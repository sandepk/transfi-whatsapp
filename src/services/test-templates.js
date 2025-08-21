#!/usr/bin/env node

/**
 * Test script for WhatsApp Template Bot
 * Run with: node src/test-templates.js
 */

import dotenv from 'dotenv';
import { createTemplate, getTemplates, deleteTemplate, sendTemplateMessage, TEMPLATE_EXAMPLES } from '../utils/template_utils.js';
import { logger } from '../utils/logger_utils.js';

// Load environment variables
dotenv.config();

async function testTemplates() {
  try {
    logger.info('Starting WhatsApp Template Bot tests...');
    
    // Test 1: Create a welcome template
    logger.info('Test 1: Creating welcome template...');
    const welcomeTemplate = await createTemplate(TEMPLATE_EXAMPLES.welcome);
    logger.info(`✅ Welcome template created: ${welcomeTemplate.id}`);
    
    // Test 2: Create an order confirmation template
    logger.info('Test 2: Creating order confirmation template...');
    const orderTemplate = await createTemplate(TEMPLATE_EXAMPLES.orderConfirmation);
    logger.info(`✅ Order template created: ${orderTemplate.id}`);
    
    // Test 3: List all templates
    logger.info('Test 3: Fetching all templates...');
    const allTemplates = await getTemplates();
    logger.info(`✅ Found ${allTemplates.data?.length || 0} templates`);
    
    // Test 4: Send a template message (if phone number is configured)
    if (process.env.TEST_PHONE_NUMBER) {
      logger.info('Test 4: Sending template message...');
      const messageResult = await sendTemplateMessage(
        process.env.TEST_PHONE_NUMBER,
        'welcome_message',
        [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: 'Test User'
              }
            ]
          }
        ]
      );
      logger.info(`✅ Template message sent: ${messageResult.messages[0].id}`);
    } else {
      logger.info('Test 4: Skipped (TEST_PHONE_NUMBER not configured)');
    }
    
    // Test 5: Clean up - delete test templates
    logger.info('Test 5: Cleaning up test templates...');
    await deleteTemplate(welcomeTemplate.id);
    await deleteTemplate(orderTemplate.id);
    logger.info('✅ Test templates cleaned up');
    
    logger.info('🎉 All tests completed successfully!');
    
  } catch (error) {
    logger.error(`❌ Test failed: ${error.message}`);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testTemplates();
}

export { testTemplates }; 