const db = require('../../config/db');

exports.getMySalon = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { rows } = await db.query(
      `SELECT * FROM salons WHERE owner_id = $1 LIMIT 1`,
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Salon not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};
exports.updateSalon = async (req, res, next) => {
  try {
    const salonId = req.params.id;

    const {
      name,
      bio,
      phone,
      location,
      categories,      // new: array of strings
      socials,
      logo_url,
      banner_url
    } = req.body;

    // Log incoming data
    console.log('📥 Updating salon:', { salonId });
    console.log('Fields:', {
      name,
      bio,
      phone,
      location,
      categories,
      socials: JSON.stringify(socials),
      logo_url,
      banner_url
    });

    // Build the update query dynamically to handle categories
    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = COALESCE($${paramIndex}, name)`);
      params.push(name);
      paramIndex++;
    }
    if (bio !== undefined) {
      updates.push(`bio = COALESCE($${paramIndex}, bio)`);
      params.push(bio);
      paramIndex++;
    }
    if (phone !== undefined) {
      updates.push(`phone = COALESCE($${paramIndex}, phone)`);
      params.push(phone);
      paramIndex++;
    }
    if (location !== undefined) {
      updates.push(`location = COALESCE($${paramIndex}, location)`);
      params.push(location);
      paramIndex++;
    }
    if (categories !== undefined) {
      // categories is an array of strings, store as PostgreSQL array
      updates.push(`categories = COALESCE($${paramIndex}::text[], categories)`);
      params.push(categories);
      paramIndex++;
    }
    if (socials !== undefined) {
      updates.push(`socials = COALESCE($${paramIndex}::jsonb, socials)`);
      params.push(socials);
      paramIndex++;
    }
    if (logo_url !== undefined) {
      updates.push(`logo_url = COALESCE($${paramIndex}, logo_url)`);
      params.push(logo_url);
      paramIndex++;
    }
    if (banner_url !== undefined) {
      updates.push(`banner_url = COALESCE($${paramIndex}, banner_url)`);
      params.push(banner_url);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    updates.push(`updated_at = now()`);

    const query = `
      UPDATE salons
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
    params.push(salonId);

    const { rows } = await db.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Salon not found' });
    }

    res.json({ success: true, salon: rows[0] });
  } catch (err) {
    console.error('❌ Update salon error:', err);
    res.status(500).json({ success: false, message: 'Failed to update salon' });
  }
};