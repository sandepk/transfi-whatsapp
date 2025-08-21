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
    { field: 'firstName', question: 'Please enter your first name:', validation: 'name' },
    { field: 'lastName', question: 'Please enter your last name:', validation: 'name' },
    { field: 'email', question: 'Please enter your email address:', validation: 'email' },
    { field: 'date', question: 'Please enter your date of birth (DD-MM-YYYY):', validation: 'date' },
    { field: 'country', question: 'Please enter your country code (e.g., IN for India):', validation: 'countryCode' },
    { field: 'gender', question: 'Please enter your gender (male/female/other):', validation: 'gender' },
    { field: 'phone', question: 'Please enter your phone number:', validation: 'phone' },
    { field: 'street', question: 'Please enter your street address:', validation: 'text' },
    { field: 'city', question: 'Please enter your city:', validation: 'text' },
    { field: 'postalCode', question: 'Please enter your postal code:', validation: 'postalCode' },
    { field: 'state', question: 'Please enter your state/province:', validation: 'text' }
  ],
  welcomeMessage: "Welcome! I'll help you create your individual account. Let me collect some information from you.",
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
    
    const currentStep = USER_REGISTRATION_FLOW.steps[state.currentStep];
    if (!currentStep) {
      logger.info(`No current step found for ${whatsappNumber} at step ${state.currentStep}`);
      return null;
    }
    
    logger.info(`Processing step ${state.currentStep}: ${currentStep.field} for ${whatsappNumber} with input: "${userInput}"`);
    
    // Validate and store user input
    const isValid = await validateUserInput(userInput, currentStep.validation);
    logger.info(`Validation result for ${currentStep.field}: ${isValid.valid} - ${isValid.message}`);
    
    if (!isValid.valid) {
      return `Invalid input. ${isValid.message}\n\n${currentStep.question}`;
    }
    
    // Store user input
    if (['street', 'city', 'postalCode', 'state'].includes(currentStep.field)) {
      // Handle address fields
      if (!state.collectedData.address) {
        state.collectedData.address = {};
      }
      state.collectedData.address[currentStep.field] = userInput;
    } else {
      // Store regular fields
      state.collectedData[currentStep.field] = userInput;
    }
    
    // Move to next step
    state.currentStep++;
    
    // Check if registration is complete
    if (state.currentStep >= USER_REGISTRATION_FLOW.steps.length) {
      // Show confirmation with all collected data
      const confirmationMessage = generateConfirmationMessage(state.collectedData);
      state.currentStep = 'confirmation';
      await setUserCreationState(redisClient, whatsappNumber, state);
      return confirmationMessage;
    }
    
    // Save updated state
    await setUserCreationState(redisClient, whatsappNumber, state);
    
    // Return next question
    const nextStep = USER_REGISTRATION_FLOW.steps[state.currentStep];
    return nextStep.question;
    
  } catch (error) {
    logger.error(`Error processing user registration step:`, error);
    return "I'm sorry, there was an error processing your input. Please try again.";
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
  message += `firstName: "${collectedData.firstName}"\n`;
  message += `lastName: "${collectedData.lastName}"\n`;
  message += `email: "${collectedData.email}"\n`;
  message += `date: "${collectedData.date}"\n`;
  message += `country: "${collectedData.country}"\n`;
  message += `gender: "${collectedData.gender}"\n`;
  message += `phone: "${collectedData.phone}"\n\n`;
  
  // Address information
  message += `🏠 **Address Information:**\n`;
  message += `street: "${collectedData.address.street}"\n`;
  message += `city: "${collectedData.address.city}"\n`;
  message += `postalCode: "${collectedData.address.postalCode}"\n`;
  message += `state: "${collectedData.address.state}"\n\n`;
  
  message += "Please type 'confirm' to proceed with account creation, or 'edit' to start over.";
  
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
    
    if (lowerInput === 'confirm') {
      // User confirmed, create account
      const userCreationResult = await createUserAccount(state.collectedData);
      await setUserCreationState(redisClient, whatsappNumber, null); // Clear state
      return userCreationResult;
    } else if (lowerInput === 'edit') {
      // User wants to edit, start over
      return await resetUserRegistration(redisClient, whatsappNumber);
    } else {
      // Invalid input
      return "Please type 'confirm' to proceed with account creation, or 'edit' to start over.";
    }
    
  } catch (error) {
    logger.error(`Error handling confirmation step:`, error);
    return "I'm sorry, there was an error processing your confirmation. Please try again.";
  }
}

// Create individual user account via API
export async function createUserAccount(userData) {
  const endpoint = USER_REGISTRATION_FLOW.apiEndpoint;
  const successMessage = `${USER_REGISTRATION_FLOW.completionMessage}\n\n✅ Your individual account has been created successfully! You can now start using our money transfer services.`;
  const errorMessage = "❌ There was an error creating your account.";
  
  return await makeApiCall(endpoint, userData, successMessage, errorMessage);
}
