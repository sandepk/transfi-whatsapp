import { logger } from '../utils/logger_utils.js';
import { validateUserInput } from '../common/validation.js';
import { 
  getBusinessUserCreationState, 
  setBusinessUserCreationState 
} from '../common/redis_utils.js';
import { makeApiCall, handleAddressField } from '../common/api_client.js';

// Business user registration flow configuration
export const BUSINESS_USER_REGISTRATION_FLOW = {
  steps: [
    { field: 'em', question: 'Please enter your business email address:', validation: 'email' },
    { field: 'businessName', question: 'Please enter your business/company name:', validation: 'text' },
    { field: 'country', question: 'Please enter your country of registration:', validation: 'text' },
    { field: 'regNo', question: 'Please enter your business registration number:', validation: 'text' },
    { field: 'date', question: 'Please enter your company incorporation date (DD-MM-YYYY):', validation: 'business_date' },
    { field: 'phone', question: 'Please enter your business phone number:', validation: 'phone' },
    { field: 'address', question: 'Please enter your business street address:', validation: 'text' },
    { field: 'city', question: 'Please enter your business city:', validation: 'text' },
    { field: 'postalCode', question: 'Please enter your business postal code:', validation: 'text' },
    { field: 'state', question: 'Please enter your business state/province:', validation: 'text' }
  ],
  welcomeMessage: "Welcome to Business Registration! I'll help you register your business. Let me collect the required information.",
  completionMessage: "Excellent! I have all your business information. Creating your business account now...",
  apiEndpoint: process.env.BUSINESS_USER_CREATION_API || `${process.env.TRANSFI_API_BASE_URL || 'https://sandbox-api.transfi.com'}/v2/business_contacts`
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
      return null;
    }
    
    const currentStep = BUSINESS_USER_REGISTRATION_FLOW.steps[state.currentStep];
    if (!currentStep) {
      return null;
    }
    
    // Validate and store user input
    const isValid = await validateUserInput(userInput, currentStep.validation);
    if (!isValid.valid) {
      return `Invalid input. ${isValid.message}\n\n${currentStep.question}`;
    }
    
    // Handle address fields and regular fields
    handleAddressField(state, currentStep, userInput);
    
    // Move to next step
    state.currentStep++;
    
    // Check if registration is complete
    if (state.currentStep >= BUSINESS_USER_REGISTRATION_FLOW.steps.length) {
      // Registration complete, create business user
      const userCreationResult = await createBusinessUserAccount(state.collectedData);
      await setBusinessUserCreationState(redisClient, whatsappNumber, null); // Clear state
      return userCreationResult;
    }
    
    // Save updated state
    await setBusinessUserCreationState(redisClient, whatsappNumber, state);
    
    // Return next question
    const nextStep = BUSINESS_USER_REGISTRATION_FLOW.steps[state.currentStep];
    return nextStep.question;
    
  } catch (error) {
    logger.error(`Error processing business user registration step:`, error);
    return "I'm sorry, there was an error processing your input. Please try again.";
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

// Create business user account via API
export async function createBusinessUserAccount(userData) {
  const endpoint = BUSINESS_USER_REGISTRATION_FLOW.apiEndpoint;
  const successMessage = `${BUSINESS_USER_REGISTRATION_FLOW.completionMessage}\n\n✅ Your business account has been created successfully! You can now start using our business money transfer services.`;
  const errorMessage = "❌ There was an error creating your business account.";
  
  return await makeApiCall(endpoint, userData, successMessage, errorMessage);
}
