import { logger } from '../utils/logger_utils.js';
import { getOpenaiResponse } from '../utils/openai_utils.js';
import { VALIDATION_PROMPTS } from '../prompts/prompts.js';

// Define which validation types should use OpenAI vs fast local validation
const OPENAI_VALIDATION_TYPES = [
  'email',           // Complex: checks disposable domains, format, etc.
  'business_name',   // Complex: checks for valid business names
  'address',         // Complex: validates address format and completeness
  'complex_text'     // Complex: any custom complex validation
];

const FAST_VALIDATION_TYPES = [
  'text',            // Basic: just check if not empty
  'number',          // Basic: numeric validation
  'postal_code',     // Basic: format validation
  'state',           // Basic: format validation
  'dob',             // Basic: date format and age validation
  'date',            // Basic: date format validation
  'business_date',   // Basic: business date validation
  'gender',          // Basic: predefined options
  'phone',           // Basic: phone number format
  'country',         // Basic: country code validation
  'city'             // Basic: city name validation
];

// Optimized input validation function
export async function validateUserInput(input, validationType) {
  try {
    // Use fast local validation for basic types
    if (FAST_VALIDATION_TYPES.includes(validationType)) {
      logger.info(`Using fast validation for ${validationType}`);
      return fastValidation(input, validationType);
    }
    
    // Use OpenAI for complex validations
    if (OPENAI_VALIDATION_TYPES.includes(validationType)) {
      logger.info(`Using OpenAI validation for ${validationType}`);
      return await openaiValidation(input, validationType);
    }
    
    // Default to fast validation for unknown types
    logger.warn(`Unknown validation type: ${validationType}, using fast validation`);
    return fastValidation(input, 'text');
    
  } catch (error) {
    logger.error(`Error in validation for ${validationType}: ${error.message}`);
    // Always fallback to fast validation on any error
    return fastValidation(input, validationType);
  }
}

// Fast local validation for basic types
export function fastValidation(input, validationType) {
  const trimmedInput = input.trim();
  
  switch (validationType) {
    case 'text':
      return {
        valid: trimmedInput.length > 0 && trimmedInput.length <= 100,
        message: trimmedInput.length === 0 ? 'Please enter a value' : 
                 trimmedInput.length > 100 ? 'Text is too long (max 100 characters)' : 'Text is valid'
      };
    
    case 'number':
      const numValue = parseFloat(trimmedInput);
      return {
        valid: !isNaN(numValue) && numValue > 0,
        message: isNaN(numValue) ? 'Please enter a valid number' : 
                 numValue <= 0 ? 'Please enter a positive number' : 'Number is valid'
      };
    
    case 'postal_code':
      const postalRegex = /^[A-Z0-9\s-]{3,10}$/i;
      return {
        valid: postalRegex.test(trimmedInput),
        message: postalRegex.test(trimmedInput) ? 'Postal code format is valid' : 'Please enter a valid postal code (3-10 characters)'
      };
    
    case 'state':
      const stateRegex = /^[A-Za-z\s]{2,50}$/;
      return {
        valid: stateRegex.test(trimmedInput) && trimmedInput.length >= 2,
        message: stateRegex.test(trimmedInput) ? 'State name is valid' : 'Please enter a valid state/province name'
      };
    
    case 'dob':
    case 'date':
      const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
      if (!dateRegex.test(trimmedInput)) {
        return {
          valid: false,
          message: 'Please enter date in DD-MM-YYYY format'
        };
      }
      
      // Additional validation for DOB (age check)
      if (validationType === 'dob') {
        const [day, month, year] = trimmedInput.split('-').map(Number);
        const birthDate = new Date(year, month - 1, day);
        const today = new Date();
        const age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
          age--;
        }
        
        return {
          valid: age >= 18 && age <= 120 && birthDate <= today,
          message: age < 18 ? 'You must be at least 18 years old' :
                   age > 120 ? 'Please enter a valid date of birth' :
                   birthDate > today ? 'Date of birth cannot be in the future' : 'Date of birth is valid'
        };
      }
      
      return {
        valid: true,
        message: 'Date format is valid'
      };
    
    case 'business_date':
      const businessDateRegex = /^\d{2}-\d{2}-\d{4}$/;
      if (!businessDateRegex.test(trimmedInput)) {
        return {
          valid: false,
          message: 'Please enter date in DD-MM-YYYY format'
        };
      }
      
      const [day, month, year] = trimmedInput.split('-').map(Number);
      const businessDate = new Date(year, month - 1, day);
      const today = new Date();
      
      return {
        valid: businessDate <= today && year >= 1900,
        message: businessDate > today ? 'Business date cannot be in the future' :
                 year < 1900 ? 'Please enter a valid business date' : 'Business date is valid'
      };
    
    case 'gender':
      const validGenders = ['male', 'female', 'other'];
      const isValidGender = validGenders.includes(trimmedInput.toLowerCase());
      return {
        valid: isValidGender,
        message: isValidGender ? 'Gender is valid' : 'Please enter male, female, or other'
      };
    
    case 'phone':
      const cleanPhone = trimmedInput.replace(/\D/g, '');
      return {
        valid: cleanPhone.length >= 10 && cleanPhone.length <= 15,
        message: cleanPhone.length < 10 ? 'Phone number is too short (minimum 10 digits)' :
                 cleanPhone.length > 15 ? 'Phone number is too long (maximum 15 digits)' : 'Phone number is valid'
      };
    
    case 'country':
    case 'countryCode':
      const countryRegex = /^[A-Z]{2,3}$/;
      return {
        valid: countryRegex.test(trimmedInput.toUpperCase()),
        message: countryRegex.test(trimmedInput.toUpperCase()) ? 'Country code is valid' : 'Please enter a valid 2-3 letter country code (e.g., US, IN, GBR)'
      };
    
    case 'city':
      const cityRegex = /^[A-Za-z\s-]{2,50}$/;
      return {
        valid: cityRegex.test(trimmedInput) && trimmedInput.length >= 2,
        message: cityRegex.test(trimmedInput) ? 'City name is valid' : 'Please enter a valid city name (2-50 characters)'
      };
    
    default:
      return {
        valid: trimmedInput.length > 0,
        message: trimmedInput.length === 0 ? 'Please enter a value' : 'Input is valid'
      };
  }
}

// OpenAI validation for complex types
async function openaiValidation(input, validationType) {
  try {
    let prompt = VALIDATION_PROMPTS[validationType] || VALIDATION_PROMPTS.text;
    
    // Replace placeholders in the prompt
    prompt = prompt.replace('{input}', input);
    prompt = prompt.replace('{currentDate}', new Date().toLocaleDateString('en-GB'));
    
    // Get validation from OpenAI
    const response = await getOpenaiResponse(
      'gpt-4o-mini',
      false,
      [
        { role: 'system', content: prompt }
      ]
    );
    
    const validationText = response.choices[0].message.content.trim();
    
    try {
      // Parse the JSON response
      const validation = JSON.parse(validationText);
      
      // Ensure the response has the expected format
      if (typeof validation.valid === 'boolean' && typeof validation.message === 'string') {
        return validation;
      } else {
        throw new Error('Invalid response format');
      }
    } catch (parseError) {
      logger.error(`Error parsing OpenAI validation response: ${parseError.message}`);
      logger.error(`Raw response: ${validationText}`);
      
      // Fallback to fast validation if OpenAI response is invalid
      return fastValidation(input, 'text');
    }
    
  } catch (error) {
    logger.error(`Error in OpenAI validation for ${validationType}: ${error.message}`);
    
    // Check if it's a rate limit error
    if (error.message.includes('429') || error.message.includes('Rate limit')) {
      logger.info(`OpenAI rate limited, using fast validation for ${validationType}`);
    }
    
    // Fallback to fast validation if OpenAI fails
    return fastValidation(input, 'text');
  }
}

// Legacy fallback function (for backward compatibility)
export function fallbackValidation(input, validationType) {
  return fastValidation(input, validationType);
}
