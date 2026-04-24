const jwt = require('jsonwebtoken');
const db = require('../../config/db');
const { signAccessToken } = require('../../utils/jwt');

exports.refresh = async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({ message: 'Refresh token required' });
  }

  try {
    // Verify refresh token
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    
    // Get fresh user data from database
    const { rows } = await db.query(
      `SELECT id, role FROM users WHERE id = $1`,
      [payload.id]
    );

    if (!rows.length) {
      return res.status(401).json({ message: 'User not found' });
    }

    const user = rows[0];

    // Issue new access token
    const newAccessToken = signAccessToken({ id: user.id, role: user.role });

    res.json({
      accessToken: newAccessToken
    });

  } catch (err) {
    return res.status(401).json({ message: 'Invalid refresh token' });
  }
};