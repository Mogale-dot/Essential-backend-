const db = require("../../config/db");
const { cache } = require("../../config/redis");

/**
 * GET /api/search
 * Unified search endpoint - searches salons, services, categories, and owners
 * Query params: q (search term), limit (default 5 per category)
 */
exports.unifiedSearch = async (req, res) => {
  try {
    const { q, limit = 5 } = req.query;
    
    if (!q || !q.trim()) {
      return res.status(400).json({
        success: false,
        message: "Search term is required",
      });
    }

    const searchTerm = `%${q.trim()}%`;
    const parsedLimit = Math.min(parseInt(limit) || 5, 20);

    console.log(`🔍 Unified Search: "${q.trim()}"`);

    // Cache key for 60 seconds
    const cacheKey = `search:${q.trim()}:${parsedLimit}`;
    const cached = await cache.get(cacheKey);
    
    if (cached) {
      console.log(`✅ Search cache HIT: ${cacheKey}`);
      return res.json(cached);
    }

    console.log(`⚠️ Search cache MISS: ${cacheKey}`);

    // ===============================
    // 1️⃣ SEARCH SALONS
    // ===============================
    const salonsQuery = `
      SELECT 
        s.id,
        s.name,
        s.categories,
        s.location,
        s.rating_avg,
        s.logo_url,
        s.banner_url
      FROM salons s
      WHERE s.deleted_at IS NULL
        AND (
          s.name ILIKE $1
          OR s.categories::text ILIKE $1
          OR s.location ILIKE $1
        )
      ORDER BY 
        CASE 
          WHEN s.name ILIKE $1 THEN 1
          WHEN s.categories::text ILIKE $1 THEN 2
          ELSE 3
        END,
        s.rating_avg DESC NULLS LAST
      LIMIT $2
    `;
    
    const salonsResult = await db.query(salonsQuery, [searchTerm, parsedLimit]);
    console.log(`🏢 Found ${salonsResult.rows.length} salons`);

    // ===============================
    // 2️⃣ SEARCH SERVICES
    // ===============================
    const servicesQuery = `
      SELECT 
        sv.id,
        sv.name,
        sv.price,
        sv.category as service_category,
        s.id as salon_id,
        s.name as salon_name,
        s.logo_url as salon_logo
      FROM services sv
      JOIN salons s ON s.id = sv.salon_id
      WHERE sv.name ILIKE $1
      ORDER BY sv.name ILIKE $1 DESC
      LIMIT $2
    `;
    
    const servicesResult = await db.query(servicesQuery, [searchTerm, parsedLimit]);
    console.log(`💇 Found ${servicesResult.rows.length} services`);

    // ===============================
    // 3️⃣ SEARCH CATEGORIES (fixed: unnest in FROM clause)
    // ===============================
    const categoriesQuery = `
      SELECT DISTINCT cat as category, COUNT(*) as salon_count
      FROM salons, unnest(categories) AS cat
      WHERE deleted_at IS NULL
        AND categories IS NOT NULL
        AND array_length(categories, 1) > 0
        AND cat ILIKE $1
      GROUP BY cat
      ORDER BY salon_count DESC
      LIMIT $2
    `;
    
    const categoriesResult = await db.query(categoriesQuery, [searchTerm, parsedLimit]);
    console.log(`📂 Found ${categoriesResult.rows.length} categories`);

    // ===============================
    // 4️⃣ SEARCH SALON OWNERS
    // ===============================
    const ownersQuery = `
      SELECT 
        u.id as user_id,
        u.name as owner_name,
        u.email as owner_email,
        s.id as salon_id,
        s.name as salon_name,
        s.logo_url as salon_logo
      FROM users u
      JOIN salons s ON s.owner_id = u.id
      WHERE u.deleted_at IS NULL
        AND s.deleted_at IS NULL
        AND u.role = 'salon_owner'
        AND u.name ILIKE $1
      ORDER BY u.name ILIKE $1 DESC
      LIMIT $2
    `;
    
    const ownersResult = await db.query(ownersQuery, [searchTerm, parsedLimit]);
    console.log(`👤 Found ${ownersResult.rows.length} salon owners`);

    // ===============================
    // 5️⃣ BUILD RESPONSE
    // ===============================
    const response = {
      success: true,
      searchTerm: q.trim(),
      results: {
        salons: salonsResult.rows.map(function(s) {
          return {
            id: s.id,
            name: s.name,
            categories: s.categories || [],
            location: s.location,
            rating: s.rating_avg ? parseFloat(s.rating_avg) : null,
            logoUrl: s.logo_url,
            bannerUrl: s.banner_url,
            type: "salon"
          };
        }),
        services: servicesResult.rows.map(function(s) {
          return {
            id: s.id,
            name: s.name,
            price: s.price,
            category: s.service_category,
            salonId: s.salon_id,
            salonName: s.salon_name,
            salonLogo: s.salon_logo,
            type: "service"
          };
        }),
        categories: categoriesResult.rows.map(function(c) {
          return {
            name: c.category,
            salonCount: parseInt(c.salon_count),
            type: "category"
          };
        }),
        owners: ownersResult.rows.map(function(o) {
          return {
            id: o.user_id,
            name: o.owner_name,
            email: o.owner_email,
            salonId: o.salon_id,
            salonName: o.salon_name,
            salonLogo: o.salon_logo,
            type: "owner"
          };
        })
      },
      meta: {
        totalSalons: salonsResult.rows.length,
        totalServices: servicesResult.rows.length,
        totalCategories: categoriesResult.rows.length,
        totalOwners: ownersResult.rows.length,
        limit: parsedLimit
      }
    };

    // Cache for 60 seconds
    await cache.set(cacheKey, response, 60);

    return res.json(response);

  } catch (error) {
    console.error("❌ Unified Search Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to perform search",
      error: error.message
    });
  }
};

/**
 * GET /api/search/recent
 * Get recent searches for a customer (stored in Redis)
 */
exports.getRecentSearches = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const recentKey = `user:${userId}:recent_searches`;
    const recent = await cache.get(recentKey);
    
    const searches = recent ? JSON.parse(recent) : [];

    return res.json({
      success: true,
      searches: searches
    });

  } catch (error) {
    console.error("❌ Get Recent Searches Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get recent searches"
    });
  }
};

/**
 * POST /api/search/recent
 * Save a recent search
 */
exports.saveRecentSearch = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { term } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!term || !term.trim()) {
      return res.status(400).json({
        success: false,
        message: "Search term is required",
      });
    }

    const recentKey = `user:${userId}:recent_searches`;
    let recent = await cache.get(recentKey);
    let searches = recent ? JSON.parse(recent) : [];

    // Remove if exists (to move to front) - FIXED: removed TypeScript annotation
    searches = searches.filter(function(s) {
      return s.toLowerCase() !== term.toLowerCase();
    });
    
    // Add to front
    searches.unshift(term.trim());
    
    // Keep only last 10
    searches = searches.slice(0, 10);

    await cache.set(recentKey, JSON.stringify(searches), 60 * 60 * 24 * 30); // 30 days

    return res.json({
      success: true,
      searches: searches
    });

  } catch (error) {
    console.error("❌ Save Recent Search Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save recent search"
    });
  }
};

/**
 * DELETE /api/search/recent
 * Clear all recent searches
 */
exports.clearRecentSearches = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const recentKey = `user:${userId}:recent_searches`;
    await cache.del(recentKey);

    return res.json({
      success: true,
      message: "Recent searches cleared"
    });

  } catch (error) {
    console.error("❌ Clear Recent Searches Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to clear recent searches"
    });
  }
};