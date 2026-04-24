 
const express = require('express');
const router = express.Router();
const rewardsController = require('./rewards.controller');
const auth = require('../../middlewares/auth');


router.use(auth);


router.post('/', rewardsController.createRewards);



router.get("/", rewardsController.getRewards);


router.delete("/:id", rewardsController.deleteReward);


module.exports = router;