const router = require('express').Router();
const controller = require('./salon.controller');
const auth = require('../../middlewares/auth');
const requireRole = require('../../middlewares/requireRole');

router.get(
  '/my-salon',
  auth,
  requireRole('admin'),
  controller.getMySalon
);

router.patch(
  '/:id',
  auth,
  requireRole('admin'),
  controller.updateSalon
);

module.exports = router;
