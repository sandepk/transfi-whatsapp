import { logger } from '../utils/logger_utils.js';
import { getOpenaiResponse } from '../utils/openai_utils.js';
import { VALIDATION_PROMPTS } from '../prompts/prompts.js';

// Input validation functions using OpenAI
export async function validateUserInput(input, validationType) {
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
      
      // Fallback to basic validation if OpenAI response is invalid
      return fallbackValidation(input, validationType);
    }
    
  } catch (error) {
    logger.error(`Error in OpenAI validation for ${validationType}: ${error.message}`);
    
    // Fallback to basic validation if OpenAI fails
    return fallbackValidation(input, validationType);
  }
}

// Fallback validation function for when OpenAI is unavailable
export function fallbackValidation(input, validationType) {
  switch (validationType) {
    case 'email':
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return {
        valid: emailRegex.test(input.trim()),
        message: emailRegex.test(input.trim()) ? 'Email format is valid' : 'Please enter a valid email address'
      };
    
    case 'date':
    case 'business_date':
      const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
      return {
        valid: dateRegex.test(input),
        message: dateRegex.test(input) ? 'Date format is valid' : 'Please enter date in DD-MM-YYYY format'
      };
    
    case 'gender':
      const validGenders = ['male', 'female', 'other'];
      const isValidGender = validGenders.includes(input.toLowerCase().trim());
      return {
        valid: isValidGender,
        message: isValidGender ? 'Gender is valid' : 'Please enter male, female, or other'
      };
    
    case 'phone':
      const cleanPhone = input.replace(/\D/g, '');
      return {
        valid: cleanPhone.length >= 10 && cleanPhone.length <= 15,
        message: 'Please enter a valid phone number (10-15 digits)'
      };
    
    case 'text':
    default:
      return {
        valid: input.trim().length > 0,
        message: input.trim().length > 0 ? 'Input is valid' : 'Please enter a valid value'
      };
  }
}
