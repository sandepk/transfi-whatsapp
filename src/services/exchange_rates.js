import fetch from 'node-fetch';
import { logger } from '../utils/logger_utils.js';
import { getOpenaiResponse } from '../utils/openai_utils.js';
import { EXCHANGE_RATES_INTENT_PROMPT, CURRENCY_EXTRACTION_PROMPT, EXCHANGE_RATES_RESPONSES } from '../prompts/prompts.js';

// Fiat-to-Crypto Exchange Rate Flow Configuration
export const FIAT_TO_CRYPTO_FLOW = {
  steps: [
    { field: 'fiatTicker', question: 'Fiat Currency (e.g., EUR, USD, PHP):', validation: 'currency' },
    { field: 'amount', question: 'Amount to convert:', validation: 'amount' },
    { field: 'cryptoTicker', question: 'Cryptocurrency (e.g., USDC, BTC, ETH):', validation: 'crypto' },
    { field: 'paymentCode', question: 'Payment Method (e.g., sepa_pull, bank_transfer):', validation: 'payment' }
  ],
  welcomeMessage: `💱 **Fiat to Cryptocurrency Exchange Rate**

I'll help you get a quote for converting fiat currency to cryptocurrency!

Please provide all the required information in the following format (one field per line):

Fiat Currency (e.g., EUR, USD, PHP):
Amount to convert:
Cryptocurrency (e.g., USDC, BTC, ETH):
Payment Method (e.g., sepa_pull, bank_transfer):

Example:
EUR
100
USDC
sepa_pull

Please enter your conversion details now:`,
  completionMessage: "Excellent! I have all your information. Getting your fiat-to-crypto quote now...",
  apiEndpoint: `${process.env.TRANSFI_API_BASE_URL || 'https://sandbox-api.transfi.com'}/v2/exchange-rates/fiat-to-crypto`
};

// Start fiat-to-crypto exchange rate flow
export async function startFiatToCryptoFlow(redisClient, whatsappNumber) {
  const state = {
    type: 'fiat_to_crypto',
    currentStep: 0,
    collectedData: {},
    startedAt: new Date().toISOString(),
    whatsappNumber: whatsappNumber
  };
  
  logger.info(`Starting fiat-to-crypto flow for ${whatsappNumber} with state:`, state);
  const setResult = await setFiatToCryptoState(redisClient, whatsappNumber, state);
  logger.info(`Fiat-to-crypto state set result for ${whatsappNumber}: ${setResult}`);
  
  return FIAT_TO_CRYPTO_FLOW.welcomeMessage;
}

// Process fiat-to-crypto exchange rate step
export async function processFiatToCryptoStep(redisClient, whatsappNumber, userInput) {
  try {
    const state = await getFiatToCryptoState(redisClient, whatsappNumber);
    if (!state || state.type !== 'fiat_to_crypto') {
      logger.info(`No valid fiat-to-crypto state found for ${whatsappNumber}`);
      return null;
    }
    
    // Check if this is the first input (bulk data collection)
    if (state.currentStep === 0) {
      return await processBulkFiatToCryptoInput(redisClient, whatsappNumber, userInput, state);
    }
    
    // Handle confirmation step
    if (state.currentStep === 'confirmation') {
      return await handleFiatToCryptoConfirmationStep(redisClient, whatsappNumber, userInput);
    }
    
    return null;
    
  } catch (error) {
    logger.error(`Error processing fiat-to-crypto step:`, error);
    return "I'm sorry, there was an error processing your input. Please try again.";
  }
}

// Process bulk fiat-to-crypto input (all fields at once)
async function processBulkFiatToCryptoInput(redisClient, whatsappNumber, userInput, state) {
  try {
    logger.info(`Processing bulk fiat-to-crypto input for ${whatsappNumber}`);
    
    // Check if user wants to exit
    const lowerInput = userInput.toLowerCase();
    if (lowerInput.includes('exit') || lowerInput.includes('cancel') || lowerInput.includes('stop')) {
      await setFiatToCryptoState(redisClient, whatsappNumber, null);
      return `✅ **Fiat-to-Crypto Flow Cancelled**\n\nYou can try again anytime by saying "fiat to crypto" or "convert to crypto".`;
    }
    
    // Split input by lines and trim whitespace
    const lines = userInput.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    if (lines.length < FIAT_TO_CRYPTO_FLOW.steps.length) {
      return `❌ **Incomplete Information**

You provided ${lines.length} fields, but I need ${FIAT_TO_CRYPTO_FLOW.steps.length} fields.

Please provide all required information in this format:

Fiat Currency (e.g., EUR, USD, PHP):
Amount to convert:
Cryptocurrency (e.g., USDC, BTC, ETH):
Payment Method (e.g., sepa_pull, bank_transfer):

Please try again with all fields:`;
    }
    
    // Validate and collect all fields
    const validationResults = [];
    const collectedData = {};
    
    for (let i = 0; i < FIAT_TO_CRYPTO_FLOW.steps.length; i++) {
      const step = FIAT_TO_CRYPTO_FLOW.steps[i];
      const inputValue = lines[i];
      
      // Validate the input
      const isValid = await validateFiatToCryptoInput(inputValue, step.validation);
      
      if (!isValid.valid) {
        validationResults.push({
          field: step.field,
          question: step.question,
          value: inputValue,
          error: isValid.message
        });
      } else {
        collectedData[step.field] = inputValue;
      }
    }
    
    // If there are validation errors, show them
    if (validationResults.length > 0) {
      let errorMessage = "❌ **Validation Errors Found**\n\n";
      errorMessage += "Please correct the following fields:\n\n";
      
      validationResults.forEach((result, index) => {
        errorMessage += `${index + 1}. **${result.question}** "${result.value}"\n`;
        errorMessage += `   Error: ${result.error}\n\n`;
      });
      
      errorMessage += "Please provide all information again with corrections:";
      return errorMessage;
    }
    
    // All validations passed, store the data
    state.collectedData = collectedData;
    state.currentStep = 'confirmation';
    
    // Save state
    await setFiatToCryptoState(redisClient, whatsappNumber, state);
    
    // Show confirmation
    return generateFiatToCryptoConfirmationMessage(collectedData);
    
  } catch (error) {
    logger.error(`Error processing bulk fiat-to-crypto input:`, error);
    return "I'm sorry, there was an error processing your conversion details. Please try again.";
  }
}

// Validate fiat-to-crypto input
async function validateFiatToCryptoInput(input, validationType) {
  const trimmedInput = input.trim();
  
  switch (validationType) {
    case 'currency':
      const currencyRegex = /^[A-Z]{3}$/;
      return {
        valid: currencyRegex.test(trimmedInput.toUpperCase()),
        message: currencyRegex.test(trimmedInput.toUpperCase()) ? 'Currency code is valid' : 'Please enter a valid 3-letter currency code (e.g., EUR, USD, PHP)'
      };
    
    case 'amount':
      const amountValue = parseFloat(trimmedInput);
      return {
        valid: !isNaN(amountValue) && amountValue > 0,
        message: isNaN(amountValue) ? 'Please enter a valid number' : amountValue <= 0 ? 'Amount must be greater than 0' : 'Amount is valid'
      };
    
    case 'crypto':
      const cryptoRegex = /^[A-Z]{2,10}$/;
      return {
        valid: cryptoRegex.test(trimmedInput.toUpperCase()),
        message: cryptoRegex.test(trimmedInput.toUpperCase()) ? 'Cryptocurrency code is valid' : 'Please enter a valid cryptocurrency code (e.g., USDC, BTC, ETH)'
      };
    
    case 'payment':
      const validPaymentMethods = ['sepa_pull', 'bank_transfer', 'card', 'wallet'];
      const isValidPayment = validPaymentMethods.includes(trimmedInput.toLowerCase());
      return {
        valid: isValidPayment,
        message: isValidPayment ? 'Payment method is valid' : 'Please enter a valid payment method (sepa_pull, bank_transfer, card, wallet)'
      };
    
    default:
      return {
        valid: trimmedInput.length > 0,
        message: trimmedInput.length === 0 ? 'Please enter a value' : 'Input is valid'
      };
  }
}

// Generate confirmation message with all collected fiat-to-crypto data
function generateFiatToCryptoConfirmationMessage(collectedData) {
  let message = "📋 **Please confirm your conversion details:**\n\n";
  
  message += `💱 **Conversion Details:**\n`;
  message += `• **Fiat Currency:** ${collectedData.fiatTicker}\n`;
  message += `• **Amount:** ${collectedData.amount}\n`;
  message += `• **Cryptocurrency:** ${collectedData.cryptoTicker}\n`;
  message += `• **Payment Method:** ${collectedData.paymentCode}\n\n`;
  
  message += "✅ **All details look good!**\n\n";
  message += "Type 'confirm' to get your quote, or 'edit' to start over.";
  
  return message;
}

// Handle fiat-to-crypto confirmation step
export async function handleFiatToCryptoConfirmationStep(redisClient, whatsappNumber, userInput) {
  try {
    const state = await getFiatToCryptoState(redisClient, whatsappNumber);
    if (!state || state.type !== 'fiat_to_crypto' || state.currentStep !== 'confirmation') {
      return null;
    }
    
    const lowerInput = userInput.toLowerCase().trim();
    
    if (lowerInput === 'confirm' || lowerInput === 'yes' || lowerInput === 'y') {
      // User confirmed, get quote
      const quoteResult = await getFiatToCryptoQuote(state.collectedData, redisClient);
      await setFiatToCryptoState(redisClient, whatsappNumber, null); // Clear state
      return quoteResult;
    } else if (lowerInput === 'edit') {
      // User wants to edit, start over
      return await resetFiatToCryptoFlow(redisClient, whatsappNumber);
    } else {
      // Invalid input
      return "Please type 'confirm', 'yes', or 'y' to get your quote, or 'edit' to start over.";
    }
    
  } catch (error) {
    logger.error(`Error handling fiat-to-crypto confirmation step:`, error);
    return "I'm sorry, there was an error processing your confirmation. Please try again.";
  }
}

// Get fiat-to-crypto quote via API
export async function getFiatToCryptoQuote(conversionData, redisClient = null) {
  try {
    const apiKey = process.env.TRANSFI_BASIC_API_KEY;
    
    if (!apiKey) {
      throw new Error('Missing required environment variable: TRANSFI_BASIC_API_KEY');
    }

    const params = new URLSearchParams({
      fiatTicker: conversionData.fiatTicker.toUpperCase(),
      amount: conversionData.amount,
      cryptoTicker: conversionData.cryptoTicker.toUpperCase(),
      paymentCode: conversionData.paymentCode.toLowerCase()
    });

    const url = `${FIAT_TO_CRYPTO_FLOW.apiEndpoint}?${params}`;
    
    logger.info(`Fetching fiat-to-crypto quote: ${url}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'authorization': `Basic ${apiKey}`,
        'content-type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorData = await response.text();
      let errorMessage = `Fiat-to-crypto API error: ${response.status} ${response.statusText}`;
      
      try {
        const parsedError = JSON.parse(errorData);
        if (parsedError.message) {
          errorMessage = parsedError.message;
        } else if (parsedError.error) {
          errorMessage = parsedError.error;
        }
      } catch (parseError) {
        if (errorData) {
          errorMessage = errorData;
        }
      }
      
      throw new Error(errorMessage);
    }

    const result = await response.json();
    
    if (!result.message || !result.message.success) {
      throw new Error('Invalid response from fiat-to-crypto API');
    }

    const data = result.message.data;
    
    // Format the response
    const quoteMessage = `💱 **Fiat to Crypto Quote**

📊 **Conversion Details:**
• **From:** ${conversionData.amount} ${conversionData.fiatTicker.toUpperCase()}
• **To:** ${data.receiveAmount.toFixed(6)} ${conversionData.cryptoTicker.toUpperCase()}
• **Crypto Price:** ${data.cryptoPrice.toFixed(6)} ${conversionData.fiatTicker.toUpperCase()}

💰 **Fees Breakdown:**
• **Processing Fee:** ${data.processingFee} ${conversionData.fiatTicker.toUpperCase()}
• **Network Fee:** ${data.networkFee} ${conversionData.fiatTicker.toUpperCase()}
• **Total Fees:** ${data.totalFee} ${conversionData.fiatTicker.toUpperCase()}

📈 **Summary:**
• **You Send:** ${data.sentAmount} ${conversionData.fiatTicker.toUpperCase()}
• **You Receive:** ${data.receiveAmount.toFixed(6)} ${conversionData.cryptoTicker.toUpperCase()}
• **Net Amount:** ${data.receiveFiatAmount.toFixed(2)} ${conversionData.fiatTicker.toUpperCase()}

⚡ **Limits:**
• **Minimum:** ${data.minLimit} ${conversionData.fiatTicker.toUpperCase()}
• **Maximum:** ${data.maxLimit.toFixed(2)} ${conversionData.fiatTicker.toUpperCase()}

⏰ **Quote valid for:** 5 minutes`;

    logger.info(`Successfully fetched fiat-to-crypto quote for ${conversionData.fiatTicker} to ${conversionData.cryptoTicker}`);
    
    return quoteMessage;

  } catch (error) {
    logger.error(`Error getting fiat-to-crypto quote: ${error.message}`);
    return `❌ **Quote Error**\n\nSorry, I couldn't get your quote at the moment.\n\nError: ${error.message}\n\nPlease try again later or contact support if the issue persists.`;
  }
}

// Check if user is in fiat-to-crypto flow
export async function isUserInFiatToCryptoFlow(redisClient, whatsappNumber) {
  try {
    const state = await getFiatToCryptoState(redisClient, whatsappNumber);
    return state && state.type === 'fiat_to_crypto';
  } catch (error) {
    logger.error(`Error checking fiat-to-crypto flow status for ${whatsappNumber}:`, error);
    return false;
  }
}

// Get fiat-to-crypto flow progress
export async function getFiatToCryptoProgress(redisClient, whatsappNumber) {
  try {
    const state = await getFiatToCryptoState(redisClient, whatsappNumber);
    if (!state || state.type !== 'fiat_to_crypto') {
      return null;
    }
    
    return {
      currentStep: state.currentStep,
      totalSteps: FIAT_TO_CRYPTO_FLOW.steps.length,
      progress: Math.round((state.currentStep / FIAT_TO_CRYPTO_FLOW.steps.length) * 100),
      collectedFields: Object.keys(state.collectedData),
      startedAt: state.startedAt
    };
  } catch (error) {
    logger.error(`Error getting fiat-to-crypto progress for ${whatsappNumber}:`, error);
    return null;
  }
}

// Reset fiat-to-crypto flow (start over)
export async function resetFiatToCryptoFlow(redisClient, whatsappNumber) {
  try {
    await setFiatToCryptoState(redisClient, whatsappNumber, null);
    return await startFiatToCryptoFlow(redisClient, whatsappNumber);
  } catch (error) {
    logger.error(`Error resetting fiat-to-crypto flow for ${whatsappNumber}:`, error);
    return "Sorry, there was an error resetting your fiat-to-crypto conversion. Please try again.";
  }
}

// Fiat-to-Crypto State Management Functions

// Redis key prefix for fiat-to-crypto flow
const FIAT_TO_CRYPTO_KEY_PREFIX = 'fiat_to_crypto_flow';

// Generate Redis key for fiat-to-crypto flow
function getFiatToCryptoKey(whatsappNumber) {
  return `${FIAT_TO_CRYPTO_KEY_PREFIX}:${whatsappNumber}`;
}

// Get fiat-to-crypto flow state
export async function getFiatToCryptoState(redisClient, whatsappNumber) {
  try {
    const key = getFiatToCryptoKey(whatsappNumber);
    logger.info(`Getting fiat-to-crypto state for ${whatsappNumber} with key: ${key}`);
    const state = await redisClient.get(key);
    logger.info(`Fiat-to-crypto state for ${whatsappNumber}: ${state ? 'exists' : 'null'}`);
    if (state) {
      const parsedState = JSON.parse(state);
      logger.info(`Parsed fiat-to-crypto state for ${whatsappNumber}:`, parsedState);
      return parsedState;
    }
    return null;
  } catch (error) {
    logger.error(`Error getting fiat-to-crypto state for ${whatsappNumber}:`, error);
    return null;
  }
}

// Set fiat-to-crypto flow state
export async function setFiatToCryptoState(redisClient, whatsappNumber, state) {
  try {
    const key = getFiatToCryptoKey(whatsappNumber);
    if (state === null) {
      // Clear the state
      await redisClient.del(key);
    } else {
      // Set state with 30 minutes expiration
      await redisClient.setEx(key, 1800, JSON.stringify(state));
    }
    return true;
  } catch (error) {
    logger.error(`Error setting fiat-to-crypto state for ${whatsappNumber}:`, error);
    return false;
  }
}

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
      'gpt-4o-mini',
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
      'gpt-4o-mini',
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






