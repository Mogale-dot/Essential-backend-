const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const db = require('../../config/db');
const {
  signAccessToken,
  signRefreshTokens
} = require('../../utils/jwt');

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID
);

/**
 * Store refresh token
 */
const storeRefreshToken = async (userId, refreshToken) => {
  await db.query(
    `
    UPDATE users
    SET refresh_token = $1,
        updated_at = NOW(),
        last_login_at = NOW()
    WHERE id = $2
    `,
    [refreshToken, userId]
  );
};

/**
 * Get salon + subscription info
 */
const getUserWithSubscription = async (userId, role) => {
  let salonId = null;
  let subscription = null;

  if (role === 'admin') {
    const salonRes = await db.query(
      `
      SELECT id
      FROM salons
      WHERE owner_id = $1
        AND deleted_at IS NULL
      `,
      [userId]
    );

    salonId = salonRes.rows[0]?.id || null;

    if (salonId) {
      const subRes = await db.query(
        `
        SELECT
          sp.name AS plan,
          s.status,
          s.expiry_date
        FROM subscriptions s
        JOIN subscription_plans sp
          ON sp.id = s.plan_id
        WHERE s.salon_id = $1
          AND s.is_current = true
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
 * GOOGLE AUTH
 * POST /auth/google
 */
exports.googleAuth = async (req, res) => {
  const client = await db.pool.connect();

  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: 'Google token required'
      });
    }

    /**
     * 1️⃣ Verify token with Google
     */
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();

    if (!payload) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Google token'
      });
    }

    const {
      sub,
      email,
      name,
      picture,
      email_verified
    } = payload;

    /**
     * 2️⃣ Validate payload
     */
    if (!sub || !email || !email_verified) {
      return res.status(401).json({
        success: false,
        message: 'Google account not verified'
      });
    }

    await client.query('BEGIN');

    /**
     * 3️⃣ Find existing user
     */
    let userResult = await client.query(
      `
      SELECT *
      FROM users
      WHERE google_id = $1
         OR email = $2
      LIMIT 1
      `,
      [sub, email.toLowerCase()]
    );

    let user;

    /**
     * 4️⃣ Create new user
     */
    if (!userResult.rows.length) {
      const newUserRes = await client.query(
        `
        INSERT INTO users (
          name,
          email,
          google_id,
          auth_provider,
          role,
          avatar_url
        )
        VALUES ($1, $2, $3, 'google', 'customer', $4)
        RETURNING id, name, email, role
        `,
        [
          name,
          email.toLowerCase(),
          sub,
          picture || null
        ]
      );

      user = newUserRes.rows[0];

      console.log('✅ New Google user created:', user.email);
    }

    /**
     * 5️⃣ Existing user
     */
    else {
      user = userResult.rows[0];

      /**
       * Link Google account if not linked
       */
      if (!user.google_id) {
        await client.query(
          `
          UPDATE users
          SET google_id = $1,
              auth_provider = 'google',
              updated_at = NOW()
          WHERE id = $2
          `,
          [sub, user.id]
        );
      }

      console.log('✅ Existing Google user login:', user.email);
    }

    /**
     * 6️⃣ Get subscription info
     */
    const { salonId, subscription } =
      await getUserWithSubscription(user.id, user.role);

    /**
     * 7️⃣ Generate app JWTs
     */
    const tokenPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      salonId,
      subscription
    };

    const accessToken = signAccessToken(tokenPayload);

    const refreshToken = signRefreshToken(tokenPayload);

    /**
     * 8️⃣ Store refresh token
     */
    await storeRefreshToken(user.id, refreshToken);

    await client.query('COMMIT');

    /**
     * 9️⃣ Return response
     */
    return res.status(200).json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        salonId,
        subscription
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');

    console.error('❌ Google auth error:', err);

    return res.status(500).json({
      success: false,
      message: 'Google authentication failed'
    });
  } finally {
    client.release();
  }
};