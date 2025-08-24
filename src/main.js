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
  userExists, 
  getUserData, 
  getUserFullName 
} from './common/redis_utils.js';
import { 
  getLiveExchangeRates, 
  isValidCurrencyCode,
  isUserInExchangeRatesFlow,
  processExchangeRatesStep,
  detectExchangeRatesIntent,
  startExchangeRatesFlow,
  startFiatToCryptoFlow,
  processFiatToCryptoStep,
  isUserInFiatToCryptoFlow
} from './services/exchange_rates.js';
import { 
  startCollectMoneyFlow,
  processCollectMoneyStep,
  isUserInCollectMoneyFlow
} from './services/collect_money_service.js';

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
        const timestamp = message.timestamp;
        const messageId = message.id;
        
        let messageText = '';
        let isDocument = false;
        
        // Handle different message types
        if (message.text && message.text.body) {
          messageText = message.text.body;
        } else if (message.document) {
          // Handle document upload (PDF)
          messageText = message.document.filename || 'document';
          isDocument = true;
          logger.info(`Received document from ${from}: ${messageText}`);
          
          // Download the document
          try {
            const documentUrl = message.document.url;
            const accessToken = process.env.META_ACCESS_TOKEN;
            
            const response = await fetch(documentUrl, {
              headers: {
                'Authorization': `Bearer ${accessToken}`
              }
            });
            
            if (response.ok) {
              const pdfBuffer = await response.arrayBuffer();
              // Store the PDF buffer for processing
              await redisClient.setEx(`pdf_${from}`, 300, Buffer.from(pdfBuffer).toString('base64'));
              logger.info(`PDF stored for ${from}`);
            }
          } catch (error) {
            logger.error(`Error downloading PDF: ${error.message}`);
          }
        } else {
          logger.warn(`Unsupported message type from ${from}:`, JSON.stringify(message, null, 2));
          messageText = '';
        }
        
        // // Check if we've already processed this message (deduplication)
        // if (await isMessageProcessed(messageId)) {
        //   logger.info(`Message ${messageId} already processed, skipping duplicate`);
        //   return;
        // }
        
        logger.info(`Processing new message ${messageId} from ${from}: ${messageText}`);
        
        // Process message and generate response
        const response = await processMessage(from, messageText, isDocument);
        
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
async function detectMoneyIntent(messageText) {
  try {
    const prompt = MONEY_INTENT_PROMPT.replace('{message}', messageText);
    const aiResponse = await getOpenaiResponse('gpt-4o-mini', false, [
      { role: 'system', content: prompt }
    ]);
    return aiResponse.choices[0].message.content.trim();
  } catch (error) {
    logger.error(`Error detecting money intent: ${error.message}`);
    return 'GENERAL_QUERY';
  }
}

// Handle user verification for money transfer/collection
async function handleUserVerification(from, messageText) {
  try {
    // Check if this is an email verification request
    const emailMatch = messageText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
    
    if (emailMatch) {
      const email = emailMatch[0];
      logger.info(`User ${from} provided email: ${email}`);
      
      // Check if user exists
      const userExistsResult = await userExists(redisClient, email);
      
      if (userExistsResult) {
        // User exists, get their data
        const userData = await getUserData(redisClient, email);
        const fullName = await getUserFullName(redisClient, email);
        
        if (userData) {
          // Store user context for this session
          const userContext = {
            email: email,
            userId: userData.userId,
            userType: userData.userType,
            fullName: fullName
          };
          
          await redisClient.setEx(`user_context:${from}`, 3600, JSON.stringify(userContext));
          logger.info(`User context set for ${from}: ${JSON.stringify(userContext)}`);
          
          // Get the stored money intent to continue with the original request
          const storedIntent = await redisClient.get(`money_intent:${from}`);
          logger.info(`Retrieved stored money intent for ${from}: ${storedIntent}`);
          
          if (storedIntent === 'COLLECT_MONEY') {
            // Continue with collect money flow
            await redisClient.del(`money_intent:${from}`); // Clear the stored intent
            const collectMoneyResponse = await startCollectMoneyFlow(redisClient, from);
            return `👋 **Welcome back, ${fullName}!**\n\n✅ Your account is verified.\n\n${collectMoneyResponse}`;
          } else if (storedIntent === 'SEND_MONEY') {
            // Continue with send money flow
            await redisClient.del(`money_intent:${from}`); // Clear the stored intent
            const sendMoneyResponse = `💰 **Send Money Flow**\n\n👋 **Welcome, ${fullName}!**\n\nI'll help you send money! Here's what we need:\n\n1. **Recipient Details** - Who you want to send money to\n2. **Amount & Currency** - How much and in what currency\n3. **Purpose** - Reason for the transfer\n4. **Payment Method** - How you want to pay\n\n**Examples of what you can say:**\n• "I want to send 1000 PHP to John Doe for rent"\n• "Send 500 USD to my sister for birthday"\n• "Transfer 2000 INR to vendor for services"\n\n**This feature is coming soon!**\n\nFor now, you can:\n• Ask about exchange rates\n• Register another account\n• Get help with other services`;
            return `👋 **Welcome back, ${fullName}!**\n\n✅ Your account is verified.\n\n${sendMoneyResponse}`;
          } else {
            // No stored intent, show general options
            const welcomeMessage = `👋 **Welcome back, ${fullName}!**\n\n✅ Your account is verified. You can now:\n\n💰 **Send Money** - Transfer money to others\n💸 **Collect Money** - Receive money from others\n\nWhat would you like to do?`;
            return welcomeMessage;
          }
        }
      } else {
        // User doesn't exist, ask for registration type directly
        await redisClient.setEx(`registration_intent:${from}`, 300, 'pending');
        await redisClient.setEx(`user_email:${from}`, 300, email); // Store email for later use
        await redisClient.setEx(`pending_money_intent:${from}`, 300, await redisClient.get(`money_intent:${from}`)); // Store the original money intent
        
        return `❌ **Account Not Found**\n\nNo account found with email: ${email}\n\nLet me help you create an account! Are you an individual or a business?\n\nPlease respond with:\n• **"Individual"** - if this is for personal use\n• **"Business"** - if this is for company transactions\n\nOr provide a different email address if you think there's an error.`;
      }
    } else {
      // No email provided, ask for it
      return `🔐 **Account Verification Required**\n\nTo send or collect money, I need to verify your account.\n\nPlease provide your registered email address:`;
    }
  } catch (error) {
    logger.error(`Error in user verification: ${error.message}`);
    return "I'm sorry, there was an error verifying your account. Please try again.";
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



// Handle exit/cancel requests from any flow
async function handleExitRequest(from, messageText) {
  const lowerMessage = messageText.toLowerCase();
  const exitKeywords = ['exit', 'cancel', 'stop', 'quit', 'back', 'menu', 'main menu', 'help', 'no', 'nevermind', 'never mind', 'end', 'finish', 'done'];
  
  return exitKeywords.some(keyword => lowerMessage.includes(keyword));
}

// Exit from all flows and return to main menu
async function exitFromAllFlows(redisClient, from) {
  try {
    // Clear all flow states
    await redisClient.del(`user_registration:${from}`);
    await redisClient.del(`business_user_registration:${from}`);
    await redisClient.del(`collect_money:${from}`);
    await redisClient.del(`exchange_rates:${from}`);
    await redisClient.del(`fiat_to_crypto_flow:${from}`);
    await redisClient.del(`money_intent:${from}`);
    await redisClient.del(`registration_intent:${from}`);
    await redisClient.del(`registration_step:${from}`);
    await redisClient.del(`user_email:${from}`);
    await redisClient.del(`pending_money_intent:${from}`);
    
    // Clear any PDF buffers
    await redisClient.del(`pdf_${from}`);
    
    logger.info(`Exited from all flows for user ${from}`);
    
    return `✅ **Exited Successfully!**\n\nYou're back to the main menu. How can I help you today?\n\n💸 **Money Services:**\n• Say "I want to send money" to start sending money\n• Say "I want to collect money" to start collecting money\n\n💱 **Exchange Rates:**\n• Ask about 'live rates' or 'exchange rates' (vs USD)\n• Say "fiat to crypto" or "convert to crypto" for cryptocurrency quotes\n\n📝 **Registration:**\n• Say "register" to create an individual account\n• Say "register business" to create a business account\n\n💡 **Examples:**\n• "I want to send 1000 PHP to John for rent"\n• "I want to collect money" (then upload PDF)\n• "What are the live rates for PHP?"\n• "I want to know exchange from fiat to crypto"\n\n🚪 **Tip:** You can type \`exit\`, \`cancel\`, \`stop\`, \`quit\`, \`back\`, \`menu\`, \`no\`, \`nevermind\`, \`end\`, \`finish\`, or \`done\` at any time to return here.`;
  } catch (error) {
    logger.error(`Error exiting from flows: ${error.message}`);
    return "I'm sorry, there was an error. Please try again.";
  }
}

// Process incoming message and generate AI response
async function processMessage(from, messageText, isDocument = false) {
  try {
    // IMMEDIATE CHECK: Check if user is in fiat-to-crypto flow first
    const isInFiatToCryptoFlow = await isUserInFiatToCryptoFlow(redisClient, from);
    logger.info(`User ${from} IMMEDIATE fiat-to-crypto flow check: ${isInFiatToCryptoFlow}`);
    
    if (isInFiatToCryptoFlow) {
      logger.info(`User ${from} is in fiat-to-crypto flow, processing step immediately`);
      // Check for exit request first
      if (await handleExitRequest(from, messageText)) {
        const exitResponse = await exitFromAllFlows(redisClient, from);
        await addToConversationHistory(from, {
          role: 'assistant',
          content: exitResponse
        });
        return exitResponse;
      }
      
      const response = await processFiatToCryptoStep(redisClient, from, messageText);
      if (response) {
        logger.info(`Fiat-to-crypto step response: ${response.substring(0, 100)}...`);
        await addToConversationHistory(from, {
          role: 'assistant',
          content: response
        });
        return response;
      } else {
        logger.warn(`No response from fiat-to-crypto step for ${from}`);
      }
    }
    
    // Check if user is in individual registration flow
    if (await isUserInRegistration(redisClient, from)) {
      // Check for exit request first
      if (await handleExitRequest(from, messageText)) {
        const exitResponse = await exitFromAllFlows(redisClient, from);
        await addToConversationHistory(from, {
          role: 'assistant',
          content: exitResponse
        });
        return exitResponse;
      }
      
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
      // Check for exit request first
      if (await handleExitRequest(from, messageText)) {
        const exitResponse = await exitFromAllFlows(redisClient, from);
        await addToConversationHistory(from, {
          role: 'assistant',
          content: exitResponse
        });
        return exitResponse;
      }
      
      const response = await processBusinessUserRegistrationStep(redisClient, from, messageText);
      if (response) {
        await addToConversationHistory(from, {
          role: 'assistant',
          content: response
        });
        return response;
      }
    }
    
    // Check if user is in collect money flow (PRIORITY CHECK - before intent detection)
    if (await isUserInCollectMoneyFlow(redisClient, from)) {
      logger.info(`User ${from} is in collect money flow`);
      
      // Check for exit request first (but not for document uploads)
      if (!isDocument && await handleExitRequest(from, messageText)) {
        const exitResponse = await exitFromAllFlows(redisClient, from);
        await addToConversationHistory(from, {
          role: 'assistant',
          content: exitResponse
        });
        return exitResponse;
      }
      
      let userInput = messageText;
      
      // If it's a document, get the PDF buffer from Redis
      if (isDocument) {
        const pdfBase64 = await redisClient.get(`pdf_${from}`);
        if (pdfBase64) {
          userInput = Buffer.from(pdfBase64, 'base64');
          await redisClient.del(`pdf_${from}`); // Clean up
          logger.info(`PDF buffer retrieved for ${from}`);
        }
      }
      
      logger.info(`Processing collect money step for ${from} with input: ${typeof userInput === 'string' ? userInput : 'Buffer'}`);
      const response = await processCollectMoneyStep(redisClient, from, userInput, isDocument);
      if (response) {
        logger.info(`Collect money step response: ${response.substring(0, 100)}...`);
        await addToConversationHistory(from, {
          role: 'assistant',
          content: response
        });
        return response;
      } else {
        logger.warn(`No response from collect money step for ${from}`);
      }
    }
    
    // Check for registration commands
    const lowerMessage = messageText.toLowerCase();
    if (lowerMessage.includes('register') || lowerMessage.includes('signup') || lowerMessage.includes('create account')) {
      // Ask user to choose between individual or business
      const response = "👋 **Welcome!**\n\nI'd be happy to help you register! Before we proceed, I need to know:\n\n**Are you an individual or a business?**\n\nPlease respond with:\n• **\"Individual\"** - if this is for personal use\n• **\"Business\"** - if this is for company transactions\n\nThis helps me set up the right type of account for you.";
      
      // Store registration intent
      await redisClient.setEx(`registration_intent:${from}`, 300, 'pending');
      
      await addToConversationHistory(from, {
        role: 'assistant',
        content: response
      });
      return response;
    }
    
    // Check if user is responding to registration type question
    const registrationIntent = await redisClient.get(`registration_intent:${from}`);
    if (registrationIntent === 'pending') {
      // Check for exit request first
      if (await handleExitRequest(from, messageText)) {
        const exitResponse = await exitFromAllFlows(redisClient, from);
        await addToConversationHistory(from, {
          role: 'assistant',
          content: exitResponse
        });
        return exitResponse;
      }
      
      const lowerResponse = messageText.toLowerCase();
      
      // Check if user provided an email instead of choosing individual/business
      const emailMatch = messageText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
      if (emailMatch) {
        // User provided a different email, check it
        const email = emailMatch[0];
        const userExistsResult = await userExists(redisClient, email);
        
        if (userExistsResult) {
          // User exists with this new email
          const userData = await getUserData(redisClient, email);
          const fullName = await getUserFullName(redisClient, email);
          
          if (userData) {
            // Store user context for this session
            const userContext = {
              email: email,
              userId: userData.userId,
              userType: userData.userType,
              fullName: fullName
            };
            
            await redisClient.setEx(`user_context:${from}`, 3600, JSON.stringify(userContext));
            
            // Check for stored money intent before clearing
            const storedIntent = await redisClient.get(`money_intent:${from}`);
            logger.info(`Retrieved stored money intent for ${from}: ${storedIntent}`);
            
            // Clear registration intent
            await redisClient.del(`registration_intent:${from}`);
            await redisClient.del(`user_email:${from}`);
            
            if (storedIntent === 'COLLECT_MONEY') {
              // Continue with collect money flow
              await redisClient.del(`money_intent:${from}`); // Clear the stored intent
              const collectMoneyResponse = await startCollectMoneyFlow(redisClient, from);
              const response = `👋 **Welcome back, ${fullName}!**\n\n✅ Your account is verified.\n\n${collectMoneyResponse}`;
              await addToConversationHistory(from, {
                role: 'assistant',
                content: response
              });
              return response;
            } else if (storedIntent === 'SEND_MONEY') {
              // Continue with send money flow
              await redisClient.del(`money_intent:${from}`); // Clear the stored intent
              const sendMoneyResponse = `💰 **Send Money Flow**\n\n👋 **Welcome, ${fullName}!**\n\nI'll help you send money! Here's what we need:\n\n1. **Recipient Details** - Who you want to send money to\n2. **Amount & Currency** - How much and in what currency\n3. **Purpose** - Reason for the transfer\n4. **Payment Method** - How you want to pay\n\n**Examples of what you can say:**\n• "I want to send 1000 PHP to John Doe for rent"\n• "Send 500 USD to my sister for birthday"\n• "Transfer 2000 INR to vendor for services"\n\n**This feature is coming soon!**\n\nFor now, you can:\n• Ask about exchange rates\n• Register another account\n• Get help with other services`;
              const response = `👋 **Welcome back, ${fullName}!**\n\n✅ Your account is verified.\n\n${sendMoneyResponse}`;
              await addToConversationHistory(from, {
                role: 'assistant',
                content: response
              });
              return response;
            } else {
              // No stored intent, show general options
              const welcomeMessage = `👋 **Welcome back, ${fullName}!**\n\n✅ **Your account is verified!**\n\nYou can now:\n\n💰 **Send Money** - Transfer money to others\n💸 **Collect Money** - Receive money from others\n\nWhat would you like to do?`;
              await addToConversationHistory(from, {
                role: 'assistant',
                content: welcomeMessage
              });
              return welcomeMessage;
            }
          }
        } else {
          // Still no account found with new email, ask again for individual/business
          await redisClient.setEx(`user_email:${from}`, 300, email); // Update stored email
          
          const response = `❌ **Account Not Found**\n\nNo account found with email: ${email} either.\n\nLet me help you create an account! Are you an individual or a business?\n\nPlease respond with:\n• **"Individual"** - if this is for personal use\n• **"Business"** - if this is for company transactions`;
          
          await addToConversationHistory(from, {
            role: 'assistant',
            content: response
          });
          return response;
        }
      }
      
      if (lowerResponse.includes('individual') || lowerResponse.includes('personal') || lowerResponse.includes('person')) {
        // User chose individual registration, start it directly
        const response = await startUserRegistration(redisClient, from);
        // Clear registration intent
        await redisClient.del(`registration_intent:${from}`);
        await redisClient.del(`user_email:${from}`);
        
        await addToConversationHistory(from, {
          role: 'assistant',
          content: response
        });
        return response;
        
      } else if (lowerResponse.includes('business') || lowerResponse.includes('company') || lowerResponse.includes('corporate')) {
        // User chose business registration, start it directly
        const response = await startBusinessUserRegistration(redisClient, from);
        // Clear registration intent
        await redisClient.del(`registration_intent:${from}`);
        await redisClient.del(`user_email:${from}`);
        
        await addToConversationHistory(from, {
          role: 'assistant',
          content: response
        });
        return response;
        
      } else {
        // Invalid response, ask again
        const storedEmail = await redisClient.get(`user_email:${from}`);
        const emailText = storedEmail ? ` with email: ${storedEmail}` : '';
        
        const response = `❌ **Invalid Selection**\n\nNo account found${emailText}.\n\nPlease respond with either:\n• **"Individual"** - for personal use\n• **"Business"** - for company transactions\n\nWhat type of account do you want to create?`;
        
        await addToConversationHistory(from, {
          role: 'assistant',
          content: response
        });
        return response;
      }
    }
    
    // Check if user is in email check step for registration
    const registrationStep = await redisClient.get(`registration_step:${from}`);
    if (registrationStep === 'email_check') {
      // Check for exit request first
      if (await handleExitRequest(from, messageText)) {
        const exitResponse = await exitFromAllFlows(redisClient, from);
        await addToConversationHistory(from, {
          role: 'assistant',
          content: exitResponse
        });
        return exitResponse;
      }
      
      const emailMatch = messageText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
      
      if (emailMatch) {
        const email = emailMatch[0];
        const registrationType = await redisClient.get(`registration_intent:${from}`);
        
        // Check if user already exists
        const userExistsResult = await userExists(redisClient, email);
        
        if (userExistsResult) {
          // User exists, get their data and welcome them
          const userData = await getUserData(redisClient, email);
          const fullName = await getUserFullName(redisClient, email);
          
          if (userData) {
            // Store user context for this session
            const userContext = {
              email: email,
              userId: userData.userId,
              userType: userData.userType,
              fullName: fullName
            };
            
            await redisClient.setEx(`user_context:${from}`, 3600, JSON.stringify(userContext));
            
            // Check for stored money intent before clearing
            const storedIntent = await redisClient.get(`money_intent:${from}`);
            logger.info(`Retrieved stored money intent for ${from}: ${storedIntent}`);
            
            // Clear registration intent and step
            await redisClient.del(`registration_intent:${from}`);
            await redisClient.del(`registration_step:${from}`);
            
            if (storedIntent === 'COLLECT_MONEY') {
              // Continue with collect money flow
              await redisClient.del(`money_intent:${from}`); // Clear the stored intent
              const collectMoneyResponse = await startCollectMoneyFlow(redisClient, from);
              const response = `👋 **Welcome back, ${fullName}!**\n\n✅ Your account is verified.\n\n${collectMoneyResponse}`;
              await addToConversationHistory(from, {
                role: 'assistant',
                content: response
              });
              return response;
            } else if (storedIntent === 'SEND_MONEY') {
              // Continue with send money flow
              await redisClient.del(`money_intent:${from}`); // Clear the stored intent
              const sendMoneyResponse = `💰 **Send Money Flow**\n\n👋 **Welcome, ${fullName}!**\n\nI'll help you send money! Here's what we need:\n\n1. **Recipient Details** - Who you want to send money to\n2. **Amount & Currency** - How much and in what currency\n3. **Purpose** - Reason for the transfer\n4. **Payment Method** - How you want to pay\n\n**Examples of what you can say:**\n• "I want to send 1000 PHP to John Doe for rent"\n• "Send 500 USD to my sister for birthday"\n• "Transfer 2000 INR to vendor for services"\n\n**This feature is coming soon!**\n\nFor now, you can:\n• Ask about exchange rates\n• Register another account\n• Get help with other services`;
              const response = `👋 **Welcome back, ${fullName}!**\n\n✅ Your account is verified.\n\n${sendMoneyResponse}`;
              await addToConversationHistory(from, {
                role: 'assistant',
                content: response
              });
              return response;
            } else {
              // No stored intent, show general options
              const welcomeMessage = `👋 **Welcome back, ${fullName}!**\n\n✅ **You already have an account!**\n\nYour account is verified. You can now:\n\n💰 **Send Money** - Transfer money to others\n💸 **Collect Money** - Receive money from others\n\nWhat would you like to do?`;
              await addToConversationHistory(from, {
                role: 'assistant',
                content: welcomeMessage
              });
              return welcomeMessage;
            }
          }
                } else {
          // User doesn't exist, start registration flow
          if (registrationType === 'individual') {
        const response = await startUserRegistration(redisClient, from);
            // Clear registration intent and step
            await redisClient.del(`registration_intent:${from}`);
            await redisClient.del(`registration_step:${from}`);
            await redisClient.del(`user_email:${from}`); // Clear stored email
            
            await addToConversationHistory(from, {
              role: 'assistant',
              content: response
            });
            return response;
          } else if (registrationType === 'business') {
            const response = await startBusinessUserRegistration(redisClient, from);
            // Clear registration intent and step
            await redisClient.del(`registration_intent:${from}`);
            await redisClient.del(`registration_step:${from}`);
            await redisClient.del(`user_email:${from}`); // Clear stored email
            
            await addToConversationHistory(from, {
              role: 'assistant',
              content: response
            });
            return response;
          }
        }
      } else {
        // No valid email provided
        const response = "❌ **Invalid Email Format**\n\nPlease provide a valid email address (e.g., user@example.com):";
        
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
      
      // Check if user has verified context and is making a new money request
      const userContext = await redisClient.get(`user_context:${from}`);
      logger.info(`User ${from} user context: ${userContext ? 'exists' : 'none'}`);
      let moneyIntent = null;
      
       if (userContext) {
         // User is verified, check for new money intent
         logger.info(`Verified user ${from} detected, checking for money intent in message: "${messageText}"`);
         try {
           moneyIntent = await detectMoneyIntent(messageText);
           logger.info(`OpenAI detected money intent for verified user: ${moneyIntent} for message: "${messageText}"`);
         } catch (error) {
           logger.error(`OpenAI intent detection failed: ${error.message}`);
           moneyIntent = null; // Force fallback detection
         }
         
         // Fallback to simple keyword detection if OpenAI fails
         if (!moneyIntent || !['SEND_MONEY', 'COLLECT_MONEY', 'GENERAL_QUERY'].includes(moneyIntent)) {
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
           } else {
             moneyIntent = 'GENERAL_QUERY';
           }
           
           logger.info(`Fallback detected money intent for verified user: ${moneyIntent} for message: "${messageText}"`);
         }
       } else {
        // No user context, check for money intent as before
        try {
          moneyIntent = await detectMoneyIntent(messageText);
          logger.info(`OpenAI detected money intent: ${moneyIntent} for message: "${messageText}"`);
        } catch (error) {
          logger.error(`OpenAI intent detection failed: ${error.message}`);
          moneyIntent = null; // Force fallback detection
        }
        
        // Fallback to simple keyword detection if OpenAI fails or returns unexpected result
        if (!moneyIntent || !['SEND_MONEY', 'COLLECT_MONEY', 'GENERAL_QUERY'].includes(moneyIntent)) {
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
          } else {
            moneyIntent = 'GENERAL_QUERY';
          }
          
          logger.info(`Fallback detected money intent: ${moneyIntent} for message: "${messageText}"`);
        }
      }
      
      if (moneyIntent === 'SEND_MONEY' || moneyIntent === 'COLLECT_MONEY') {
        logger.info(`Processing ${moneyIntent} intent for user ${from}`);
        
        // Always ask for email first for money flows
        const verificationMessage = `🔐 **Account Verification Required**\n\nTo ${moneyIntent === 'SEND_MONEY' ? 'send money' : 'collect money'}, I need to verify your account.\n\nPlease provide your registered email address:`;
        
        // Store the intent in Redis for the next response
        await redisClient.setEx(`money_intent:${from}`, 300, moneyIntent); // 5 minutes expiry
        
        await addToConversationHistory(from, {
          role: 'assistant',
          content: verificationMessage
        });
        return verificationMessage;
      } else {
        logger.info(`User ${from} money intent: ${moneyIntent} (not requiring verification)`);
      }
    } else {
      // User has a stored intent, check if they're responding to the email verification
      if (await handleExitRequest(from, messageText)) {
        // User wants to exit/cancel the money request
        const exitResponse = await exitFromAllFlows(redisClient, from);
        await addToConversationHistory(from, {
          role: 'assistant',
          content: exitResponse
        });
        return exitResponse;
      } else {
        // Process email verification
        const verificationResponse = await handleUserVerification(from, messageText);
        
        await addToConversationHistory(from, {
          role: 'assistant',
          content: verificationResponse
        });
        return verificationResponse;
      }
    }
    
    // Check for other commands
    if (lowerMessage === 'help' || lowerMessage === 'commands') {
      const helpResponse = `🤖 **WhatsApp Bot Commands:**

💸 **Money Services:**
• Say "I want to send money" - Start send money process
• Say "I want to collect money" - Start collect money process (upload PDF + create order)

💱 **Exchange Rates:**
• Ask about "live rates" or "exchange rates" - Get currency rates vs USD
• Say "fiat to crypto" or "convert to crypto" - Get fiat-to-cryptocurrency quotes
• Say "I want to know exchange from fiat to crypto" - Get cryptocurrency conversion rates

📝 **Registration:**
• \`register\` - Start individual user registration
• \`register business\` - Start business user registration
• \`status\` - Check your registration progress
• \`reset\` - Reset your current registration

🚪 **Exit Commands:**
• \`exit\`, \`cancel\`, \`stop\`, \`quit\`, \`back\`, \`menu\`, \`no\`, \`nevermind\`, \`end\`, \`finish\`, \`done\` - Exit from any flow and return to main menu

📋 **Other Commands:**
• \`help\` - Show this help message

💡 **Examples:**
• Say "I want to send money" to start the process
• Say "I want to collect money" to start the process
• Ask "What are the live rates for PHP?" for exchange rates vs USD
• Say "fiat to crypto" to get cryptocurrency quotes
• Say "I want to know exchange from fiat to crypto" for crypto conversion rates
• Type \`register\` for direct registration
• Type \`exit\` at any time to return to main menu

📄 **Collect Money Flow:**
1. Upload PDF invoice
2. Provide all order details in one message (amount, currency, purpose code, etc.)
3. Order created + payment link sent!

💡 **Money Flow Examples:**
**Send Money:**
• "I want to send 1000 PHP to John Doe for rent"
• "Send 500 USD to my sister for birthday"
• "Transfer 2000 INR to vendor for services"

**Collect Money:**
• Upload PDF invoice first
• Then provide: amount, currency, purpose, payment type, etc.
• All in one message, one value per line`;
      
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
      // Check for exit request first
      if (await handleExitRequest(from, messageText)) {
        const exitResponse = await exitFromAllFlows(redisClient, from);
        await addToConversationHistory(from, {
          role: 'assistant',
          content: exitResponse
        });
        return exitResponse;
      }
      
      const response = await processExchangeRatesStep(redisClient, from, messageText);
      if (response) {
        await addToConversationHistory(from, {
          role: 'assistant',
          content: response
        });
        return response;
      }
    }
    

    
    // Check for exchange rates intent using OpenAI - handle directly without email verification
    const exchangeRatesIntent = await detectExchangeRatesIntent(messageText);
    logger.info(`User ${from} exchange rates intent: ${exchangeRatesIntent}`);
    
    if (exchangeRatesIntent === 'EXCHANGE_RATES') {
      // Check if this is actually a fiat-to-crypto request
      const lowerMessage = messageText.toLowerCase();
      logger.info(`User ${from} message contains fiat: ${lowerMessage.includes('fiat')}, crypto: ${lowerMessage.includes('crypto')}`);
      
      if (lowerMessage.includes('fiat') && lowerMessage.includes('crypto')) {
        // This is a fiat-to-crypto request, not a regular exchange rate request
        logger.info(`User ${from} starting fiat-to-crypto flow`);
        const response = await startFiatToCryptoFlow(redisClient, from);
        await addToConversationHistory(from, {
          role: 'assistant',
          content: response
        });
        return response;
      } else {
        // Regular exchange rates request
        logger.info(`User ${from} starting regular exchange rates flow`);
        const response = await startExchangeRatesFlow(redisClient, from, messageText);
        await addToConversationHistory(from, {
          role: 'assistant',
          content: response
        });
        return response;
      }
    }
    
    // Check for fiat-to-crypto intent
    const fiatCryptoMessage = messageText.toLowerCase();
    logger.info(`User ${from} checking fiat-to-crypto keywords in message: "${messageText}"`);
    
    if (fiatCryptoMessage.includes('fiat to crypto') || fiatCryptoMessage.includes('convert to crypto') || 
        fiatCryptoMessage.includes('fiat to cryptocurrency') || fiatCryptoMessage.includes('crypto quote') ||
        fiatCryptoMessage.includes('cryptocurrency quote') || fiatCryptoMessage.includes('fiat crypto') ||
        fiatCryptoMessage.includes('exchange from fiat to crypto') || fiatCryptoMessage.includes('exchange fiat to crypto') ||
        fiatCryptoMessage.includes('fiat to crypto exchange') || fiatCryptoMessage.includes('crypto exchange rate') ||
        fiatCryptoMessage.includes('fiat crypto exchange') || fiatCryptoMessage.includes('convert fiat to crypto')) {
      logger.info(`User ${from} fiat-to-crypto keywords detected, starting flow`);
      const response = await startFiatToCryptoFlow(redisClient, from);
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
    let aiResponse = "Thank you for your message! I'm a WhatsApp financial services bot. How can I help you today?\n\n💸 **Money Services:**\n• Say \"I want to send money\" to start sending money\n• Say \"I want to collect money\" to start collecting money\n\n💱 **Exchange Rates:**\n• Ask about 'live rates' or 'exchange rates' (vs USD)\n• Say \"fiat to crypto\" or \"convert to crypto\" for cryptocurrency quotes\n\n📝 **Direct Registration:**\n• Type 'register' for individual account\n• Type 'register business' for business account\n\n💡 **Examples:**\n• \"I want to send 1000 PHP to John for rent\"\n• \"I want to collect money\" (then upload PDF)\n• \"What are the live rates for PHP?\"\n• \"I want to know exchange from fiat to crypto\"\n\nType 'help' for more commands!";
    
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

// Debug endpoint to check fiat-to-crypto flow state
app.get('/debug/fiat-to-crypto/:whatsappNumber', async (req, res) => {
  try {
    const whatsappNumber = req.params.whatsappNumber;
    const state = await getFiatToCryptoState(redisClient, whatsappNumber);
    
    res.status(200).json({
      success: true,
      whatsappNumber,
      state,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error(`Error in fiat-to-crypto debug endpoint: ${error.message}`);
    res.status(500).json({
      error: 'Failed to get fiat-to-crypto state',
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