// salon.routes.js
const express = require("express");
const router = express.Router();
const salonController = require("./salonFeed.controller");
const auth = require("../../middlewares/auth");

// All salon routes require authentication
router.use(auth);

// GET /api/salons - List salons with pagination
router.get("/", salonController.getSalons);

// GET /api/salons/:id - Get salon profile
router.get("/:id", salonController.getSalonProfile);

// GET /api/salons/:id/gallery - Get salon gallery
router.get("/:id/gallery", salonController.getSalonGallery);

// GET /api/salons/:id/services - Get salon services
router.get("/:id/services", salonController.getSalonServices);

// GET /api/salons/:id/reviews - Get salon reviews (placeholder)
router.get("/:id/reviews", salonController.getSalonReviews);

// GET /api/salons/:id/rewards - Get salon rewards count
router.get("/:id/rewards", salonController.getSalonRewardsCount);

module.exports = router;