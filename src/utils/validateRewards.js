// utils/validateRewards.js

const ALLOWED_TIERS = ['basic', 'standard', 'premium', 'vip'];

module.exports = function validateRewards(rewards) {
  if (!Array.isArray(rewards) || rewards.length === 0) {
    throw new Error('Rewards array is required');
  }

  for (const reward of rewards) {
    if (!reward.title || !reward.tier) {
      throw new Error('Reward title and tier are required');
    }

    if (!ALLOWED_TIERS.includes(reward.tier)) {
      throw new Error(`Invalid tier: ${reward.tier}`);
    }
  }
};