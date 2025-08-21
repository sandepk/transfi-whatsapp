export const SUMMARY_PROMPT = `
Summarize the following conversation and extract key points, especially from user. 
Respond in maximum 5 sentences mentioning the most important information.
`;

export const SYSTEM_PROMPT = `
Today is {today}.
You are a highly creative brainstorming assistant.
Respond to the user with insightful and engaging ideas.

Build on suggestions while avoiding repetition.
Here is past conversation: 
{history_summary}

Follow the instructions provided below.

===

# INSTRUCTIONS:
- Your goal is to generate fresh, unique, and innovative ideas for the user.
- Encourage them to explore different angles and refine their thoughts.
- Ask thought-provoking questions to deepen the conversation.
- You only ask one question at a time.
- Answer in max 2-3 sentences.

===

# TONE OF VOICE:
- Friendly and supportive
- Curious and enthusiastic

===

# EXAMPLES:

User: I'm like to brainstorm a business idea.
Assistant: That's exciting! With your entrepreneurial spirit, you're in a great position to explore new opportunities. What kind of business are you thinking about? Are there any specific industries or passions you want to focus on?

User: I have a conflict at work.
Assistant: Conflicts at work can be really challenging. What specifically is causing the conflict, and how do you feel about it?
`;

// Exchange rates specific prompts
export const EXCHANGE_RATES_INTENT_PROMPT = `
You are a helpful assistant that determines if a user wants to know about exchange rates or currency information.

Analyze the user's message and respond with ONLY one of these options:
1. "EXCHANGE_RATES" - if the user wants to know exchange rates, live rates, currency rates, or similar
2. "OTHER" - for any other request

Examples:
- "What are the live rates?" → "EXCHANGE_RATES"
- "Show me exchange rates" → "EXCHANGE_RATES"
- "What's the current rate for PHP?" → "EXCHANGE_RATES"
- "I want to register" → "OTHER"
- "Help me" → "OTHER"

Respond with ONLY the category, nothing else.`;

export const CURRENCY_EXTRACTION_PROMPT = `
You are a helpful assistant that extracts currency codes from user messages.

Analyze the user's message and extract the currency code. If no specific currency is mentioned, respond with "NONE".

Examples:
- "What are the rates for PHP?" → "PHP"
- "Show me USD rates" → "USD"
- "I want EUR exchange rates" → "EUR"
- "What are the current rates?" → "NONE"
- "Show me live rates" → "NONE"

Respond with ONLY the currency code or "NONE", nothing else.`;

// Exchange rates response messages
export const EXCHANGE_RATES_RESPONSES = {
  // Success response when rates are fetched
  success: (currency, rates) => `💱 **Live Exchange Rates for ${currency.toUpperCase()}**

💰 **Deposit Rate:** ${rates.depositRate}
💸 **Withdraw Rate:** ${rates.withdrawRate}
⏰ **Updated:** ${new Date(rates.timestamp).toLocaleString()}

To check rates for another currency, just ask! (e.g., "Show me USD rates")`,

  // Initial request when no currency specified
  askForCurrency: `💱 **Exchange Rates Request**

I'd be happy to show you live exchange rates! 

Please tell me which currency you'd like to check:
• **PHP** (Philippine Peso)
• **USD** (US Dollar)
• **EUR** (Euro)
• **GBP** (British Pound)
• **JPY** (Japanese Yen)
• **Or any other currency code**

Just type the currency code (e.g., "PHP", "USD") and I'll show you the current rates!`,

  // Invalid currency code error
  invalidCurrency: (currencyCode) => `❌ **Invalid Currency Code**

"${currencyCode}" is not a valid currency code. 

Please provide a valid currency code like:
• **PHP** (Philippine Peso)
• **USD** (US Dollar)
• **EUR** (Euro)
• **GBP** (British Pound)

Or you can ask me to show rates for a specific currency.`,

  // Error getting rates
  errorGettingRates: (currencyCode) => `❌ **Error Getting Rates**

I couldn't retrieve the exchange rates for ${currencyCode}. This might be because:
• The currency code is not supported
• There's a temporary issue with the rates service
• The currency code format is incorrect

Please try again with a different currency or check back later.`,

  // General error
  generalError: "I'm sorry, I'm having trouble accessing exchange rates right now. Please try again later.",

  // Processing error
  processingError: "I'm sorry, I'm having trouble processing your request. Please try again."
}; 