const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  family: 4  // 🔥 ADD THIS - forces IPv4 only
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  testConnection: async () => {
    try {
      const result = await pool.query('SELECT NOW()');
      return { success: true, time: result.rows[0].now };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};