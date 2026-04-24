 
const router = require('express').Router();
const controller = require('./services.controller');
const auth = require('../../middlewares/auth');

// All services routes require login
router.use(auth);

// GET services
router.get('/', controller.getServices);

// BULK CREATE services
router.post('/', controller.createServices);

// UPDATE service
router.patch('/:serviceId', controller.updateService);

// DELETE service
router.delete('/:serviceId', controller.deleteService);

module.exports = router;
