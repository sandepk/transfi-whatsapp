import { logger } from '../utils/logger_utils.js';

// Generic API call function
export async function makeApiCall(endpoint, data, successMessage, errorMessage) {
  try {
    const apiKey = process.env.TRANSFI_BASIC_API_KEY;
    
    if (!apiKey) {
      throw new Error('Missing required environment variable: TRANSFI_BASIC_API_KEY');
    }

    logger.info(`Making API call to: ${endpoint}`);
    logger.info(`Request data:`, data);

    // Structure data according to API requirements
    const apiData = {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      date: data.date,
      country: data.country,
      gender: data.gender,
      phone: data.phone,
      address: {
        street: data.address.street,
        city: data.address.city,
        postalCode: data.address.postalCode,
        state: data.address.state
      }
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Basic ${apiKey}`
      },
      body: JSON.stringify(apiData)
    });

    const responseData = await response.json();
    logger.info(`API Response Status: ${response.status}`);
    logger.info(`API Response Data:`, responseData);

    if (!response.ok) {
      logger.error(`API Error: ${response.status} - ${response.statusText}`);
      logger.error(`API Error Details:`, responseData);
      
      // Handle specific error cases
      if (response.status === 409) {
        return "❌ An account with this email already exists. Please use a different email address or contact support if you need help.";
      }
      
      return `${errorMessage}\n\nError: ${responseData.message || response.statusText}`;
    }

    logger.info('API call successful');
    return successMessage;

  } catch (error) {
    logger.error(`Error making API call to ${endpoint}:`, error);
    return `${errorMessage}\n\nPlease try again later or contact support if the problem persists.`;
  }
}

// Common address handling function (kept for backward compatibility)
export function handleAddressField(state, currentStep, userInput) {
  if (currentStep.field === 'address') {
    // Handle address fields
    state.collectedData.address = {
      street: userInput,
      city: '',
      postalCode: '',
      state: ''
    };
  } else if (['city', 'postalCode', 'state'].includes(currentStep.field)) {
    // Update address object
    if (!state.collectedData.address) {
      state.collectedData.address = {};
    }
    state.collectedData.address[currentStep.field] = userInput;
  } else {
    // Store regular fields
    state.collectedData[currentStep.field] = userInput;
  }
}
