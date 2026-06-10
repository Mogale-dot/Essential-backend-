const express = require('express');
const router = express.Router();
const otpController = require('./otp.controller');
const { authenticateToken } = require('../../middlewares/auth');

// Password reset routes (OTP based)
router.post('/forgot-password', otpController.requestOTP);
router.post('/resend-otp', otpController.resendOTP);
router.post('/verify-otp', otpController.verifyOTP);
router.post('/reset-password', otpController.resetPassword);



module.exports = router;