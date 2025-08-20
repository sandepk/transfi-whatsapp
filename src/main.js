import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import { createTemplate, getTemplates, deleteTemplate, sendTemplateMessage } from './template_utils.js';
import { logger } from './logger_utils.js';
import { 
  redisClient,
  connectRedis, 
  getConversationHistory, 
  addToConversationHistory, 
  isMessageProcessed, 
  markMessageProcessed,
  checkRedisHealth,
  disconnectRedis
} from './redis_client.js';
import {
  startUserRegistration,
  processUserRegistrationStep,
  isUserInRegistration,
  startBusinessUserRegistration,
  processBusinessUserRegistrationStep,
  isUserInBusinessRegistration,
  getRegistrationProgress,
  resetUserRegistration,
  getBusinessRegistrationProgress,
  resetBusinessUserRegistration
} from './user_creation.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to Redis on startup
(async () => {
  try {
    await connectRedis();
  } catch (error) {
    logger.error('Failed to connect to Redis:', error);
  }
})();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Redis utility functions are now imported from redis_client.js

// Note: Redis is now used for conversation history and message deduplication

// Conversation state management functions
// Conversation state functions are now imported from user_creation.js

// User registration functions are now imported from user_creation.js

// Input validation functions are now imported from user_creation.js

// User creation API functions are now imported from user_creation.js

// WhatsApp webhook verification endpoint
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    logger.info('Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    logger.error('Webhook verification failed');
    res.sendStatus(403);
  }
});

// WhatsApp webhook endpoint to receive messages
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    
    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry[0];
      const changes = entry.changes[0];
      const value = changes.value;
      
      if (value.messages && value.messages.length > 0) {
        const message = value.messages[0];
        const from = message.from;
        const messageText = message.text?.body || '';
        const timestamp = message.timestamp;
        const messageId = message.id;
        
        // Check if we've already processed this message (deduplication)
        if (await isMessageProcessed(messageId)) {
          logger.info(`Message ${messageId} already processed, skipping duplicate`);
          return;
        }
        
        logger.info(`Processing new message ${messageId} from ${from}: ${messageText}`);
        
        // Process message and generate response
        const response = await processMessage(from, messageText);
        
        // Send response back to WhatsApp (template or text based on config)
        const sendResult = await sendWhatsAppMessage(from, response);
        
        if (sendResult && sendResult.success !== false) {
          // Mark message as processed only if sent successfully
          await markMessageProcessed(messageId);
          logger.info(`Message ${messageId} processed and sent successfully`);
        } else {
          logger.warn(`Message ${messageId} could not be sent, will retry on next webhook`);
        }
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    logger.error(`Error processing webhook: ${error.message}`);
    res.status(500).send('Internal Server Error');
  }
});

// Process incoming message and generate AI response
async function processMessage(from, messageText) {
  try {
    // Check if user is in individual registration flow
    if (await isUserInRegistration(redisClient, from)) {
      const response = await processUserRegistrationStep(redisClient, from, messageText);
      if (response) {
        await addToConversationHistory(from, {
          role: 'assistant',
          content: response
        });
        return response;
      }
    }
    
    // Check if user is in business registration flow
    if (await isUserInBusinessRegistration(redisClient, from)) {
      const response = await processBusinessUserRegistrationStep(redisClient, from, messageText);
      if (response) {
        await addToConversationHistory(from, {
          role: 'assistant',
          content: response
        });
        return response;
      }
    }
    
    // Check for registration commands
    const lowerMessage = messageText.toLowerCase();
    if (lowerMessage.includes('register') || lowerMessage.includes('signup') || lowerMessage.includes('create account')) {
      if (lowerMessage.includes('business') || lowerMessage.includes('company') || lowerMessage.includes('corporate')) {
        // Start business user registration
        const response = await startBusinessUserRegistration(redisClient, from);
        await addToConversationHistory(from, {
          role: 'assistant',
          content: response
        });
        return response;
      } else {
        // Start individual user registration
        const response = await startUserRegistration(redisClient, from);
        await addToConversationHistory(from, {
          role: 'assistant',
          content: response
        });
        return response;
      }
    }
    
    // Check for other commands
    if (lowerMessage === 'help' || lowerMessage === 'commands') {
      const helpResponse = `🤖 **WhatsApp Bot Commands:**

📝 **Registration:**
• \`register\` - Start individual user registration
• \`register business\` - Start business user registration
• \`status\` - Check your registration progress
• \`reset\` - Reset your current registration
• \`help\` - Show this help message

💡 **Examples:**
• Type \`register\` to create your account
• Type \`register business\` for business account
• Type \`status\` to see your progress`;
      
      await addToConversationHistory(from, {
        role: 'assistant',
        content: helpResponse
      });
      return helpResponse;
    }
    
    if (lowerMessage === 'status') {
      // Check individual registration status
      if (await isUserInRegistration(redisClient, from)) {
        const progress = await getRegistrationProgress(redisClient, from);
        const statusResponse = `📊 **Registration Progress:**

Step: ${progress.currentStep}/${progress.totalSteps}
Progress: ${progress.progress}%
Started: ${new Date(progress.startedAt).toLocaleString()}
Collected: ${progress.collectedFields.join(', ') || 'None'}

Continue with the next question or type \`reset\` to start over.`;
        
        await addToConversationHistory(from, {
          role: 'assistant',
          content: statusResponse
        });
        return statusResponse;
      }
      
      // Check business registration status
      if (await isUserInBusinessRegistration(redisClient, from)) {
        const progress = await getBusinessRegistrationProgress(redisClient, from);
        const statusResponse = `📊 **Business Registration Progress:**

Step: ${progress.currentStep}/${progress.totalSteps}
Progress: ${progress.progress}%
Started: ${new Date(progress.startedAt).toLocaleString()}
Collected: ${progress.collectedFields.join(', ') || 'None'}

Continue with the next question or type \`reset\` to start over.`;
        
        await addToConversationHistory(from, {
          role: 'assistant',
          content: statusResponse
        });
        return statusResponse;
      }
      
      const noRegistrationResponse = "❌ You are not currently in any registration process.\n\nType \`register\` to start individual registration or \`register business\` for business registration.";
      
      await addToConversationHistory(from, {
        role: 'assistant',
        content: noRegistrationResponse
      });
      return noRegistrationResponse;
    }
    
    if (lowerMessage === 'reset') {
      // Reset individual registration
      if (await isUserInRegistration(redisClient, from)) {
        const response = await resetUserRegistration(redisClient, from);
        await addToConversationHistory(from, {
          role: 'assistant',
          content: response
        });
        return response;
      }
      
      // Reset business registration
      if (await isUserInBusinessRegistration(redisClient, from)) {
        const response = await resetBusinessUserRegistration(redisClient, from);
        await addToConversationHistory(from, {
          role: 'assistant',
          content: response
        });
        return response;
      }
      
      const noResetResponse = "❌ Nothing to reset. You are not currently in any registration process.";
      
      await addToConversationHistory(from, {
        role: 'assistant',
        content: noResetResponse
      });
      return noResetResponse;
    }
    
    // Get conversation history for this user
    let history = await getConversationHistory(from);
    
    // Add user message to history
    await addToConversationHistory(from, {
      role: 'user',
      content: messageText
    });
    
    // Simple response logic (you can integrate OpenAI here)
    let aiResponse = "Thank you for your message! I'm a WhatsApp template bot. How can I help you today?\n\nTo register, type: 'register' or 'signup'\nFor business registration, type: 'register business'";
    
    // Add AI response to history
    await addToConversationHistory(from, {
      role: 'assistant',
      content: aiResponse
    });
    
    logger.info(`Response generated: ${aiResponse}`);
    return aiResponse;
    
  } catch (error) {
    logger.error(`Error processing message: ${error.message}`);
    return "I'm sorry, I'm having trouble processing your message right now. Please try again later.";
  }
}

// Note: sendWhatsAppMessage function removed - now using sendTemplateMessage directly

// Configuration for message type
const MESSAGE_CONFIG = {
  useTemplate: process.env.USE_TEMPLATE_MESSAGES === 'true', // Set to 'true' in .env to use templates
  defaultTemplate: process.env.DEFAULT_TEMPLATE || 'template_language',
  defaultLanguage: process.env.DEFAULT_LANGUAGE || 'en'
};

// User creation functionality is now in a separate module (src/user_creation.js)

// Send WhatsApp message using Meta Business API
// This function automatically chooses between template and text messages based on MESSAGE_CONFIG
// When useTemplate is true: calls sendTemplateMessage function
// When useTemplate is false: sends normal text message
async function sendWhatsAppMessage(to, message) {
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

// Template creation endpoint
app.post('/create-template', async (req, res) => {
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
});

// Get all templates endpoint
app.get('/templates', async (req, res) => {
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
});

// Delete template endpoint
app.delete('/templates/:id', async (req, res) => {
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
});

// Send template message endpoint
app.post('/send-template', async (req, res) => {
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
});

// WhatsApp configuration check endpoint
app.get('/whatsapp-config', (req, res) => {
  try {
    const config = {
      hasAccessToken: !!process.env.META_ACCESS_TOKEN,
      hasPhoneNumberId: !!process.env.WHATSAPP_PHONE_NUMBER_ID,
      hasBusinessAccountId: !!process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      hasVerifyToken: !!process.env.WHATSAPP_VERIFY_TOKEN,
      baseUrl: process.env.BASE_URL || `http://localhost:${PORT}`,
      webhookUrl: `${process.env.BASE_URL || 'http://localhost:' + PORT}/webhook`,
      port: PORT,
      messageConfig: MESSAGE_CONFIG
    };
    
    res.status(200).json({
      success: true,
      config,
      instructions: {
        whitelist: 'To fix "phone number not in allowed list" error: Go to Meta Business Manager > WhatsApp Business Account > Configuration > Phone Numbers > Advanced > Allowed Recipients and add the phone number.',
        webhook: 'Set your webhook URL in Meta Business Manager to: ' + config.webhookUrl,
        verifyToken: 'Use the same verify token in Meta Business Manager and your .env file',
        messageType: 'To switch between template and text messages, use POST /message-config or set USE_TEMPLATE_MESSAGES=true/false in .env'
      }
    });
    
  } catch (error) {
    logger.error(`Error in config endpoint: ${error.message}`);
    res.status(500).json({
      error: 'Failed to get configuration',
      details: error.message
    });
  }
});

// Dynamic message configuration endpoint
app.post('/message-config', (req, res) => {
  try {
    const { useTemplate, defaultTemplate, defaultLanguage } = req.body;
    
    // Update configuration
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
    logger.error(`Error updating message config: ${error.message}`);
    res.status(500).json({
      error: 'Failed to update message configuration',
      details: error.message
    });
  }
});

// Debug endpoint to check message processing status
app.get('/debug/messages', async (req, res) => {
  try {
    const debugInfo = {
      redisHealth: await checkRedisHealth(),
      messageConfig: MESSAGE_CONFIG,
      timestamp: new Date().toISOString()
    };
    
    res.status(200).json({
      success: true,
      debug: debugInfo
    });
    
  } catch (error) {
    logger.error(`Error in debug endpoint: ${error.message}`);
    res.status(500).json({
      error: 'Failed to get debug info',
      details: error.message
    });
  }
});

// Test user registration endpoint
app.get('/test/registration', async (req, res) => {
  try {
    const testWhatsappNumber = '1234567890';
    
    // Test starting individual registration
    const individualResponse = await startUserRegistration(redisClient, testWhatsappNumber);
    
    // Test starting business registration
    const businessResponse = await startBusinessUserRegistration(redisClient, testWhatsappNumber);
    
    res.status(200).json({
      success: true,
      message: 'User registration functions are working',
      individualResponse,
      businessResponse,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error(`Error testing registration: ${error.message}`);
    res.status(500).json({
      error: 'Failed to test registration',
      details: error.message
    });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const redisHealth = await checkRedisHealth();
    
    res.status(200).json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      service: 'WhatsApp Template Bot',
      version: '1.0.0',
      redis: {
        status: redisHealth ? 'connected' : 'disconnected',
        healthy: redisHealth
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'SERVICE_UNAVAILABLE',
      timestamp: new Date().toISOString(),
      service: 'WhatsApp Template Bot',
      version: '1.0.0',
      redis: {
        status: 'error',
        healthy: false,
        error: error.message
      }
    });
  }
});

// API documentation endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'WhatsApp Template Bot API',
    version: '1.0.0',
    endpoints: {
      'GET /health': 'Health check',
      'GET /webhook': 'Webhook verification',
      'POST /webhook': 'Receive WhatsApp messages',
      'POST /create-template': 'Create new template',
      'GET /templates': 'List all templates',
      'DELETE /templates/:id': 'Delete template',
      'POST /send-template': 'Send template message',
      'GET /whatsapp-config': 'Check WhatsApp configuration',
      'POST /message-config': 'Update message configuration',
      'GET /debug/messages': 'Debug message processing status',
      'GET /test/registration': 'Test user registration functions'
    },
    documentation: '/docs'
  });
});

// Start server
app.listen(PORT, () => {
  logger.info(`WhatsApp Template Bot server running on port ${PORT}`);
  logger.info(`Webhook URL: ${process.env.BASE_URL || 'http://localhost:' + PORT}/webhook`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await disconnectRedis();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await disconnectRedis();
  process.exit(0);
});

export default app; 