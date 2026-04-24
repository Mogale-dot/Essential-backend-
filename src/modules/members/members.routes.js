const router = require('express').Router();
const controller = require('./members.controller');
const requireAuth = require('../../middlewares/auth');


// All routes require login
router.use(requireAuth);

/**
 * GET /members
 * List all members for current admin's salon
 */
// CHANGED: Removed salonId param - backend auto-detects from admin user
router.get(
  '/',
 
  controller.listMembers
);

/**
 * POST /members
 * Add new member to salon
 */
// CHANGED: Removed salonId param - backend auto-detects
router.post(
  '/',

  controller.addMember
);

/**
 * PATCH /members/:memberId/role
 * Change member's role
 */
// FIXED: Changed path to match REST convention
router.patch(
  '/:memberId/role',
 
  controller.changeRole
);

/**
 * PATCH /members/:memberId/permissions
 * Update member permissions
 */
// ADDED: This route was missing
router.patch(
  '/:memberId/permissions',
  
  controller.updatePermissions
);

/**
 * DELETE /members/:memberId
 * Remove member from salon
 */
// FIXED: Changed path to match REST convention
router.delete(
  '/:memberId',
 
  controller.removeMember
);

module.exports = router;  