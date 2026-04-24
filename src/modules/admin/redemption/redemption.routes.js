const express = require('express');
const router = express.Router();
const controller = require('./redemption.controller');
const auth = require('../../../middlewares/auth');
const requireRole = require('../../../middlewares/requireRole');
console.log('✅ Controller methods:', Object.keys(controller));
// All routes require authentication and admin role


router.use(auth);
router.use(requireRole('admin')); 


// POST /admin/redemption/confirm - Confirm redemption by scanning QR
router.post('/confirm', controller.confirmRedemption);

// GET /admin/redemption/history - Get redemption history
router.get('/history', controller.getRedemptionHistory);

module.exports = router;