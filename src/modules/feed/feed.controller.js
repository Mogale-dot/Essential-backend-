const db = require("../../config/db");
const { cache } = require("../../config/redis");

/**
 * GET /api/feed
 * Customer Feed (Authenticated)
 * Cached for 60 seconds
 */
exports.getFeed = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { cursor, limit = 10 } = req.query;
    const parsedLimit = Math.min(parseInt(limit) || 10, 20);

    // ✅ Parse cursor (format could be "timestamp:id" or just "timestamp")
    let cursorTimestamp = null;
    let cursorId = null;
    
    if (cursor) {
      const parts = cursor.split(':');
      if (parts.length >= 2) {
        // Format: "timestamp:id"
        cursorTimestamp = parts.slice(0, -1).join(':');
        cursorId = parts[parts.length - 1];
      } else {
        // Format: just timestamp
        cursorTimestamp = cursor;
      }
      
      // ✅ Parse the date regardless of format
      const parsedDate = parseCursorDate(cursorTimestamp);
      if (parsedDate) {
        cursorTimestamp = parsedDate;
      } else {
        console.warn("⚠️ Invalid cursor timestamp, ignoring cursor");
        cursorTimestamp = null;
        cursorId = null;
      }
    }

    const cacheKey = `feed:${userId}:${cursor || "first"}:${parsedLimit}`;
    
    // Check cache
    const cachedData = await cache.get(cacheKey);
    if (cachedData) {
      console.log(`✅ Feed cache HIT for user ${userId}`);
      return res.json(cachedData);
    }

    console.log(`⚠️ Feed cache MISS for user ${userId}`);

    // Build query
    let query = `
      SELECT 
        p.id,
        p.caption,
        p.cover_image_url,
        p.like_count,
        p.comment_count,
        p.created_at,

        s.id as salon_id,
        s.name as salon_name,
        s.logo_url as salon_logo,

        (
          SELECT json_agg(
            json_build_object(
              'id', i.id,
              'url', i.image_url,
              'position', i.position
            )
            ORDER BY i.position ASC
          )
          FROM salon_post_images i
          WHERE i.post_id = p.id
        ) as images

      FROM salon_posts p
      JOIN salons s ON s.id = p.salon_id
      WHERE p.visibility = 'public'
    `;

    const params = [];
    let paramIndex = 1;

    // Use composite cursor
    if (cursorTimestamp) {
      if (cursorId) {
        query += ` AND (p.created_at < $${paramIndex} OR (p.created_at = $${paramIndex} AND p.id < $${paramIndex + 1}))`;
        params.push(cursorTimestamp, cursorId);
        paramIndex += 2;
      } else {
        query += ` AND p.created_at < $${paramIndex}`;
        params.push(cursorTimestamp);
        paramIndex++;
      }
    }

    query += ` ORDER BY p.created_at DESC, p.id DESC LIMIT $${paramIndex}`;
    params.push(parsedLimit + 1);

    const result = await db.query(query, params);
    console.log(`📊 Query returned ${result.rows.length} rows`);

    // Check if we have more items
    const hasMore = result.rows.length > parsedLimit;
    const items = hasMore ? result.rows.slice(0, parsedLimit) : result.rows;

    // Remove duplicates (safety net)
    const uniqueRows = [];
    const seenIds = new Set();
    
    for (const row of items) {
      if (!seenIds.has(row.id)) {
        seenIds.add(row.id);
        uniqueRows.push(row);
      }
    }

    const posts = uniqueRows.map(row => ({
      id: row.id,
      caption: row.caption || "",
      coverImageUrl: row.cover_image_url,
      likeCount: Number(row.like_count) || 0,
      commentCount: Number(row.comment_count) || 0,
      createdAt: row.created_at,
      salon: {
        id: row.salon_id,
        name: row.salon_name,
        logoUrl: row.salon_logo,
      },
      images: row.images || [],
    }));

    // Get like state
    if (posts.length > 0) {
      const postIds = posts.map(p => p.id);
      const likeQuery = `
        SELECT post_id
        FROM post_likes
        WHERE user_id = $1
        AND post_id = ANY($2::uuid[])
      `;
      const likeResult = await db.query(likeQuery, [userId, postIds]);
      const likedMap = Object.fromEntries(
        likeResult.rows.map(row => [row.post_id, true])
      );

      posts.forEach(post => {
        post.isLiked = !!likedMap[post.id];
      });
    }

    // Create next cursor with BOTH timestamp and id
    let nextCursor = null;
    if (hasMore && posts.length > 0) {
      const lastPost = posts[posts.length - 1];
      // ✅ Use ISO string for consistent format
      const isoDate = new Date(lastPost.createdAt).toISOString();
      nextCursor = `${isoDate}:${lastPost.id}`;
    }

    const response = {
      success: true,
      posts,
      nextCursor,
    };

    // Cache for 60 seconds
    await cache.set(cacheKey, response, 60);

    return res.json(response);

  } catch (error) {
    console.error("❌ Feed Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load feed",
    });
  }
};

// Helper function to parse any date format into PostgreSQL-compatible timestamp
function parseCursorDate(cursorDate) {
  if (!cursorDate) return null;
  
  // If it's already in ISO format (YYYY-MM-DDTHH:mm:ss.sssZ)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(cursorDate)) {
    return cursorDate;
  }
  
  try {
    // Try to parse JavaScript Date string
    const date = new Date(cursorDate);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  } catch (e) {
    console.warn("Failed to parse date:", cursorDate);
  }
  
  return null;
}
/**
 * POST /api/posts/:postId/like
 * Toggle like on a post
 */exports.toggleLike = async (req, res) => {
  const client = await db.pool.connect();
  
  try {
    const userId = req.user?.id;
    const { postId } = req.params;

    console.log('\n❤️ ===== TOGGLE LIKE =====');
    console.log('📌 User ID:', userId);
    console.log('📌 Post ID from params:', postId);
    console.log('📌 Post ID type:', typeof postId);
    console.log('📌 Post ID length:', postId?.length);
    console.log('📌 Full params:', req.params);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!postId) {
      return res.status(400).json({
        success: false,
        message: "Post ID is required",
      });
    }

    // First, let's check what posts exist in the database
    const allPosts = await client.query(`SELECT id FROM salon_posts LIMIT 5`);
    console.log('📊 Sample posts in DB:', allPosts.rows);

    // Check if the post exists
    console.log('🔍 Looking for post with ID:', postId);
    const postCheck = await client.query(
      `SELECT id FROM salon_posts WHERE id = $1`,
      [postId]
    );

    console.log('📊 Post check result:', postCheck.rows);

    if (postCheck.rows.length === 0) {
      console.log('❌ Post not found in database');
      
      // Try case-insensitive search
      const caseInsensitive = await client.query(
        `SELECT id FROM salon_posts WHERE LOWER(id::text) = LOWER($1)`,
        [postId]
      );
      console.log('📊 Case-insensitive search:', caseInsensitive.rows);
      
      // Try trimming spaces
      const trimmedSearch = await client.query(
        `SELECT id FROM salon_posts WHERE TRIM(id::text) = TRIM($1)`,
        [postId]
      );
      console.log('📊 Trimmed search:', trimmedSearch.rows);
      
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: "Post not found",
        debug: {
          sentPostId: postId,
          postIdType: typeof postId,
          postIdLength: postId.length,
          postIdChars: postId.split('').map(c => c.charCodeAt(0)),
          sampleDbIds: allPosts.rows.map(r => r.id)
        }
      });
    }

    await client.query('BEGIN');

    // Check if like exists
    const likeCheck = await client.query(
      `SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2`,
      [postId, userId]
    );

    const isLiked = likeCheck.rows.length > 0;
    console.log('📊 Current like status:', isLiked ? 'Liked' : 'Not liked');

    if (isLiked) {
      // Unlike - remove like
      console.log('➖ Removing like...');
      await client.query(
        `DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2`,
        [postId, userId]
      );
      
      await client.query(
        `UPDATE salon_posts SET like_count = like_count - 1 WHERE id = $1`,
        [postId]
      );
      
      console.log('✅ Post unliked');
    } else {
      // Like - add like
      console.log('➕ Adding like...');
      await client.query(
        `INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)`,
        [postId, userId]
      );
      
      await client.query(
        `UPDATE salon_posts SET like_count = like_count + 1 WHERE id = $1`,
        [postId]
      );
      
      console.log('✅ Post liked');
    }

    await client.query('COMMIT');
    console.log('✅ Transaction committed');

    // Invalidate relevant caches
    // Feed cache will expire naturally (60s TTL)
    // Optionally invalidate specific post cache if you have one
    await cache.del(`post:${postId}`);
    console.log('🗑️ Cache invalidated for post:', postId);

    // Get updated like count
    const updatedPost = await client.query(
      `SELECT like_count FROM salon_posts WHERE id = $1`,
      [postId]
    );

    const response = {
      success: true,
      isLiked: !isLiked,
      likeCount: updatedPost.rows[0].like_count,
    };

    console.log('📤 Response:', response);

    return res.json(response);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ Like Error:", error);
    console.error("❌ Error stack:", error.stack);
    
    return res.status(500).json({
      success: false,
      message: "Failed to toggle like",
      error: error.message
    });
  } finally {
    client.release();
    console.log('🔓 Database client released');
  }
};

/**
 * OPTIONAL: Get likes for multiple posts (batch)
 * Useful if you need to refresh like states
 */
exports.getLikesBatch = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { postIds } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!postIds || !Array.isArray(postIds) || postIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Post IDs array is required",
      });
    }

    const likeResult = await db.query(
      `
      SELECT post_id
      FROM post_likes
      WHERE user_id = $1
      AND post_id = ANY($2::uuid[])
      `,
      [userId, postIds]
    );

    const likedMap = Object.fromEntries(
      likeResult.rows.map(row => [row.post_id, true])
    );

    const result = postIds.map(id => ({
      postId: id,
      isLiked: !!likedMap[id],
    }));

    return res.json({
      success: true,
      likes: result,
    });

  } catch (error) {
    console.error("❌ Batch Likes Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get likes",
    });
  }
};