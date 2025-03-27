const { ChatOpenAI } = require("langchain/chat_models/openai");
const config = require('../config')
const insights = require('../services/insights');
const { Client } = require("langsmith")
const { LangChainTracer } = require("langchain/callbacks");
const { ChatBedrock } = require("langchain/chat_models/bedrock");
const { ConversationChain, LLMChain } = require("langchain/chains");
const { ChatPromptTemplate, HumanMessagePromptTemplate, SystemMessagePromptTemplate, MessagesPlaceholder } = require("langchain/prompts");
const { BufferMemory, ChatMessageHistory } = require("langchain/memory");
const { HumanMessage, AIMessage } = require("langchain/schema");
const countTokens = require( '@anthropic-ai/tokenizer'); 

const AZURE_OPENAI_API_KEY = config.OPENAI_API_KEY;
const OPENAI_API_KEY = config.OPENAI_API_KEY_J;
const OPENAI_API_VERSION = config.OPENAI_API_VERSION;
const OPENAI_API_VERSION_O1 = config.OPENAI_API_VERSION_O1;
const OPENAI_API_BASE = config.OPENAI_API_BASE;
const client = new Client({
  apiUrl: "https://api.smith.langchain.com",
  apiKey: config.LANGSMITH_API_KEY,
});

function createModels(projectName) {
  const tracer = new LangChainTracer({
    projectName: projectName,
    client
  });

  const azuregpt4mini = new ChatOpenAI({
    azureOpenAIApiKey: AZURE_OPENAI_API_KEY,
    azureOpenAIApiVersion: OPENAI_API_VERSION,
    azureOpenAIApiInstanceName: OPENAI_API_BASE,
    azureOpenAIApiDeploymentName: "gpt-4o-mini",
    temperature: 0,
    timeout: 500000,
    callbacks: [tracer],
  });

  const azureo1 = new ChatOpenAI({
    azureOpenAIApiKey: AZURE_OPENAI_API_KEY,
    azureOpenAIApiVersion: OPENAI_API_VERSION_O1,
    azureOpenAIApiInstanceName: OPENAI_API_BASE,
    azureOpenAIApiDeploymentName: "o1",
    timeout: 500000,
    callbacks: [tracer],
  });
  
  return { azuregpt4mini, azureo1 };
}

function extractAndParse(summaryText) {
  // Step 1: Extract Text using Regular Expressions
  const matches = summaryText.match(/<output>(.*?)<\/output>/s);
  if (!matches) {
    console.warn("No matches found in <output> tags.");
    return "[]";
  }

  // Assuming the content in <output> is JSON
  try {
    // Step 2: Convert Extracted Text to JSON
    const extractedJson = JSON.parse(matches[1]);  // Considering only the first match
    return JSON.stringify(extractedJson);
  } catch (error) {
    console.warn("Invalid JSON format in <output> tags.");
    return "Invalid JSON format";
  }
}

function createHtmlTemplate(htmlContent, jsonContent) {
  // Based on the JSON variables, we will edit the htmlContent and return the new html
  // Each variable will control some part of the htmlContent
  /* Example of JSON vars:
    {
    "genetic_technique": "<WGS, Exome, Panel>",   # Based on this var, we will add a div explaining the genetic technique used
    "pathogenic_variants": "<true, false>", # Based on this var, we will add a div explaining if the patient has pathogenic variants or not and what does it means
    "pathogenic_variants_list":[ 
      {
        "variant": "<variant1>",
        "date": "<YYYY-MM-DD>"
      },
      {
        "variant": "<variant2>",
        "date": "<YYYY-MM-DD>"
      }
    ],
    "genetic_heritage": "<autosomalDominant, autosomalRecessive, XLinkedDominant, XLinkedRecessive, YLinked, mitochondrial>", # Based on this var, we will add a div explaining the genetic heritage of the patient and a photo of the inheritance
    "paternal_tests_confirmation": "<true, false>" # Based on this var, we will add a div explaining if the patient parents has to be tested for the same genetic variants
    }
    Example of base htmlContent:
    <html>
    <div title="Intro">
      <p>This is a summary of the patient.</p>
    </div>
    <genetic_technique>
    <div title="Genetic">
      <p>This is a summary of the patient's genetic information.</p>
    </div>
    <pathogenic_variants>
    <heritage>
    <paternal_tests_confirmation>
    <div title="Others">
      <p>This includes any other information about the patient.</p>
    </div>
    </html>
  */
    
  // Step 1: Convert JSON to Object
  const jsonObject = JSON.parse(jsonContent);
  // We will load a JSON with the generic information templates
  const genericTemplates = require('./generic_templates.json');

  // Step 2: Add the new divs to the htmlContent based on the jsonObject
  if (jsonObject.genetic_technique) {
    const geneticTechnique = genericTemplates.genetic_technique[jsonObject.genetic_technique];
    htmlContent = htmlContent.replace(/<EMPTY_genetic_technique>/g, `<div title="Genetic Technique">${geneticTechnique}</div><br/>`);
  }

  if (jsonObject.pathogenic_variants) {
    const pathogenicVariants = genericTemplates.pathogenic_variants[jsonObject.pathogenic_variants];
      htmlContent = htmlContent.replace(/<EMPTY_pathogenic_variants>/g, `<div title="Pathogenic Variants">${pathogenicVariants}</div><br/>`);
  }

  if (jsonObject.genetic_heritage) {
    const geneticHeritage = genericTemplates.genetic_heritage[jsonObject.genetic_heritage];
    htmlContent = htmlContent.replace(/<EMPTY_heritage>/g, `<div title="Genetic Heritage">${geneticHeritage}</div><br/>`);
  } 

  if (jsonObject.paternal_tests_confirmation) {
    const paternalTestsConfirmation = genericTemplates.paternal_tests_confirmation[jsonObject.paternal_tests_confirmation];
    htmlContent = htmlContent.replace(/<EMPTY_paternal_tests_confirmation>/g, `<div title="Paternal Tests Confirmation">${paternalTestsConfirmation}</div><br/>`);
  }

  // Step 3: Return the new htmlContent
  console.log(htmlContent);

  return [htmlContent, jsonObject.pathogenic_variants_list];
}

function extractAndParseGene(summaryText) {
  // Step 1: Extract Text using Regular Expressions
  const matchHtml = summaryText.match(/<html>(.*?)<\/html>/s);
  const matches = summaryText.match(/<output>(.*?)<\/output>/s);
  if (!matchHtml) {
    console.warn("No matches found in <html> tags.");
    return "[]";
  }

  if (!matches) {
    console.warn("No matches found in <output> tags.");
    return "[]";
  }

  // Assuming the content in <output> is JSON
  try {
    // Step 2: Convert Extracted Text to JSON
    const extractedHtml = matchHtml[1];  // Considering only the first match
    const extractedJson = JSON.parse(matches[1]);  // Considering only the first match
    return [extractedHtml, JSON.stringify(extractedJson)];
  } catch (error) {
    console.warn("Invalid JSON format in <output> tags.");
    return "Invalid JSON format";
  }
}

// This function will be a basic conversation with documents (context)
// This will take some history of the conversation if any and the current documents if any
// And will return a proper answer to the question based on the conversation and the documents 
async function navigator_summarize(userId, question, context, timeline, gene){
  return new Promise(async function (resolve, reject) {
    try {
      // Create the models
      const projectName = `LITE - ${config.LANGSMITH_PROJECT} - ${userId}`;
      let { azureo1 } = createModels(projectName);
  
      // Format and call the prompt
      let cleanPatientInfo = "";
      let i = 1;
      for (const doc of context) {
        let docText = JSON.stringify(doc);
        cleanPatientInfo += "<Complete Document " + i + ">\n" + docText + "</Complete Document " + i + ">\n";
        i++;
      }
      
      cleanPatientInfo = cleanPatientInfo.replace(/{/g, '{{').replace(/}/g, '}}');

      const systemMessagePrompt = SystemMessagePromptTemplate.fromTemplate(
        `This is the list of the medical information of the patient:
  
        ${cleanPatientInfo}
  
        You are a medical expert, based on this context with the medical documents from the patient.`
      );
  
      let humanMessagePrompt;
      if (timeline) {
        humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate(
          `Take a deep breath and work on this problem step-by-step.      
          Please, answer the following question/task with the information you have in context:

          <input>
          {input}
          </input>
          
          Don't make up any information.
          Your response should:
          - Be formatted in simple, single-line JSON.
          - Exclude escape characters like '\\n' within JSON elements.
          - Avoid unnecessary characters around formatting such as triple quotes around HTML.
          - Be patient-friendly, minimizing medical jargon.
          - Use ISO 8601 date format for dates (YYYY-MM-DD), if no day is available, use the first day of the month (YYYY-MM-01).
          
          Example of desired JSON format (this is just a formatting example, not related to the input):
          
          <output>
          [
              {{
                  "date": "<YYYY-MM-DD>",
                  "eventType": "<only one of: diagnosis, treatment, test, future_medical_appointment, important_life_event>",
                  "keyMedicalEvent": "<small description>"
              }},
              {{
                  "date": "<YYYY-MM-DD>",
                  "eventType": "<only one of: diagnosis, treatment, test, future_medical_appointment, important_life_event>",
                  "keyMedicalEvent": "<small description>"
              }},
          ]
          </output>
          
          Always use the <output> tag to encapsulate the JSON response.`
        );
      } else if (gene) {
        humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate(
          `Take a deep breath and work on this problem step-by-step.      
          Please, answer the following question/task with the information you have in context:

          <input>
          {input}
          </input>
          
          Don't make up any information.
          Your response should:
          - Be formatted in simple, single-line HTML without line breaks inside elements.
          - Exclude escape characters like '\\n' within HTML elements.
          - Avoid unnecessary characters around formatting such as triple quotes around HTML.
          - Be patient-friendly, minimizing medical jargon.
          - Add an extra <output> tag to encapsulate the extra JSON response with the booleans and categorie variables.
          
          Example of desired HTML format (this is just a formatting example, REMEMBER TO ADD THE XML TAGS ALWAYS):
          
          <html>
          <div title="Intro">
            <h3>Report Introduction</h3>
            <p>This is a summary of the patient and the report introduction.</p>
          </div>
          <EMPTY_genetic_technique> // Add this EMPTY ALONE XML tag ALWAYS with nothing more
          <div title="Genetic">
            <h3>Genetic Information</h3>
            <p>This is a summary of the genetic information results from the analysis.</p>
          </div>
          <EMPTY_pathogenic_variants> // Add this EMPTY ALONE XML tag ALWAYS with nothing more
          <EMPTY_heritage> // Add this EMPTY ALONE XML tag ALWAYS with nothing more
          <EMPTY_paternal_tests_confirmation> // Add this EMPTY ALONE XML tag ALWAYS with nothing more
          <div title="Others">
            <h3>Other Information</h3>
            <p>This includes any other information about the patient.</p>
          </div>
          </html>
          
          <output>
          {{
              "genetic_technique": "<WGS, Exome, Panel>",
              "pathogenic_variants": "<true, false>", # Only truly pathogenic variants exclude likely pathogenic etc
              "pathogenic_variants_list":[ # Only truly pathogenic variants exclude likely pathogenic etc
                {{
                  "variant": "<variant1>",
                  "date": "<YYYY-MM-DD>"
                }},
                {{
                  "variant": "<variant2>",
                  "date": "<YYYY-MM-DD>"
                }}
              ],
              "genetic_heritage": "<autosomalDominant, autosomalRecessive, XLinkedDominant, XLinkedRecessive, YLinked, mitochondrial>",
              "paternal_tests_confirmation": "<true, false>"
          }}
          </output>
          
          Always use the <output> tag to encapsulate the JSON response.`
        );
      }
  
      const chatPrompt = ChatPromptTemplate.fromMessages([systemMessagePrompt, humanMessagePrompt]);
  
      const chain = new LLMChain({
        prompt: chatPrompt,
        llm: azureo1,
      });

      const chain_retry = chain.withRetry({
        stopAfterAttempt: 3,
      });

      
      let response;
      try {
        response = await chain_retry.invoke({
          input: question,
        });
      } catch (error) {
        if (error.message.includes('Error 429')) {
          console.log("Rate limit exceeded, waiting and retrying...");
          await new Promise(resolve => setTimeout(resolve, 20000)); // Wait for 20 seconds
          response = await chain_retry.invoke({
            input: question,
          });
        } else {
          throw error;
        }
      }

      console.log(response);

      if (timeline) {
        response.text = extractAndParse(response.text);
      } else if (gene) {
        parts = extractAndParseGene(response.text);
        formattedParts = createHtmlTemplate(parts[0], parts[1]);
        response.text = formattedParts[0];
        response.json = formattedParts[1];
      }

      resolve(response);
    } catch (error) {
      console.log("Error happened: ", error)
      insights.error(error);
      var respu = {
        "msg": error,
        "status": 500
      }
      resolve(respu);
    }
  });
}

async function translateSummary(lang, text) {
  return new Promise(async function (resolve, reject) {
    try {
      // Create the models
      const projectName = `TRANSLATE - ${config.LANGSMITH_PROJECT}`;
      let { azuregpt4mini } = createModels(projectName); // Ajusta esto si necesitas otros modelos

      // Format and call the prompt
      const systemMessagePrompt = SystemMessagePromptTemplate.fromTemplate(
        `You are an expert translator. Your task is to translate the given text into the specified language.`
      );

      const humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate(
        `Translate the following text into {input_language}:

        {input_text}

        The translation should be clear, accurate, and patient-friendly. Avoid unnecessary medical jargon and ensure the translation is understandable for patients and their families.

        Provide the translation only in the HTML format as follows:
        <div><h3>Title</h3><p>Translation goes here.</p></div>`
      );

      const chatPrompt = ChatPromptTemplate.fromMessages([systemMessagePrompt, humanMessagePrompt]);

      const chain = new LLMChain({
        prompt: chatPrompt,
        llm: azuregpt4mini,
      });

      const chain_retry = chain.withRetry({
        stopAfterAttempt: 3,
      });

      let response;
      try {
        response = await chain_retry.invoke({
          input_language: lang,
          input_text: text,
        });
      } catch (error) {
        if (error.message.includes('Error 429')) {
          console.log("Rate limit exceeded, waiting and retrying...");
          await new Promise(resolve => setTimeout(resolve, 20000)); // Wait for 20 seconds
          response = await chain_retry.invoke({
            input_language: lang,
            input_text: text,
          });
        } else {
          throw error;
        }
      }

      resolve(response);
    } catch (error) {
      console.log("Error happened: ", error)
      insights.error(error);
      var respu = {
        "msg": error,
        "status": 500
      }
      resolve(respu);
    }
  });
}

module.exports = {
  navigator_summarize,
  translateSummary
};