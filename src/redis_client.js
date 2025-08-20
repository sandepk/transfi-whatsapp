import { createClient } from 'redis';
import { logger } from './logger_utils.js';

// Fallback in-memory storage when Redis is not available
let useFallbackStorage = false;
const fallbackStorage = {
  conversations: new Map(),
  processedMessages: new Set(),
  userCreationStates: new Map(),
  businessUserCreationStates: new Map()
};

// Redis client setup
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://docker.internal:6379', // Use docker.internal for host access
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST || 'docker.internal', // Use docker.internal for host access
    port: process.env.REDIS_PORT || 6379,    // Use host port
    connectTimeout: 10000,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
    family: 4 // Force IPv4 to avoid IPv6 issues
  }
});



// Redis connection and error handling
redisClient.on('error', (err) => {
  logger.error('Redis Client Error:', err);
  if (err.code === 'ECONNREFUSED') {
    logger.warn('Redis connection refused, switching to fallback storage');
    useFallbackStorage = true;
  }
});

redisClient.on('connect', () => {
  logger.info('Redis Client Connected');
});

redisClient.on('ready', () => {
  logger.info('Redis Client Ready');
});

redisClient.on('end', () => {
  logger.info('Redis Client Connection Ended');
});

redisClient.on('reconnecting', () => {
  logger.info('Redis Client Reconnecting...');
});

// Connect to Redis with retry logic
async function connectRedis() {
  const maxRetries = 5;
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      await redisClient.connect();
      logger.info('Redis connection established');
      return true;
    } catch (error) {
      retries++;
      logger.error(`Redis connection attempt ${retries} failed:`, error.message);
      
      if (retries < maxRetries) {
        logger.info(`Retrying Redis connection in 3 seconds... (${retries}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        logger.error('Max Redis connection retries reached. Please check Redis server.');
        return false;
      }
    }
  }
}

// Redis utility functions for conversation history
async function getConversationHistory(userId) {
  try {
    if (useFallbackStorage) {
      return fallbackStorage.conversations.get(userId) || [];
    }
    const history = await redisClient.get(`conv:${userId}`);
    return history ? JSON.parse(history) : [];
  } catch (error) {
    logger.error(`Error getting conversation history for ${userId}:`, error);
    // Fallback to in-memory storage
    useFallbackStorage = true;
    return fallbackStorage.conversations.get(userId) || [];
  }
}

async function setConversationHistory(userId, history) {
  try {
    if (useFallbackStorage) {
      fallbackStorage.conversations.set(userId, history);
      return true;
    }
    await redisClient.setEx(`conv:${userId}`, 86400, JSON.stringify(history)); // Expire in 24 hours
    return true;
  } catch (error) {
    logger.error(`Error setting conversation history for ${userId}:`, error);
    // Fallback to in-memory storage
    useFallbackStorage = true;
    fallbackStorage.conversations.set(userId, history);
    return true;
  }
}

async function addToConversationHistory(userId, message) {
  try {
    let history;
    if (useFallbackStorage) {
      history = fallbackStorage.conversations.get(userId) || [];
    } else {
      history = await getConversationHistory(userId);
    }
    
    history.push(message);
    
    // Keep only last 10 messages to avoid token limits
    if (history.length > 10) {
      history = history.slice(-10);
    }
    
    if (useFallbackStorage) {
      fallbackStorage.conversations.set(userId, history);
    } else {
      await setConversationHistory(userId, history);
    }
    return true;
  } catch (error) {
    logger.error(`Error adding to conversation history for ${userId}:`, error);
    // Fallback to in-memory storage
    useFallbackStorage = true;
    let history = fallbackStorage.conversations.get(userId) || [];
    history.push(message);
    if (history.length > 10) {
      history = history.slice(-10);
    }
    fallbackStorage.conversations.set(userId, history);
    return true;
  }
}

// Redis utility functions for message deduplication
async function isMessageProcessed(messageId) {
  try {
    if (useFallbackStorage) {
      return fallbackStorage.processedMessages.has(messageId);
    }
    return await redisClient.exists(`msg:${messageId}`);
  } catch (error) {
    logger.error(`Error checking if message ${messageId} is processed:`, error);
    // Fallback to in-memory storage
    useFallbackStorage = true;
    return fallbackStorage.processedMessages.has(messageId);
  }
}

async function markMessageProcessed(messageId) {
  try {
    if (useFallbackStorage) {
      fallbackStorage.processedMessages.add(messageId);
      return true;
    }
    await redisClient.setEx(`msg:${messageId}`, 3600, '1'); // Expire in 1 hour
    return true;
  } catch (error) {
    logger.error(`Error marking message ${messageId} as processed:`, error);
    // Fallback to in-memory storage
    useFallbackStorage = true;
    fallbackStorage.processedMessages.add(messageId);
    return true;
  }
}

// Redis utility functions for general operations
async function setKey(key, value, expireSeconds = 3600) {
  try {
    await redisClient.setEx(key, expireSeconds, value);
    return true;
  } catch (error) {
    logger.error(`Error setting key ${key}:`, error);
    return false;
  }
}

async function getKey(key) {
  try {
    return await redisClient.get(key);
  } catch (error) {
    logger.error(`Error getting key ${key}:`, error);
    return null;
  }
}

async function deleteKey(key) {
  try {
    return await redisClient.del(key);
  } catch (error) {
    logger.error(`Error deleting key ${key}:`, error);
    return false;
  }
}

async function keyExists(key) {
  try {
    return await redisClient.exists(key);
  } catch (error) {
    logger.error(`Error checking if key ${key} exists:`, error);
    return false;
  }
}

// Health check function
async function checkRedisHealth() {
  try {
    await redisClient.ping();
    return true;
  } catch (error) {
    logger.error('Redis health check failed:', error);
    return false;
  }
}

// Graceful shutdown
async function disconnectRedis() {
  try {
    await redisClient.quit();
    logger.info('Redis client disconnected gracefully');
  } catch (error) {
    logger.error('Error disconnecting Redis client:', error);
  }
}

export {
  redisClient,
  connectRedis,
  getConversationHistory,
  setConversationHistory,
  addToConversationHistory,
  isMessageProcessed,
  markMessageProcessed,
  setKey,
  getKey,
  deleteKey,
  keyExists,
  checkRedisHealth,
  disconnectRedis
};
