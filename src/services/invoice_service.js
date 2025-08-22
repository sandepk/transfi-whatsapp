import { logger } from '../utils/logger_utils.js';
import FormDataNode from 'form-data';

// Create invoice by uploading PDF
export async function createInvoice(pdfBuffer, email) {
  try {
    const apiKey = process.env.TRANSFI_BASIC_API_KEY;
    
    logger.info(`Environment check - TRANSFI_BASIC_API_KEY exists: ${!!apiKey}`);
    logger.info(`Environment check - TRANSFI_BASIC_API_KEY length: ${apiKey ? apiKey.length : 0}`);
    logger.info(`Environment check - TRANSFI_BASIC_API_KEY first 10 chars: ${apiKey ? apiKey.substring(0, 10) : 'undefined'}`);
    logger.info(`Environment check - TRANSFI_BASIC_API_KEY last 10 chars: ${apiKey ? apiKey.substring(apiKey.length - 10) : 'undefined'}`);
    
    if (!apiKey) {
      throw new Error('Missing required environment variable: TRANSFI_BASIC_API_KEY');
    }

    // Validate PDF buffer
    if (!pdfBuffer) {
      throw new Error('No PDF buffer provided');
    }

    // Convert to Buffer if needed
    if (!Buffer.isBuffer(pdfBuffer)) {
      if (typeof pdfBuffer === 'string') {
        // If it's base64 encoded
        pdfBuffer = Buffer.from(pdfBuffer, 'base64');
      } else {
        pdfBuffer = Buffer.from(pdfBuffer);
      }
      logger.info(`Converted PDF data to Buffer: ${pdfBuffer.length} bytes`);
    }

    // Quick validation - check if it looks like a PDF (more flexible)
    const pdfHeader = pdfBuffer.slice(0, 8).toString('ascii');
    if (!pdfHeader.includes('%PDF')) {
      logger.warn(`PDF header validation failed. Header: ${pdfHeader}`);
      // Don't throw error, just log warning - some PDFs might have different headers
    }

    if (!email || typeof email !== 'string') {
      throw new Error('Invalid email provided');
    }

    logger.info(`Creating invoice for email: ${email} with PDF buffer size: ${pdfBuffer.length} bytes`);
    logger.info(`PDF buffer first 16 bytes: ${pdfBuffer.slice(0, 16).toString('hex')}`);

    // Try using native FormData first, fallback to form-data package
    let form;
    let isNativeFormData = false;
    
    try {
      // Try native FormData (Node.js 18+)
      form = new FormData();
      form.append('invoiceType', 'invoice');
      form.append('direction', 'deposit');
      form.append('email', email);
      form.append('invoice', new Blob([pdfBuffer], { type: 'application/pdf' }), 'invoice.pdf');
      isNativeFormData = true;
      logger.info('Using native FormData');
    } catch (error) {
      // Fallback to form-data package with better error handling
      logger.info(`Native FormData failed: ${error.message}, using form-data package`);
      try {
        form = new FormDataNode();
        form.append('invoiceType', 'invoice');
        form.append('direction', 'deposit');
        form.append('email', email);
        form.append('invoice', pdfBuffer, {
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          knownLength: pdfBuffer.length
        });
        isNativeFormData = false;
        logger.info('Successfully created form with form-data package');
      } catch (formError) {
        logger.error(`Both FormData methods failed: ${formError.message}`);
        throw new Error('Failed to create form data for file upload');
      }
    }
    
    logger.info(`Form data created successfully with ${pdfBuffer.length} bytes`);
    
    // Handle headers differently for native vs package FormData
    let headers = {
      'Authorization': `Basic ${apiKey}`,
      'Accept': 'application/json'
    };
    
    if (!isNativeFormData) {
      // For form-data package, get headers
      const formHeaders = form.getHeaders();
      headers = { ...headers, ...formHeaders };
      logger.info(`Using form-data package headers:`, formHeaders);
    } else {
      // For native FormData, don't set Content-Type (browser/fetch will set it)
      logger.info('Using native FormData (no manual Content-Type needed)');
    }

    logger.info(`Sending request to: https://sandbox-api.transfi.com/v2/invoices/create`);

    const response = await fetch('https://sandbox-api.transfi.com/v2/invoices/create', {
      method: 'POST',
      headers: headers,
      body: form
    });

    const raw = await response.text();
    logger.info(`Invoice creation raw response: ${raw}`);
    
    let responseData;
    try {
      responseData = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid API response (not JSON). Status: ${response.status}, Body: ${raw}`);
    }

    logger.info(`Invoice creation response status: ${response.status}`);
    logger.info(`Invoice creation response:`, responseData);

    if (!response.ok) {
      logger.error(`Invoice creation failed with status: ${response.status}`);
      logger.error(`Response headers:`, Object.fromEntries(response.headers.entries()));
      logger.error(`Response body:`, responseData);
      
      // Provide more specific error messages
      let errorMessage = `Invoice creation failed: ${response.status}`;
      if (responseData.message) {
        errorMessage += ` - ${responseData.message}`;
      } else if (responseData.error) {
        errorMessage += ` - ${responseData.error}`;
      } else if (responseData.detail) {
        errorMessage += ` - ${responseData.detail}`;
      }
      
      throw new Error(errorMessage);
    }

    logger.info(`Invoice created successfully: ${responseData.invoiceId}`);
    return responseData;

  } catch (error) {
    logger.error(`Error creating invoice: ${error.message}`);
    throw error;
  }
}

// Create deposit order
export async function createDepositOrder(orderData) {
  try {
    const apiKey = process.env.TRANSFI_BASIC_API_KEY;
    
    if (!apiKey) {
      throw new Error('Missing required environment variable: TRANSFI_BASIC_API_KEY');
    }

    logger.info(`Creating deposit order:`, orderData);

    const response = await fetch('https://sandbox-api.transfi.com/v2/orders/deposit', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(orderData)
    });

    const raw = await response.text();
    logger.info(`Deposit order raw response: ${raw}`);

    let responseData;
    try {
      responseData = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid API response (not JSON). Status: ${response.status}, Body: ${raw}`);
    }

    logger.info(`Deposit order response status: ${response.status}`);
    logger.info(`Deposit order response:`, responseData);

    if (!response.ok) {
      throw new Error(`Deposit order creation failed: ${responseData.message || response.statusText}`);
    }

    logger.info(`Deposit order created successfully`);
    return responseData;

  } catch (error) {
    logger.error(`Error creating deposit order: ${error.message}`);
    throw error;
  }
}
