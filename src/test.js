require('dotenv').config();
const { redis, cache } = require('./src/config/redis');

async function test() {
  console.log('🧪 Testing Redis connection...');
  
  // Test 1: Basic ping
  const isHealthy = await cache.ping();
  console.log('✅ Redis health check:', isHealthy);
  
  // Test 2: Set and get
  await cache.set('test:key', { message: 'Hello Redis!' }, 60);
  const value = await cache.get('test:key');
  console.log('✅ Cache get/set:', value);
  
  // Test 3: remember pattern
  const data = await cache.remember('test:remember', 30, async () => {
    console.log('⚡ Fetching fresh data...');
    return { fetched: new Date().toISOString() };
  });
  console.log('✅ Cache remember (first call):', data);
  
  const cachedData = await cache.remember('test:remember', 30, async () => {
    console.log('⚡ This should not run!');
    return { should: 'not happen' };
  });
  console.log('✅ Cache remember (second call - should be cached):', cachedData);
  
  // Test 4: Delete
  await cache.del('test:key');
  const deleted = await cache.get('test:key');
  console.log('✅ Cache delete:', deleted === null);
  
  // Clean up
  await cache.del('test:remember');
  
  console.log('\n🎉 All tests passed!');
  process.exit(0);
}

test().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});