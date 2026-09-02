 
const db = require('../../config/db');
const calculateRewardPoints = require('../../utils/calculateRewardPoints');
const validateRewards = require('../../utils/validateRewards');
const { cache } = require("../../config/redis");

/**
 * SETUP rewards (Admin)
 * Overwrites existing rewards
 */
exports.createRewards = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
       // 🔑
    const ownerId = req.user.id;
  const { rewards } = req.body;

  validateRewards(rewards);

  // 1️⃣ Get salon_id for this owner
  const salonResult = await client.query(
    'SELECT id FROM salons WHERE owner_id = $1',
    [ownerId]
  );

  if (!salonResult.rows.length) {
    return res.status(404).json({ message: 'Salon not found' });
  }

  const salonId = salonResult.rows[0].id;

  // 2️⃣ Check services using salon_id (CORRECT)
  const services = await client.query(
    'SELECT id , points FROM services WHERE salon_id = $1',
    [salonId]
  );

  if (!services.rows.length) {
    return res
      .status(400)
      .json({ message: 'Add services before creating rewards' });
  }


    const tierPoints = calculateRewardPoints(
      services.rows.map(s => s.points)
    );

    await client.query('BEGIN');

    await client.query(
      'DELETE FROM rewards WHERE salon_id = $1',
      [salonId]
    );

    const inserted = [];

    for (const reward of rewards) {
      const { rows } = await client.query(
        `
        INSERT INTO rewards
        (salon_id, tier, title, description, points_required)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        `,
        [
          salonId,
          reward.tier,
          reward.title,
          reward.description || null,
          tierPoints[reward.tier]
        ]
      );

      inserted.push(rows[0]);
    }

    await client.query('COMMIT');

    res.status(201).json(inserted);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};





/**
 * GET /rewards
 * Get all rewards for the authenticated admin's salon
 * Cache: 5 minutes
 */
// ==============================================
// UPDATED: getRewards with logging
// ==============================================
exports.getRewards = async (req, res) => {
  try {
    const salonId = req.user.salonId;

    const cacheKey = `salon:${salonId}:rewards`;
    const cached = await cache.get(cacheKey);

    if (cached) {
      console.log(`✅ Cache HIT: ${cacheKey} (${cached.length} rewards)`);
      return res.json({ success: true, rewards: cached });
    }

    console.log(`⚠️ Cache MISS: ${cacheKey} - querying database`);

    const result = await db.query(
      `
      SELECT 
        id,
        tier,
        title,
        description,
        points_required,
        is_active,
        created_at
      FROM rewards
      WHERE salon_id = $1
      ORDER BY 
        CASE tier 
          WHEN 'basic' THEN 1
          WHEN 'standard' THEN 2
          WHEN 'premium' THEN 3
          WHEN 'vip' THEN 4
          ELSE 5
        END,
        created_at DESC
      `,
      [salonId]
    );

    const rewards = result.rows;
    console.log(`📊 Database returned ${rewards.length} rewards for salon ${salonId}`);
   


    await cache.set(cacheKey, rewards, 300); // 5 minutes

    res.json({ success: true, rewards });

  } catch (err) {
    console.error("❌ getRewards error:", err);
    res.status(500).json({ success: false, message: "Failed to load rewards" });
  }
};

// ==============================================
// UPDATED: createRewards with cache invalidation
// ==============================================
exports.createRewards = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const ownerId = req.user.id;
    const { rewards } = req.body;

    validateRewards(rewards);

    // 1️⃣ Get salon_id for this owner
    const salonResult = await client.query(
      'SELECT id FROM salons WHERE owner_id = $1',
      [ownerId]
    );

    if (!salonResult.rows.length) {
      return res.status(404).json({ message: 'Salon not found' });
    }

    const salonId = salonResult.rows[0].id;

    // 2️⃣ Check services
    const services = await client.query(
      'SELECT id, points FROM services WHERE salon_id = $1',
      [salonId]
    );

    if (!services.rows.length) {
      return res
        .status(400)
        .json({ message: 'Add services before creating rewards' });
    }

    const tierPoints = calculateRewardPoints(
      services.rows.map(s => s.points)
    );

    await client.query('BEGIN');

    // Delete existing rewards
    await client.query(
      'DELETE FROM rewards WHERE salon_id = $1',
      [salonId]
    );

    const inserted = [];

    for (const reward of rewards) {
      const { rows } = await client.query(
        `
        INSERT INTO rewards
        (salon_id, tier, title, description, points_required)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        `,
        [
          salonId,
          reward.tier,
          reward.title,
          reward.description || null,
          tierPoints[reward.tier]
        ]
      );

      inserted.push(rows[0]);
    }

    await client.query('COMMIT');

    // 🔥 Invalidate cache after new rewards are created
    await cache.del(`salon:${salonId}:rewards`);
    console.log(`🗑️ Cache invalidated for salon:${salonId}:rewards`);

    res.status(201).json(inserted);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

/**
 * DELETE /rewards/:id
 * Delete a reward, but ensure the tier still has at least one reward after deletion
 */
exports.deleteReward = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const salonId = req.user.salonId;
    const { id } = req.params;

    // 1️⃣ Check if reward exists and belongs to this salon
    const rewardCheck = await client.query(
      `SELECT id, tier FROM rewards WHERE id = $1 AND salon_id = $2`,
      [id, salonId]
    );

    if (rewardCheck.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Reward not found" 
      });
    }

    const reward = rewardCheck.rows[0];

    await client.query('BEGIN');

    // 2️⃣ Count how many rewards in this tier (including the one we're about to delete)
    const countResult = await client.query(
      `SELECT COUNT(*) as count FROM rewards WHERE salon_id = $1 AND tier = $2`,
      [salonId, reward.tier]
    );

    const tierCount = parseInt(countResult.rows[0].count);

    if (tierCount <= 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Cannot delete the only reward in ${reward.tier} tier. Please add another reward first.`
      });
    }

    // 3️⃣ Perform the deletion
    await client.query(
      `DELETE FROM rewards WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');

    // 4️⃣ Invalidate cache
    await cache.del(`salon:${salonId}:rewards`);

    res.json({ 
      success: true, 
      message: "Reward deleted successfully" 
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("❌ deleteReward error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to delete reward" 
    });
  } finally {
    client.release();
  }
};