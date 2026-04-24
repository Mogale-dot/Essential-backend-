const express = require("express");
const router = express.Router();
const auth = require("../../middlewares/auth");
const {
  getProfile,
  updateProfile,
  changePassword,
  deleteAccount,
  getSubscription,
  cancelSubscription,
} = require("./profile.controller");

// All routes require authentication
router.use(auth);

// Profile management
router.get("/me", getProfile);
router.put("/me", updateProfile);
router.put("/change-password", changePassword);
router.delete("/me", deleteAccount);

// Subscription management (for admin/salon owners)
router.get("/subscription", getSubscription);
router.post("/cancel-subscription", cancelSubscription);

module.exports = router;