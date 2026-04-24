 const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../../config/db');



exports.getCustomerSalons = async (req, res) => {
  try {
    const customerId = req.user.id;

    const result = await db.query(
  `
  SELECT 
    s.id,
    s.name,
    s.logo_url,
    s.banner_url,
    s.rating_avg,
    u.name as owner_name,
    COUNT(v.id) AS total_visits,
    COUNT(CASE WHEN v.is_used_for_redemption = false THEN 1 END) AS eligible_visits,   -- ✅ eligible visits
    EXISTS(
      SELECT 1 FROM reviews r
      WHERE r.salon_id = s.id AND r.customer_id = $1
    ) AS has_reviewed
  FROM salon_customers sc
  JOIN salons s ON s.id = sc.salon_id
  JOIN users u ON u.id = s.owner_id
  LEFT JOIN visits v ON v.salon_id = s.id AND v.customer_id = $1
  WHERE sc.user_id = $1
  GROUP BY s.id, u.name
  ORDER BY s.created_at DESC
  `,
  [customerId]
);

    return res.json({
      salons: result.rows.map(row => ({
  id: row.id,
  name: row.name,
  logoUrl: row.logo_url,
  coverImageUrl: row.banner_url,
 rating_avg: row.rating_avg ? parseFloat(row.rating_avg) : null,
  ownerName: row.owner_name,
  totalVisits: Number(row.total_visits),
  eligibleVisits: Number(row.eligible_visits),   // ✅ new
  hasPendingReview: row.total_visits > 0 && !row.has_reviewed
}))
    });

  } catch (err) {
    console.error('❌ getCustomerSalons error:', err);
    return res.status(500).json({ message: "Failed to load salons" });
  }
};






exports.requestRedemptionToken = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { rewardId } = req.body;

    console.log('\n🔍 ===== REQUEST REDEMPTION TOKEN =====');
    console.log('📌 Customer ID:', customerId);
    console.log('📌 Reward ID:', rewardId);

    if (!rewardId) {
      return res.status(400).json({ message: 'Reward ID required' });
    }

    // 1️⃣ First, get the reward directly
    console.log('🔍 Looking up reward by ID...');
    const rewardRes = await db.query(
      `SELECT id, tier, points_required, is_active, salon_id
       FROM rewards
       WHERE id = $1 AND is_active = true`,
      [rewardId]
    );

    if (!rewardRes.rows.length) {
      console.log('❌ Reward not found in database');
      return res.status(404).json({ message: 'Reward not found' });
    }

    const reward = rewardRes.rows[0];
    console.log('✅ Reward found:', reward);

    // 2️⃣ Check if customer is linked to this reward's salon
    console.log('🔍 Checking if customer is linked to salon:', reward.salon_id);
    const linkCheck = await db.query(
      `SELECT 1 FROM salon_customers 
       WHERE user_id = $1 AND salon_id = $2`,
      [customerId, reward.salon_id]
    );

    if (!linkCheck.rows.length) {
      console.log('❌ Customer not linked to this salon');
      return res.status(403).json({ 
        message: 'You are not a customer of this salon' 
      });
    }

    // 3️⃣ Get customer stats for THIS specific salon
    console.log('🔍 Getting customer stats for salon:', reward.salon_id);
    const statsRes = await db.query(
      `
      SELECT 
        u.id,
        u.is_vip,
        COALESCE(SUM(vs.points), 0) AS total_points,
        COUNT(DISTINCT v.id) AS total_visits
      FROM users u
      LEFT JOIN visits v 
        ON v.customer_id = u.id 
        AND v.salon_id = $2
      LEFT JOIN visit_services vs 
        ON vs.visit_id = v.id
      WHERE u.id = $1
      GROUP BY u.id, u.is_vip
      `,
      [customerId, reward.salon_id]
    );

    const customer = statsRes.rows[0] || {
      id: customerId,
      is_vip: false,
      total_points: 0,
      total_visits: 0
    };

    // 4️⃣ Apply unlocking rules
    if (Number(customer.total_visits) < 3) {
      return res.status(400).json({
        message: 'Minimum 3 visits required'
      });
    }

    if (reward.tier === 'vip' && !customer.is_vip) {
      return res.status(400).json({
        message: 'VIP members only'
      });
    }

    if (Number(customer.total_points) < Number(reward.points_required)) {
      return res.status(400).json({
        message: 'Insufficient points'
      });
    }

    console.log('✅ All rules passed!');

    // 5️⃣ Generate token with JWT_ACCESS_SECRET
    const jti = uuidv4();
    console.log('🔐 Generating token with JWT_ACCESS_SECRET');
    
    const tokenPayload = {
      sub: customerId,
      salonId: reward.salon_id,
      rewardId: reward.id,
      tier: reward.tier,
      pointsRequired: reward.points_required,
      type: 'reward_redemption',
      jti
    };

    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_ACCESS_SECRET,  // ← FIXED: Use ACCESS secret
      { expiresIn: '5m' }
    ); 

    // ===== 🔴 ADD THIS PART - Store token in database =====
    const client = await db.pool.connect();
    try {
      await client.query(
        `
        INSERT INTO redemption_tokens 
        (jti, token_hash, customer_id, salon_id, reward_id)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [jti, token, customerId, reward.salon_id, reward.id]
      );
      console.log('✅ Token stored in database with jti:', jti);
    } catch (dbErr) {
      console.error('❌ Failed to store token in database:', dbErr);
      // If we can't store it, don't return the token
      return res.status(500).json({ message: 'Failed to generate redemption token' });
    } finally {
      client.release();
    }

    console.log('✅ Token generated successfully');

    return res.status(200).json({
      token,
      expiresIn: 300
    });

  } catch (err) {
    console.error('❌ Error in requestRedemptionToken:', err);
    console.error('❌ Error message:', err.message);
    console.error('❌ Error stack:', err.stack);
    
    return res.status(500).json({ 
      message: 'Failed to generate token',
      error: err.message 
    });
  }
};
exports.getRewardStatus = async (req, res) => {
  const client = await db.pool.connect();

  try {
    const customerId = req.user.id;
    const { salonId } = req.query;

    console.log('🔍 ===== GET REWARD STATUS =====');
    console.log('📌 Customer ID:', customerId);
    console.log('📌 Salon ID:', salonId);

    if (!salonId) {
      return res.status(400).json({ message: "salonId required" });
    }

    // Check if customer is linked to salon
    const linkCheck = await db.query(
      `SELECT 1 FROM salon_customers 
       WHERE user_id = $1 AND salon_id = $2`,
      [customerId, salonId]
    );

    if (!linkCheck.rows.length) {
      return res.status(403).json({ message: "Not linked to this salon" });
    }

    // Get eligible visits and last visit date
    const eligibleVisitsRes = await client.query(
      `
      SELECT 
        COUNT(*) as eligible_count,
        MAX(created_at) as last_visit_date
      FROM visits
      WHERE customer_id = $1 
        AND salon_id = $2
        AND (is_used_for_redemption = false OR is_used_for_redemption IS NULL)
      `,
      [customerId, salonId]
    );
    
    let eligibleVisits = Number(eligibleVisitsRes.rows[0].eligible_count);
    const lastVisitDate = eligibleVisitsRes.rows[0].last_visit_date;
    
    console.log('📊 Eligible visits:', eligibleVisits);
    console.log('📊 Last visit date:', lastVisitDate);

    // 🔴 RULE 1: Check 60-day expiration
    let isExpired = false;
    let daysSinceLastVisit = 0;
    
    if (lastVisitDate && eligibleVisits >= 3) {
      const now = new Date();
      const lastVisit = new Date(lastVisitDate);
      const diffTime = now - lastVisit;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      daysSinceLastVisit = diffDays;
      
      if (diffDays > 60) {
        isExpired = true;
        console.log(`⚠️ 60 days passed since last visit (${diffDays} days). Resetting...`);
        
        await client.query('BEGIN');
        
        // Mark ALL eligible visits as used (reset to 0)
        await client.query(
          `
          UPDATE visits
          SET is_used_for_redemption = true
          WHERE customer_id = $1 
            AND salon_id = $2
            AND (is_used_for_redemption = false OR is_used_for_redemption IS NULL)
          `,
          [customerId, salonId]
        );
        
        await client.query('COMMIT');
        
        eligibleVisits = 0;
        isExpired = true;
      }
    }

    // RULE 2: If eligible visits exceed 3, reset to 0
    if (!isExpired && eligibleVisits > 3) {
      console.log(`⚠️ Eligible visits (${eligibleVisits}) exceeds 3. Resetting to 0...`);
      
      await client.query('BEGIN');
      
      await client.query(
        `
        UPDATE visits
        SET is_used_for_redemption = true
        WHERE customer_id = $1 
          AND salon_id = $2
          AND (is_used_for_redemption = false OR is_used_for_redemption IS NULL)
        `,
        [customerId, salonId]
      );
      
      await client.query('COMMIT');
      
      eligibleVisits = 0;
    }

    console.log('📊 Eligible visits after checks:', eligibleVisits);

    // Get total points earned and redeemed
    const statsRes = await client.query(
      `
      SELECT 
        u.id,
        u.is_vip,
        COALESCE(SUM(vs.points), 0) AS total_points_earned,
        COALESCE(
          (SELECT SUM(points_used) FROM reward_redemptions 
           WHERE customer_id = u.id AND salon_id = $2), 0
        ) AS total_points_redeemed,
        COUNT(DISTINCT v.id) AS total_visits
      FROM users u
      LEFT JOIN visits v 
        ON v.customer_id = u.id 
        AND v.salon_id = $2
      LEFT JOIN visit_services vs 
        ON vs.visit_id = v.id
      WHERE u.id = $1
      GROUP BY u.id, u.is_vip
      `,
      [customerId, salonId]
    );

    const customer = statsRes.rows[0] || {
      is_vip: false,
      total_points_earned: 0,
      total_points_redeemed: 0,
      total_visits: 0
    };

    const totalPointsEarned = Number(customer.total_points_earned);
    const totalPointsRedeemed = Number(customer.total_points_redeemed);
    const availablePoints = totalPointsEarned - totalPointsRedeemed;

    console.log('📊 Points earned:', totalPointsEarned);
    console.log('📊 Points redeemed:', totalPointsRedeemed);
    console.log('📊 Available points:', availablePoints);

    // Get rewards
    const rewardsRes = await db.query(
      `
      SELECT id, title, description, points_required, tier
      FROM rewards
      WHERE salon_id = $1 AND is_active = true
      ORDER BY points_required ASC
      `,
      [salonId]
    );

    // Process rewards
    const rewards = rewardsRes.rows.map(reward => {
      let status = "LOCKED";
      let reason = null;

      // Check 1: If expired, all rewards are BLOCKED
      if (isExpired) {
        status = "EXPIRED";
        reason = `No visits in last 60 days. Make a new visit to reactivate rewards.`;
      }
      // Check 2: Need 3 eligible visits
      else if (eligibleVisits < 3) {
        status = "LOCKED";
        reason = `Need 3 visits to unlock rewards. Current: ${eligibleVisits}`;
      } 
      // Check 3: VIP tier restriction
      else if (reward.tier === "vip" && !customer.is_vip) {
        status = "BLOCKED";
        reason = "VIP only";
      } 
      // Check 4: Insufficient points
      else if (availablePoints < reward.points_required) {
        status = "LOCKED";
        reason = `Need ${reward.points_required - availablePoints} more points`;
      } 
      else {
        status = "UNLOCKED";
      }

      return { 
        id: reward.id,
        title: reward.title,
        points: reward.points_required,
        tier: reward.tier,
        status: status.toLowerCase(),
        reason,
        image: null
      };
    });

    // Calculate days remaining if not expired
    let daysRemaining = null;
    if (!isExpired && lastVisitDate && eligibleVisits >= 3) {
      const lastVisit = new Date(lastVisitDate);
      const expiryDate = new Date(lastVisit);
      expiryDate.setDate(expiryDate.getDate() + 60);
      const now = new Date();
      const diffTime = expiryDate - now;
      daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      daysRemaining = Math.max(0, daysRemaining);
    }

    const response = {
      customer: {
        points: availablePoints,
        pointsEarned: totalPointsEarned,
        pointsRedeemed: totalPointsRedeemed,
        totalVisits: Number(customer.total_visits || 0),
        eligibleVisits: eligibleVisits,
        canRedeem: (eligibleVisits >= 3 && !isExpired),
        isVip: customer.is_vip || false,
        loyaltyExpired: isExpired,
        daysSinceLastVisit: daysSinceLastVisit,
        daysRemainingToRedeem: daysRemaining,
        lastVisitDate: lastVisitDate
      },
      rewards
    };

    console.log('✅ Final response:', JSON.stringify(response, null, 2));

    return res.json(response);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error in getRewardStatus:', err);
    return res.status(500).json({ 
      message: "Failed to load rewards",
      error: err.message 
    });
  } finally {
    client.release();
  }
};