const db = require('../../config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { sendInviteEmail } = require('../../utils/mailer');

// ✅ FIXED: Allowed roles (matching frontend)
const ALLOWED_ROLES = ['admin', 'manager', 'stylist', 'receptionist'];

// ✅ FIXED: Allowed permissions
const ALLOWED_PERMISSIONS = [
  "scan_qr",
  "create_booking",
  "edit_booking",
  "delete_booking",
  "view_reports",
  "manage_services",
  "manage_staff",
  "edit_salon",
  "customer_support",
  "view_appointments",
  "update_services",
  "customer_notes",
  "checkin_customers",
  "take_payments",
  "manage_inventory",
  "manage_payments",
  "analytics_access"
];

/**
 * Utility: Generate Clean Password
 */
function generatePassword(length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  const bytes = crypto.randomBytes(length);

  for (let i = 0; i < length; i++) {
    password += chars[bytes[i] % chars.length];
  }

  return password;
}

/**
 * Helper: Get salon owned by admin
 */
async function getAdminSalon(adminId) {
  const { rows } = await db.query(
    `SELECT id, qr_identity FROM salons WHERE owner_id = $1`,
    [adminId]
  );

  if (!rows.length) {
    throw new Error('Salon not found for this admin');
  }

  return rows[0];
}

/**
 * GET ALL MEMBERS (admin only)
 */
exports.listMembers = async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const salon = await getAdminSalon(adminId);

    const { rows } = await db.query(
      `
      SELECT
        sm.id AS member_id,
        u.id AS user_id,
        u.name,
        u.email,
        sm.role,
        sm.permissions,
        sm.created_at
      FROM salon_members sm
      JOIN users u ON u.id = sm.user_id
      WHERE sm.salon_id = $1
      ORDER BY sm.created_at DESC
      `,
      [salon.id]
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
};

/**
 * ADD MEMBER
 */
exports.addMember = async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const { name, email, role } = req.body;

    if (!name || !email || !role) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    // ✅ Validate role
    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ 
        message: `Invalid role. Allowed roles: ${ALLOWED_ROLES.join(', ')}` 
      });
    }

    const salon = await getAdminSalon(adminId);

    // Check if user already exists
    const existingUser = await db.query(
      `SELECT id FROM users WHERE email = $1`,
      [email]
    );

    if (existingUser.rows.length) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    // Generate password
    const plainPassword = generatePassword(10);
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    console.log('=================================');
    console.log('NEW MEMBER CREATED');
    console.log('Email:', email);
    console.log('Password:', plainPassword);
    console.log('Role:', role);
    console.log('=================================');

    // Insert into users table
    const userInsert = await db.query(
      `
      INSERT INTO users (name, email, password_hash, role)
      VALUES ($1, $2, $3, 'member')
      RETURNING id
      `,
      [name, email, hashedPassword]
    );

    const userId = userInsert.rows[0].id;

    // ✅ Set default permissions based on role
    let defaultPermissions = ['scan_qr'];
    
    if (role === 'admin') {
      defaultPermissions = [...ALLOWED_PERMISSIONS];
    } else if (role === 'manager') {
      defaultPermissions = [
        'scan_qr',
        'create_booking',
        'edit_booking',
        'view_reports',
        'manage_services',
        'customer_support',
        'view_appointments'
      ];
    } else if (role === 'stylist') {
      defaultPermissions = [
        'scan_qr',
        'create_booking',
        'edit_booking',
        'view_appointments',
        'customer_notes'
      ];
    } else if (role === 'receptionist') {
      defaultPermissions = [
        'scan_qr',
        'create_booking',
        'edit_booking',
        'checkin_customers',
        'take_payments'
      ];
    }

    const memberInsert = await db.query(
      `
      INSERT INTO salon_members 
      (salon_id, user_id, role, qr_code, permissions)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, permissions
      `,
      [salon.id, userId, role, salon.qr_identity, defaultPermissions]
    );

    // Send invite email
    await sendInviteEmail({
      email,
      password: plainPassword,
    });

    res.status(201).json({
      message: 'Member created successfully',
      memberId: memberInsert.rows[0].id,
      email,
      role,
      permissions: memberInsert.rows[0].permissions,
      password: plainPassword,
    });
  } catch (err) {
    console.error('Add member error:', err);
    next(err);
  }
};

/**
 * CHANGE ROLE
 */
exports.changeRole = async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const { memberId } = req.params;
    const { role } = req.body;

    // ✅ Validate role
    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ 
        message: `Invalid role. Allowed roles: ${ALLOWED_ROLES.join(', ')}` 
      });
    }

    const salon = await getAdminSalon(adminId);

    // ✅ Also update permissions based on new role
    let defaultPermissions = ['scan_qr'];
    
    if (role === 'admin') {
      defaultPermissions = [...ALLOWED_PERMISSIONS];
    } else if (role === 'manager') {
      defaultPermissions = [
        'scan_qr',
        'create_booking',
        'edit_booking',
        'view_reports',
        'manage_services',
        'customer_support',
        'view_appointments'
      ];
    } else if (role === 'stylist') {
      defaultPermissions = [
        'scan_qr',
        'create_booking',
        'edit_booking',
        'view_appointments',
        'customer_notes'
      ];
    } else if (role === 'receptionist') {
      defaultPermissions = [
        'scan_qr',
        'create_booking',
        'edit_booking',
        'checkin_customers',
        'take_payments'
      ];
    }

    await db.query(
      `
      UPDATE salon_members
      SET role = $1, permissions = $2
      WHERE id = $3 AND salon_id = $4
      `,
      [role, defaultPermissions, memberId, salon.id]
    );

    res.json({ success: true, permissions: defaultPermissions });
  } catch (err) {
    console.error('Change role error:', err);
    next(err);
  }
};

/**
 * REMOVE MEMBER
 */
exports.removeMember = async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const { memberId } = req.params;

    const salon = await getAdminSalon(adminId);

    // First get linked user
    const member = await db.query(
      `
      SELECT user_id FROM salon_members
      WHERE id = $1 AND salon_id = $2
      `,
      [memberId, salon.id]
    );

    if (!member.rows.length) {
      return res.status(404).json({ message: 'Member not found' });
    }

    const userId = member.rows[0].user_id;

    // Delete from salon_members
    await db.query(`DELETE FROM salon_members WHERE id = $1`, [memberId]);

    // Also delete login account
    await db.query(`DELETE FROM users WHERE id = $1 AND role = 'member'`, [userId]);

    res.json({ success: true });
  } catch (err) {
    console.error('Remove member error:', err);
    next(err);
  }
};

/**
 * UPDATE MEMBER PERMISSIONS
 */
exports.updatePermissions = async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const { memberId } = req.params;
    const { permissions } = req.body;

    if (!Array.isArray(permissions)) {
      return res.status(400).json({
        message: "Permissions must be an array"
      });
    }

    // Validate permissions
    const invalidPermissions = permissions.filter(
      (p) => !ALLOWED_PERMISSIONS.includes(p)
    );

    if (invalidPermissions.length) {
      return res.status(400).json({
        message: "Invalid permissions detected",
        invalidPermissions: invalidPermissions
      });
    }

    // Get admin's salon
    const { rows: salonRows } = await db.query(
      `SELECT id FROM salons WHERE owner_id = $1`,
      [adminId]
    );

    if (!salonRows.length) {
      return res.status(404).json({ message: "Salon not found" });
    }

    const salonId = salonRows[0].id;

    // Ensure member belongs to this salon
    const { rows: memberRows } = await db.query(
      `
      SELECT id
      FROM salon_members
      WHERE id = $1 AND salon_id = $2
      `,
      [memberId, salonId]
    );

    if (!memberRows.length) {
      return res.status(403).json({
        message: "Not allowed to modify this member"
      });
    }

    // Update permissions
    const { rows: updated } = await db.query(
      `
      UPDATE salon_members
      SET permissions = $1
      WHERE id = $2
      RETURNING id, role, permissions
      `,
      [permissions, memberId]
    );

    res.json({
      message: "Permissions updated successfully",
      member: updated[0]
    });

  } catch (err) {
    console.error('Update permissions error:', err);
    next(err);
  }
};