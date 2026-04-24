const db = require('../../config/db');

/**
 * Create Review
 * Customer can only review a salon if they have a completed visit
 */
exports.createReview = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { salonId, rating, comment } = req.body;
    const customerId = req.user.id;

    if (!salonId || !rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: "Invalid input" });
    }

    const linkCheck = await client.query(
      `SELECT 1 FROM salon_customers WHERE user_id = $1 AND salon_id = $2`,
      [customerId, salonId]
    );
    if (!linkCheck.rows.length) {
      return res.status(403).json({ success: false, message: "Not linked to this salon" });
    }

    const reviewCheck = await client.query(
      `SELECT 1 FROM reviews WHERE customer_id = $1 AND salon_id = $2`,
      [customerId, salonId]
    );
    if (reviewCheck.rows.length) {
      return res.status(400).json({ success: false, message: "Already reviewed this salon" });
    }

    await client.query('BEGIN');

    const insertRes = await client.query(
      `INSERT INTO reviews (salon_id, customer_id, rating, comment)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [salonId, customerId, rating, comment || null]
    );

    await client.query(
      `UPDATE salons
       SET rating_avg = (
         SELECT AVG(rating) FROM reviews WHERE salon_id = $1
       ),
       rating_count = (
         SELECT COUNT(*) FROM reviews WHERE salon_id = $1
       )
       WHERE id = $1`,
      [salonId]
    );

    await client.query('COMMIT');

    res.status(201).json({ success: true, review: insertRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ createReview error:', err);
    res.status(500).json({ success: false, message: "Failed to submit review" });
  } finally {
    client.release();
  }
};