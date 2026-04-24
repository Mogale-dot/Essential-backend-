const db = require('../config/db');

module.exports = (requiredSalonRole) => {
  return async (req, res, next) => {
    const userId = req.user.id;
    const salonId = req.params.salonId;
    console.log('USER:', req.user);
console.log('SALON:', salonId); 
console.log('ROLE CHECK →', {
  userId: req.user?.id,
  salonId: req.params.salonId,
});



    if (!salonId) {
      return res.status(400).json({ message: 'Missing salonId' });
    }

    const { rows } = await db.query(
      `
      SELECT role
      FROM salon_members
      WHERE user_id = $1 AND salon_id = $2
      `,
      [userId, salonId]
    );

    if (!rows.length) {
      return res.status(403).json({ message: 'Not a salon member' });
    }

 if (rows[0].role !== requireSalondRole.toLowerCase()) {

      return res.status(403).json({ message: 'Insufficient permissions' });
    }

    next();
  };
};
