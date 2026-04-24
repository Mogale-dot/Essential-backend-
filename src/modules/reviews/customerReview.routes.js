const express = require("express");
const router = express.Router();

const Controller = require('./customerReview.controller');

const auth = require('../../middlewares/auth');


/**
 * Customer creates review
 */
router.post(
  "/",
  auth,
  Controller.createReview
);



module.exports = router;