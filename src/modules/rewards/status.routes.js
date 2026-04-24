const express = require('express');
const router = express.Router();
const controller = require('./status.controller');
const auth = require('../../middlewares/auth');

// Debug: Log available methods
console.log('✅ Controller methods:', Object.keys(controller));

// GET /salons – Get all salons for the logged-in customer
router.get('/salons', auth, controller.getCustomerSalons);

// GET /rewards/status – Get reward status for a specific salon
router.get('/rewards/status', auth, controller.getRewardStatus);

// POST /request-redemption – Request a redemption token for a reward
router.post('/request-redemption', auth, controller.requestRedemptionToken);

module.exports = router;