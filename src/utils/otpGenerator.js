/**
 * Generate a 6-digit OTP code
 * @returns {string} 6-digit OTP
 */
const generateOTP = () => {
  return Math.floor(10000 + Math.random() * 90000).toString();
};

/**
 * Generate OTP expiry time (10 minutes from now)
 * @returns {Date} Expiry date
 */
const getOTPExpiry = () => {
  return new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
};

/**
 * Check if OTP is expired
 * @param {Date} expiryDate 
 * @returns {boolean}
 */
const isOTPExpired = (expiryDate) => {
  return new Date() > new Date(expiryDate);
};

module.exports = {
  generateOTP,
  getOTPExpiry,
  isOTPExpired
};