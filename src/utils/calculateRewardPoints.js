// utils/calculateRewardPoints.js

module.exports = function calculateRewardPoints(pointsArray) {
  if (!pointsArray.length) {
    throw new Error('No service points found');
  }

  const sorted = [...pointsArray].sort((a, b) => a - b);
  const mean =
    sorted.reduce((sum, val) => sum + val, 0) / sorted.length;

  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];

  return {
    basic: Math.round(q1),
    standard: Math.round(mean),
    premium: Math.round(q3),
    vip: Math.round(q3 * 1.5) // VIP is intentionally expensive
  };
};