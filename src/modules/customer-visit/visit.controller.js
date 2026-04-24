const db = require('../../config/db');

exports.createVisit = async (req, res) => {
  const client = await db.pool.connect();

  try {
    const userId = req.user?.id;
console.log(req.body);
    if (!userId) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    const { customerId, services } = req.body;

    if (!customerId || !services || !services.length) {
      return res.status(400).json({ message: 'Invalid visit data' });
    }

    // 🔍 Get salon by owner
    const salonRes = await client.query(
      `SELECT id FROM salons WHERE owner_id = $1`,
      [userId]
    );

    if (!salonRes.rows.length) {
      return res.status(403).json({ message: 'Salon not found' });
    }

    const salonId = salonRes.rows[0].id;

    await client.query('BEGIN');

    // 1️⃣ Verify customer belongs to salon
    const membership = await client.query(
      `
      SELECT 1 FROM salon_customers
      WHERE salon_id = $1 AND user_id = $2
      `,
      [salonId, customerId]
    );

    if (!membership.rows.length) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Customer not linked to salon' });
    }

    // 2️⃣ Load services
    const serviceIds = services.map(s => s.serviceId);

    const serviceRes = await client.query(
      `
      SELECT id, price, points
      FROM services
      WHERE salon_id = $1
      AND id = ANY($2)
      `,
      [salonId, serviceIds]
    );

    if (serviceRes.rows.length !== services.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Invalid service selection' });
    }

    // 3️⃣ Calculate totals
    let totalAmount = 0;
    let totalPoints = 0;

    serviceRes.rows.forEach(service => {
      totalAmount += Number(service.price);
      totalPoints += Number(service.points);
    });

    totalAmount = Number(totalAmount.toFixed(2));
    totalPoints = Number(totalPoints.toFixed(2));

    // 4️⃣ Create visit
    const visitRes = await client.query(
      `
      INSERT INTO visits (salon_id, customer_id, total_amount, total_points)
      VALUES ($1, $2, $3, $4)
      RETURNING id, created_at
      `,
      [salonId, customerId, totalAmount, totalPoints]
    );

    const visit = visitRes.rows[0];

    // 5️⃣ Create visit_services rows
    for (const service of serviceRes.rows) {
      await client.query(
        `
        INSERT INTO visit_services
        (visit_id, service_id, price, points)
        VALUES ($1, $2, $3, $4)
        `,
        [visit.id, service.id, service.price, service.points]
      );
    }

    await client.query('COMMIT');

    return res.status(201).json({
      visitId: visit.id,
      totalAmount,
      totalPoints,
      createdAt: visit.created_at
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);

    return res.status(500).json({
      message: 'Server error'
    });
  } finally {
    client.release();
  }
}; 
/**
 * GET /visits/history
 * Get visit history for a customer (for rewards screen)
 */
exports.getVisitHistory = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { salonId } = req.query;

    if (!salonId) {
      return res.status(400).json({
        success: false,
        message: "salonId is required",
      });
    }

    // Get all visits for this customer and salon
    const result = await db.query(
      `
      SELECT 
        v.id,
        v.created_at as date,
        EXISTS(
          SELECT 1 FROM reward_redemptions rr 
          WHERE rr.customer_id = v.customer_id 
          AND rr.salon_id = v.salon_id
          AND rr.redeemed_at >= v.created_at - INTERVAL '1 minute'
          AND rr.redeemed_at <= v.created_at + INTERVAL '1 minute'
        ) as rewarded,
        COALESCE(
          (SELECT SUM(vs.points) FROM visit_services vs WHERE vs.visit_id = v.id), 0
        ) as points_earned
      FROM visits v
      WHERE v.customer_id = $1 AND v.salon_id = $2
      ORDER BY v.created_at DESC
      `,
      [customerId, salonId]
    );

    return res.json({
      success: true,
      history: result.rows,
    });
  } catch (err) {
    console.error("❌ Get visit history error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load visit history",
    });
  }
};
