import { logger } from '../utils/logger_utils.js';
import { validateUserInput } from '../common/validation.js';
import { 
  getBusinessUserCreationState, 
  setBusinessUserCreationState 
} from '../common/redis_utils.js';
import { makeBusinessApiCall, handleAddressField } from '../common/api_client.js';

// Business user registration flow configuration
export const BUSINESS_USER_REGISTRATION_FLOW = {
  steps: [
    { field: 'em', question: 'Business Email Address:', validation: 'email' },
    { field: 'businessName', question: 'Business/Company Name:', validation: 'text' },
    { field: 'country', question: 'Country of Registration:', validation: 'text' },
    { field: 'regNo', question: 'Business Registration Number:', validation: 'text' },
    { field: 'date', question: 'Company Incorporation Date (DD-MM-YYYY):', validation: 'business_date' },
    { field: 'phone', question: 'Business Phone Number:', validation: 'phone' },
    { field: 'address', question: 'Business Street Address:', validation: 'text' },
    { field: 'city', question: 'Business City:', validation: 'text' },
    { field: 'postalCode', question: 'Business Postal Code:', validation: 'text' },
    { field: 'state', question: 'Business State/Province:', validation: 'text' }
  ],
  welcomeMessage: `Welcome to Business Registration! I'll help you register your business. 

Please provide all the required information in the following format (one field per line):

Business Email Address:
Business/Company Name:
Country of Registration:
Business Registration Number:
Company Incorporation Date (DD-MM-YYYY):
Business Phone Number:
Business Street Address:
Business City:
Business Postal Code:
Business State/Province:

Example:
business@company.com
ABC Corporation Ltd
India
REG123456789
15-03-2020
9876543210
123 Business Street
Mumbai
400001
Maharashtra

Please enter your business information now:`,
  completionMessage: "Excellent! I have all your business information. Creating your business account now...",
  apiEndpoint: process.env.BUSINESS_USER_CREATION_API || `${process.env.TRANSFI_API_BASE_URL || 'https://sandbox-api.transfi.com'}/v2/users/business`
};

// Start business user registration
export async function startBusinessUserRegistration(redisClient, whatsappNumber) {
  const state = {
    type: 'business_user_registration',
    currentStep: 0,
    collectedData: {},
    startedAt: new Date().toISOString(),
    whatsappNumber: whatsappNumber
  };
  
  await setBusinessUserCreationState(redisClient, whatsappNumber, state);
  return BUSINESS_USER_REGISTRATION_FLOW.welcomeMessage;
}

// Process business user registration step
export async function processBusinessUserRegistrationStep(redisClient, whatsappNumber, userInput) {
  try {
    const state = await getBusinessUserCreationState(redisClient, whatsappNumber);
    if (!state || state.type !== 'business_user_registration') {
      logger.info(`No valid business registration state found for ${whatsappNumber}`);
      return null;
    }
    
    // Check if this is the first input (bulk data collection)
    if (state.currentStep === 0) {
      return await processBulkBusinessInput(redisClient, whatsappNumber, userInput, state);
    }
    
    // Handle confirmation step
    if (state.currentStep === 'confirmation') {
      return await handleBusinessConfirmationStep(redisClient, whatsappNumber, userInput);
    }
    
    return null;
    
  } catch (error) {
    logger.error(`Error processing business user registration step:`, error);
    return "I'm sorry, there was an error processing your input. Please try again.";
  }
}

// Process bulk business input (all fields at once)
async function processBulkBusinessInput(redisClient, whatsappNumber, userInput, state) {
  try {
    logger.info(`Processing bulk business input for ${whatsappNumber}`);
    
    // Split input by lines and trim whitespace
    const lines = userInput.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    if (lines.length < BUSINESS_USER_REGISTRATION_FLOW.steps.length) {
      return `❌ **Incomplete Information**

You provided ${lines.length} fields, but I need ${BUSINESS_USER_REGISTRATION_FLOW.steps.length} fields.

Please provide all required information in this format:

Business Email Address:
Business/Company Name:
Country of Registration:
Business Registration Number:
Company Incorporation Date (DD-MM-YYYY):
Business Phone Number:
Business Street Address:
Business City:
Business Postal Code:
Business State/Province:

Please try again with all fields:`;
    }
    
    // Validate and collect all fields
    const validationResults = [];
    const collectedData = {};
    const addressData = {};
    
    for (let i = 0; i < BUSINESS_USER_REGISTRATION_FLOW.steps.length; i++) {
      const step = BUSINESS_USER_REGISTRATION_FLOW.steps[i];
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
        if (['address', 'city', 'postalCode', 'state'].includes(step.field)) {
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
    await setBusinessUserCreationState(redisClient, whatsappNumber, state);
    
    // Show confirmation
    return generateBusinessConfirmationMessage(collectedData);
    
  } catch (error) {
    logger.error(`Error processing bulk business input:`, error);
    return "I'm sorry, there was an error processing your business information. Please try again.";
  }
}

// Check if user is in business registration flow
export async function isUserInBusinessRegistration(redisClient, whatsappNumber) {
  try {
    const state = await getBusinessUserCreationState(redisClient, whatsappNumber);
    return state && state.type === 'business_user_registration';
  } catch (error) {
    logger.error(`Error checking business user registration status for ${whatsappNumber}:`, error);
    return false;
  }
}

// Get business registration progress
export async function getBusinessRegistrationProgress(redisClient, whatsappNumber) {
  try {
    const state = await getBusinessUserCreationState(redisClient, whatsappNumber);
    if (!state || state.type !== 'business_user_registration') {
      return null;
    }
    
    return {
      currentStep: state.currentStep,
      totalSteps: BUSINESS_USER_REGISTRATION_FLOW.steps.length,
      progress: Math.round((state.currentStep / BUSINESS_USER_REGISTRATION_FLOW.steps.length) * 100),
      collectedFields: Object.keys(state.collectedData),
      startedAt: state.startedAt
    };
  } catch (error) {
    logger.error(`Error getting business registration progress for ${whatsappNumber}:`, error);
    return null;
  }
}

// Reset business user registration (start over)
export async function resetBusinessUserRegistration(redisClient, whatsappNumber) {
  try {
    await setBusinessUserCreationState(redisClient, whatsappNumber, null);
    return await startBusinessUserRegistration(redisClient, whatsappNumber);
  } catch (error) {
    logger.error(`Error resetting business user registration for ${whatsappNumber}:`, error);
    return "Sorry, there was an error resetting your business registration. Please try again.";
  }
}

// Generate confirmation message with all collected business data
function generateBusinessConfirmationMessage(collectedData) {
  let message = "📋 **Please confirm your business details:**\n\n";
  
  // Business information
  message += `🏢 **Business Information:**\n`;
  message += `• **Business Email:** ${collectedData.em}\n`;
  message += `• **Business Name:** ${collectedData.businessName}\n`;
  message += `• **Country:** ${collectedData.country}\n`;
  message += `• **Registration Number:** ${collectedData.regNo}\n`;
  message += `• **Incorporation Date:** ${collectedData.date}\n`;
  message += `• **Business Phone:** ${collectedData.phone}\n\n`;
  
  // Address information
  message += `🏠 **Business Address:**\n`;
  message += `• **Street Address:** ${collectedData.address.address}\n`;
  message += `• **City:** ${collectedData.address.city}\n`;
  message += `• **Postal Code:** ${collectedData.address.postalCode}\n`;
  message += `• **State:** ${collectedData.address.state}\n\n`;
  
  message += "✅ **All business information looks good!**\n\n";
  message += "Type 'confirm' to create your business account, or 'edit' to start over.";
  
  return message;
}

// Handle business confirmation step
export async function handleBusinessConfirmationStep(redisClient, whatsappNumber, userInput) {
  try {
    const state = await getBusinessUserCreationState(redisClient, whatsappNumber);
    if (!state || state.type !== 'business_user_registration' || state.currentStep !== 'confirmation') {
      return null;
    }
    
    const lowerInput = userInput.toLowerCase().trim();
    
    if (lowerInput === 'confirm' || lowerInput === 'yes' || lowerInput === 'y') {
      // User confirmed, create business account
      const userDataWithWhatsApp = { ...state.collectedData, whatsappNumber };
      const userCreationResult = await createBusinessUserAccount(userDataWithWhatsApp, redisClient);
      await setBusinessUserCreationState(redisClient, whatsappNumber, null); // Clear state
      return userCreationResult;
    } else if (lowerInput === 'edit') {
      // User wants to edit, start over
      return await resetBusinessUserRegistration(redisClient, whatsappNumber);
    } else {
      // Invalid input
      return "Please type 'confirm', 'yes', or 'y' to proceed with business account creation, or 'edit' to start over.";
    }
    
  } catch (error) {
    logger.error(`Error handling business confirmation step:`, error);
    return "I'm sorry, there was an error processing your confirmation. Please try again.";
  }
}

// Create business user account via API
export async function createBusinessUserAccount(userData, redisClient = null) {
  const endpoint = BUSINESS_USER_REGISTRATION_FLOW.apiEndpoint;
  const successMessage = `${BUSINESS_USER_REGISTRATION_FLOW.completionMessage}\n\n✅ Your business account has been created successfully! You can now start using our business money transfer services.`;
  const errorMessage = "❌ There was an error creating your business account.";
  
  const result = await makeBusinessApiCall(endpoint, userData, successMessage, errorMessage, redisClient);
  
  // If account creation was successful, set user context for current session
  if (result.includes('successfully') && redisClient) {
    try {
      const userContext = {
        email: userData.em,
        userId: userData.userId || 'pending', // Will be updated when API response is processed
        userType: 'business',
        fullName: userData.businessName,
        createdAt: new Date().toISOString()
      };
      
      // Set user context for current WhatsApp session
      await redisClient.setEx(`user_context:${userData.whatsappNumber || 'unknown'}`, 3600, JSON.stringify(userContext));
      logger.info(`User context set for WhatsApp session after business account creation`);
    } catch (error) {
      logger.error(`Error setting user context after business account creation: ${error.message}`);
    }
  }
  
  return result;
}
