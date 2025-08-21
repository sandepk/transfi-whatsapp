import { logger } from '../utils/logger_utils.js';

// Redis key prefixes
export const REDIS_KEY_PREFIX = 'user_creation';
export const BUSINESS_REDIS_KEY_PREFIX = 'business_user_creation';
export const USER_DATA_PREFIX = 'user_data';

// Generate Redis key for a specific WhatsApp user
export function getUserCreationKey(whatsappNumber) {
  return `${REDIS_KEY_PREFIX}:${whatsappNumber}`;
}

// Generate Redis key for a specific business WhatsApp user
export function getBusinessUserCreationKey(whatsappNumber) {
  return `${BUSINESS_REDIS_KEY_PREFIX}:${whatsappNumber}`;
}

// Generate Redis key for user data by email
export function getUserDataKey(email) {
  return `${USER_DATA_PREFIX}:${email.toLowerCase()}`;
}

// Store user data by email (called after successful user creation)
export async function storeUserData(redisClient, email, userData) {
  try {
    const key = getUserDataKey(email);
    const dataToStore = {
      ...userData,
      email: email.toLowerCase(),
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString()
    };
    
    // Store with 1 year expiration
    await redisClient.setEx(key, 31536000, JSON.stringify(dataToStore));
    logger.info(`User data stored for email: ${email}`);
    return true;
  } catch (error) {
    logger.error(`Error storing user data for ${email}:`, error);
    return false;
  }
}

// Get user data by email
export async function getUserData(redisClient, email) {
  try {
    const key = getUserDataKey(email);
    const userData = await redisClient.get(key);
    
    if (userData) {
      const parsedData = JSON.parse(userData);
      // Update last accessed time
      parsedData.lastAccessed = new Date().toISOString();
      await redisClient.setEx(key, 31536000, JSON.stringify(parsedData));
      logger.info(`User data retrieved for email: ${email}`);
      return parsedData;
    }
    
    logger.info(`No user data found for email: ${email}`);
    return null;
  } catch (error) {
    logger.error(`Error getting user data for ${email}:`, error);
    return null;
  }
}

// Check if user exists by email
export async function userExists(redisClient, email) {
  try {
    const userData = await getUserData(redisClient, email);
    return userData !== null;
  } catch (error) {
    logger.error(`Error checking if user exists for ${email}:`, error);
    return false;
  }
}

// Get user's full name (firstName + lastName)
export async function getUserFullName(redisClient, email) {
  try {
    const userData = await getUserData(redisClient, email);
    if (userData && userData.firstName && userData.lastName) {
      return `${userData.firstName} ${userData.lastName}`;
    } else if (userData && userData.businessName) {
      return userData.businessName;
    }
    return null;
  } catch (error) {
    logger.error(`Error getting user full name for ${email}:`, error);
    return null;
  }
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
