const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../../config/db');
const { signAccessToken, signRefreshToken } = require('../../utils/jwt');

/**
 * Helper: Store refresh token in database
 */
const storeRefreshToken = async (userId, refreshToken) => {
  await db.query(
    `UPDATE users SET refresh_token = $1, updated_at = NOW() WHERE id = $2`,
    [refreshToken, userId]
  );
};

/**
 * Helper: Clear refresh token from database
 */
const clearRefreshToken = async (userId) => {
  await db.query(
    `UPDATE users SET refresh_token = NULL, updated_at = NOW() WHERE id = $1`,
    [userId]
  );
};

/**
 * Helper: Get user data with subscription and salon info
 */
const getUserWithSubscription = async (userId, userRole) => {
  let salonId = null;
  let subscription = null;

  if (userRole === 'admin') {
    const salonRes = await db.query(
      `SELECT id FROM salons WHERE owner_id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    salonId = salonRes.rows[0]?.id || null;

    if (salonId) {
      const subRes = await db.query(
        `
        SELECT sp.name AS plan, s.status, s.expiry_date
        FROM subscriptions s
        JOIN subscription_plans sp ON sp.id = s.plan_id
        WHERE s.salon_id = $1 AND s.is_current = true
        LIMIT 1
        `,
        [salonId]
      );
      if (subRes.rows.length) {
        subscription = {
          plan: subRes.rows[0].plan,
          status: subRes.rows[0].status,
          expiryDate: subRes.rows[0].expiry_date
        };
      }
    }
  }

  return { salonId, subscription };
};

/**
 * Customer signup
 * POST /auth/signup
 */
exports.signup = async (req, res, next) => {
  const client = await db.pool.connect();
  
  try {
    const { name, email, password } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name, email and password are required' 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        message: 'Password must be at least 6 characters' 
      });
    }

    await client.query('BEGIN');

    // Check if user already exists
    const existing = await client.query(
      `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [email.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ 
        success: false, 
        message: 'Email already registered' 
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const { rows } = await client.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'customer')
       RETURNING id, name, email, role`,
      [name, email.toLowerCase(), hash]
    );

    const user = rows[0];

    const tokenPayload = { 
      id: user.id, 
      name: user.name,
      email: user.email,
      role: user.role,
      salonId: null,
      subscription: null
    };

    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken(tokenPayload);

    // ✅ Store refresh token in database
    await client.query(
      `UPDATE users SET refresh_token = $1 WHERE id = $2`,
      [refreshToken, user.id]
    );

    await client.query('COMMIT');

    console.log('✅ Customer signed up:', { id: user.id, email: user.email });

    res.status(201).json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        salonId: null,
        subscription: null
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Signup error:', err);
    next(err);
  } finally {
    client.release();
  }
};

/**
 * Login - works for both customers and admins
 * POST /auth/login
 */
exports.login = async (req, res, next) => {
  const client = await db.pool.connect();
  
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required' 
      });
    }

    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, name, email, password_hash, role FROM users 
       WHERE email = $1 AND deleted_at IS NULL`,
      [email.toLowerCase()]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid email or password' 
      });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      await client.query('ROLLBACK');
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid email or password' 
      });
    }

    // Get subscription and salon info if admin
    const { salonId, subscription } = await getUserWithSubscription(user.id, user.role);

    const tokenPayload = { 
      id: user.id, 
      name: user.name,
      email: user.email,
      role: user.role,
      salonId: salonId,
      subscription: subscription
    };

    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken(tokenPayload);

    // ✅ Store refresh token in database
    await client.query(
      `UPDATE users SET refresh_token = $1, last_login_at = NOW() WHERE id = $2`,
      [refreshToken, user.id]
    );

    await client.query('COMMIT');

    console.log('✅ User logged in:', { id: user.id, email: user.email, role: user.role });

    res.json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        salonId: salonId,
        subscription: subscription
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Login error:', err);
    next(err);
  } finally {
    client.release();
  }
};

/**
 * Register a new salon (creates admin user + salon + trial subscription)
 * POST /auth/register-salon
 */
exports.registerSalon = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const { ownerName, email, password, salonName, categories } = req.body;

    // Validation
    if (!ownerName || !email || !password || !salonName || !categories) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }

    if (!Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Categories must be a non-empty array' 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        message: 'Password must be at least 6 characters' 
      });
    }

    await client.query('BEGIN');

    // Check if user already exists
    const existingUser = await client.query(
      `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ 
        success: false, 
        message: 'Email already registered' 
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Create user as admin
    const userResult = await client.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'admin')
       RETURNING id, name, email, role`,
      [ownerName, email.toLowerCase(), passwordHash]
    );

    const user = userResult.rows[0];

    // Create salon linked to user
    const salonResult = await client.query(
      `INSERT INTO salons (name, categories, owner_id, is_open, is_visible)
       VALUES ($1, $2, $3, true, true)
       RETURNING id, name, categories`,
      [salonName, categories, user.id]
    );

    const salon = salonResult.rows[0];

    // Create trial subscription (30 days)
    await client.query(
      `
      INSERT INTO subscriptions (
        salon_id, plan_id, status, start_date, expiry_date,
        provider, provider_ref, is_current
      ) VALUES ($1, 1, 'active', NOW(), NOW() + INTERVAL '30 days',
        'internal', NULL, true)
      `,
      [salon.id]
    );

    // Get subscription details
    const subRes = await client.query(
      `
      SELECT sp.name AS plan, s.status, s.expiry_date
      FROM subscriptions s
      JOIN subscription_plans sp ON sp.id = s.plan_id
      WHERE s.salon_id = $1 AND s.is_current = true
      LIMIT 1
      `,
      [salon.id]
    );

    let subscription = null;
    if (subRes.rows.length) {
      const sub = subRes.rows[0];
      subscription = {
        plan: sub.plan,
        status: sub.status,
        expiryDate: sub.expiry_date
      };
    }

    const tokenPayload = { 
      id: user.id, 
      name: user.name,
      email: user.email,
      role: user.role,
      salonId: salon.id,
      subscription: subscription
    };

    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken(tokenPayload);

    // ✅ Store refresh token in database
    await client.query(
      `UPDATE users SET refresh_token = $1 WHERE id = $2`,
      [refreshToken, user.id]
    );

    await client.query('COMMIT');

    console.log('✅ Salon registered:', { salonId: salon.id, ownerId: user.id });

    res.status(201).json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        salonId: salon.id,
        subscription: subscription
      },
      salon: {
        id: salon.id,
        name: salon.name,
        categories: salon.categories
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Salon registration error:', err);
    next(err);
  } finally {
    client.release();
  }
};

/**
 * Refresh access token
 * POST /auth/refresh
 */
exports.refresh = async (req, res) => {
  const { refreshToken } = req.body;

  console.log('\n🔄 ===== REFRESH TOKEN =====');

  if (!refreshToken) {
    return res.status(401).json({ 
      success: false, 
      message: 'Refresh token required' 
    });
  }

  try {
    // 1️⃣ Verify refresh token signature
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    console.log('✅ Refresh token signature verified');

    // 2️⃣ Get user and verify stored refresh token matches
    const { rows } = await db.query(
      `SELECT id, name, email, role, refresh_token FROM users 
       WHERE id = $1 AND deleted_at IS NULL`,
      [payload.id]
    );

    if (!rows.length) {
      return res.status(401).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const user = rows[0];

    // 3️⃣ CRITICAL: Verify stored token matches
    if (user.refresh_token !== refreshToken) {
      console.log('⚠️ Refresh token mismatch - possible token theft');
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid refresh token' 
      });
    }

    // Get subscription and salon info
    const { salonId, subscription } = await getUserWithSubscription(user.id, user.role);

    // 4️⃣ Create new tokens
    const tokenPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      salonId: salonId,
      subscription: subscription
    };

    const newAccessToken = signAccessToken(tokenPayload);
    
    // ✅ Rotate refresh token for better security
    const newRefreshToken = signRefreshToken(tokenPayload);
    await storeRefreshToken(user.id, newRefreshToken);

    console.log('✅ Tokens refreshed for user:', user.id);

    res.json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        salonId: salonId,
        subscription: subscription
      }
    });

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      console.log('❌ Refresh token expired');
      return res.status(401).json({ 
        success: false, 
        message: 'Refresh token expired. Please login again.' 
      });
    }
    
    if (err.name === 'JsonWebTokenError') {
      console.log('❌ Invalid refresh token signature');
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid refresh token' 
      });
    }

    console.error('❌ Refresh error:', err.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to refresh token' 
    });
  }
};

/**
 * Logout - invalidate refresh token
 * POST /auth/logout
 */
exports.logout = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // ✅ Clear refresh token from database
    await clearRefreshToken(userId);

    console.log('✅ User logged out:', userId);

    res.json({ 
      success: true, 
      message: 'Logged out successfully' 
    });
  } catch (err) {
    console.error('❌ Logout error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to logout' 
    });
  }
};

/**
 * Get current user info
 * GET /auth/me
 */
exports.getMe = async (req, res) => {
  try {
    const userId = req.user.id;

    const { rows } = await db.query(
      `SELECT id, name, email, role, created_at, last_login_at 
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const user = rows[0];
    const { salonId, subscription } = await getUserWithSubscription(user.id, user.role);

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        salonId: salonId,
        subscription: subscription,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at
      }
    });
  } catch (err) {
    console.error('❌ GetMe error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get user info' 
    });
  }
};