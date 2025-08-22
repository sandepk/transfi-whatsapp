import { logger } from '../utils/logger_utils.js';
import { createInvoice, createDepositOrder } from './invoice_service.js';
import { getUserData } from '../common/redis_utils.js';

// Collect money flow configuration
export const COLLECT_MONEY_FLOW = {
  steps: [
    { field: 'pdf', question: 'Please upload your PDF invoice:', validation: 'pdf' }
  ],
  welcomeMessage: `💸 **Collect Money Flow**

I'll help you collect money! Here's what we need:

1. **Upload PDF Invoice** - Your invoice document
2. **Order Details** - All other information in one go

Please upload your PDF invoice first:`,
  bulkInputMessage: `📋 **Please provide all order details in one message:**

Please provide the following information **one value per line** in this exact order:

**Line 1:** Amount (in cents, e.g., 10000)
**Line 2:** Currency (3-letter code, e.g., PHP, USD)
**Line 3:** Purpose Code (e.g., expense_or_medical_reimbursement)
**Line 4:** Payment Type (e.g., bank_transfer)
**Line 5:** Partner ID (optional, e.g., order-1234)
**Line 6:** Payment Code (optional, e.g., bpi)

**Note:** Invoice ID will be automatically added from your uploaded PDF.

**Example (copy exactly as shown):**
10000
PHP
expense_or_medical_reimbursement
bank_transfer
order-1234
bpi

**Just provide the values, one per line:**`,
  completionMessage: "Excellent! I have all your information. Creating your deposit order now...",
  successMessage: "✅ **Deposit Order Created Successfully!**\n\nYour order has been created and a payment link has been generated."
};

// Start collect money flow
export async function startCollectMoneyFlow(redisClient, whatsappNumber) {
  const state = {
    type: 'collect_money',
    currentStep: 0,
    collectedData: {},
    startedAt: new Date().toISOString(),
    whatsappNumber: whatsappNumber
  };
  
  await setCollectMoneyState(redisClient, whatsappNumber, state);
  return COLLECT_MONEY_FLOW.welcomeMessage;
}

// Process collect money step
export async function processCollectMoneyStep(redisClient, whatsappNumber, userInput, isDocument = false) {
  try {
    const state = await getCollectMoneyState(redisClient, whatsappNumber);
    logger.info(`Collect money state for ${whatsappNumber}:`, state);
    
    if (!state || state.type !== 'collect_money') {
      logger.warn(`No valid collect money state found for ${whatsappNumber}. State:`, state);
      return null;
    }
    
    logger.info(`Processing collect money step ${state.currentStep} for ${whatsappNumber}`);
    
    // Handle PDF upload
    if (isDocument && state.currentStep === 0) {
      return await handlePdfUpload(redisClient, whatsappNumber, userInput, state);
    }
    
    // Handle bulk input for order details
    if (!isDocument && state.currentStep === 1) {
      return await handleBulkOrderInput(redisClient, whatsappNumber, userInput, state);
    }
    
    return null;
    
  } catch (error) {
    logger.error(`Error processing collect money step:`, error);
    return "I'm sorry, there was an error processing your input. Please try again.";
  }
}

// Handle PDF upload
async function handlePdfUpload(redisClient, whatsappNumber, pdfBuffer, state) {
  try {
    // Get user email from context
    const userContext = await redisClient.get(`user_context:${whatsappNumber}`);
    if (!userContext) {
      return "❌ **User Not Verified**\n\nPlease verify your account first by providing your email address.";
    }
    
    const context = JSON.parse(userContext);
    const email = context.email;
    
    logger.info(`PDF upload - Email: ${email}, Buffer type: ${typeof pdfBuffer}, Is Buffer: ${Buffer.isBuffer(pdfBuffer)}`);
    if (pdfBuffer && typeof pdfBuffer === 'object') {
      logger.info(`PDF buffer length: ${pdfBuffer.length || 'unknown'}`);
    }
    
    // Create invoice
    const invoiceResult = await createInvoice(pdfBuffer, email);
    
    // Store invoice data
    state.collectedData.invoiceId = invoiceResult.invoiceId;
    state.collectedData.pdfUrl = invoiceResult.url;
    state.currentStep = 1;
    
    await setCollectMoneyState(redisClient, whatsappNumber, state);
    
    return `✅ **PDF Uploaded Successfully!**\n\nInvoice ID: ${invoiceResult.invoiceId}\n\n${COLLECT_MONEY_FLOW.bulkInputMessage}`;
    
  } catch (error) {
    logger.error(`Error handling PDF upload: ${error.message}`);
    return `❌ **PDF Upload Failed**\n\nError: ${error.message}\n\nPlease try uploading your PDF again.`;
  }
}

// Handle bulk input for order details
async function handleBulkOrderInput(redisClient, whatsappNumber, userInput, state) {
  try {
    logger.info(`Processing bulk order input for ${whatsappNumber}: ${userInput}`);
    
    // Parse the bulk input
    const orderData = parseBulkOrderInput(userInput);
    
    if (!orderData) {
      return `❌ **Invalid Input Format**\n\nPlease provide the information in the correct format:\n\n${COLLECT_MONEY_FLOW.bulkInputMessage}`;
    }
    
    // Show what was parsed for debugging
    logger.info(`Parsed input lines:`, userInput.split('\n').filter(line => line.trim()));
    logger.info(`Parsed order data:`, orderData);
    
    // Validate the parsed data
    const validationResult = validateOrderData(orderData);
    if (!validationResult.isValid) {
      return `❌ **Validation Error**\n\n${validationResult.error}\n\nPlease provide the information in the correct format:\n\n${COLLECT_MONEY_FLOW.bulkInputMessage}`;
    }
    
    // Check if invoiceId is present (from PDF upload)
    if (!state.collectedData.invoiceId) {
      return `❌ **Missing Invoice ID**\n\nNo invoice ID found. Please upload your PDF invoice first.\n\n${COLLECT_MONEY_FLOW.bulkInputMessage}`;
    }
    
    // Store all the order data
    Object.assign(state.collectedData, orderData);
    state.currentStep = 2; // Move to completion
    
    logger.info(`Updated state with order data:`, state.collectedData);
    await setCollectMoneyState(redisClient, whatsappNumber, state);
    
    logger.info(`Calling createDepositOrderFromData for ${whatsappNumber}`);
    // Show confirmation and create order
    return await createDepositOrderFromData(redisClient, whatsappNumber, state);
    
  } catch (error) {
    logger.error(`Error handling bulk order input: ${error.message}`);
    return "I'm sorry, there was an error processing your order details. Please try again.";
  }
}

// Create deposit order from collected data
async function createDepositOrderFromData(redisClient, whatsappNumber, state) {
  try {
    // Get user email from context
    const userContext = await redisClient.get(`user_context:${whatsappNumber}`);
    const context = JSON.parse(userContext);
    const email = context.email;
    
    // Prepare order data with all available fields
    const orderData = {
      paymentType: state.collectedData.paymentType || "bank_transfer",
      amount: parseInt(state.collectedData.amount),
      currency: state.collectedData.currency.toUpperCase(),
      email: email,
      purposeCode: state.collectedData.purposeCode,
      redirectUrl: "https://www.transfi.com",
      sourceUrl: "https://transfi.com",
      invoiceId: state.collectedData.invoiceId, // From PDF upload
      headlessMode: true // Required for headless integration
    };
    
    // Add optional fields if provided
    if (state.collectedData.partnerId) {
      orderData.partnerId = state.collectedData.partnerId;
    }
    
    if (state.collectedData.paymentCode) {
      orderData.paymentCode = state.collectedData.paymentCode;
    }
    
    logger.info(`Creating deposit order with data:`, orderData);
    logger.info(`Invoice ID from PDF upload: ${state.collectedData.invoiceId}`);
    
    // Create deposit order
    const orderResult = await createDepositOrder(orderData);
    
    // Clear state
    await setCollectMoneyState(redisClient, whatsappNumber, null);
    
    // Extract payment URL from response
    const paymentUrl = orderResult.paymentUrl;
    const orderId = orderResult.orderId;
    
    return `${COLLECT_MONEY_FLOW.successMessage}\n\nOrder Details:\n• Order ID: ${orderId}\n• Amount: ${orderData.amount} ${orderData.currency}\n• Invoice ID: ${orderData.invoiceId}\n• Purpose: ${orderData.purposeCode}\n\n💳 **Payment Link:**\n${paymentUrl}\n\nClick the link above to complete your payment!`;
    
  } catch (error) {
    logger.error(`Error creating deposit order: ${error.message}`);
    return `❌ **Order Creation Failed**\n\nError: ${error.message}\n\nPlease try again or contact support.`;
  }
}

// Parse bulk order input - user provides only values, we map them
function parseBulkOrderInput(input) {
  try {
    const lines = input.split('\n').filter(line => line.trim());
    const orderData = {};
    
    // Expected order: amount, currency, purpose code, payment type, partner id (optional), payment code (optional)
    const expectedFields = ['amount', 'currency', 'purposeCode', 'paymentType', 'partnerId', 'paymentCode'];
    
    for (let i = 0; i < lines.length && i < expectedFields.length; i++) {
      const value = lines[i].trim();
      
      if (value) {
        const field = expectedFields[i];
        
        switch (field) {
          case 'amount':
            orderData.amount = parseInt(value);
            break;
          case 'currency':
            orderData.currency = value.toUpperCase();
            break;
          case 'purposeCode':
            orderData.purposeCode = value;
            break;
          case 'paymentType':
            orderData.paymentType = value;
            break;
          case 'partnerId':
            orderData.partnerId = value;
            break;
          case 'paymentCode':
            orderData.paymentCode = value;
            break;
        }
      }
    }
    
    logger.info(`Parsed order data:`, orderData);
    return orderData;
    
  } catch (error) {
    logger.error(`Error parsing bulk order input: ${error.message}`);
    return null;
  }
}

// Validate order data
function validateOrderData(orderData) {
  const errors = [];
  
  // Required fields
  if (!orderData.amount || isNaN(orderData.amount) || orderData.amount < 1) {
    errors.push('Amount must be a valid number greater than 0');
  }
  
  if (!orderData.currency || !/^[A-Z]{3}$/.test(orderData.currency)) {
    errors.push('Currency must be a valid 3-letter currency code (e.g., PHP, USD)');
  }
  
  if (!orderData.purposeCode || orderData.purposeCode.trim().length === 0) {
    errors.push('Purpose Code is required');
  }
  
  if (!orderData.paymentType || orderData.paymentType.trim().length === 0) {
    errors.push('Payment Type is required');
  }
  
  // Note: invoiceId validation is done separately since it comes from PDF upload
  
  if (errors.length > 0) {
    return {
      isValid: false,
      error: errors.join('\n')
    };
  }
  
  return { isValid: true };
}

// Redis state management functions
export async function setCollectMoneyState(redisClient, whatsappNumber, state) {
  const key = `collect_money:${whatsappNumber}`;
  if (state) {
    await redisClient.setEx(key, 1800, JSON.stringify(state)); // 30 minutes expiry
  } else {
    await redisClient.del(key);
  }
}

export async function getCollectMoneyState(redisClient, whatsappNumber) {
  const key = `collect_money:${whatsappNumber}`;
  const state = await redisClient.get(key);
  return state ? JSON.parse(state) : null;
}

export async function isUserInCollectMoneyFlow(redisClient, whatsappNumber) {
  const state = await getCollectMoneyState(redisClient, whatsappNumber);
  const isInFlow = state && state.type === 'collect_money';
  logger.info(`Checking if ${whatsappNumber} is in collect money flow: ${isInFlow}. State:`, state);
  return isInFlow;
}
