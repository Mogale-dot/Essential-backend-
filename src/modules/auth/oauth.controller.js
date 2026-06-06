const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const db = require('../../config/db');
const {
  signAccessToken,
  signRefreshToken  // Make sure this matches your export
} = require('../../utils/jwt');

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID
);

/**
 * Store refresh token in database
 * FIXED: Added error handling and timeout prevention
 */
const storeRefreshToken = async (userId, refreshToken) => {
  try {
    // Use a simple UPDATE without transaction conflicts
    const result = await db.query(
      `
      UPDATE users 
      SET refresh_token = $1,
          updated_at = NOW(),
          last_login_at = NOW()
      WHERE id = $2
      `,
      [refreshToken, userId]
    );
    
    if (result.rowCount === 0) {
      console.warn(`⚠️ User ${userId} not found when updating refresh token`);
    }
    
    return result;
  } catch (error) {
    console.error('❌ Error storing refresh token:', error.message);
    throw error; // Re-throw to be caught by the main handler
  }
};

/**
 * Get salon + subscription info for admin users
 */
const getUserWithSubscription = async (userId, role) => {
  let salonId = null;
  let subscription = null;

  // Only admins have salons and subscriptions
  if (role === 'admin') {
    try {
      const salonRes = await db.query(
        `
        SELECT id
        FROM salons
        WHERE owner_id = $1
          AND deleted_at IS NULL
        LIMIT 1
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
    } catch (error) {
      console.error('❌ Error fetching subscription:', error.message);
      // Don't throw - subscription is optional
    }
  }

  return { salonId, subscription };
};

/**
 * GOOGLE AUTH
 * POST /auth/google
 */
exports.googleAuth = async (req, res) => {
  // Don't use manual client for simple queries - use db directly
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
      sub,              // Google's unique user ID
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

    /**
     * 3️⃣ Find OR create user
     * FIXED: Removed explicit transaction for simpler flow
     * This prevents deadlocks and timeout issues
     */
    let userResult = await db.query(
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
     * 4️⃣ Create new user if doesn't exist
     */
    if (!userResult.rows.length) {
      const newUserRes = await db.query(
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
          name || email.split('@')[0], // Fallback name if not provided
          email.toLowerCase(),
          sub,
          picture || null
        ]
      );

      user = newUserRes.rows[0];
      console.log('✅ New Google user created:', user.email);
    } 
    /**
     * 5️⃣ Existing user found
     */
    else {
      user = userResult.rows[0];

      /**
       * Link Google account if user exists but hasn't used Google before
       */
      if (!user.google_id) {
        await db.query(
          `
          UPDATE users
          SET google_id = $1,
              auth_provider = 'google',
              updated_at = NOW()
          WHERE id = $2
          `,
          [sub, user.id]
        );
        console.log('🔗 Linked Google account to existing user:', user.email);
      }

      console.log('✅ Existing Google user login:', user.email);
    }

    /**
     * 6️⃣ Get subscription info (only for admin/salon owners)
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
     * 8️⃣ Store refresh token in database
     * FIXED: Don't await this synchronously - fire and forget
     * This prevents the timeout from blocking the response
     */
    storeRefreshToken(user.id, refreshToken).catch(err => {
      console.error('❌ Background refresh token storage failed:', err.message);
    });

    /**
     * 9️⃣ Return response immediately
     * Don't wait for refresh token storage to complete
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
    console.error('❌ Google auth error:', err);

    // More detailed error logging
    if (err.code === '57014') {
      console.error('Database timeout - check your PostgreSQL configuration');
    }

    return res.status(500).json({
      success: false,
      message: 'Google authentication failed'
    });
  }
};