import fetch from 'node-fetch';
import { logger } from './logger_utils.js';

/**
 * Create a WhatsApp message template
 * @param {Object} templateData - Template data object
 * @returns {Promise<Object>} Created template response
 */
export async function createTemplate(templateData) {
  try {
    const accessToken = process.env.META_ACCESS_TOKEN;
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    
    if (!accessToken || !wabaId) {
      throw new Error('Missing required environment variables: META_ACCESS_TOKEN or WHATSAPP_BUSINESS_ACCOUNT_ID');
    }
    
    const url = `https://graph.facebook.com/v18.0/${wabaId}/message_templates`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(templateData)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`WhatsApp Template API error: ${JSON.stringify(errorData)}`);
    }
    
    const result = await response.json();
    logger.info(`Template created successfully: ${result.id}`);
    return result;
    
  } catch (error) {
    logger.error(`Error creating template: ${error.message}`);
    throw error;
  }
}

/**
 * Get all templates for a WhatsApp Business Account
 * @returns {Promise<Object>} Templates list
 */
export async function getTemplates() {
  try {
    const accessToken = process.env.META_ACCESS_TOKEN;
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    
    if (!accessToken || !wabaId) {
      throw new Error('Missing required environment variables: META_ACCESS_TOKEN or WHATSAPP_BUSINESS_ACCOUNT_ID');
    }
    
    const url = `https://graph.facebook.com/v18.0/${wabaId}/message_templates?access_token=${accessToken}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`WhatsApp Template API error: ${JSON.stringify(errorData)}`);
    }
    
    const result = await response.json();
    return result;
    
  } catch (error) {
    logger.error(`Error fetching templates: ${error.message}`);
    throw error;
  }
}

/**
 * Delete a template
 * @param {string} templateId - Template ID to delete
 * @returns {Promise<Object>} Deletion response
 */
export async function deleteTemplate(templateId) {
  try {
    const accessToken = process.env.META_ACCESS_TOKEN;
    
    if (!accessToken) {
      throw new Error('Missing required environment variable: META_ACCESS_TOKEN');
    }
    
    const url = `https://graph.facebook.com/v18.0/${templateId}?access_token=${accessToken}`;
    
    const response = await fetch(url, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`WhatsApp Template API error: ${JSON.stringify(errorData)}`);
    }
    
    const result = await response.json();
    logger.info(`Template deleted successfully: ${templateId}`);
    return result;
    
  } catch (error) {
    logger.error(`Error deleting template: ${error.message}`);
    throw error;
  }
}

/**
 * Send a template message
 * @param {string} to - Recipient phone number
 * @param {string} templateName - Name of the template to use
 * @param {Array} components - Template components with variables
 * @returns {Promise<Object>} Send response
 */
export async function sendTemplateMessage(to, templateName, components = [], language = 'en') {
  try {
    const accessToken = process.env.META_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    
    if (!accessToken || !phoneNumberId) {
      throw new Error('Missing required environment variables: META_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID');
    }
    
    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;
    
    const messageData = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: language
        }
      }
    };
    
    // Add components if provided
    if (components && components.length > 0) {
      messageData.template.components = components;
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(messageData)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`WhatsApp Template API error: ${JSON.stringify(errorData)}`);
    }
    
    const result = await response.json();
    logger.info(`Template message sent successfully: ${result.messages[0].id}`);
    return result;
    
  } catch (error) {
    logger.error(`Error sending template message: ${error.message}`);
    throw error;
  }
}

/**
 * Example template data for common use cases
 */
export const TEMPLATE_EXAMPLES = {
  // Welcome message template
  welcome: {
    name: 'welcome_message',
    language: 'en_US',
    category: 'UTILITY',
    components: [
      {
        type: 'HEADER',
        format: 'TEXT',
        text: 'Welcome to our service!'
      },
      {
        type: 'BODY',
        text: 'Hi {{1}}, thank you for choosing us. We\'re here to help you with any questions.'
      },
      {
        type: 'FOOTER',
        text: 'Reply with any questions'
      }
    ]
  },
  
  // Order confirmation template
  orderConfirmation: {
    name: 'order_confirmation',
    language: 'en_US',
    category: 'UTILITY',
    components: [
      {
        type: 'HEADER',
        format: 'TEXT',
        text: 'Order Confirmed!'
      },
      {
        type: 'BODY',
        text: 'Hi {{1}}, your order {{2}} has been confirmed. Total: ${{3}}. Expected delivery: {{4}}.'
      },
      {
        type: 'FOOTER',
        text: 'Track your order at {{5}}'
      }
    ]
  },
  
  // Appointment reminder template
  appointmentReminder: {
    name: 'appointment_reminder',
    language: 'en_US',
    category: 'UTILITY',
    components: [
      {
        type: 'HEADER',
        format: 'TEXT',
        text: 'Appointment Reminder'
      },
      {
        type: 'BODY',
        text: 'Hi {{1}}, this is a reminder for your appointment on {{2}} at {{3}}. Location: {{4}}.'
      },
      {
        type: 'FOOTER',
        text: 'Call {{5}} to reschedule'
      }
    ]
  },
  
  // Customer support template with buttons
  customerSupport: {
    name: 'customer_support',
    language: 'en_US',
    category: 'UTILITY',
    components: [
      {
        type: 'HEADER',
        format: 'TEXT',
        text: 'How can we help?'
      },
      {
        type: 'BODY',
        text: 'Hi {{1}}, we are here to help you. Please select an option below.'
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'QUICK_REPLY',
            text: 'General Inquiry'
          },
          {
            type: 'QUICK_REPLY',
            text: 'Technical Support'
          },
          {
            type: 'QUICK_REPLY',
            text: 'Billing Question'
          }
        ]
      }
    ]
  }
}; 