import { logger } from '../utils/logger_utils.js';
import { validateUserInput } from '../common/validation.js';
import { 
  getUserCreationState, 
  setUserCreationState 
} from '../common/redis_utils.js';
import { makeApiCall, handleAddressField } from '../common/api_client.js';

// Individual user registration flow configuration
export const USER_REGISTRATION_FLOW = {
  steps: [
    { field: 'firstName', question: 'First Name:', validation: 'name' },
    { field: 'lastName', question: 'Last Name:', validation: 'name' },
    { field: 'email', question: 'Email Address:', validation: 'email' },
    { field: 'date', question: 'Date of Birth (DD-MM-YYYY):', validation: 'date' },
    { field: 'country', question: 'Country Code (e.g., IN):', validation: 'countryCode' },
    { field: 'gender', question: 'Gender (male/female/other):', validation: 'gender' },
    { field: 'phone', question: 'Phone Number:', validation: 'phone' },
    { field: 'street', question: 'Street Address:', validation: 'text' },
    { field: 'city', question: 'City:', validation: 'text' },
    { field: 'postalCode', question: 'Postal Code:', validation: 'postalCode' },
    { field: 'state', question: 'State/Province:', validation: 'text' }
  ],
  welcomeMessage: `Welcome! I'll help you create your individual account. 

Please provide all the required information in the following format (one field per line):

First Name:
Last Name:
Email Address:
Date of Birth (DD-MM-YYYY):
Country Code (e.g., IN):
Gender (male/female/other):
Phone Number:
Street Address:
City:
Postal Code:
State/Province:

Example:
John
Doe
john.doe@email.com
15-03-1990
IN
male
9876543210
123 Main Street
Mumbai
400001
Maharashtra

Please enter your information now:`,
  completionMessage: "Great! I have all the information. Creating your account now...",
  apiEndpoint: process.env.USER_CREATION_API || `${process.env.TRANSFI_API_BASE_URL || 'https://sandbox-api.transfi.com'}/v2/users/individual`
};

// Start individual user registration
export async function startUserRegistration(redisClient, whatsappNumber) {
  const state = {
    type: 'user_registration',
    currentStep: 0,
    collectedData: {},
    startedAt: new Date().toISOString(),
    whatsappNumber: whatsappNumber
  };
  
  await setUserCreationState(redisClient, whatsappNumber, state);
  return USER_REGISTRATION_FLOW.welcomeMessage;
}

// Process individual user registration step
export async function processUserRegistrationStep(redisClient, whatsappNumber, userInput) {
  try {
    const state = await getUserCreationState(redisClient, whatsappNumber);
    if (!state || state.type !== 'user_registration') {
      logger.info(`No valid registration state found for ${whatsappNumber}`);
      return null;
    }
    
    // Check if this is the first input (bulk data collection)
    if (state.currentStep === 0) {
      return await processBulkUserInput(redisClient, whatsappNumber, userInput, state);
    }
    
    // Handle confirmation step
    if (state.currentStep === 'confirmation') {
      return await handleConfirmationStep(redisClient, whatsappNumber, userInput);
    }
    
    return null;
    
  } catch (error) {
    logger.error(`Error processing user registration step:`, error);
    return "I'm sorry, there was an error processing your input. Please try again.";
  }
}

// Process bulk user input (all fields at once)
async function processBulkUserInput(redisClient, whatsappNumber, userInput, state) {
  try {
    logger.info(`Processing bulk input for ${whatsappNumber}`);
    
    // Split input by lines and trim whitespace
    const lines = userInput.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    if (lines.length < USER_REGISTRATION_FLOW.steps.length) {
      return `❌ **Incomplete Information**

You provided ${lines.length} fields, but I need ${USER_REGISTRATION_FLOW.steps.length} fields.

Please provide all required information in this format:

First Name:
Last Name:
Email Address:
Date of Birth (DD-MM-YYYY):
Country Code (e.g., IN):
Gender (male/female/other):
Phone Number:
Street Address:
City:
Postal Code:
State/Province:

Please try again with all fields:`;
    }
    
    // Validate and collect all fields
    const validationResults = [];
    const collectedData = {};
    const addressData = {};
    
    for (let i = 0; i < USER_REGISTRATION_FLOW.steps.length; i++) {
      const step = USER_REGISTRATION_FLOW.steps[i];
      const inputValue = lines[i];
      
      // Validate the input
      const isValid = await validateUserInput(inputValue, step.validation);
      
      if (!isValid.valid) {
        validationResults.push({
          field: step.field,
          question: step.question,
          value: inputValue,
          error: isValid.message
        });
      } else {
        // Store valid data
        if (['street', 'city', 'postalCode', 'state'].includes(step.field)) {
          addressData[step.field] = inputValue;
        } else {
          collectedData[step.field] = inputValue;
        }
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
    if (Object.keys(addressData).length > 0) {
      collectedData.address = addressData;
    }
    
    state.collectedData = collectedData;
    state.currentStep = 'confirmation';
    
    // Save state
    await setUserCreationState(redisClient, whatsappNumber, state);
    
    // Show confirmation
    return generateConfirmationMessage(collectedData);
    
  } catch (error) {
    logger.error(`Error processing bulk user input:`, error);
    return "I'm sorry, there was an error processing your information. Please try again.";
  }
}

// Check if user is in individual registration flow
export async function isUserInRegistration(redisClient, whatsappNumber) {
  try {
    const state = await getUserCreationState(redisClient, whatsappNumber);
    return state && state.type === 'user_registration';
  } catch (error) {
    logger.error(`Error checking user registration status for ${whatsappNumber}:`, error);
    return false;
  }
}

// Get individual registration progress
export async function getRegistrationProgress(redisClient, whatsappNumber) {
  try {
    const state = await getUserCreationState(redisClient, whatsappNumber);
    if (!state || state.type !== 'user_registration') {
      return null;
    }
    
    return {
      currentStep: state.currentStep,
      totalSteps: USER_REGISTRATION_FLOW.steps.length,
      progress: Math.round((state.currentStep / USER_REGISTRATION_FLOW.steps.length) * 100),
      collectedFields: Object.keys(state.collectedData),
      startedAt: state.startedAt
    };
  } catch (error) {
    logger.error(`Error getting registration progress for ${whatsappNumber}:`, error);
    return null;
  }
}

// Reset individual user registration (start over)
export async function resetUserRegistration(redisClient, whatsappNumber) {
  try {
    await setUserCreationState(redisClient, whatsappNumber, null);
    return await startUserRegistration(redisClient, whatsappNumber);
  } catch (error) {
    logger.error(`Error resetting user registration for ${whatsappNumber}:`, error);
    return "Sorry, there was an error resetting your registration. Please try again.";
  }
}

// Generate confirmation message with all collected data
function generateConfirmationMessage(collectedData) {
  let message = "📋 **Please confirm your details:**\n\n";
  
  // Personal information
  message += `👤 **Personal Information:**\n`;
  message += `• **First Name:** ${collectedData.firstName}\n`;
  message += `• **Last Name:** ${collectedData.lastName}\n`;
  message += `• **Email:** ${collectedData.email}\n`;
  message += `• **Date of Birth:** ${collectedData.date}\n`;
  message += `• **Country:** ${collectedData.country}\n`;
  message += `• **Gender:** ${collectedData.gender}\n`;
  message += `• **Phone:** ${collectedData.phone}\n\n`;
  
  // Address information
  message += `🏠 **Address Information:**\n`;
  message += `• **Street:** ${collectedData.address.street}\n`;
  message += `• **City:** ${collectedData.address.city}\n`;
  message += `• **Postal Code:** ${collectedData.address.postalCode}\n`;
  message += `• **State:** ${collectedData.address.state}\n\n`;
  
  message += "✅ **All information looks good!**\n\n";
  message += "Type 'confirm' to create your account, or 'edit' to start over.";
  
  return message;
}

// Handle confirmation step
export async function handleConfirmationStep(redisClient, whatsappNumber, userInput) {
  try {
    const state = await getUserCreationState(redisClient, whatsappNumber);
    if (!state || state.type !== 'user_registration' || state.currentStep !== 'confirmation') {
      return null;
    }
    
    const lowerInput = userInput.toLowerCase().trim();
    
    if (lowerInput === 'confirm' || lowerInput === 'yes' || lowerInput === 'y') {
      // User confirmed, create account
      const userDataWithWhatsApp = { ...state.collectedData, whatsappNumber };
      const userCreationResult = await createUserAccount(userDataWithWhatsApp, redisClient);
      await setUserCreationState(redisClient, whatsappNumber, null); // Clear state
      return userCreationResult;
    } else if (lowerInput === 'edit') {
      // User wants to edit, start over
      return await resetUserRegistration(redisClient, whatsappNumber);
    } else {
      // Invalid input
      return "Please type 'confirm', 'yes', or 'y' to proceed with account creation, or 'edit' to start over.";
    }
    
  } catch (error) {
    logger.error(`Error handling confirmation step:`, error);
    return "I'm sorry, there was an error processing your confirmation. Please try again.";
  }
}

// Create individual user account via API
export async function createUserAccount(userData, redisClient = null) {
  const endpoint = USER_REGISTRATION_FLOW.apiEndpoint;
  const successMessage = `${USER_REGISTRATION_FLOW.completionMessage}\n\n✅ Your individual account has been created successfully! You can now start using our money transfer services.`;
  const errorMessage = "❌ There was an error creating your account.";
  
  const result = await makeApiCall(endpoint, userData, successMessage, errorMessage, redisClient);
  
  // If account creation was successful, set user context for current session
  if (result.includes('successfully') && redisClient) {
    try {
      const userContext = {
        email: userData.email,
        userId: userData.userId || 'pending', // Will be updated when API response is processed
        userType: 'individual',
        fullName: `${userData.firstName} ${userData.lastName}`,
        createdAt: new Date().toISOString()
      };
      
      // Set user context for current WhatsApp session
      await redisClient.setEx(`user_context:${userData.whatsappNumber || 'unknown'}`, 3600, JSON.stringify(userContext));
      logger.info(`User context set for WhatsApp session after account creation`);
    } catch (error) {
      logger.error(`Error setting user context after account creation: ${error.message}`);
    }
  }
  
  return result;
}
