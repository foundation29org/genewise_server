'use strict';

const { ChatOpenAI } = require("langchain/chat_models/openai");
const config = require('../config');
const insights = require('../services/insights'); // Assuming this is for logging/monitoring
const { Client } = require("langsmith");
const { LangChainTracer } = require("langchain/callbacks");
// const { ChatBedrock } = require("langchain/chat_models/bedrock"); // Keep if needed, but example uses OpenAI
const { LLMChain } = require("langchain/chains");
const { ChatPromptTemplate, HumanMessagePromptTemplate, SystemMessagePromptTemplate } = require("langchain/prompts");
// Removed unused imports: ConversationChain, MessagesPlaceholder, BufferMemory, ChatMessageHistory, HumanMessage, AIMessage, countTokens

// --- Configuration & Clients ---
const AZURE_OPENAI_API_KEY = config.OPENAI_API_KEY;
const OPENAI_API_VERSION_O1 = config.OPENAI_API_VERSION_O1; // Assuming this is the primary version needed
const OPENAI_API_BASE = config.OPENAI_API_BASE;
const LANGSMITH_API_KEY = config.LANGSMITH_API_KEY;
const LANGSMITH_PROJECT_BASE = config.LANGSMITH_PROJECT || 'DefaultProject'; // Default project name

const langsmithClient = LANGSMITH_API_KEY ? new Client({
    apiUrl: "https://api.smith.langchain.com",
    apiKey: LANGSMITH_API_KEY,
}) : undefined;

// --- Model Creation ---
/**
 * Creates configured ChatOpenAI models with LangSmith tracing.
 * @param {string} projectName - The LangSmith project name.
 * @returns {object} Object containing configured models (e.g., { llm }).
 */
function createModels(projectName) {
  const callbacks = langsmithClient ? [new LangChainTracer({ projectName, client: langsmithClient })] : undefined;

  // Using 'o1' as the primary model based on the original navigator_summarize usage
  const llm = new ChatOpenAI({
      azureOpenAIApiKey: AZURE_OPENAI_API_KEY,
      azureOpenAIApiVersion: OPENAI_API_VERSION_O1,
      azureOpenAIApiInstanceName: OPENAI_API_BASE,
      azureOpenAIApiDeploymentName: "o1", // Using the 'o1' deployment
      // temperature: 0.1, // <--- REMOVE THIS LINE
      timeout: 500000,
      callbacks: callbacks,
      // Consider adding maxTokens if needed to control output length/cost
  });

  // If you specifically need gpt-4o-mini for translation or other tasks, create it here too
  // Also remove temperature from here just in case this deployment has the same limitation
  const translationLlm = new ChatOpenAI({
      azureOpenAIApiKey: AZURE_OPENAI_API_KEY,
      azureOpenAIApiVersion: config.OPENAI_API_VERSION, // Use appropriate version for mini
      azureOpenAIApiInstanceName: OPENAI_API_BASE,
      azureOpenAIApiDeploymentName: "gpt-4o-mini", // Use the mini deployment
      // temperature: 0, // <--- REMOVE THIS LINE TOO
      timeout: 500000,
      callbacks: callbacks,
  });



    return { llm, translationLlm }; // Return the primary model used for generation/extraction
}

// --- Core LLM Interaction Functions ---

/**
 * Executes a prompt expecting a structured text response.
 * @param {string} userId - Identifier for the user requesting the generation.
 * @param {string} systemPrompt - The system message content.
 * @param {string} userPrompt - The user message content (the core task instructions).
 * @returns {Promise<string>} The raw text response from the LLM.
 * @throws {Error} If the LLM call fails after retries.
 */
async function generateStructuredText(userId, systemPrompt, userPrompt) {
    const projectName = `GenText - ${LANGSMITH_PROJECT_BASE} - ${userId}`;
    const { llm } = createModels(projectName); // Use the primary LLM

    const systemMessagePrompt = SystemMessagePromptTemplate.fromTemplate(systemPrompt);
    const humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate("{task}");
    const chatPrompt = ChatPromptTemplate.fromMessages([systemMessagePrompt, humanMessagePrompt]);

    const chain = new LLMChain({
        prompt: chatPrompt,
        llm: llm,
    });

    // Add retry logic similar to the original
    const chain_retry = chain.withRetry({ stopAfterAttempt: 3 });

    console.log(`[LangchainService] Executing generateStructuredText for User: ${userId}`);
    try {
        const response = await chain_retry.invoke({ task: userPrompt });
        if (!response || typeof response.text !== 'string') {
             throw new Error("Invalid response structure from LLM chain.");
        }
        console.log(`[LangchainService] generateStructuredText successful for User: ${userId}`);
        return response.text;
    } catch (error) {
        console.error(`[LangchainService] Error in generateStructuredText for User ${userId}:`, error);
        insights.error(error); // Log error
        // Re-throw a more specific error or handle rate limits
        if (error.message && error.message.includes('429')) {
             console.warn("[LangchainService] Rate limit likely exceeded. Consider adding delay/backoff.");
             // You might implement a delay here before throwing, but retries handle some cases
             throw new Error(`Rate limit exceeded during text generation: ${error.message}`);
        }
        throw new Error(`Failed to generate structured text: ${error.message || error}`);
    }
}

/**
 * Executes a prompt specifically designed to return *only* a valid JSON object or array.
 * Attempts to parse the response.
 * @param {string} userId - Identifier for the user requesting the extraction.
 * @param {string} systemPrompt - The system message content.
 * @param {string} userPrompt - The user message content, instructing the LLM to return *only* JSON.
 * @returns {Promise<object|array>} The parsed JSON object or array.
 * @throws {Error} If the LLM call fails, returns non-JSON, or JSON parsing fails.
 */
async function extractJson(userId, systemPrompt, userPrompt) {
    const projectName = `ExtractJSON - ${LANGSMITH_PROJECT_BASE} - ${userId}`;
    const { llm } = createModels(projectName); // Use the primary LLM

    const systemMessagePrompt = SystemMessagePromptTemplate.fromTemplate(systemPrompt);
    const humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate("{task}");
    const chatPrompt = ChatPromptTemplate.fromMessages([systemMessagePrompt, humanMessagePrompt]);

    const chain = new LLMChain({
        prompt: chatPrompt,
        llm: llm,
    });

    const chain_retry = chain.withRetry({ stopAfterAttempt: 3 });

    console.log(`[LangchainService] Executing extractJson for User: ${userId}`);
    try {
        const response = await chain_retry.invoke({ task: userPrompt });
        if (!response || typeof response.text !== 'string') {
            throw new Error("Invalid response structure from LLM chain.");
        }

        const rawText = response.text.trim();
        // Basic check if it looks like JSON before attempting parse
        if ((!rawText.startsWith('{') || !rawText.endsWith('}')) && (!rawText.startsWith('[') || !rawText.endsWith(']'))) {
             console.warn(`[LangchainService] LLM response for JSON extraction doesn't start/end with {} or []. Raw: ${rawText.substring(0, 100)}...`);
             // Sometimes LLMs add ```json ... ```, try to strip it
             const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/);
             if (jsonMatch && jsonMatch[1]) {
                 console.log("[LangchainService] Stripped markdown fence from JSON response.");
                 return JSON.parse(jsonMatch[1].trim());
             }
             throw new Error("LLM response does not appear to be valid JSON (missing braces/brackets).");
        }

        // Attempt to parse
        const parsedJson = JSON.parse(rawText);
        console.log(`[LangchainService] extractJson successful and parsed for User: ${userId}`);
        return parsedJson;

    } catch (error) {
        console.error(`[LangchainService] Error in extractJson for User ${userId}:`, error);
        insights.error(error); // Log error
         if (error instanceof SyntaxError) {
             console.error("[LangchainService] JSON Parsing failed. Raw response:", response?.text);
             throw new Error(`Failed to parse JSON response from LLM: ${error.message}`);
         }
        if (error.message && error.message.includes('429')) {
            console.warn("[LangchainService] Rate limit likely exceeded during JSON extraction.");
            throw new Error(`Rate limit exceeded during JSON extraction: ${error.message}`);
        }
        throw new Error(`Failed to extract JSON: ${error.message || error}`);
    }
}

/**
 * Translates text to a specified language using an LLM.
 * @param {string} lang - Target language code (e.g., 'es', 'en').
 * @param {string} text - The text to translate.
 * @param {string} userId - Identifier for logging/tracing purposes (optional).
 * @returns {Promise<string>} The translated text.
 * @throws {Error} If the translation fails.
 */
async function translateText(lang, text, userId = 'anonymous') {
    const projectName = `Translate - ${LANGSMITH_PROJECT_BASE} - ${userId}`;
    // Use the specific translation model if defined, otherwise fallback to primary
    const { translationLlm, llm } = createModels(projectName);
    const modelToUse = translationLlm || llm;

    const systemMessagePrompt = SystemMessagePromptTemplate.fromTemplate(
        `You are an expert translator specializing in medical and genetic information. Your task is to translate the provided text accurately and clearly into the target language, ensuring it remains patient-friendly and avoids overly technical jargon where possible.`
    );

    // Note: The original prompt requested specific HTML structure. Removing that to keep this function general.
    // The caller (e.g., frontend or another service) should handle presentation.
    const humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate(
        `Translate the following text into **{input_language}**. Return ONLY the translated text, without any explanations, introductions, or formatting like HTML tags unless they were part of the original text.

Text to Translate:
\`\`\`
{input_text}
\`\`\`

Target Language: {input_language}`
    );

    const chatPrompt = ChatPromptTemplate.fromMessages([systemMessagePrompt, humanMessagePrompt]);

    const chain = new LLMChain({
        prompt: chatPrompt,
        llm: modelToUse,
    });

    const chain_retry = chain.withRetry({ stopAfterAttempt: 3 });

    console.log(`[LangchainService] Executing translateText to ${lang} for User: ${userId}`);
    try {
        const response = await chain_retry.invoke({
            input_language: lang,
            input_text: text,
        });
         if (!response || typeof response.text !== 'string') {
             throw new Error("Invalid response structure from LLM chain during translation.");
         }
        console.log(`[LangchainService] translateText to ${lang} successful for User: ${userId}`);
        // Return the clean text
        return response.text.trim();
    } catch (error) {
        console.error(`[LangchainService] Error in translateText to ${lang} for User ${userId}:`, error);
        insights.error(error);
        if (error.message && error.message.includes('429')) {
            console.warn("[LangchainService] Rate limit likely exceeded during translation.");
            throw new Error(`Rate limit exceeded during translation: ${error.message}`);
        }
        throw new Error(`Failed to translate text: ${error.message || error}`);
    }
}

module.exports = {
    generateStructuredText,
    extractJson,
    translateText,
    // Note: We export specific functions, not the overloaded navigator_summarize
};