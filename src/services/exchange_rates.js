import fetch from 'node-fetch';
import { logger } from '../utils/logger_utils.js';
import { getOpenaiResponse } from '../utils/openai_utils.js';
import { EXCHANGE_RATES_INTENT_PROMPT, CURRENCY_EXTRACTION_PROMPT, EXCHANGE_RATES_RESPONSES } from '../prompts/prompts.js';

/**
 * Get live exchange rates for a specific currency
 * @param {string} currency - Currency code (e.g., 'PHP', 'USD', 'EUR')
 * @returns {Promise<Object>} Exchange rates object with depositRate and withdrawRate
 */
export async function getLiveExchangeRates(currency) {
  try {
    // Validate currency parameter
    if (!currency || typeof currency !== 'string') {
      throw new Error('Currency parameter is required and must be a string');
    }

    // Convert to uppercase for consistency
    const currencyCode = currency.toUpperCase().trim();
    
    // Validate currency code format (basic validation)
    if (currencyCode.length < 1 || currencyCode.length > 10) {
      throw new Error('Currency code must be between 1 and 10 characters');
    }

    const apiKey = process.env.TRANSFI_BASIC_API_KEY;
    
    if (!apiKey) {
      throw new Error('Missing required environment variable: TRANSFI_BASIC_API_KEY');
    }

    const url = `https://sandbox-api.transfi.com/v2/exchange-rates/live-rates?currency=${currencyCode}`;
    
    logger.info(`Fetching live exchange rates for currency: ${currencyCode}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'authorization': `Basic ${apiKey}`
      }
    });

    if (!response.ok) {
      const errorData = await response.text();
      let errorMessage = `Exchange rates API error: ${response.status} ${response.statusText}`;
      
      try {
        const parsedError = JSON.parse(errorData);
        if (parsedError.message) {
          errorMessage = parsedError.message;
        } else if (parsedError.error) {
          errorMessage = parsedError.error;
        }
      } catch (parseError) {
        // If error response is not JSON, use the raw text
        if (errorData) {
          errorMessage = errorData;
        }
      }
      
      throw new Error(errorMessage);
    }

    const result = await response.json();
    
    // Validate response structure
    if (!result.depositRate || !result.withdrawRate) {
      logger.warn(`Unexpected API response structure for ${currencyCode}:`, result);
      throw new Error('Invalid response structure from exchange rates API');
    }

    logger.info(`Successfully fetched exchange rates for ${currencyCode}: Deposit: ${result.depositRate}, Withdraw: ${result.withdrawRate}`);
    
    return {
      currency: currencyCode,
      depositRate: result.depositRate,
      withdrawRate: result.withdrawRate,
      timestamp: new Date().toISOString(),
      source: 'Transfi API'
    };

  } catch (error) {
    logger.error(`Error fetching live exchange rates for ${currency}: ${error.message}`);
    throw error;
  }
}

/**
 * Validate if a currency code is supported (basic validation)
 * @param {string} currency - Currency code to validate
 * @returns {boolean} True if currency code format is valid
 */
export function isValidCurrencyCode(currency) {
  if (!currency || typeof currency !== 'string') {
    return false;
  }
  
  const currencyCode = currency.toUpperCase().trim();
  
  // Basic validation: 1-10 characters, only alphabetic characters
  return /^[A-Z]{1,10}$/.test(currencyCode);
}

// Exchange Rates State Management Functions

// Redis key prefix for exchange rates flow
const EXCHANGE_RATES_KEY_PREFIX = 'exchange_rates_flow';

// Generate Redis key for exchange rates flow
function getExchangeRatesKey(whatsappNumber) {
  return `${EXCHANGE_RATES_KEY_PREFIX}:${whatsappNumber}`;
}

// Check if user is in exchange rates flow
export async function isUserInExchangeRatesFlow(redisClient, whatsappNumber) {
  try {
    const key = getExchangeRatesKey(whatsappNumber);
    const state = await redisClient.get(key);
    return state ? JSON.parse(state) : null;
  } catch (error) {
    logger.error(`Error checking exchange rates flow state for ${whatsappNumber}:`, error);
    return null;
  }
}

// Set exchange rates flow state
export async function setExchangeRatesState(redisClient, whatsappNumber, state) {
  try {
    const key = getExchangeRatesKey(whatsappNumber);
    if (state === null) {
      // Clear the state
      await redisClient.del(key);
    } else {
      // Set state with 30 minutes expiration
      await redisClient.setEx(key, 1800, JSON.stringify(state));
    }
    return true;
  } catch (error) {
    logger.error(`Error setting exchange rates state for ${whatsappNumber}:`, error);
    return false;
  }
}

// Detect if user wants exchange rates using OpenAI
export async function detectExchangeRatesIntent(messageText) {
  try {
    const response = await getOpenaiResponse(
      'gpt-3.5-turbo-0125',
      false,
      [
        { role: 'system', content: EXCHANGE_RATES_INTENT_PROMPT },
        { role: 'user', content: messageText }
      ]
    );
    
    const intent = response.choices[0].message.content.trim();
    logger.info(`Exchange rates intent detected: ${intent}`);
    return intent;
  } catch (error) {
    logger.error(`Error detecting exchange rates intent: ${error.message}`);
    // Fallback to simple keyword matching
    const lowerMessage = messageText.toLowerCase();
    if (lowerMessage.includes('rate') || lowerMessage.includes('exchange') || 
        lowerMessage.includes('currency') || lowerMessage.includes('live')) {
      return 'EXCHANGE_RATES';
    }
    return 'OTHER';
  }
}

// Extract currency code from user message using OpenAI
export async function extractCurrencyCode(messageText) {
  try {
    const response = await getOpenaiResponse(
      'gpt-3.5-turbo-0125',
      false,
      [
        { role: 'system', content: CURRENCY_EXTRACTION_PROMPT },
        { role: 'user', content: messageText }
      ]
    );
    
    const currency = response.choices[0].message.content.trim();
    logger.info(`Currency code extracted: ${currency}`);
    return currency;
  } catch (error) {
    logger.error(`Error extracting currency code: ${error.message}`);
    return 'NONE';
  }
}

// Start exchange rates flow
export async function startExchangeRatesFlow(redisClient, whatsappNumber, messageText) {
  try {
    // Extract currency code from the initial message
    const currencyCode = await extractCurrencyCode(messageText);
    
    if (currencyCode !== 'NONE' && isValidCurrencyCode(currencyCode)) {
      // User provided a valid currency code, get rates immediately
      const rates = await getLiveExchangeRates(currencyCode);
      const response = EXCHANGE_RATES_RESPONSES.success(currencyCode, rates);
      
      // Clear the flow state since we completed the request
      await setExchangeRatesState(redisClient, whatsappNumber, null);
      return response;
    } else {
      // No currency specified, ask user for it
      const state = {
        type: 'exchange_rates',
        currentStep: 'waiting_for_currency',
        startedAt: new Date().toISOString(),
        whatsappNumber: whatsappNumber
      };
      
      await setExchangeRatesState(redisClient, whatsappNumber, state);
      
      return EXCHANGE_RATES_RESPONSES.askForCurrency;
    }
  } catch (error) {
    logger.error(`Error starting exchange rates flow: ${error.message}`);
    return EXCHANGE_RATES_RESPONSES.generalError;
  }
}

// Process exchange rates step
export async function processExchangeRatesStep(redisClient, whatsappNumber, userInput) {
  try {
    const state = await isUserInExchangeRatesFlow(redisClient, whatsappNumber);
    
    if (!state || state.type !== 'exchange_rates') {
      return null; // Not in exchange rates flow
    }
    
    if (state.currentStep === 'waiting_for_currency') {
      // User provided currency input
      const currencyCode = userInput.trim().toUpperCase();
      
      if (!isValidCurrencyCode(currencyCode)) {
        return EXCHANGE_RATES_RESPONSES.invalidCurrency(currencyCode);
      }
      
      try {
        // Get live exchange rates
        const rates = await getLiveExchangeRates(currencyCode);
        
        const response = EXCHANGE_RATES_RESPONSES.success(currencyCode, rates);
        
        // Clear the flow state since we completed the request
        await setExchangeRatesState(redisClient, whatsappNumber, null);
        return response;
        
      } catch (error) {
        logger.error(`Error getting exchange rates for ${currencyCode}: ${error.message}`);
        return EXCHANGE_RATES_RESPONSES.errorGettingRates(currencyCode);
      }
    }
    
    return null; // Should not reach here
  } catch (error) {
    logger.error(`Error processing exchange rates step: ${error.message}`);
    return EXCHANGE_RATES_RESPONSES.processingError;
  }
}
