const { v4: uuidv4 } = require('uuid');
const db = require('../../config/db');
const { redis, cache } = require('../../config/redis'); // Import both redis and cache

/**
 * Create a new salon post
 * POST /api/salon/posts
 * 
 * Request body: {
 *   "caption": "Fresh braids ✨",
 *   "images": ["https://cdn.com/img1.jpg", "https://cdn.com/img2.jpg"]
 * }
 */
exports.createSalonPost = async (req, res) => {
  const client = await db.pool.connect();
  
  console.log('\n📝 ===== CREATE SALON POST =====');
  console.log('📌 req.user:', req.user); // 👈 ADD THIS

  try {
    // 👇 CRITICAL: Check if salonId exists
    const salonId = req.user?.salonId;
    
    console.log('📌 salonId from token:', salonId);
    console.log('📌 salonId type:', typeof salonId);
    console.log('📌 salonId value:', JSON.stringify(salonId));

    if (!salonId) {
      console.log('❌ No salonId in token!');
      return res.status(400).json({
        success: false,
        message: 'Salon ID not found in token. Please login again.'
      });
    }

    const { caption, images } = req.body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one image is required'
      });
    }

    await client.query('BEGIN');

    const postId = uuidv4();
    const coverImage = images[0];

    // Create post with explicit salonId
    await client.query(
      `
      INSERT INTO salon_posts
      (id, salon_id, caption, cover_image_url, like_count, comment_count, visibility)
      VALUES ($1, $2, $3, $4, 0, 0, 'public')
      `,
      [postId, salonId, caption || null, coverImage]  // 👈 salonId is used here
    );

    console.log('✅ Post inserted with salonId:', salonId);

    // Insert images
    for (let i = 0; i < images.length; i++) {
      await client.query(
        `
        INSERT INTO salon_post_images
        (id, post_id, image_url, position)
        VALUES ($1, $2, $3, $4)
        `,
        [uuidv4(), postId, images[i], i]
      );
    }

    await client.query('COMMIT');
    console.log('✅ Post created successfully with ID:', postId);

    // Verify the post was saved correctly
    const verifyPost = await client.query(
      `SELECT id, salon_id FROM salon_posts WHERE id = $1`,
      [postId]
    );
    console.log('✅ Verified post in DB:', verifyPost.rows[0]);

    // Redis invalidation
    await cache.del(`salon:${salonId}:posts`);
    const feedKeys = await redis.keys('feed:*');
    if (feedKeys.length > 0) {
      await redis.del(feedKeys);
    }

    return res.status(201).json({
      success: true,
      post: {
        id: postId,
        caption: caption || '',
        images: images,
        coverImage: coverImage,
        imageCount: images.length,
        createdAt: new Date().toISOString(),
        likes: 0,
        comments: 0
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Create Post Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create post'
    });
  } finally {
    client.release();
  }
};
/**
 * Get all posts for a salon (profile gallery)
 * GET /api/salon/posts
 */
exports.getSalonPosts = async (req, res) => {
  try {
    const salonId = req.user.salonId;
    const { limit = 20, cursor } = req.query;

    console.log('\n📸 ===== GET SALON POSTS =====');
    console.log('📌 salonId from token:', salonId);

    let query = `
      SELECT 
        p.id,
        p.salon_id,
        p.caption,
        p.cover_image_url,
        p.like_count,
        p.comment_count,
        p.created_at,
        p.visibility,
        (
          SELECT json_agg(
            json_build_object(
              'id', i.id,
              'url', i.image_url,
              'position', i.position
            ) ORDER BY i.position ASC
          )
          FROM salon_post_images i
          WHERE i.post_id = p.id
        ) as images
      FROM salon_posts p
      WHERE p.salon_id = $1
      AND p.visibility = 'public'
    `;

    const params = [salonId];
    let paramIndex = 2;

    if (cursor) {
      query += ` AND p.created_at < $${paramIndex}`;
      params.push(cursor);
      paramIndex++;
    }

    query += ` ORDER BY p.created_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit));

    console.log('📊 Query:', query);
    console.log('📊 Params:', params);

    const result = await db.query(query, params);
    
    console.log(`✅ Found ${result.rows.length} posts`);
    
    // 👇 FIXED: Use for...of loop instead of forEach
    for (let i = 0; i < result.rows.length; i++) {
      const post = result.rows[i];
      console.log(`\n📦 POST ${i + 1}:`);
      console.log('   id:', post.id);
      console.log('   salon_id:', post.salon_id);
      console.log('   caption:', post.caption ? post.caption.substring(0, 50) + '...' : '(empty)');
      console.log('   cover_image_url:', post.cover_image_url);
      console.log('   like_count:', post.like_count);
      console.log('   comment_count:', post.comment_count);
      console.log('   created_at:', post.created_at);
      console.log('   images array:', post.images ? JSON.stringify(post.images, null, 2) : 'NO IMAGES');
      
      // Check if images array exists and has items
      if (post.images && post.images.length > 0) {
        console.log(`   ✅ Found ${post.images.length} images:`);
        for (let j = 0; j < post.images.length; j++) {
          const img = post.images[j];
          console.log(`      Image ${j + 1}:`, {
            id: img.id,
            url: img.url?.substring(0, 50) + '...',
            position: img.position
          });
        }
      } else {
        console.log('   ❌ No images in post.images array');
        
        // Direct image query - using await is fine here because we're in an async function
        const imageCheck = await db.query(
          `SELECT * FROM salon_post_images WHERE post_id = $1`,
          [post.id]
        );
        console.log(`   📊 Direct image query for post ${post.id}:`, imageCheck.rows);
      }
    }

    // Transform to camelCase for frontend
    const posts = result.rows.map(row => ({
      id: row.id,
      salonId: row.salon_id,
      caption: row.caption || '',
      coverImageUrl: row.cover_image_url,
      likeCount: row.like_count || 0,
      commentCount: row.comment_count || 0,
      createdAt: row.created_at,
      images: row.images || []  // Ensure images is always an array
    }));

    console.log('\n📤 SENDING TO FRONTEND:');
    console.log('   Total posts:', posts.length);
    if (posts.length > 0) {
      console.log('   First post structure:', JSON.stringify(posts[0], null, 2));
    }

    return res.json({
      success: true,
      posts: posts,
      nextCursor: posts.length ? posts[posts.length - 1].createdAt : null
    });

  } catch (error) {
    console.error('❌ Error getting posts:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get posts'
    });
  }
};
exports.deleteSalonPost = async (req, res) => {
  const client = await db.pool.connect();

  try {
    const salonId = req.user.salonId;
    const { postId } = req.params;

    console.log('\n🗑️ ===== DELETE SALON POST =====');
    console.log('📌 Salon ID:', salonId);
    console.log('📌 Post ID:', postId);

    // Verify post belongs to salon
    const checkRes = await client.query(
      `SELECT id FROM salon_posts WHERE id = $1 AND salon_id = $2`,
      [postId, salonId]
    );

    if (checkRes.rows.length === 0) {
      console.log('❌ Post not found or unauthorized');
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    await client.query('BEGIN');

    // Delete post (cascades to images automatically)
    await client.query(
      `DELETE FROM salon_posts WHERE id = $1`,
      [postId]
    );

    await client.query('COMMIT');
    console.log('✅ Post deleted from database');

    // Invalidate caches
    console.log('🧹 Clearing Redis caches...');
    
    await cache.del(`post:${postId}`);
    await cache.del(`salon:${salonId}:posts`);
    
    const feedKeys = await redis.keys('feed:*');
    if (feedKeys.length > 0) {
      await redis.del(feedKeys);
      console.log(`✅ Cleared ${feedKeys.length} feed caches`);
    }

    console.log('✅ Post deleted successfully');

    return res.json({
      success: true,
      message: 'Post deleted successfully'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error deleting post:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete post'
    });
  } finally {
    client.release();
  }
}; 



