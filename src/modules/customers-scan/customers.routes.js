
const router = require('express').Router();
const controller  = require('./customers.controller');
const auth = require('../../middlewares/auth');

router.post('/identify',auth,  controller.identifyCustomer);
router.get('/', auth, controller.getSalonCustomers);
module.exports = router;