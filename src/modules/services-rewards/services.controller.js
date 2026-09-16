const db = require('../../config/db');

/**
 * GET all services for logged-in salon
 */
exports.getServices = async (req, res, next) => {
  try {
    // 🔑 derive salonId from logged-in user
    const salonRes = await db.query(
      `SELECT id FROM salons WHERE owner_Id = $1`,
      [req.user.id]
    );

    if (!salonRes.rows.length) {
      return res.status(403).json({ message: 'Salon not found for user' });
    }

    const salonId = salonRes.rows[0].id;

    const { rows } = await db.query(
      `
      SELECT
        id,
        name,
        category,
        description,
        price,
        points,
        image_url,
        video_url,
        created_at
      FROM services
      WHERE salon_id = $1
        AND is_active = true
      ORDER BY created_at ASC
      `,
      [salonId]
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
};

/**
 * BULK CREATE services
 * Frontend sends an array of services
 */
exports.createServices = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    // 🔑 Derive salonId (DO NOT trust req.user.salonId)
    const salonRes = await client.query(
      `SELECT id FROM salons WHERE owner_id = $1`,
      [req.user.id]
    );

    if (!salonRes.rows.length) {
      return res.status(403).json({ message: 'Salon not found for user' });
    }

    const salonId = salonRes.rows[0].id;
    const { services } = req.body;

    if (!Array.isArray(services) || services.length === 0) {
      return res.status(400).json({ message: 'Services array is required' });
    }

    await client.query('BEGIN');

    const inserted = [];

    for (const service of services) {
      const {
        name,
        category,
        description,
        price,
        image_url,
        video_url,
      } = service;

      if (!name || price === undefined) {
        throw new Error('Service name and price are required');
      }

      const points = Math.floor(Number(price) / 10);

      const { rows } = await client.query(
        `
        INSERT INTO services
        (salon_id, name, category, description, price, image_url, points, video_url)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
        `,
        [
          salonId,
          name,
          category || null,
          description || null,
          price,
          image_url || null,
          points,
          video_url || null,
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
 * UPDATE single service
 */
exports.updateService = async (req, res, next) => {
  try {
    const salonId = req.user.salonId;
    const { serviceId } = req.params;
    const {
      name,
      category,
      description,
      price,
      image_url,
      video_url,
    } = req.body;

    const points =
      price !== undefined ? Math.floor(Number(price) / 10) : undefined;

    const { rows, rowCount } = await db.query(
      `
      UPDATE services
      SET
        name = COALESCE($1, name),
        category = COALESCE($2, category),
        description = COALESCE($3, description),
        price = COALESCE($4, price),
        points = COALESCE($5, points),
        image_url = COALESCE($6, image_url),
        video_url = COALESCE($7, video_url)
      WHERE id = $8
        AND salon_id = $9
        AND is_active = true
      RETURNING *
      `,
      [
        name,
        category,
        description,
        price,
        points,
        image_url,
        video_url,
        serviceId,
        salonId,
      ]
    );

    if (!rowCount) {
      return res.status(404).json({ message: 'Service not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE service (soft delete)
 */
exports.deleteService = async (req, res, next) => {
  try {
    const salonId = req.user.salonId;
    const { serviceId } = req.params;

    const { rowCount } = await db.query(
      `
      UPDATE services
      SET is_active = false
      WHERE id = $1 AND salon_id = $2
      `,
      [serviceId, salonId]
    );

    if (!rowCount) {
      return res.status(404).json({ message: 'Service not found' });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};