const express = require('express');
const router = express.Router();
const auth = require('../../middlewares/auth');
const {
  signup,
  login,
  registerSalon,
  refresh,
  logout,
  getMe
} = require('./auth.controller');

// Public routes
router.post('/signup', signup);
router.post('/login', login);
router.post('/register-salon', registerSalon);
router.post('/refresh', refresh);

// Protected routes (require authentication)
router.post('/logout', auth, logout);
router.get('/me', auth, getMe);

module.exports = router;