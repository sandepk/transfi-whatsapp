import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import { sendWhatsAppMessage } from './services/template_service.js';

import { logger } from './utils/logger_utils.js';
import { 
  redisClient,
  connectRedis, 
  getConversationHistory, 
  addToConversationHistory, 
  isMessageProcessed, 
  markMessageProcessed,
  checkRedisHealth,
  disconnectRedis
} from './services/redis_client.js';
import { getUserCreationState } from './common/redis_utils.js';
import { 
  getLiveExchangeRates, 
  isValidCurrencyCode,
  isUserInExchangeRatesFlow,
  processExchangeRatesStep,
  detectExchangeRatesIntent,
  startExchangeRatesFlow
} from './services/exchange_rates.js';

// Individual user functions
import {
  startUserRegistration,
  processUserRegistrationStep,
  handleConfirmationStep,
  isUserInRegistration,
  getRegistrationProgress,
  resetUserRegistration
} from './users/individual_user.js';

// Business user functions
import {
  startBusinessUserRegistration,
  processBusinessUserRegistrationStep,
  isUserInBusinessRegistration,
  getBusinessRegistrationProgress,
  resetBusinessUserRegistration
} from './users/business_user.js';
import { MONEY_INTENT_PROMPT, USER_TYPE_PROMPT } from './prompts/prompts.js';
import { getOpenaiResponse } from './utils/openai_utils.js';

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

// User registration functions are now organized in separate files:
// - Individual users: users/individual_user.js
// - Business users: users/business_user.js
// - Common functionality: common/ folder

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
        
        // // Check if we've already processed this message (deduplication)
        // if (await isMessageProcessed(messageId)) {
        //   logger.info(`Message ${messageId} already processed, skipping duplicate`);
        //   return;
        // }
        
        logger.info(`Processing new message ${messageId} from ${from}: ${messageText}`);
        
        // Process message and generate response
        const response = await processMessage(from, messageText);
        
        // Send response back to WhatsApp
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

// Intent detection functions
async function detectMoneyIntent(message) {
  try {
    const prompt = MONEY_INTENT_PROMPT.replace('{message}', message);
    const response = await getOpenaiResponse('gpt-4o-mini', false, [
      { role: 'system', content: prompt }
    ]);
    return response.choices[0].message.content.trim();
  } catch (error) {
    logger.error(`Error detecting money intent: ${error.message}`);
    return 'GENERAL_QUERY';
  }
}

async function classifyUserType(response) {
  try {
    const prompt = USER_TYPE_PROMPT.replace('{response}', response);
    const aiResponse = await getOpenaiResponse('gpt-4o-mini', false, [
      { role: 'system', content: prompt }
    ]);
    return aiResponse.choices[0].message.content.trim();
  } catch (error) {
    logger.error(`Error classifying user type: ${error.message}`);
    return 'INDIVIDUAL';
  }
}



// Process incoming message and generate AI response
async function processMessage(from, messageText) {
  try {
    // Check if user is in individual registration flow
    if (await isUserInRegistration(redisClient, from)) {
      // Check if user is in confirmation step
      const state = await getUserCreationState(redisClient, from);
      if (state && state.currentStep === 'confirmation') {
        const response = await handleConfirmationStep(redisClient, from, messageText);
        if (response) {
          await addToConversationHistory(from, {
            role: 'assistant',
            content: response
          });
          return response;
        }
      } else {
        // Regular registration step
        const response = await processUserRegistrationStep(redisClient, from, messageText);
        if (response) {
          await addToConversationHistory(from, {
            role: 'assistant',
            content: response
          });
          return response;
        }
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
    
    // Check for money transfer/collection intent (only if not already in a flow)
    let storedIntent = await redisClient.get(`money_intent:${from}`);
    logger.info(`Redis check - storedIntent for ${from}: ${storedIntent}`);
    
    // Check if stored intent has expired (Redis TTL will handle this automatically)
    if (storedIntent) {
      const ttl = await redisClient.ttl(`money_intent:${from}`);
      logger.info(`Redis TTL for ${from}: ${ttl}`);
      if (ttl <= 0) {
        // Intent expired, clear it
        await redisClient.del(`money_intent:${from}`);
        storedIntent = null;
        logger.info(`Cleared expired intent for ${from}`);
      }
    }
    
    if (!storedIntent) {
      logger.info(`No stored intent found, checking message: "${messageText}"`);
      
      // First try OpenAI intent detection
      let moneyIntent;
      try {
        moneyIntent = await detectMoneyIntent(messageText);
        logger.info(`OpenAI detected money intent: ${moneyIntent} for message: "${messageText}"`);
      } catch (error) {
        logger.error(`OpenAI intent detection failed: ${error.message}`);
        moneyIntent = null; // Force fallback detection
      }
      
      // Fallback to simple keyword detection if OpenAI fails or returns unexpected result
      if (!moneyIntent || !['SEND_MONEY', 'COLLECT_MONEY', 'EXCHANGE_RATES', 'GENERAL_QUERY'].includes(moneyIntent)) {
        logger.info(`OpenAI returned unexpected result: "${moneyIntent}", using fallback detection`);
        
        // More comprehensive fallback detection
        const lowerMessage = messageText.toLowerCase();
        
        if (lowerMessage.includes('send money') || lowerMessage.includes('want to send') || 
            lowerMessage.includes('need to send') || lowerMessage.includes('send money') ||
            lowerMessage.includes('transfer money') || lowerMessage.includes('send cash')) {
          moneyIntent = 'SEND_MONEY';
        } else if (lowerMessage.includes('collect money') || lowerMessage.includes('want to collect') || 
                   lowerMessage.includes('need to collect') || lowerMessage.includes('receive money') ||
                   lowerMessage.includes('get money') || lowerMessage.includes('collect cash')) {
          moneyIntent = 'COLLECT_MONEY';
        } else if (lowerMessage.includes('exchange rate') || lowerMessage.includes('live rate') || 
                   lowerMessage.includes('currency rate') || lowerMessage.includes('php rate') ||
                   lowerMessage.includes('usd rate') || lowerMessage.includes('eur rate')) {
          moneyIntent = 'EXCHANGE_RATES';
        } else {
          moneyIntent = 'GENERAL_QUERY';
        }
        
        logger.info(`Fallback detected money intent: ${moneyIntent} for message: "${messageText}"`);
      }
      
      if (moneyIntent === 'SEND_MONEY' || moneyIntent === 'COLLECT_MONEY') {
        // Ask user if they are individual or business
        const userTypeQuestion = `💸 **${moneyIntent === 'SEND_MONEY' ? 'Send Money' : 'Collect Money'} Request**

I'd be happy to help you ${moneyIntent === 'SEND_MONEY' ? 'send money' : 'collect money'}! 

Before we proceed, I need to know:
**Are you an individual or a business?**

Please respond with:
• **"Individual"** - if this is for personal use (sending to family/friends, personal expenses)
• **"Business"** - if this is for company transactions (payroll, vendor payments, business expenses)

This helps me set up the right type of account for you.`;
        
        // Store the intent in Redis for the next response
        await redisClient.setEx(`money_intent:${from}`, 300, moneyIntent); // 5 minutes expiry
        
        await addToConversationHistory(from, {
          role: 'assistant',
          content: userTypeQuestion
        });
        return userTypeQuestion;
      }
    } else {
      // User has a stored intent, check if they're responding to the user type question
      if (messageText.toLowerCase().includes('cancel')) {
        // User wants to cancel the money request
        await redisClient.del(`money_intent:${from}`); // Clear the stored intent
        const cancelResponse = "✅ Money request cancelled. How else can I help you today?\n\n💸 **Money Services:**\n• Say \"I want to send money\" to start sending money\n• Say \"I want to collect money\" to start collecting money\n\n💱 **Exchange Rates:**\n• Ask about 'live rates' or 'exchange rates'";
        
        await addToConversationHistory(from, {
          role: 'assistant',
          content: cancelResponse
        });
        return cancelResponse;
      } else if (messageText.toLowerCase().includes('individual') || messageText.toLowerCase().includes('business')) {
        const userType = await classifyUserType(messageText);
        
        if (userType === 'BUSINESS') {
          // Start business user registration
          const response = await startBusinessUserRegistration(redisClient, from);
          await redisClient.del(`money_intent:${from}`); // Clear the stored intent
          await addToConversationHistory(from, {
            role: 'assistant',
            content: response
          });
          return response;
        } else {
          // Start individual user registration
          const response = await startUserRegistration(redisClient, from);
          await redisClient.del(`money_intent:${from}`); // Clear the stored intent
          await addToConversationHistory(from, {
            role: 'assistant',
            content: response
          });
          return response;
        }
      } else {
        // User has stored intent but didn't answer the question properly
        const userTypeQuestion = `💸 **${storedIntent === 'SEND_MONEY' ? 'Send Money' : 'Collect Money'} Request**

I need to know your account type to continue. Please respond with:
• **"Individual"** - for personal use
• **"Business"** - for company transactions
• **"Cancel"** - to cancel this request

Which type of account do you need?`;
        
        await addToConversationHistory(from, {
          role: 'assistant',
          content: userTypeQuestion
        });
        return userTypeQuestion;
      }
    }
    
    // Check for other commands
    if (lowerMessage === 'help' || lowerMessage === 'commands') {
      const helpResponse = `🤖 **WhatsApp Bot Commands:**

💸 **Money Services:**
• Say "I want to send money" - Start send money process
• Say "I want to collect money" - Start collect money process
• Ask about "live rates" or "exchange rates" - Get currency rates

📝 **Registration:**
• \`register\` - Start individual user registration
• \`register business\` - Start business user registration
• \`status\` - Check your registration progress
• \`reset\` - Reset your current registration

📋 **Other Commands:**
• \`help\` - Show this help message

💡 **Examples:**
• Say "I want to send money" to start the process
• Say "I want to collect money" to start the process
• Ask "What are the live rates for PHP?" for exchange rates
• Type \`register\` for direct registration`;
      
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
    
    // Check if user is in exchange rates flow
    if (await isUserInExchangeRatesFlow(redisClient, from)) {
      const response = await processExchangeRatesStep(redisClient, from, messageText);
      if (response) {
        await addToConversationHistory(from, {
          role: 'assistant',
          content: response
        });
        return response;
      }
    }
    
    // Check for exchange rates intent using OpenAI
    const exchangeRatesIntent = await detectExchangeRatesIntent(messageText);
    if (exchangeRatesIntent === 'EXCHANGE_RATES') {
      const response = await startExchangeRatesFlow(redisClient, from, messageText);
      await addToConversationHistory(from, {
        role: 'assistant',
        content: response
      });
      return response;
    }
    
    // Get conversation history for this user
    let history = await getConversationHistory(from);
    
    // Add user message to history
    await addToConversationHistory(from, {
      role: 'user',
      content: messageText
    });
    
    // Simple response logic (you can integrate OpenAI here)
    let aiResponse = "Thank you for your message! I'm a WhatsApp financial services bot. How can I help you today?\n\n💸 **Money Services:**\n• Say \"I want to send money\" to start sending money\n• Say \"I want to collect money\" to start collecting money\n\n💱 **Exchange Rates:**\n• Ask about 'live rates' or 'exchange rates'\n\n📝 **Direct Registration:**\n• Type 'register' for individual account\n• Type 'register business' for business account\n\nType 'help' for more commands!";
    
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
      port: PORT
    };
    
    res.status(200).json({
      success: true,
      config,
      instructions: {
        whitelist: 'To fix "phone number not in allowed list" error: Go to Meta Business Manager > WhatsApp Business Account > Configuration > Phone Numbers > Advanced > Allowed Recipients and add the phone number.',
        webhook: 'Set your webhook URL in Meta Business Manager to: ' + config.webhookUrl,
        verifyToken: 'Use the same verify token in Meta Business Manager and your .env file',

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



// Debug endpoint to check message processing status
app.get('/debug/messages', async (req, res) => {
  try {
    const debugInfo = {
      redisHealth: await checkRedisHealth(),
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
      service: 'WhatsApp Bot',
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
      service: 'WhatsApp Bot',
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
    service: 'WhatsApp Bot API',
    version: '1.0.0',
    endpoints: {
      'GET /health': 'Health check',
      'GET /webhook': 'Webhook verification',
      'POST /webhook': 'Receive WhatsApp messages',

      'GET /whatsapp-config': 'Check WhatsApp configuration',
      
      'GET /debug/messages': 'Debug message processing status',
      'GET /test/registration': 'Test user registration functions'
    },
    documentation: '/docs'
  });
});

// Start server
app.listen(PORT, () => {
  logger.info(`WhatsApp Bot server running on port ${PORT}`);
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

// Exchange rates functionality moved to src/services/exchange_rates.js

export default app; 