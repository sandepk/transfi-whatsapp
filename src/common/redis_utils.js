import { logger } from '../utils/logger_utils.js';

// Redis key prefixes
export const REDIS_KEY_PREFIX = 'user_creation';
export const BUSINESS_REDIS_KEY_PREFIX = 'business_user_creation';

// Generate Redis key for a specific WhatsApp user
export function getUserCreationKey(whatsappNumber) {
  return `${REDIS_KEY_PREFIX}:${whatsappNumber}`;
}

// Generate Redis key for a specific business WhatsApp user
export function getBusinessUserCreationKey(whatsappNumber) {
  return `${BUSINESS_REDIS_KEY_PREFIX}:${whatsappNumber}`;
}

// Generic state management functions
export async function getCreationState(redisClient, whatsappNumber, keyGenerator) {
  try {
    const key = keyGenerator(whatsappNumber);
    const state = await redisClient.get(key);
    return state ? JSON.parse(state) : null;
  } catch (error) {
    logger.error(`Error getting creation state for ${whatsappNumber}:`, error);
    return null;
  }
}

export async function setCreationState(redisClient, whatsappNumber, state, keyGenerator) {
  try {
    const key = keyGenerator(whatsappNumber);
    if (state === null) {
      // Clear the state
      await redisClient.del(key);
    } else {
      // Set state with 1 hour expiration
      await redisClient.setEx(key, 3600, JSON.stringify(state));
    }
    return true;
  } catch (error) {
    logger.error(`Error setting creation state for ${whatsappNumber}:`, error);
    return false;
  }
}

// Individual user state management
export async function getUserCreationState(redisClient, whatsappNumber) {
  return getCreationState(redisClient, whatsappNumber, getUserCreationKey);
}

export async function setUserCreationState(redisClient, whatsappNumber, state) {
  return setCreationState(redisClient, whatsappNumber, state, getUserCreationKey);
}

// Business user state management
export async function getBusinessUserCreationState(redisClient, whatsappNumber) {
  return getCreationState(redisClient, whatsappNumber, getBusinessUserCreationKey);
}

export async function setBusinessUserCreationState(redisClient, whatsappNumber, state) {
  return setCreationState(redisClient, whatsappNumber, state, getBusinessUserCreationKey);
}
