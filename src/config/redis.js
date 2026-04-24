const Redis = require('ioredis');

// Determine which Redis URL to use
const getRedisUrl = () => {
  const env = process.env.NODE_ENV || 'development';
  
  if (env === 'production') {
    // Production - Use your production Redis (AWS/Azure/Upstash)
    if (!process.env.REDIS_PROD_URL) {
      throw new Error('REDIS_PROD_URL environment variable is not set');
    }
    return process.env.REDIS_PROD_URL;
  } else {
    // Development - Use Upstash or local Redis
    if (process.env.REDIS_DEV_URL) {
      return process.env.REDIS_DEV_URL; // Upstash dev
    }
    // Fallback to local Redis (if you have it installed)
    return 'redis://localhost:6379';
  }
};

// Create Redis client with Upstash-specific configuration
const redis = new Redis(getRedisUrl(), {
  // ⚠️ CRITICAL: Upstash requires TLS/SSL
  tls: {},  // Empty object enables TLS
  
  // Connection retry strategy
  retryStrategy: (times) => {
    // Exponential backoff: wait 2^times * 50ms, max 2 seconds
    const delay = Math.min(Math.pow(2, times) * 50, 2000);
    console.log(`🔄 Redis: Retrying connection in ${delay}ms... (attempt ${times})`);
    return delay;
  },
  
  // Maximum number of retries per request
  maxRetriesPerRequest: 3,
  
  // Enable ready check
  enableReadyCheck: true,
  
  // Connection timeout (ms)
  connectTimeout: 10000,
  
  // Keep alive
  keepAlive: 30000,
  
  // Reconnect on error
  reconnectOnError: (err) => {
    console.error('❌ Redis reconnect on error:', err.message);
    return true; // Always try to reconnect
  }
});

// Connection event handlers
redis.on('connect', () => {
  console.log('✅ Redis: Connected successfully');
});

redis.on('ready', () => {
  console.log('✅ Redis: Ready to accept commands');
});

redis.on('error', (err) => {
  console.error('❌ Redis: Connection error:', err.message);
  // Don't crash the app on Redis errors
});

redis.on('close', () => {
  console.log('⚠️ Redis: Connection closed');
});

redis.on('reconnecting', (delay) => {
  console.log(`🔄 Redis: Reconnecting in ${delay}ms...`);
});

// Helper functions for common operations
const cache = {
  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {Promise<any>} - Parsed value or null
   */
  async get(key) {
    try {
      const value = await redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (err) {
      console.error('❌ Redis get error:', err.message);
      return null;
    }
  },

  /**
   * Set value in cache with expiration
   * @param {string} key - Cache key
   * @param {any} value - Value to store (will be JSON.stringify'd)
   * @param {number} ttl - Time to live in seconds (default: 60)
   * @returns {Promise<boolean>} - Success status
   */
  async set(key, value, ttl = 60) {
    try {
      await redis.setex(key, ttl, JSON.stringify(value));
      return true;
    } catch (err) {
      console.error('❌ Redis set error:', err.message);
      return false;
    }
  },

  /**
   * Delete a key
   * @param {string} key - Cache key to delete
   * @returns {Promise<boolean>} - Success status
   */
  async del(key) {
    try {
      await redis.del(key);
      return true;
    } catch (err) {
      console.error('❌ Redis del error:', err.message);
      return false;
    }
  },

  /**
   * Delete all keys matching a pattern
   * @param {string} pattern - Pattern like "feed:*" or "salon:*:posts"
   * @returns {Promise<boolean>} - Success status
   */
  async delPattern(pattern) {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(keys);
        console.log(`✅ Redis: Deleted ${keys.length} keys matching "${pattern}"`);
      }
      return true;
    } catch (err) {
      console.error('❌ Redis delPattern error:', err.message);
      return false;
    }
  },

  /**
   * Get or set cache (read-through caching)
   * @param {string} key - Cache key
   * @param {number} ttl - Time to live in seconds
   * @param {Function} fetchFunction - Function to fetch data if cache misses
   * @returns {Promise<any>} - Data from cache or fetchFunction
   */
  async remember(key, ttl, fetchFunction) {
    // Try cache first
    const cached = await this.get(key);
    if (cached) {
      console.log(`✅ Redis cache HIT: ${key}`);
      return cached;
    }

    console.log(`⚠️ Redis cache MISS: ${key}`);
    
    // Not in cache, execute function
    const fresh = await fetchFunction();
    
    // Store in cache (don't wait for it)
    this.set(key, fresh, ttl).catch(err => 
      console.error(`❌ Failed to cache ${key}:`, err.message)
    );
    
    return fresh;
  },

  /**
   * Check if Redis is healthy
   * @returns {Promise<boolean>} - True if Redis is responding
   */
  async ping() {
    try {
      const result = await redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  },

  /**
   * Get cache statistics
   * @returns {Promise<Object>} - Cache stats
   */
  async stats() {
    try {
      const info = await redis.info();
      const keyspace = await redis.info('keyspace');
      
      return {
        info,
        keyspace,
        connected: redis.status === 'ready'
      };
    } catch (err) {
      console.error('❌ Redis stats error:', err.message);
      return { connected: false };
    }
  },

  /**
   * Flush all cache (use with caution!)
   * @returns {Promise<boolean>} - Success status
   */
  async flush() {
    try {
      await redis.flushall();
      console.log('⚠️ Redis: All cache flushed');
      return true;
    } catch (err) {
      console.error('❌ Redis flush error:', err.message);
      return false;
    }
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Closing Redis connection...');
  await redis.quit();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🔄 Closing Redis connection...');
  await redis.quit();
  process.exit(0);
});

module.exports = { redis, cache };