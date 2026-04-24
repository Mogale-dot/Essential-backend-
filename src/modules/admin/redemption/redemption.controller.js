const db = require('../../../config/db');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

/**
 * Helper: Get customer stats (total points and visits)
 */
const getCustomerStats = async (customerId, salonId) => {
  // Get total points from visit_services
  const pointsRes = await db.query(
    `
    SELECT COALESCE(SUM(vs.points), 0) AS total_points
    FROM visits v
    JOIN visit_services vs ON vs.visit_id = v.id
    WHERE v.customer_id = $1 AND v.salon_id = $2
    `,
    [customerId, salonId]
  );

  // Get total visits count
  const visitsRes = await db.query(
    `
    SELECT COUNT(DISTINCT v.id) AS total_visits
    FROM visits v
    WHERE v.customer_id = $1 AND v.salon_id = $2
    `,
    [customerId, salonId]
  );

  // Get total points already redeemed
  const redeemedRes = await db.query(
    `
    SELECT COALESCE(SUM(points_used), 0) AS redeemed_points
    FROM reward_redemptions
    WHERE customer_id = $1 AND salon_id = $2
    `,
    [customerId, salonId]
  );

  const totalPoints = parseInt(pointsRes.rows[0]?.total_points || 0);
  const redeemedPoints = parseInt(redeemedRes.rows[0]?.redeemed_points || 0);
  const availablePoints = totalPoints - redeemedPoints;

  return {
    total_points: totalPoints,
    redeemed_points: redeemedPoints,
    available_points: availablePoints,
    total_visits: parseInt(visitsRes.rows[0]?.total_visits || 0),
  };
};

/**
 * POST /admin/redemption/confirm
 * Admin scans QR and confirms redemption
 */
exports.confirmRedemption = async (req, res) => {
  const client = await db.pool.connect();

  try {
    const { token } = req.body;
    const adminId = req.user.id;
    const adminSalonId = req.user.salonId;

    console.log('\n🔍 ===== CONFIRM REDEMPTION =====');
    console.log('📌 Admin ID:', adminId);
    console.log('📌 Admin Salon ID:', adminSalonId);

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required',
      });
    }

    // 1️⃣ Decode and verify JWT
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      console.log('✅ Token decoded:', decoded);
    } catch (err) {
      return res.status(401).json({
        success: false,
        code: 'TOKEN_INVALID',
        message: 'Invalid or malformed token',
      });
    }

    // 2️⃣ Find token in database using jti
    const tokenRes = await client.query(
      `SELECT jti, customer_id, salon_id, reward_id, used_at 
       FROM redemption_tokens WHERE jti = $1`,
      [decoded.jti]
    );

    if (tokenRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'TOKEN_INVALID',
        message: 'Invalid redemption token',
      });
    }

    const tokenRow = tokenRes.rows[0];

    // 3️⃣ Check if already used
    if (tokenRow.used_at) {
      return res.status(409).json({
        success: false,
        code: 'TOKEN_USED',
        message: 'This reward has already been redeemed',
      });
    }

    // 4️⃣ Verify admin belongs to correct salon
    if (tokenRow.salon_id !== adminSalonId) {
      return res.status(403).json({
        success: false,
        message: 'Token not valid for this salon',
      });
    }

    // 5️⃣ Get customer stats with eligible visits
    const eligibleVisitsRes = await client.query(
      `
      SELECT COUNT(*) as eligible_count
      FROM visits
      WHERE customer_id = $1 
        AND salon_id = $2
        AND (is_used_for_redemption = false OR is_used_for_redemption IS NULL)
      `,
      [tokenRow.customer_id, tokenRow.salon_id]
    );
    const eligibleVisits = Number(eligibleVisitsRes.rows[0].eligible_count);
    console.log('📊 Eligible visits before redemption:', eligibleVisits);

    // 6️⃣ Check minimum visits requirement
    if (eligibleVisits < 3) {
      return res.status(403).json({
        success: false,
        code: 'VISIT_REQUIREMENT_NOT_MET',
        message: `Minimum 3 visits required to redeem rewards. Customer has ${eligibleVisits} eligible visit${eligibleVisits !== 1 ? 's' : ''}.`,
      });
    }

    // 7️⃣ Get points earned and redeemed
    const statsRes = await client.query(
      `
      SELECT 
        COALESCE(SUM(vs.points), 0) AS total_points_earned,
        COALESCE(
          (SELECT SUM(points_used) FROM reward_redemptions 
           WHERE customer_id = $1 AND salon_id = $2), 0
        ) AS total_points_redeemed
      FROM visits v
      LEFT JOIN visit_services vs ON vs.visit_id = v.id
      WHERE v.customer_id = $1 AND v.salon_id = $2
      `,
      [tokenRow.customer_id, tokenRow.salon_id]
    );

    const totalPointsEarned = Number(statsRes.rows[0].total_points_earned);
    const totalPointsRedeemed = Number(statsRes.rows[0].total_points_redeemed);
    const availablePoints = totalPointsEarned - totalPointsRedeemed;
    console.log('📊 Available points:', availablePoints);

    // 8️⃣ Get reward details
    const rewardRes = await client.query(
      `SELECT id, title, points_required FROM rewards WHERE id = $1`,
      [tokenRow.reward_id]
    );

    if (rewardRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Reward not found',
      });
    }

    const reward = rewardRes.rows[0];
    const pointsRequired = Number(reward.points_required);
    console.log('📊 Reward points required:', pointsRequired);

    // 9️⃣ Check sufficient points
    if (availablePoints < pointsRequired) {
      return res.status(403).json({
        success: false,
        code: 'INSUFFICIENT_POINTS',
        message: 'Customer does not have enough points',
        details: {
          available: availablePoints,
          required: pointsRequired,
        },
      });
    }

    // 🔟 Start transaction
    await client.query('BEGIN');

    try {
      // Record redemption
      const redemptionRes = await client.query(
        `
        INSERT INTO reward_redemptions 
        (customer_id, salon_id, reward_id, points_used, visits_at_redeem)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, redeemed_at
        `,
        [
          tokenRow.customer_id,
          tokenRow.salon_id,
          reward.id,
          pointsRequired,
          eligibleVisits,
        ]
      );

      // Mark the 3 most recent eligible visits as used for redemption
      const updateVisitsRes = await client.query(
        `
        UPDATE visits
        SET is_used_for_redemption = true
        WHERE id IN (
          SELECT id FROM visits
          WHERE customer_id = $1 
            AND salon_id = $2
            AND (is_used_for_redemption = false OR is_used_for_redemption IS NULL)
          ORDER BY created_at ASC
          LIMIT 3
        )
        RETURNING id, created_at
        `,
        [tokenRow.customer_id, tokenRow.salon_id]
      );
      console.log(`✅ Marked ${updateVisitsRes.rowCount} visit(s) as used for redemption`);

      // Mark token as used
      await client.query(
        `UPDATE redemption_tokens SET used_at = NOW() WHERE id = $1`,
        [tokenRow.id]
      );

      await client.query('COMMIT');

      console.log('✅ Redemption successful');

      // Calculate remaining points and visits
      const remainingPoints = availablePoints - pointsRequired;
      const remainingEligibleVisits = eligibleVisits - updateVisitsRes.rowCount;

      return res.json({
        success: true,
        message: 'Reward redeemed successfully',
        redemption: {
          redemptionId: redemptionRes.rows[0].id,
          rewardId: reward.id,
          rewardTitle: reward.title,
          pointsUsed: pointsRequired,
          remainingPoints: remainingPoints,
          totalPointsEarned: totalPointsEarned,
          visitsUsed: updateVisitsRes.rowCount,
          remainingEligibleVisits: remainingEligibleVisits,
          redeemedAt: redemptionRes.rows[0].redeemed_at,
        },
      });

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

  } catch (err) {
    console.error('❌ Error in confirmRedemption:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to process redemption',
      error: err.message,
    });
  } finally {
    client.release();
  }
};

/**
 * GET /admin/redemption/history
 * Get redemption history for a salon
 */
exports.getRedemptionHistory = async (req, res) => {
  try {
    const salonId = req.user.salonId;
    const { limit = 50, offset = 0 } = req.query;

    const historyRes = await db.query(
      `
      SELECT 
        rr.id,
        rr.redeemed_at,
        rr.points_used,
        rr.visits_at_redeem,
        u.name as customer_name,
        u.email as customer_email,
        r.name as reward_title,
        r.tier as reward_tier
      FROM reward_redemptions rr
      JOIN users u ON u.id = rr.customer_id
      JOIN rewards r ON r.id = rr.reward_id
      WHERE rr.salon_id = $1
      ORDER BY rr.redeemed_at DESC
      LIMIT $2 OFFSET $3
      `,
      [salonId, limit, offset]
    );

    // Get total count
    const countRes = await db.query(
      `SELECT COUNT(*) FROM reward_redemptions WHERE salon_id = $1`,
      [salonId]
    );

    return res.json({
      success: true,
      redemptions: historyRes.rows,
      total: parseInt(countRes.rows[0].count),
    });

  } catch (err) {
    console.error('Error fetching redemption history:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch redemption history',
    });
  }
};