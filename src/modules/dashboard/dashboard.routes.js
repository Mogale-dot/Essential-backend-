const express = require('express');
const router = express.Router();
const dashboardController = require('../dashboard/dashboard.controller');
const auth = require('../../middlewares/auth');

// Protect route with authentication
router.use(auth);

// GET /api/salon/dashboard
router.get('/', dashboardController.getDashboard);

module.exports = router;