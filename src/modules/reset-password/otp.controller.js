const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../../config/db');
const { generateOTP, getOTPExpiry, isOTPExpired } = require('../../utils/otpGenerator');
const { sendPasswordResetOTP, sendPasswordChangedEmail } = require('../../utils/emailService');
const { signAccessToken, signRefreshToken } = require('../../utils/jwt');

/**
 * Generate a secure reset token (used after OTP verification)
 */
const generateResetToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Store OTP in database
 * FIXED: Removed ON CONFLICT - uses DELETE then INSERT
 */
const storeOTP = async (userId, otp, expiryDate) => {
  // Hash the OTP before storing (security)
  const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');
  
  // First delete any existing OTP for this user
  await db.query(
    `DELETE FROM password_reset_otps WHERE user_id = $1`,
    [userId]
  );
  
  // Then insert new OTP
  await db.query(
    `INSERT INTO password_reset_otps (user_id, otp_hash, expires_at, used)
     VALUES ($1, $2, $3, false)`,
    [userId, hashedOTP, expiryDate]
  );
};

/**
 * Verify OTP
 */
const verifyOTP = async (email, otp) => {
  // First get user
  const userResult = await db.query(
    `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`,
    [email]
  );
  
  if (userResult.rows.length === 0) {
    return { valid: false, message: 'User not found' };
  }
  
  const userId = userResult.rows[0].id;
  const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');
  
  const otpResult = await db.query(
    `SELECT id, expires_at, used 
     FROM password_reset_otps 
     WHERE user_id = $1 AND otp_hash = $2`,
    [userId, hashedOTP]
  );
  
  if (otpResult.rows.length === 0) {
    return { valid: false, message: 'Invalid OTP code' };
  }
  
  const otpRecord = otpResult.rows[0];
  
  if (otpRecord.used) {
    return { valid: false, message: 'OTP has already been used' };
  }
  
  if (isOTPExpired(otpRecord.expires_at)) {
    return { valid: false, message: 'OTP has expired. Please request a new one.' };
  }
  
  // Mark OTP as used
  await db.query(
    `UPDATE password_reset_otps SET used = true WHERE id = $1`,
    [otpRecord.id]
  );
  
  return { valid: true, userId };
};

/**
 * Step 1: Request OTP
 * POST /auth/forgot-password
 */
exports.requestOTP = async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required'
      });
    }
    
    // Find user by email
    const userResult = await db.query(
      `SELECT id, name, email, auth_provider, password_hash 
       FROM users 
       WHERE email = $1 AND deleted_at IS NULL`,
      [email.toLowerCase()]
    );
    
    // Security: Don't reveal if email exists or not
    if (userResult.rows.length === 0) {
      console.log(`Password reset requested for non-existent email: ${email}`);
      return res.status(200).json({
        success: true,
        message: 'If an account exists with this email, you will receive a verification code.'
      });
    }
    
    const user = userResult.rows[0];
    
    // Check if user is a Google-only user (no password)
    if (user.auth_provider === 'google' && !user.password_hash) {
      return res.status(400).json({
        success: false,
        message: 'This account uses Google Sign-In. Please login with Google instead.'
      });
    }
    
    // Generate and store OTP
    const otp = generateOTP();
    const expiryDate = getOTPExpiry();
    await storeOTP(user.id, otp, expiryDate);
    
    // Send OTP via email
    await sendPasswordResetOTP(user.email, user.name, otp);
    
    console.log(`OTP sent to: ${user.email}`);
    
    res.status(200).json({
      success: true,
      message: 'Verification code sent to your email.'
    });
    
  } catch (error) {
    console.error('Request OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send verification code'
    });
  }
};

/**
 * Step 2: Resend OTP
 * POST /auth/resend-otp
 */
exports.resendOTP = async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required'
      });
    }
    
    const userResult = await db.query(
      `SELECT id, name, email FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [email.toLowerCase()]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'If an account exists, a new code will be sent.'
      });
    }
    
    const user = userResult.rows[0];
    
    // Generate and store new OTP
    const otp = generateOTP();
    const expiryDate = getOTPExpiry();
    await storeOTP(user.id, otp, expiryDate);
    
    // Send new OTP
    await sendPasswordResetOTP(user.email, user.name, otp);
    
    console.log(`Resent OTP to: ${user.email}`);
    
    res.status(200).json({
      success: true,
      message: 'A new verification code has been sent to your email.'
    });
    
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend verification code'
    });
  }
};

/**
 * Step 3: Verify OTP
 * POST /auth/verify-otp
 */
exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP code are required'
      });
    }
    
    if (otp.length !== 5 || !/^\d+$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid 5-digit code'
      });
    }
    
    const verification = await verifyOTP(email, otp);
    
    if (!verification.valid) {
      return res.status(400).json({
        success: false,
        message: verification.message
      });
    }
    
    // Generate a temporary reset token (valid for 15 minutes)
    const resetToken = generateResetToken();
    const resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000);
    const hashedResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    
    // First delete any existing token for this user
    await db.query(
      `DELETE FROM password_reset_tokens WHERE user_id = $1`,
      [verification.userId]
    );
    
    // Insert new token
    await db.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [verification.userId, hashedResetToken, resetTokenExpiry]
    );
    
    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      resetToken: resetToken
    });
    
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP'
    });
  }
};

/**
 * Step 4: Reset Password with token
 * POST /auth/reset-password
 */
exports.resetPassword = async (req, res) => {
  const client = await db.pool.connect();
  
  try {
    const { token, newPassword, email } = req.body;
    
    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Token and new password are required'
      });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }
    
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    
    // Verify token
    const tokenResult = await client.query(
      `SELECT user_id, expires_at, used 
       FROM password_reset_tokens 
       WHERE token_hash = $1`,
      [hashedToken]
    );
    
    if (tokenResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }
    
    const tokenRecord = tokenResult.rows[0];
    
    if (tokenRecord.used) {
      return res.status(400).json({
        success: false,
        message: 'This reset link has already been used'
      });
    }
    
    if (new Date() > new Date(tokenRecord.expires_at)) {
      return res.status(400).json({
        success: false,
        message: 'Reset token has expired. Please request a new one.'
      });
    }
    
    await client.query('BEGIN');
    
    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update user's password
    await client.query(
      `UPDATE users 
       SET password_hash = $1, 
           auth_provider = COALESCE(auth_provider, 'email'),
           updated_at = NOW()
       WHERE id = $2`,
      [hashedPassword, tokenRecord.user_id]
    );
    
    // Mark token as used
    await client.query(
      `UPDATE password_reset_tokens SET used = true WHERE token_hash = $1`,
      [hashedToken]
    );
    
    // Also mark any OTPs as used
    await client.query(
      `UPDATE password_reset_otps SET used = true WHERE user_id = $1`,
      [tokenRecord.user_id]
    );
    
    // Get user info for confirmation email
    const userResult = await client.query(
      `SELECT name, email FROM users WHERE id = $1`,
      [tokenRecord.user_id]
    );
    
    await client.query('COMMIT');
    
    // Send confirmation email (async - don't wait)
    sendPasswordChangedEmail(userResult.rows[0].email, userResult.rows[0].name)
      .catch(err => console.error('Confirmation email failed:', err));
    
    console.log(`Password reset successfully for user: ${tokenRecord.user_id}`);
    
    res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You can now login with your new password.'
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password'
    });
  } finally {
    client.release();
  }
};