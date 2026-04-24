const express = require('express');
const router = express.Router();
const controller = require('./visit.controller');
const auth = require('../../middlewares/auth');

router.post('/', auth, controller.createVisit);
// Add this route
router.get("/history", auth, controller.getVisitHistory);

module.exports = router;