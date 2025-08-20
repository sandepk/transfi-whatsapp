import { logger } from './logger_utils.js';

// User registration flow configuration
const USER_REGISTRATION_FLOW = {
  steps: [
    { field: 'email', question: 'Please enter your email address:', validation: 'email' },
    { field: 'firstName', question: 'Please enter your first name:', validation: 'text' },
    { field: 'lastName', question: 'Please enter your last name:', validation: 'text' },
    { field: 'date', question: 'Please enter your date of birth (DD-MM-YYYY):', validation: 'date' },
    { field: 'country', question: 'Please enter your country of citizenship:', validation: 'text' },
    { field: 'gender', question: 'Please enter your gender (male/female/other):', validation: 'gender' },
    { field: 'phone', question: 'Please enter your phone number:', validation: 'phone' },
    { field: 'address', question: 'Please enter your street address:', validation: 'text' },
    { field: 'city', question: 'Please enter your city:', validation: 'text' },
    { field: 'postalCode', question: 'Please enter your postal code:', validation: 'text' },
    { field: 'state', question: 'Please enter your state/province:', validation: 'text' }
  ],
  welcomeMessage: "Welcome! I'll help you create your account. Let me collect some information from you.",
  completionMessage: "Great! I have all the information. Creating your account now...",
  apiEndpoint: process.env.USER_CREATION_API || 'https://api.transfi.c/contacts'
};

// Business user registration flow configuration
const BUSINESS_USER_REGISTRATION_FLOW = {
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
  apiEndpoint: process.env.BUSINESS_USER_CREATION_API || 'https://api.transfi.c/business_contacts'
};

// Redis key prefix for user creation data
const REDIS_KEY_PREFIX = 'user_creation';

// Redis key prefix for business user creation data
const BUSINESS_REDIS_KEY_PREFIX = 'business_user_creation';

// Generate Redis key for a specific WhatsApp user
function getUserCreationKey(whatsappNumber) {
  return `${REDIS_KEY_PREFIX}:${whatsappNumber}`;
}

// Generate Redis key for a specific business WhatsApp user
function getBusinessUserCreationKey(whatsappNumber) {
  return `${BUSINESS_REDIS_KEY_PREFIX}:${whatsappNumber}`;
}

// Conversation state management functions
async function getUserCreationState(redisClient, whatsappNumber) {
  try {
    const key = getUserCreationKey(whatsappNumber);
    const state = await redisClient.get(key);
    return state ? JSON.parse(state) : null;
  } catch (error) {
    logger.error(`Error getting user creation state for ${whatsappNumber}:`, error);
    return null;
  }
}

async function setUserCreationState(redisClient, whatsappNumber, state) {
  try {
    const key = getUserCreationKey(whatsappNumber);
    if (state === null) {
      // Clear the state
      await redisClient.del(key);
    } else {
      // Set state with 1 hour expiration
      await redisClient.setEx(key, 3600, JSON.stringify(state));
    }
    return true;
  } catch (error) {
    logger.error(`Error setting user creation state for ${whatsappNumber}:`, error);
    return false;
  }
}

async function startUserRegistration(redisClient, whatsappNumber) {
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

async function processUserRegistrationStep(redisClient, whatsappNumber, userInput) {
  try {
    const state = await getUserCreationState(redisClient, whatsappNumber);
    if (!state || state.type !== 'user_registration') {
      return null;
    }
    
    const currentStep = USER_REGISTRATION_FLOW.steps[state.currentStep];
    if (!currentStep) {
      return null;
    }
    
    // Validate and store user input
    const isValid = validateUserInput(userInput, currentStep.validation);
    if (!isValid.valid) {
      return `Invalid input. ${isValid.message}\n\n${currentStep.question}`;
    }
    
    // Store the validated data
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
    
    // Move to next step
    state.currentStep++;
    
    // Check if registration is complete
    if (state.currentStep >= USER_REGISTRATION_FLOW.steps.length) {
      // Registration complete, create user
      const userCreationResult = await createUserAccount(state.collectedData);
      await setUserCreationState(redisClient, whatsappNumber, null); // Clear state
      return userCreationResult;
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

// Input validation functions
function validateUserInput(input, validationType) {
  switch (validationType) {
    case 'email':
      // Enhanced email validation with multiple checks
      const emailValidation = validateEmailFormat(input);
      return emailValidation;
    
    case 'date':
      const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
      if (!dateRegex.test(input)) {
        return {
          valid: false,
          message: 'Please enter date in DD-MM-YYYY format (e.g., 20-01-2002)'
        };
      }
      
      // Parse the date and validate it's a real date
      const [day, month, year] = input.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      
      // Check if it's a valid date
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return {
          valid: false,
          message: 'Please enter a valid date (e.g., 20-01-2002)'
        };
      }
      
      // Check if date is not in the future
      if (date > new Date()) {
        return {
          valid: false,
          message: 'Date of birth cannot be in the future'
        };
      }
      
      // Check if person is at least 13 years old
      const minAge = new Date();
      minAge.setFullYear(minAge.getFullYear() - 13);
      if (date > minAge) {
        return {
          valid: false,
          message: 'You must be at least 13 years old to register'
        };
      }
      
      return {
        valid: true,
        message: 'Date format is valid'
      };
    
    case 'business_date':
      const businessDateRegex = /^\d{2}-\d{2}-\d{4}$/;
      if (!businessDateRegex.test(input)) {
        return {
          valid: false,
          message: 'Please enter date in DD-MM-YYYY format (e.g., 25-09-2001)'
        };
      }
      
      // Parse the date and validate it's a real date
      const [bDay, bMonth, bYear] = input.split('-').map(Number);
      const businessDate = new Date(bYear, bMonth - 1, bDay);
      
      // Check if it's a valid date
      if (businessDate.getFullYear() !== bYear || businessDate.getMonth() !== bMonth - 1 || businessDate.getDate() !== bDay) {
        return {
          valid: false,
          message: 'Please enter a valid incorporation date (e.g., 25-09-2001)'
        };
      }
      
      // Check if date is not in the future
      if (businessDate > new Date()) {
        return {
          valid: false,
          message: 'Company incorporation date cannot be in the future'
        };
      }
      
      // Check if company is not older than 100 years (reasonable business age)
      const maxAge = new Date();
      maxAge.setFullYear(maxAge.getFullYear() - 100);
      if (businessDate < maxAge) {
        return {
          valid: false,
          message: 'Company incorporation date seems too old. Please verify the date.'
        };
      }
      
      return {
        valid: true,
        message: 'Incorporation date format is valid'
      };
    
    case 'gender':
      const validGenders = ['male', 'female', 'other'];
      return {
        valid: validGenders.includes(input.toLowerCase()),
        message: 'Please enter: male, female, or other'
      };
    
    case 'phone':
      const phoneRegex = /^\d{10,15}$/;
      const cleanPhone = input.replace(/\D/g, '');
      if (cleanPhone.length < 10) {
        return {
          valid: false,
          message: 'Phone number must be at least 10 digits long'
        };
      }
      if (cleanPhone.length > 15) {
        return {
          valid: false,
          message: 'Phone number cannot exceed 15 digits'
        };
      }
      return {
        valid: phoneRegex.test(cleanPhone),
        message: 'Please enter a valid phone number (10-15 digits)'
      };
    
    case 'text':
    default:
      return {
        valid: input.trim().length > 0,
        message: 'Please enter a valid value'
      };
  }
}

// Enhanced email validation function
function validateEmailFormat(email) {
  // Trim whitespace
  const trimmedEmail = email.trim();
  
  // Check if empty
  if (!trimmedEmail) {
    return {
      valid: false,
      message: 'Email address cannot be empty'
    };
  }
  
  // Check length (RFC 5321 limits local part to 64 chars, domain to 255 chars)
  if (trimmedEmail.length > 254) {
    return {
      valid: false,
      message: 'Email address is too long (maximum 254 characters)'
    };
  }
  
  // Check for basic email structure: local@domain
  const emailParts = trimmedEmail.split('@');
  if (emailParts.length !== 2) {
    return {
      valid: false,
      message: 'Email must contain exactly one @ symbol (e.g., john@example.com)'
    };
  }
  
  const [localPart, domain] = emailParts;
  
  // Validate local part (before @)
  if (!localPart || localPart.length === 0) {
    return {
      valid: false,
      message: 'Email must have a local part before @ (e.g., john@example.com)'
    };
  }
  
  if (localPart.length > 64) {
    return {
      valid: false,
      message: 'Local part of email is too long (maximum 64 characters)'
    };
  }
  
  // Check local part starts and ends with valid characters
  if (localPart.startsWith('.') || localPart.endsWith('.')) {
    return {
      valid: false,
      message: 'Local part cannot start or end with a dot'
    };
  }
  
  // Check for consecutive dots in local part
  if (localPart.includes('..')) {
    return {
      valid: false,
      message: 'Local part cannot contain consecutive dots'
    };
  }
  
  // Validate domain part (after @)
  if (!domain || domain.length === 0) {
    return {
      valid: false,
      message: 'Email must have a domain after @ (e.g., john@example.com)'
    };
  }
  
  if (domain.length > 253) {
    return {
      valid: false,
      message: 'Domain part is too long (maximum 253 characters)'
    };
  }
  
  // Check domain starts and ends with valid characters
  if (domain.startsWith('.') || domain.endsWith('.')) {
    return {
      valid: false,
      message: 'Domain cannot start or end with a dot'
    };
  }
  
  // Check for consecutive dots in domain
  if (domain.includes('..')) {
    return {
      valid: false,
      message: 'Domain cannot contain consecutive dots'
    };
  }
  
  // Check domain has at least one dot (for TLD)
  if (!domain.includes('.')) {
    return {
      valid: false,
      message: 'Domain must include a top-level domain (e.g., .com, .org)'
    };
  }
  
  // Check TLD length (should be 2-6 characters)
  const tld = domain.split('.').pop();
  if (tld.length < 2 || tld.length > 6) {
    return {
      valid: false,
      message: 'Top-level domain must be 2-6 characters long'
    };
  }
  
  // Check for valid characters in local part (letters, numbers, dots, underscores, hyphens)
  const localPartRegex = /^[a-zA-Z0-9._%+-]+$/;
  if (!localPartRegex.test(localPart)) {
    return {
      valid: false,
      message: 'Local part contains invalid characters. Use only letters, numbers, dots, underscores, hyphens, and plus signs'
    };
  }
  
  // Check for valid characters in domain (letters, numbers, dots, hyphens)
  const domainRegex = /^[a-zA-Z0-9.-]+$/;
  if (!domainRegex.test(domain)) {
    return {
      valid: false,
      message: 'Domain contains invalid characters. Use only letters, numbers, dots, and hyphens'
    };
  }
  
  // Final comprehensive regex check
  const comprehensiveEmailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!comprehensiveEmailRegex.test(trimmedEmail)) {
    return {
      valid: false,
      message: 'Email format is invalid. Please check your email address'
    };
  }
  
  // Check for common disposable email domains (optional - you can customize this list)
  const disposableDomains = [
    'tempmail.com', '10minutemail.com', 'guerrillamail.com', 'mailinator.com',
    'yopmail.com', 'throwaway.email', 'temp-mail.org', 'sharklasers.com'
  ];
  
  const domainLower = domain.toLowerCase();
  if (disposableDomains.some(disposable => domainLower.includes(disposable))) {
    return {
      valid: false,
      message: 'Please use a valid email address from a legitimate email provider'
    };
  }
  
  // All checks passed
  return {
    valid: true,
    message: 'Email format is valid'
  };
}

// User creation API call
async function createUserAccount(userData) {
  try {
    logger.info('Creating user account with data:', userData);
    
    const response = await fetch(USER_REGISTRATION_FLOW.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.USER_CREATION_API_KEY || ''}`
      },
      body: JSON.stringify(userData)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      logger.error('User creation API error:', errorData);
      return `Sorry, there was an error creating your account: ${errorData.message || 'Unknown error'}`;
    }
    
    const result = await response.json();
    logger.info('User account created successfully:', result);
    
    return `🎉 Congratulations! Your account has been created successfully!\n\nAccount ID: ${result.id || 'N/A'}\nEmail: ${userData.email}\n\nYou can now log in to your account.`;
    
  } catch (error) {
    logger.error('Error calling user creation API:', error);
    return `Sorry, there was an error creating your account. Please try again later or contact support.`;
  }
}

// Business user creation API call
async function createBusinessUserAccount(businessData) {
  try {
    logger.info('Creating business user account with data:', businessData);
    
    const response = await fetch(BUSINESS_USER_REGISTRATION_FLOW.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.BUSINESS_USER_CREATION_API_KEY || ''}`
      },
      body: JSON.stringify(businessData)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      logger.error('Business user creation API error:', errorData);
      return `Sorry, there was an error creating your business account: ${errorData.message || 'Unknown error'}`;
    }
    
    const result = await response.json();
    logger.info('Business user account created successfully:', result);
    
    return `🎉 Congratulations! Your business account has been created successfully!\n\nBusiness ID: ${result.id || 'N/A'}\nBusiness Name: ${businessData.businessName}\nEmail: ${businessData.em}\n\nYou can now log in to your business account.`;
    
  } catch (error) {
    logger.error('Error calling business user creation API:', error);
    return `Sorry, there was an error creating your business account. Please try again later or contact support.`;
  }
}

// Check if user is in registration flow
async function isUserInRegistration(redisClient, whatsappNumber) {
  try {
    const state = await getUserCreationState(redisClient, whatsappNumber);
    return state && state.type === 'user_registration';
  } catch (error) {
    logger.error(`Error checking user registration status for ${whatsappNumber}:`, error);
    return false;
  }
}

// Get current registration progress
async function getRegistrationProgress(redisClient, whatsappNumber) {
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

// Reset user registration (start over)
async function resetUserRegistration(redisClient, whatsappNumber) {
  try {
    await setUserCreationState(redisClient, whatsappNumber, null);
    return await startUserRegistration(redisClient, whatsappNumber);
  } catch (error) {
    logger.error(`Error resetting user registration for ${whatsappNumber}:`, error);
    return "Sorry, there was an error resetting your registration. Please try again.";
  }
}

// Business user registration functions
async function getBusinessUserCreationState(redisClient, whatsappNumber) {
  try {
    const key = getBusinessUserCreationKey(whatsappNumber);
    const state = await redisClient.get(key);
    return state ? JSON.parse(state) : null;
  } catch (error) {
    logger.error(`Error getting business user creation state for ${whatsappNumber}:`, error);
    return null;
  }
}

async function setBusinessUserCreationState(redisClient, whatsappNumber, state) {
  try {
    const key = getBusinessUserCreationKey(whatsappNumber);
    if (state === null) {
      // Clear the state
      await redisClient.del(key);
    } else {
      // Set state with 1 hour expiration
      await redisClient.setEx(key, 3600, JSON.stringify(state));
    }
    return true;
  } catch (error) {
    logger.error(`Error setting business user creation state for ${whatsappNumber}:`, error);
    return false;
  }
}

async function startBusinessUserRegistration(redisClient, whatsappNumber) {
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

async function processBusinessUserRegistrationStep(redisClient, whatsappNumber, userInput) {
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
    const isValid = validateUserInput(userInput, currentStep.validation);
    if (!isValid.valid) {
      return `Invalid input. ${isValid.message}\n\n${currentStep.question}`;
    }
    
    // Store the validated data
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
async function isUserInBusinessRegistration(redisClient, whatsappNumber) {
  try {
    const state = await getBusinessUserCreationState(redisClient, whatsappNumber);
    return state && state.type === 'business_user_registration';
  } catch (error) {
    logger.error(`Error checking business user registration status for ${whatsappNumber}:`, error);
    return false;
  }
}

// Get business registration progress
async function getBusinessRegistrationProgress(redisClient, whatsappNumber) {
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
async function resetBusinessUserRegistration(redisClient, whatsappNumber) {
  try {
    await setBusinessUserCreationState(redisClient, whatsappNumber, null);
    return await startBusinessUserRegistration(redisClient, whatsappNumber);
  } catch (error) {
    logger.error(`Error resetting business user registration for ${whatsappNumber}:`, error);
    return "Sorry, there was an error resetting your business registration. Please try again.";
  }
}

export {
  USER_REGISTRATION_FLOW,
  BUSINESS_USER_REGISTRATION_FLOW,
  getUserCreationKey,
  getUserCreationState,
  setUserCreationState,
  startUserRegistration,
  processUserRegistrationStep,
  isUserInRegistration,
  getRegistrationProgress,
  resetUserRegistration,
  createUserAccount,
  getBusinessUserCreationState,
  setBusinessUserCreationState,
  startBusinessUserRegistration,
  processBusinessUserRegistrationStep,
  isUserInBusinessRegistration,
  getBusinessRegistrationProgress,
  resetBusinessUserRegistration,
  createBusinessUserAccount
};
