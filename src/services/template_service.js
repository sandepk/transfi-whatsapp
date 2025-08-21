import { createTemplate, getTemplates, deleteTemplate, sendTemplateMessage } from '../utils/template_utils.js';
import { logger } from '../utils/logger_utils.js';

// Configuration for message type
export const MESSAGE_CONFIG = {
  useTemplate: process.env.USE_TEMPLATE_MESSAGES === 'true', // Set to 'true' in .env to use templates
  defaultTemplate: process.env.DEFAULT_TEMPLATE || 'template_language',
  defaultLanguage: process.env.DEFAULT_LANGUAGE || 'en'
};

// Send WhatsApp message using Meta Business API
// This function automatically chooses between template and text messages based on MESSAGE_CONFIG
// When useTemplate is true: calls sendTemplateMessage function
// When useTemplate is false: sends normal text message
export async function sendWhatsAppMessage(to, message) {
  try {
    const accessToken = process.env.META_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    
    if (!accessToken || !phoneNumberId) {
      throw new Error('Missing required environment variables for WhatsApp API');
    }
    
    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;
    
    // Choose between template and text message based on configuration
    let messageData;
    
    if (MESSAGE_CONFIG.useTemplate) {
      // Use sendTemplateMessage function for templates
      logger.info(`Template mode enabled: sending template message using ${MESSAGE_CONFIG.defaultTemplate}`);
      return await sendTemplateMessage(to, MESSAGE_CONFIG.defaultTemplate, [], MESSAGE_CONFIG.defaultLanguage);
    } else {
      // Send normal text message
      logger.info(`Text mode enabled: sending custom text message`);
      messageData = {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: {
          body: message
        }
      };
      
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
        
        // Handle specific WhatsApp API errors gracefully
        if (errorData.error && errorData.error.code === 131030) {
          logger.warn(`Phone number ${to} not in allowed list. Add to whitelist in Meta Business Manager.`);
          return {
            success: false,
            error: 'Phone number not whitelisted',
            details: 'This phone number needs to be added to the allowed recipients list in your Meta Business account.'
          };
        }
        
        throw new Error(`WhatsApp API error: ${JSON.stringify(errorData)}`);
      }
      
      const result = await response.json();
      logger.info(`WhatsApp text message sent successfully: ${result.messages[0].id}`);
      return result;
    }
    
  } catch (error) {
    logger.error(`Error sending WhatsApp message: ${error.message}`);
    throw error;
  }
}

// Template creation endpoint handler
export async function handleCreateTemplate(req, res) {
  try {
    const templateData = req.body;
    
    // Validate required fields
    if (!templateData.name || !templateData.language || !templateData.category || !templateData.components) {
      return res.status(400).json({
        error: 'Missing required fields: name, language, category, components'
      });
    }
    
    const result = await createTemplate(templateData);
    res.status(201).json({
      success: true,
      template: result
    });
    
  } catch (error) {
    logger.error(`Error in template creation endpoint: ${error.message}`);
    res.status(500).json({
      error: 'Failed to create template',
      details: error.message
    });
  }
}

// Get all templates endpoint handler
export async function handleGetTemplates(req, res) {
  try {
    const result = await getTemplates();
    res.status(200).json(result);
    
  } catch (error) {
    logger.error(`Error fetching templates: ${error.message}`);
    res.status(500).json({
      error: 'Failed to fetch templates',
      details: error.message
    });
  }
}

// Delete template endpoint handler
export async function handleDeleteTemplate(req, res) {
  try {
    const templateId = req.params.id;
    const result = await deleteTemplate(templateId);
    res.status(200).json({
      success: true,
      message: 'Template deleted successfully',
      result
    });
    
  } catch (error) {
    logger.error(`Error deleting template: ${error.message}`);
    res.status(500).json({
      error: 'Failed to delete template',
      details: error.message
    });
  }
}

// Send template message endpoint handler
export async function handleSendTemplate(req, res) {
  try {
    const { to, templateName, components } = req.body;
    
    if (!to || !templateName) {
      return res.status(400).json({
        error: 'Missing required fields: to, templateName'
      });
    }
    
    const result = await sendTemplateMessage(to, templateName, components, 'en');
    res.status(200).json({
      success: true,
      message: 'Template message sent successfully',
      result
    });
    
  } catch (error) {
    logger.error(`Error sending template message: ${error.message}`);
    res.status(500).json({
      error: 'Failed to send template message',
      details: error.message
    });
  }
}

// Update message configuration endpoint handler
export async function handleUpdateMessageConfig(req, res) {
  try {
    const { useTemplate, defaultTemplate, defaultLanguage } = req.body;
    
    if (useTemplate !== undefined) {
      MESSAGE_CONFIG.useTemplate = useTemplate === true || useTemplate === 'true';
      logger.info(`Message type changed to: ${MESSAGE_CONFIG.useTemplate ? 'Template' : 'Text'}`);
    }
    
    if (defaultTemplate) {
      MESSAGE_CONFIG.defaultTemplate = defaultTemplate;
      logger.info(`Default template changed to: ${defaultTemplate}`);
    }
    
    if (defaultLanguage) {
      MESSAGE_CONFIG.defaultLanguage = defaultLanguage;
      logger.info(`Default language changed to: ${defaultLanguage}`);
    }
    
    res.status(200).json({
      success: true,
      message: 'Message configuration updated successfully',
      currentConfig: MESSAGE_CONFIG
    });
    
  } catch (error) {
    logger.error(`Error updating message configuration: ${error.message}`);
    res.status(500).json({
      error: 'Failed to update message configuration',
      details: error.message
    });
  }
}

// Get message configuration endpoint handler
export async function handleGetMessageConfig(req, res) {
  try {
    res.status(200).json({
      success: true,
      messageConfig: MESSAGE_CONFIG,
      messageType: 'To switch between template and text messages, use POST /message-config or set USE_TEMPLATE_MESSAGES=true/false in .env'
    });
    
  } catch (error) {
    logger.error(`Error getting message configuration: ${error.message}`);
    res.status(500).json({
      error: 'Failed to get message configuration',
      details: error.message
    });
  }
}
