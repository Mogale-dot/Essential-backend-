const { Resend } = require('resend');

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Your personal email for testing (the one you registered with Resend)
const YOUR_TEST_EMAIL = 'mogaleboipelo99@gmail.com'; // Change this to YOUR email

/**
 * Send OTP for password reset
 * In TESTING MODE, emails only go to your own email address
 */
const sendPasswordResetOTP = async (email, name, otp) => {
  try {
    // For testing: Log what would be sent to real users
    console.log(`\n📧 ===== TEST MODE =====`);
    console.log(`Would send OTP to: ${email}`);
    console.log(`OTP Code: ${otp}`);
    console.log(`For user: ${name || 'customer'}`);
    console.log(`=======================\n`);
    
    // In testing mode, send to YOUR email only
    const { data, error } = await resend.emails.send({
      from: 'onboarding@resend.dev', // Resend's test sender (only works for your email)
      to: [YOUR_TEST_EMAIL], // ⚠️ ONLY your email works in testing mode
      subject: `[TEST] Password Reset OTP - Essential Salons (for ${email})`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Reset OTP - TEST MODE</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { text-align: center; padding: 20px 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px 12px 0 0; }
            .header h1 { color: white; margin: 0; font-size: 24px; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; }
            .test-badge { background: #ff9800; color: white; padding: 8px 16px; border-radius: 20px; display: inline-block; margin-bottom: 20px; font-size: 14px; font-weight: bold; }
            .otp-code { font-size: 48px; font-weight: bold; text-align: center; letter-spacing: 10px; color: #667eea; margin: 20px 0; font-family: monospace; }
            .real-user { background: #e3f2fd; padding: 12px; border-radius: 8px; margin: 20px 0; }
            .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0; font-size: 14px; }
            .footer { text-align: center; padding: 20px; font-size: 12px; color: #6c757d; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 Essential Salons</h1>
            </div>
            <div class="content">
              <div style="text-align: center;">
                <div class="test-badge">🧪 TEST MODE</div>
              </div>
              
              <h2>Hi ${name || 'there'}!</h2>
              
              <div class="real-user">
                <strong>⚠️ This email would normally go to:</strong><br>
                ${email}
              </div>
              
              <p>Use the following 6-digit code to reset your password:</p>
              
              <div class="otp-code">${otp}</div>
              
              <p>This code will expire in <strong>10 minutes</strong>.</p>
              
              <div class="warning">
                ⚠️ <strong>TEST MODE NOTICE:</strong><br>
                In production, this email would be sent directly to ${email}.<br>
                For testing, it's being sent to your developer email.
              </div>
              
              <hr style="margin: 30px 0;">
              
              <p style="font-size: 14px;">For security, this request was made from:</p>
              <ul style="font-size: 14px;">
                <li>🌐 Essential Mobile App</li>
                <li>📱 Device: Mobile App</li>
              </ul>
            </div>
            <div class="footer">
              <p>© 2026 Essential Salons. All rights reserved.</p>
              <p>Essential Salons, Pretoria, South Africa</p>
              <p><strong>🧪 This is a test email</strong></p>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    if (error) {
      console.error('Email send error:', error);
      throw new Error('Failed to send OTP email');
    }
    
    console.log(`✅ Test OTP email sent to: ${YOUR_TEST_EMAIL} (for user: ${email})`);
    return { success: true };
    
  } catch (error) {
    console.error('Email service error:', error);
    throw new Error('Email service unavailable');
  }
};

/**
 * Send password changed confirmation email (TESTING MODE)
 */
const sendPasswordChangedEmail = async (email, name) => {
  try {
    console.log(`\n📧 ===== PASSWORD CHANGE CONFIRMATION (TEST MODE) =====`);
    console.log(`Would send confirmation to: ${email}`);
    console.log(`==================================================\n`);
    
    const { data, error } = await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: [YOUR_TEST_EMAIL],
      subject: `[TEST] Password Changed - Essential Salons (for ${email})`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center; border-radius: 12px 12px 0 0; }
            .header h1 { color: white; margin: 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; }
            .test-badge { background: #ff9800; color: white; padding: 8px 16px; border-radius: 20px; display: inline-block; margin-bottom: 20px; font-size: 14px; font-weight: bold; }
            .real-user { background: #e3f2fd; padding: 12px; border-radius: 8px; margin: 20px 0; }
            .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 Essential Salons</h1>
            </div>
            <div class="content">
              <div style="text-align: center;">
                <div class="test-badge">🧪 TEST MODE</div>
              </div>
              
              <h2>Hi ${name || 'there'}! 👋</h2>
              
              <div class="real-user">
                <strong>⚠️ This email would normally go to:</strong><br>
                ${email}
              </div>
              
              <p>Your Essential Salons account password was just changed.</p>
              <p>If you made this change, no further action is needed.</p>
              
              <div class="warning">
                ⚠️ <strong>Didn't change your password?</strong><br>
                Contact us immediately at support@essentialsalons.com
              </div>
              
              <hr>
              <p style="font-size: 12px; color: #666;">Essential Salons · Pretoria, South Africa</p>
              <p style="font-size: 12px; color: #999;"><strong>🧪 This is a test email</strong></p>
            </div>
          </div>
        </body>
        </html>
      `,
    });
    
    console.log(`✅ Test password change email sent for user: ${email}`);
    return { success: true };
    
  } catch (error) {
    console.error('Password change email error:', error);
    // Don't throw - this is just a notification
  }
};

module.exports = {
  sendPasswordResetOTP,
  sendPasswordChangedEmail
};