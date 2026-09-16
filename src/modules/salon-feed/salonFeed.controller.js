// controllers/salon.controller.js
const db = require("../../config/db");
const { cache } = require("../../config/redis");


/**
 * GET /api/salons
 * Get paginated list of salons with search (name, categories, services)
 */
exports.getSalons = async (req, res) => {
  try {
    const { limit = 20, cursor, search } = req.query;
    const parsedLimit = Math.min(parseInt(limit) || 20, 50);

    const cacheKey = `salons:list:${search || "all"}:${cursor || "start"}:${parsedLimit}`;
    const cached = await cache.get(cacheKey);

    if (cached) {
      console.log(`✅ Cache HIT: ${cacheKey}`);
      return res.json(cached);
    }

    console.log(`⚠️ Cache MISS: ${cacheKey} - querying database`);
    console.log(`🔍 Search term: "${search}"`);

    // ✅ FIXED: Added LEFT JOIN services
    let query = `
      SELECT DISTINCT
        s.id,
        s.name,
        s.categories,
        s.logo_url,
        s.banner_url,
        s.rating_avg,
        s.created_at,
        COUNT(DISTINCT sp.id) as posts_count,
        COUNT(DISTINCT r.id) as rewards_count
      FROM salons s
      LEFT JOIN salon_posts sp ON sp.salon_id = s.id
      LEFT JOIN rewards r ON r.salon_id = s.id
      LEFT JOIN services sv ON sv.salon_id = s.id  -- ✅ ADD THIS LINE
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    // 🔍 SEARCH: name, categories, AND services
    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      query += ` AND (
        s.name ILIKE $${paramIndex}
        OR s.categories::text ILIKE $${paramIndex}
        OR sv.name ILIKE $${paramIndex}
      )`;
      params.push(searchTerm);
      paramIndex++;
      console.log(`🔍 Searching for: "${searchTerm}"`);
    }

    // 📄 PAGINATION: cursor (created_at)
    if (cursor) {
      query += ` AND s.created_at < $${paramIndex}`;
      params.push(cursor);
      paramIndex++;
    }

    query += ` GROUP BY s.id ORDER BY s.created_at DESC LIMIT $${paramIndex}`;
    params.push(parsedLimit);

    console.log("📝 Executing query...");
    const result = await db.query(query, params);

    console.log(`✅ Found ${result.rows.length} salons`);

    const salons = result.rows.map(s => ({
      id: s.id,
      name: s.name,
      categories: s.categories || [],
      logoUrl: s.logo_url,
      bannerUrl: s.banner_url,
      postsCount: parseInt(s.posts_count) || 0,
      rewardsCount: parseInt(s.rewards_count) || 0,
      rating_avg: s.rating_avg ? parseFloat(s.rating_avg) : null,
      createdAt: s.created_at
    }));

    const response = {
      success: true,
      salons,
      nextCursor: salons.length === parsedLimit
        ? salons[salons.length - 1].createdAt
        : null
    };

    await cache.set(cacheKey, response, 60);

    return res.json(response);

  } catch (err) {
    console.error("❌ getSalons error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to load salons" 
    });
  }
};
/**
 * GET /api/salons/:id
 * Get detailed salon profile
 * Cache: 5 minutes
 */
exports.getSalonProfile = async (req, res) => {
  try {
    const { id } = req.params;

    const cacheKey = `salon:profile:${id}`;
    const cached = await cache.get(cacheKey);

    if (cached) {
      console.log(`✅ Cache HIT: ${cacheKey}`);
      return res.json(cached);
    }

    console.log(`⚠️ Cache MISS: ${cacheKey} - querying database`);

    const result = await db.query(
      `
      SELECT 
        s.id,
        s.name,
       
        s.bio,
        s.phone,
      
        s.location,
        s.socials,
        s.logo_url,
        s.banner_url,
        s.categories,
        s.created_at,
        COUNT(DISTINCT sp.id) as posts_count,
        COUNT(DISTINCT r.id) as rewards_count,
        (SELECT AVG(rating) FROM reviews WHERE salon_id = s.id) as rating_avg,
        (SELECT COUNT(*) FROM reviews WHERE salon_id = s.id) as rating_count
      FROM salons s
      LEFT JOIN salon_posts sp ON sp.salon_id = s.id
      LEFT JOIN rewards r ON r.salon_id = s.id
      WHERE s.id = $1
      GROUP BY s.id
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Salon not found" 
      });
    }

    const salon = result.rows[0];

    const response = {
      success: true,
      salon: {
        id: salon.id,
        name: salon.name,
        bio: salon.bio,
        phone: salon.phone,
        
        location: salon.location,
        socials: salon.socials || {},
        categories: salon.categories || [],
        logoUrl: salon.logo_url,
        bannerUrl: salon.banner_url,
        postsCount: parseInt(salon.posts_count) || 0,
        rewardsCount: parseInt(salon.rewards_count) || 0,
        ratingAvg: salon.rating_avg ? parseFloat(salon.rating_avg) : null,
        ratingCount: parseInt(salon.rating_count) || 0,
        createdAt: salon.created_at
      }
    };

    await cache.set(cacheKey, response, 300); // 5 minutes

    res.json(response);

  } catch (err) {
    console.error("❌ getSalonProfile error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to load salon profile" 
    });
  }
};

/**
 * GET /api/salons/:id/gallery
 * Get salon gallery images from salon_posts
 * Cache: 60 seconds
 */
exports.getSalonGallery = async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 20, cursor } = req.query;
    const parsedLimit = Math.min(parseInt(limit) || 20, 50);

    const cacheKey = `salon:${id}:gallery:${cursor || "start"}:${parsedLimit}`;
    const cached = await cache.get(cacheKey);

    if (cached) {
      console.log(`✅ Cache HIT: ${cacheKey}`);
      return res.json(cached);
    }

    console.log(`⚠️ Cache MISS: ${cacheKey} - querying database`);

    let query = `
      SELECT 
        spi.id as image_id,
        spi.image_url,
        spi.position,
        sp.id as post_id,
        sp.created_at
      FROM salon_posts sp
      JOIN salon_post_images spi ON spi.post_id = sp.id
      WHERE sp.salon_id = $1
      AND sp.visibility = 'public'
    `;

    const params = [id];
    let paramIndex = 2;

    if (cursor) {
      query += ` AND sp.created_at < $${paramIndex}`;
      params.push(cursor);
      paramIndex++;
    }

    query += ` ORDER BY sp.created_at DESC, spi.position ASC LIMIT $${paramIndex}`;
    params.push(parsedLimit);

    const result = await db.query(query, params);

    const images = result.rows.map(img => ({
      id: img.image_id,
      url: img.image_url,
      postId: img.post_id,
      position: img.position,
      createdAt: img.created_at
    }));

    const response = {
      success: true,
      images,
      nextCursor: images.length === parsedLimit
        ? images[images.length - 1].createdAt
        : null
    };

    await cache.set(cacheKey, response, 60);

    res.json(response);

  } catch (err) {
    console.error("❌ getSalonGallery error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to load gallery" 
    });
  }
};

/**
 * GET /api/salons/:id/services
 * Get salon services
 * Cache: 5 minutes
 */
exports.getSalonServices = async (req, res) => {
  try {
    const { id } = req.params;

    const cacheKey = `salon:${id}:services`;
    const cached = await cache.get(cacheKey);

    if (cached) {
      console.log(`✅ Cache HIT: ${cacheKey}`);
      return res.json(cached);
    }

    console.log(`⚠️ Cache MISS: ${cacheKey} - querying database`);

    const result = await db.query(
      `
      SELECT 
        id,
        name,
        category,
        
        price,
        points,
        image_url,
        video_url,
        created_at
      FROM services
      WHERE salon_id = $1
      AND is_active = true
      ORDER BY category, name ASC
      `,
      [id]
    );

    const services = result.rows.map(s => ({
      id: s.id,
      name: s.name,
      category: s.category,
      
      price: s.price,
      points: s.points,
      imageUrl: s.image_url,
      videoUrl: s.video_url,
      createdAt: s.created_at
    }));

    const response = {
      success: true,
      services
    };

    await cache.set(cacheKey, response, 300); // 5 minutes

    res.json(response);

  } catch (err) {
    console.error("❌ getSalonServices error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to load services" 
    });
  }
};

/**
 * GET /api/salons/:id/reviews
 * Get paginated reviews for a salon
 * Cache: 60 seconds
 */
exports.getSalonReviews = async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 10, cursor } = req.query;
    const parsedLimit = Math.min(parseInt(limit) || 10, 30);

    const cacheKey = `salon:${id}:reviews:${cursor || "start"}:${parsedLimit}`;
    const cached = await cache.get(cacheKey);

    if (cached) {
      console.log(`✅ Cache HIT: ${cacheKey}`);
      return res.json(cached);
    }

    console.log(`⚠️ Cache MISS: ${cacheKey} - querying database`);

    let query = `
      SELECT 
        r.id,
        r.rating,
        r.comment,
        r.created_at,
        u.name as customer_name
      FROM reviews r
      JOIN users u ON u.id = r.customer_id
      WHERE r.salon_id = $1
    `;

    const params = [id];
    let paramIndex = 2;

    if (cursor) {
      query += ` AND r.created_at < $${paramIndex}`;
      params.push(cursor);
      paramIndex++;
    }

    query += ` ORDER BY r.created_at DESC LIMIT $${paramIndex}`;
    params.push(parsedLimit);

    const result = await db.query(query, params);

    const reviews = result.rows.map(row => ({
      id: row.id,
      customerName: row.customer_name,
      rating: row.rating,
      comment: row.comment,
      createdAt: row.created_at,
    }));

    const nextCursor = reviews.length === parsedLimit
      ? reviews[reviews.length - 1].createdAt
      : null;

    const response = {
      success: true,
      reviews,
      nextCursor,
    };

    await cache.set(cacheKey, response, 60); // 60 seconds

    res.json(response);
  } catch (err) {
    console.error('❌ getSalonReviews error:', err);
    res.status(500).json({ success: false, message: "Failed to load reviews" });
  }
};

/**
 * GET /api/salons/:id/rewards-count
 * Get salon rewards count
 * Cache: 5 minutes
 */
exports.getSalonRewardsCount = async (req, res) => {
  try {
    const { id } = req.params;

    const cacheKey = `salon:${id}:rewards`;
    const cached = await cache.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const result = await db.query(
      `
      SELECT COUNT(*) as count
      FROM rewards
      WHERE salon_id = $1 AND is_active = true
      `,
      [id]
    );

    const response = {
      success: true,
      count: parseInt(result.rows[0].count) || 0
    };

    await cache.set(cacheKey, response, 300);

    res.json(response);

  } catch (err) {
    console.error("❌ getSalonRewardsCount error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to load rewards count" 
    });
  }
};