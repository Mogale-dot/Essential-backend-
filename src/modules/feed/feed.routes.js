const express = require("express");
const router = express.Router();
const { getFeed, toggleLike, getLikesBatch } = require("./feed.controller");
const auth = require("../../middlewares/auth");

// Feed endpoints
router.get("/", auth, getFeed);

// Like endpoints
router.post("/posts/:postId/like", auth, toggleLike);
router.post("/likes/batch", auth, getLikesBatch); // Optional batch endpoint

module.exports = router;