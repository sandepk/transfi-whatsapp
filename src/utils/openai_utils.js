import OpenAI from 'openai';

// Lazy initialization of OpenAI client
let openai = null;

// Rate limiting variables
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 5; // 5 milli seconds 

function getOpenAIClient() {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    
    openai = new OpenAI({
      apiKey: apiKey
    });
  }
  return openai;
}

// Constants
const TEMPERATURE = 0.1;
const MAX_TOKENS = 35;
const STOP_SEQUENCES = ["==="];
const TOP_P = 1;
const TOP_K = 1;
const BEST_OF = 1;
const FREQUENCY_PENALTY = 0;
const PRESENCE_PENALTY = 0;

const SUPPORTED_MODELS = [
  // Groq Llama models
  "groq/llama3-8b-8192", 
  "groq/llama-3.1-8b-instant", 
  "groq/llama-3.1-70b-versatile", 
  // OpenAI models
  "gpt-3.5-turbo-0125",
  "gpt-4o", 
  "gpt-4o-mini",
  "gpt-4-0125-preview",
  // Amazon Anthropic models
  "bedrock/anthropic.claude-3-sonnet-20240229-v1:0",
  "bedrock/anthropic.claude-3-opus-20240229-v1:0",
  "bedrock/anthropic.claude-v2:1"
];

/**
 * GPT model without function call
 * @param {string} model - The model to use
 * @param {boolean} stream - Whether to stream the response
 * @param {Array} messages - Array of message objects
 * @returns {Promise<Object>} OpenAI response
 */
async function getOpenaiResponse(model, stream = false, messages = []) {
  if (!SUPPORTED_MODELS.includes(model)) {
    throw new Error(`Model ${model} is not supported`);
  }

  try {
    // Rate limiting check
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
      console.log(`Rate limit: Waiting ${waitTime}ms before next request`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    const client = getOpenAIClient();
    const response = await client.chat.completions.create({
      model: model,
      messages: messages,
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      top_p: TOP_P,
      frequency_penalty: FREQUENCY_PENALTY,
      presence_penalty: PRESENCE_PENALTY,
      stream: stream
    });
    
    // Update last request time
    lastRequestTime = Date.now();
    
    return response;
  } catch (error) {
    console.error(`Error calling OpenAI API: ${error.message}`);
    
    // Handle rate limit errors specifically
    if (error.message.includes('429') || error.message.includes('Rate limit')) {
      console.log('Rate limit hit, waiting 20 seconds before retry...');
      await new Promise(resolve => setTimeout(resolve, 20000));
      // Retry once
      return getOpenaiResponse(model, stream, messages);
    }
    
    throw error;
  }
}



export {
  getOpenaiResponse
}; 