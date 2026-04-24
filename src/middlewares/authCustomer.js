const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const auth = req.headers.authorization;

  if (!auth) {
    return res.status(401).json({ message: 'Token missing' });
  }

  const token = auth.split(' ')[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    
    // Verify this is a customer (not an admin)
    if (payload.role && payload.role !== 'customer') {
      return res.status(403).json({ message: 'Access denied. Customer only.' });
    }
    
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};