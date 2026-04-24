const app = require('./app');
const PORT = process.env.PORT || 4000;
const { testConnection } = require('./config/db');

// Route to test DB connection
app.get('/api/test-db', async (req, res) => {
  console.log('💡 /api/test-db route called'); // Check if route is hit
  try {
    const result = await testConnection();
    console.log('✅ DB connection result:', result);
    res.json({ success: true, result });
  } catch (error) {
    console.error('❌ DB connection error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});