import OpenAI from 'openai';
import { SUMMARY_PROMPT } from '../prompts/prompts.js';

// Lazy initialization of OpenAI client
let openai = null;

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
    
    return response;
  } catch (error) {
    console.error(`Error calling OpenAI API: ${error.message}`);
    throw error;
  }
}

/**
 * Summarize conversation history in one sentence
 * @param {Array} history - Conversation history
 * @returns {Promise<string>} Summary of conversation
 */
async function summariseConversation(history) {
  try {
    let conversation = "";
    
    // Take last 70 messages to avoid token limits
    const recentHistory = history.slice(-7);
    
    for (const item of recentHistory) {
      if (item.role === 'user') {
        conversation += `User: ${item.content} `;
      } else if (item.role === 'assistant') {
        conversation += `Bot: ${item.content} `;
      }
    }

    const openaiResponse = await getOpenaiResponse(
      "gpt-3.5-turbo-0125",
      false,
      [
        { role: 'system', content: SUMMARY_PROMPT }, 
        { role: 'user', content: conversation }
      ]
    );

    return openaiResponse.choices[0].message.content.trim();
  } catch (error) {
    console.error(`Error summarizing conversation: ${error.message}`);
    return "No previous conversation context available.";
  }
}

export {
  getOpenaiResponse,
  summariseConversation
}; 