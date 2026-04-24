const db = require("../../config/db");
const bcrypt = require("bcrypt");

/**
 * Helper: Check if user is admin
 */
const isAdmin = (role) => {
  return role === "super_admin" || role === "admin";
};

/**
 * GET /api/profile/me
 * Get current user profile (works for both customer and admin)
 */
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    const result = await db.query(
      `
      SELECT 
        u.name,
        u.email,
        u.role
      FROM users u
      WHERE u.id = $1 AND u.deleted_at IS NULL
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = result.rows[0];

    // If admin/salon owner, also get salon and subscription info
    let salonData = null;
    if (isAdmin(userRole)) {
      const salonResult = await db.query(
        `
        SELECT 
          s.id,
          s.name,
          s.created_at as joined_at,
          sub.status as subscription_status,
          sub.start_date,
          sub.expiry_date,
          sp.name as plan_name,
          sp.price as plan_price
        FROM salons s
        LEFT JOIN subscriptions sub ON sub.salon_id = s.id AND sub.deleted_at IS NULL
        LEFT JOIN subscription_plans sp ON sp.id = sub.plan_id
        WHERE s.owner_id = $1 AND s.deleted_at IS NULL
        ORDER BY sub.created_at DESC
        LIMIT 1
        `,
        [userId]
      );
      
      if (salonResult.rows.length > 0) {
        const salon = salonResult.rows[0];
        salonData = {
          id: salon.id,
          name: salon.name,
          joinedAt: salon.joined_at,
          subscription: {
            status: salon.subscription_status || "trial",
            planName: salon.plan_name || "Free Trial",
            planPrice: salon.plan_price || 0,
            startDate: salon.start_date,
            expiryDate: salon.expiry_date,
          },
        };
      }
    }

    return res.json({
      success: true,
      data: {
        name: user.name,
        email: user.email,
        role: user.role,
        ...(salonData && { salon: salonData }),
      },
    });
  } catch (error) {
    console.error("❌ Get Profile Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load profile",
    });
  }
};
/**
 * PUT /api/profile/me
 * Update user profile
 * - Customers can update name
 * - Admins can update email
 */
exports.updateProfile = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { name, email } = req.body;

    // Customers can only update name
    if (!isAdmin(userRole) && (!name || !name.trim())) {
      return res.status(400).json({
        success: false,
        message: "Name is required",
      });
    }

    // Admins can only update email
    if (isAdmin(userRole) && (!email || !email.trim())) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    let query, params;

    if (isAdmin(userRole)) {
      // Admin: update email
      query = `
        UPDATE users
        SET email = $1, updated_at = NOW()
        WHERE id = $2 AND deleted_at IS NULL
        RETURNING id, name, email
      `;
      params = [email.trim(), userId];
    } else {
      // Customer: update name
      query = `
        UPDATE users
        SET name = $1, updated_at = NOW()
        WHERE id = $2 AND deleted_at IS NULL
        RETURNING id, name, email
      `;
      params = [name.trim(), userId];
    }

    const result = await db.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.json({
      success: true,
      message: isAdmin(userRole) ? "Email updated successfully" : "Name updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Update Profile Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update profile",
    });
  } finally {
    client.release();
  }
};

/**
 * PUT /api/profile/change-password
 * Change user password (works for both customer and admin)
 */
exports.changePassword = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters",
      });
    }

    // Get current password hash
    const userResult = await db.query(
      `SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      userResult.rows[0].password_hash
    );
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Hash new password
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await db.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [newPasswordHash, userId]
    );

    return res.json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("❌ Change Password Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to change password",
    });
  } finally {
    client.release();
  }
};

/**
 * DELETE /api/profile/me
 * Permanently delete user account (works for both customer and admin)
 * For admin: also deletes associated salon (cascade will handle related data)
 */
exports.deleteAccount = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check if user exists
    const userResult = await db.query(
      `SELECT id, name, email, role FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = userResult.rows[0];

    // If admin, also delete associated salon
    if (isAdmin(userRole)) {
      const salonResult = await db.query(
        `SELECT id, name FROM salons WHERE owner_id = $1 AND deleted_at IS NULL`,
        [userId]
      );
      if (salonResult.rows.length > 0) {
        await db.query(`DELETE FROM salons WHERE id = $1`, [salonResult.rows[0].id]);
        console.log(`✅ Deleted salon: ${salonResult.rows[0].name}`);
      }
    }

    // Permanently delete the user
    await db.query(`DELETE FROM users WHERE id = $1`, [userId]);

    return res.json({
      success: true,
      message: "Account permanently deleted",
    });
  } catch (error) {
    console.error("❌ Delete Account Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete account",
    });
  } finally {
    client.release();
  }
};

/**
 * GET /api/profile/subscription
 * Get subscription details for admin/salon owner
 */
exports.getSubscription = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!isAdmin(userRole)) {
      return res.status(403).json({
        success: false,
        message: "Only salon owners can access subscription details",
      });
    }

    const result = await db.query(
      `
      SELECT 
        s.id as salon_id,
        s.name as salon_name,
        sub.plan_id,
        sp.name as plan_name,
        sp.price,
        sp.duration_days,
        sub.status as subscription_status,
        sub.start_date,
        sub.expiry_date,
        sub.provider
      FROM salons s
      JOIN subscriptions sub ON sub.salon_id = s.id
      JOIN subscription_plans sp ON sp.id = sub.plan_id
      WHERE s.owner_id = $1 AND s.deleted_at IS NULL
      ORDER BY sub.created_at DESC
      LIMIT 1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: {
          hasSubscription: false,
          message: "No active subscription found",
        },
      });
    }

    const sub = result.rows[0];

    return res.json({
      success: true,
      data: {
        hasSubscription: true,
        plan: sub.plan_name,
        planId: sub.plan_id,
        price: sub.price,
        status: sub.subscription_status,
        joinedAt: sub.start_date,
        expiresAt: sub.expiry_date,
        provider: sub.provider,
      },
    });
  } catch (error) {
    console.error("❌ Get Subscription Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load subscription details",
    });
  }
};

/**
 * POST /api/profile/cancel-subscription
 * Cancel subscription for admin/salon owner
 */
exports.cancelSubscription = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!isAdmin(userRole)) {
      return res.status(403).json({
        success: false,
        message: "Only salon owners can cancel subscriptions",
      });
    }

    // Get salon id
    const salonResult = await db.query(
      `SELECT id FROM salons WHERE owner_id = $1 AND deleted_at IS NULL`,
      [userId]
    );

    if (salonResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Salon not found",
      });
    }

    const salonId = salonResult.rows[0].id;

    // Cancel subscription (set status to cancelled, don't delete)
    await db.query(
      `UPDATE subscriptions SET status = 'cancelled', updated_at = NOW() WHERE salon_id = $1 AND status = 'active'`,
      [salonId]
    );

    return res.json({
      success: true,
      message: "Subscription cancelled successfully",
    });
  } catch (error) {
    console.error("❌ Cancel Subscription Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to cancel subscription",
    });
  } finally {
    client.release();
  }
};