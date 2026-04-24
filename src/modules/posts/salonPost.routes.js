const express = require('express');
const router = express.Router();
const { 
  createSalonPost, 
  getSalonPosts, 
  deleteSalonPost 
} = require('./salonPost.controller');
const auth = require('../../middlewares/auth');
const requireRole = require('../../middlewares/requireRole');

// All salon post routes require authentication and admin role
router.use(auth);
router.use(requireRole('admin'));

// POST /api/salon/posts - Create new post
router.post('/post', createSalonPost);

// GET /api/salon/posts - Get salon's posts (gallery)
router.get('/posts', getSalonPosts);

// DELETE /api/salon/posts/:postId - Delete a post
router.delete('/posts/:postId', deleteSalonPost);

module.exports = router;