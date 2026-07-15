const express = require("express");
const router = express.Router();
const auth = require("../../middlewares/auth");
const {
  getFeed,
  toggleLike,
  getLikesBatch,
  blockSalon,
  unblockSalon,
  hidePost,
  reportPost,
  getBlockedSalons,
} = require("./feed.controller");

// Feed endpoints
router.get("/", auth, getFeed);

// Like endpoints
router.post("/posts/:postId/like", auth, toggleLike);
router.post("/likes/batch", auth, getLikesBatch);

// ✅ Block/Unblock Salon endpoints (mounted under /api/feed)
router.post("/salons/:salonId/block", auth, blockSalon);
router.delete("/salons/:salonId/block", auth, unblockSalon);
router.get("/blocked", auth, getBlockedSalons);

// ✅ Hide Post endpoint (mounted under /api/feed)
router.post("/posts/:postId/hide", auth, hidePost);

// ✅ Report Post endpoint (mounted under /api/feed)
router.post("/posts/:postId/report", auth, reportPost);

module.exports = router;