'use strict';

const { AzureChatOpenAI } = require("@langchain/openai");
const { ChatPromptTemplate, HumanMessagePromptTemplate, SystemMessagePromptTemplate } = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { LangChainTracer } = require("@langchain/core/tracers/tracer_langchain");
const config = require('../config');
const insights = require('../services/insights');
const { Client } = require("langsmith");

const AZURE_OPENAI_API_KEY = config.OPENAI_API_KEY;
const OPENAI_API_VERSION_O1 = config.OPENAI_API_VERSION_O1;
const OPENAI_API_BASE = config.OPENAI_API_BASE;
const LANGSMITH_API_KEY = config.LANGSMITH_API_KEY;
const LANGSMITH_PROJECT_BASE = config.LANGSMITH_PROJECT || 'DefaultProject';

const langsmithClient = LANGSMITH_API_KEY ? new Client({
    apiUrl: "https://api.smith.langchain.com",
    apiKey: LANGSMITH_API_KEY,
}) : undefined;

function createModels(projectName) {
  const callbacks = langsmithClient ? [new LangChainTracer({ projectName, client: langsmithClient })] : undefined;

  const llm = new AzureChatOpenAI({
      azureOpenAIApiKey: AZURE_OPENAI_API_KEY,
      azureOpenAIApiVersion: OPENAI_API_VERSION_O1,
      azureOpenAIApiInstanceName: OPENAI_API_BASE,
      azureOpenAIApiDeploymentName: "o1",
      timeout: 500000,
      callbacks: callbacks,
  });

  const translationLlm = new AzureChatOpenAI({
      azureOpenAIApiKey: AZURE_OPENAI_API_KEY,
      azureOpenAIApiVersion: config.OPENAI_API_VERSION,
      azureOpenAIApiInstanceName: OPENAI_API_BASE,
      azureOpenAIApiDeploymentName: "gpt-4o-mini",
      timeout: 500000,
      callbacks: callbacks,
  });

    return { llm, translationLlm };
}

function withRetry(runnable) {
    return runnable.withRetry({ stopAfterAttempt: 3 });
}

async function generateStructuredText(userId, systemPrompt, userPrompt) {
    const projectName = `GenText - ${LANGSMITH_PROJECT_BASE} - ${userId}`;
    const { llm } = createModels(projectName);

    const systemMessagePrompt = SystemMessagePromptTemplate.fromTemplate(systemPrompt);
    const humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate("{task}");
    const chatPrompt = ChatPromptTemplate.fromMessages([systemMessagePrompt, humanMessagePrompt]);
    const chain = withRetry(chatPrompt.pipe(llm).pipe(new StringOutputParser()));

    console.log(`[LangchainService] Executing generateStructuredText for User: ${userId}`);
    try {
        const text = await chain.invoke({ task: userPrompt });
        if (typeof text !== 'string') {
             throw new Error("Invalid response structure from LLM chain.");
        }
        console.log(`[LangchainService] generateStructuredText successful for User: ${userId}`);
        return text;
    } catch (error) {
        console.error(`[LangchainService] Error in generateStructuredText for User ${userId}:`, error);
        insights.error(error);
        if (error.message && error.message.includes('429')) {
             console.warn("[LangchainService] Rate limit likely exceeded. Consider adding delay/backoff.");
             throw new Error(`Rate limit exceeded during text generation: ${error.message}`);
        }
        throw new Error(`Failed to generate structured text: ${error.message || error}`);
    }
}

async function extractJson(userId, systemPrompt, userPrompt) {
    const projectName = `ExtractJSON - ${LANGSMITH_PROJECT_BASE} - ${userId}`;
    const { llm } = createModels(projectName);

    const systemMessagePrompt = SystemMessagePromptTemplate.fromTemplate(systemPrompt);
    const humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate("{task}");
    const chatPrompt = ChatPromptTemplate.fromMessages([systemMessagePrompt, humanMessagePrompt]);
    const chain = withRetry(chatPrompt.pipe(llm).pipe(new StringOutputParser()));

    let rawText = '';
    console.log(`[LangchainService] Executing extractJson for User: ${userId}`);
    try {
        rawText = await chain.invoke({ task: userPrompt });
        if (typeof rawText !== 'string') {
            throw new Error("Invalid response structure from LLM chain.");
        }

        rawText = rawText.trim();
        if ((!rawText.startsWith('{') || !rawText.endsWith('}')) && (!rawText.startsWith('[') || !rawText.endsWith(']'))) {
             console.warn(`[LangchainService] LLM response for JSON extraction doesn't start/end with {} or []. Raw: ${rawText.substring(0, 100)}...`);
             const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/);
             if (jsonMatch && jsonMatch[1]) {
                 console.log("[LangchainService] Stripped markdown fence from JSON response.");
                 return JSON.parse(jsonMatch[1].trim());
             }
             throw new Error("LLM response does not appear to be valid JSON (missing braces/brackets).");
        }

        const parsedJson = JSON.parse(rawText);
        console.log(`[LangchainService] extractJson successful and parsed for User: ${userId}`);
        return parsedJson;

    } catch (error) {
        console.error(`[LangchainService] Error in extractJson for User ${userId}:`, error);
        insights.error(error);
         if (error instanceof SyntaxError) {
             console.error("[LangchainService] JSON Parsing failed. Raw response:", rawText);
             throw new Error(`Failed to parse JSON response from LLM: ${error.message}`);
         }
        if (error.message && error.message.includes('429')) {
            console.warn("[LangchainService] Rate limit likely exceeded during JSON extraction.");
            throw new Error(`Rate limit exceeded during JSON extraction: ${error.message}`);
        }
        throw new Error(`Failed to extract JSON: ${error.message || error}`);
    }
}

async function translateText(lang, text, userId = 'anonymous') {
    const projectName = `Translate - ${LANGSMITH_PROJECT_BASE} - ${userId}`;
    const { translationLlm, llm } = createModels(projectName);
    const modelToUse = translationLlm || llm;

    const systemMessagePrompt = SystemMessagePromptTemplate.fromTemplate(
        `You are an expert translator specializing in medical and genetic information. Your task is to translate the provided text accurately and clearly into the target language, ensuring it remains patient-friendly and avoids overly technical jargon where possible.`
    );

    const humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate(
        `Translate the following text into **{input_language}**. Return ONLY the translated text, without any explanations or introductions. Keep HTML tags that were in the original text. Keep placeholders such as [[[GWIMG0]]] exactly as they appear; do not translate, drop, or reformat them.

Text to Translate:
\`\`\`
{input_text}
\`\`\`

Target Language: {input_language}`
    );

    const chatPrompt = ChatPromptTemplate.fromMessages([systemMessagePrompt, humanMessagePrompt]);
    const chain = withRetry(chatPrompt.pipe(modelToUse).pipe(new StringOutputParser()));

    console.log(`[LangchainService] Executing translateText to ${lang} for User: ${userId}`);
    try {
        const translated = await chain.invoke({
            input_language: lang,
            input_text: text,
        });
         if (typeof translated !== 'string') {
             throw new Error("Invalid response structure from LLM chain during translation.");
         }
        console.log(`[LangchainService] translateText to ${lang} successful for User: ${userId}`);
        return translated.trim();
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
};
