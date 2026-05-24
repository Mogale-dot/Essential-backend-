const express = require('express');
const router = express.Router();

const oauthController = require('./oauth.controller');

/**
 * GOOGLE AUTH
 */
router.post('/google', oauthController.googleAuth);

module.exports = router;