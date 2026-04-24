const express = require("express");
const router = express.Router();
const auth = require("../../middlewares/auth");
const {
  unifiedSearch,
  getRecentSearches,
  saveRecentSearch,
  clearRecentSearches
} = require("./search.controller");

// Main search endpoint
router.get("/", auth, unifiedSearch);

// Recent searches management
router.get("/recent", auth, getRecentSearches);
router.post("/recent", auth, saveRecentSearch);
router.delete("/recent", auth, clearRecentSearches);

module.exports = router;