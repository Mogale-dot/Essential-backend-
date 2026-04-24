const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const auth = req.headers.authorization;
  console.log('🔐 AUTH MIDDLEWARE - Headers:', req.headers);
  console.log('🔐 AUTH MIDDLEWARE - Auth header:', auth);

  if (!auth) {
    console.log('❌ No authorization header');
    return res.status(401).json({ message: 'Token missing' });
  }

  const token = auth.split(' ')[1];
  console.log('🔑 Token received:', token ? token.substring(0, 20) + '...' : 'None');

  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    console.log('✅ Token verified. Payload:', payload);
    req.user = payload;
    next();
  } catch (err) {
    console.log('❌ Token verification failed:', err.message);
    return res.status(401).json({ message: 'Invalid token' });
  }
};