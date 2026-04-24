const db = require('../../config/db');

console.log('✅✅✅ CUSTOMERS CONTROLLER LOADED ✅✅✅');

exports.identifyCustomer = async (req, res) => {
  console.log('\n🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀');
  console.log('🚀 IDENTIFY CUSTOMER ENDPOINT HIT!');
  console.log('🚀 Timestamp:', new Date().toISOString());
  console.log('🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀\n');
  
  console.log('📦 Request body:', req.body);
  console.log('📦 Request headers:', {
    authorization: req.headers.authorization ? 'Bearer [PRESENT]' : 'MISSING',
    'content-type': req.headers['content-type'],
    ...req.headers
  });
  console.log('📦 Request user from auth:', req.user);
  
  const client = await db.pool.connect();

  try {
    const userId = req.user?.id;
    console.log('👤 User ID from token:', userId);

    if (!userId) {
      console.log('❌ No user ID in token!');
      return res.status(401).json({ message: 'Invalid token' });
    }

    const { email } = req.body;
    console.log('📧 Email from request:', email);

    if (!email) {
      console.log('❌ No email provided');
      return res.status(400).json({ message: 'Email is required' });
    }

    // Get salonId from salons table using owner_id
    console.log('🔍 Looking up salon for user:', userId);
    const salonRes = await client.query(
      `SELECT id FROM salons WHERE owner_id = $1`,
      [userId]
    );
    console.log('🏢 Salon query result:', salonRes.rows);

    if (!salonRes.rows.length) {
      console.log('❌ No salon found for user', userId);
      return res.status(403).json({ message: 'Salon not found for this user' });
    }

    const salonId = salonRes.rows[0].id;
    console.log('✅ Found salon ID:', salonId);

    await client.query('BEGIN');
    console.log('🔄 Transaction started');

    // 1️⃣ Verify user exists
    console.log('🔍 Looking up user with email:', email.toLowerCase());
    const userRes = await client.query(
      `
      SELECT id, name, email, role
      FROM users
      WHERE email = $1
      `,
      [email.toLowerCase()]
    );
    console.log('👥 User query result:', userRes.rows);

    if (!userRes.rows.length) {
      console.log('❌ No user found with email:', email);
      await client.query('ROLLBACK');
      console.log('🔄 Transaction rolled back');
      return res.status(404).json({
        message: 'Customer must have an account'
      });
    }

    const user = userRes.rows[0];
    console.log('✅ Found user:', user);

    if (user.role !== 'customer') {
      console.log('❌ User is not a customer, role is:', user.role);
      await client.query('ROLLBACK');
      console.log('🔄 Transaction rolled back');
      return res.status(400).json({
        message: 'User is not a customer'
      });
    }

    // 2️⃣ Link customer to salon
    console.log('🔗 Linking customer to salon - salonId:', salonId, 'userId:', user.id);
    const linkResult = await client.query(
      `
      INSERT INTO salon_customers (salon_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      RETURNING *
      `,
      [salonId, user.id]
    );
    console.log('🔗 Link result:', linkResult.rows);

    await client.query('COMMIT');
    console.log('✅ Transaction committed successfully');

    // 3️⃣ Response
    const response = {
      id: user.id,
      name: user.name,
      email: user.email,
      points: 0
    };
    console.log('📤 Sending response:', response);
    
    return res.status(200).json(response);

  } catch (err) {
    console.log('\n❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌');
    console.log('❌ ERROR CAUGHT IN CONTROLLER');
    console.log('❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌\n');
    
    console.log('Error name:', err.name);
    console.log('Error message:', err.message);
    console.log('Error stack:', err.stack);
    
    if (err.code) {
      console.log('Database error code:', err.code);
      console.log('Database error detail:', err.detail);
    }
    
    try {
      await client.query('ROLLBACK');
      console.log('🔄 Transaction rolled back due to error');
    } catch (rollbackErr) {
      console.log('⚠️ Error during rollback:', rollbackErr.message);
    }
    
    return res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  } finally {
    client.release();
    console.log('🔓 Database client released\n');
  }
};

exports.getSalonCustomers = async (req, res) => {
  console.log('\n📋📋📋📋📋📋📋📋📋📋📋📋📋📋📋📋📋');
  console.log('📋 GET SALON CUSTOMERS ENDPOINT HIT!');
  console.log('📋 Timestamp:', new Date().toISOString());
  console.log('📋📋📋📋📋📋📋📋📋📋📋📋📋📋📋📋📋\n');

  try {
    const userId = req.user?.id;
    console.log('👤 User ID from token:', userId);

    if (!userId) {
      console.log('❌ No user ID in token');
      return res.status(401).json({ message: 'Invalid token' });
    }

    // Get salonId from salons table
    console.log('🔍 Looking up salon for user:', userId);
    const salonRes = await db.query(
      `SELECT id FROM salons WHERE owner_id = $1`,
      [userId]
    );
    console.log('🏢 Salon query result:', salonRes.rows);

    if (!salonRes.rows.length) {
      console.log('❌ No salon found for user');
      return res.status(403).json({ message: 'Salon not found' });
    }

    const salonId = salonRes.rows[0].id;
    console.log('✅ Found salon ID:', salonId);

    const result = await db.query(
  `
  SELECT
    u.id,
    u.name,
    u.email,
    sc.joined_at,

    COUNT(v.id) AS visits,
    COALESCE(SUM(v.total_amount), 0) AS total_spent,
    COALESCE(SUM(v.total_points), 0) AS reward_points,
    MAX(v.created_at) AS last_visit

  FROM salon_customers sc
  JOIN users u ON u.id = sc.user_id

  LEFT JOIN visits v 
    ON v.customer_id = u.id
    AND v.salon_id = sc.salon_id

  WHERE sc.salon_id = $1

  GROUP BY u.id, u.name, u.email, sc.joined_at
  ORDER BY sc.joined_at DESC
  `,
  [salonId]
);

    console.log(`📊 Found ${result.rows.length} customers`);

   const customers = result.rows.map(c => {
  const visits = Number(c.visits);
  const totalSpent = Number(c.total_spent);
  const rewardPoints = Number(c.reward_points);

  return {
    id: c.id,
    name: c.name,
    email: c.email,
    visits,
    totalSpent,
    lastVisit: c.last_visit,
    rewardPoints,

    // Simple logic (can evolve later)
    isNew: visits === 1,
    isVip: totalSpent >= 1000 // example VIP threshold
  };
});

    console.log('📤 Sending customers response');
    return res.json(customers);

  } catch (err) {
    console.log('\n❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌');
    console.log('❌ ERROR IN GET SALON CUSTOMERS');
    console.log('❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌\n');
    
    console.log('Error name:', err.name);
    console.log('Error message:', err.message);
    console.log('Error stack:', err.stack);
    
    res.status(500).json({ message: 'Server error' });
  }
};