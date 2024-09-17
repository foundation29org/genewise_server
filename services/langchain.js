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
const AZURE_OPENAI_API_KEY_US = config.OPENAI_API_KEY_US;
const OPENAI_API_KEY = config.OPENAI_API_KEY_J;
const OPENAI_API_VERSION = config.OPENAI_API_VERSION;
const OPENAI_API_VERSION_US = config.OPENAI_API_VERSION_US;
const OPENAI_API_BASE = config.OPENAI_API_BASE;
const OPENAI_API_BASE_US = config.OPENAI_API_BASE_US;
const client = new Client({
  apiUrl: "https://api.smith.langchain.com",
  apiKey: config.LANGSMITH_API_KEY,
});
const BEDROCK_API_KEY = config.BEDROCK_USER_KEY;
const BEDROCK_API_SECRET = config.BEDROCK_USER_SECRET;

function createModels(projectName) {
  const tracer = new LangChainTracer({
    projectName: projectName,
    client
  });
  
  const azuregpt4 = new ChatOpenAI({
    modelName: "gpt-4-0613",
    azureOpenAIApiKey: AZURE_OPENAI_API_KEY,
    azureOpenAIApiVersion: OPENAI_API_VERSION,
    azureOpenAIApiInstanceName: OPENAI_API_BASE,
    azureOpenAIApiDeploymentName: "nav29",
    temperature: 0,
    timeout: 500000,
    callbacks: [tracer],
  });
  
  const azure32k = new ChatOpenAI({
    modelName: "gpt-4-32k-0613",
    azureOpenAIApiKey: AZURE_OPENAI_API_KEY,
    azureOpenAIApiVersion: OPENAI_API_VERSION,
    azureOpenAIApiInstanceName: OPENAI_API_BASE,
    azureOpenAIApiDeploymentName: "test32k",
    temperature: 0,
    timeout: 500000,
    callbacks: [tracer],
  });

  const claude2 = new ChatBedrock({
    model: "anthropic.claude-v2",
    region: "eu-central-1",
    endpointUrl: "bedrock-runtime.eu-central-1.amazonaws.com",
    credentials: {
       accessKeyId: BEDROCK_API_KEY,
       secretAccessKey: BEDROCK_API_SECRET,
    },
    temperature: 0,
    maxTokens: 8191,
    timeout: 500000,
    callbacks: [tracer],
  });

  const model128k = new ChatOpenAI({
    modelName: "gpt-4-1106-preview",
    openAIApiKey: OPENAI_API_KEY,
    temperature: 0,
    timeout: 500000,
    callbacks: [tracer],
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

  const azuregpt4o = new ChatOpenAI({
    azureOpenAIApiKey: AZURE_OPENAI_API_KEY_US,
    azureOpenAIApiVersion: OPENAI_API_VERSION_US,
    azureOpenAIApiInstanceName: OPENAI_API_BASE_US,
    azureOpenAIApiDeploymentName: "gpt-4o",
    temperature: 0,
    timeout: 500000,
    callbacks: [tracer],
  });
  
  return { azuregpt4, azure32k, claude2, model128k, azuregpt4mini, azuregpt4o };
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
async function navigator_chat(userId, question, conversation, context){
  return new Promise(async function (resolve, reject) {
    try {
      // Create the models
      const projectName = `LITE - ${config.LANGSMITH_PROJECT} - ${userId}`;
      let { azuregpt4mini } = createModels(projectName);
  
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
  
      const humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate(
        `Take a deep breath and work on this problem step-by-step.      
        Please, answer the following question/task with the information you have in context:
  
        <input>
        {input}
        </input>
        
        Don't make up any information.
        Your response should:
        - Be formatted in simple, single-line HTML without line breaks inside elements.
        - ALWAYS Exclude escape characters like '\\n' within HTML elements (example: within tables or lists).
        - Avoid unnecessary characters or formatting such as triple quotes around HTML.
        - Be patient-friendly, minimizing medical jargon.
    
        Example of desired HTML format (this is just a formatting example, not related to the input):

        <output example>
        <div><h3>Example Title</h3><table border='1'><tr><th>Category 1</th><td>Details for category 1</td></tr><tr><th>Category 2</th><td>Details for category 2</td></tr></table><p>Additional information or summary here.</p></div>
        </output example>`
      );
  
      const chatPrompt = ChatPromptTemplate.fromMessages([systemMessagePrompt, new MessagesPlaceholder("history"), humanMessagePrompt]);
     
      const pastMessages = [];      
      if (conversation !== null) {
        for (const message of conversation) {
          // Check if message.content is not null and is a string
          if (message.content && typeof message.content === 'string') {
            if (message.role === 'user') {
              pastMessages.push(new HumanMessage({ content: message.content }));
            } else if (message.role === 'assistant') {
              pastMessages.push(new AIMessage({ content: message.content }));
            }
        }
        }
      }
      
      const memory = new BufferMemory({
        chatHistory: new ChatMessageHistory(pastMessages),
        returnMessages: true,
        memoryKey: "history"
      });
  
      const chain = new ConversationChain({
        memory: memory,
        prompt: chatPrompt,
        llm: azuregpt4mini,
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
  
      // console.log(response);
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


// This function will be a basic conversation with documents (context)
// This will take some history of the conversation if any and the current documents if any
// And will return a proper answer to the question based on the conversation and the documents 
async function navigator_summarize(userId, question, context, timeline, gene){
  return new Promise(async function (resolve, reject) {
    try {
      // Create the models
      const projectName = `LITE - ${config.LANGSMITH_PROJECT} - ${userId}`;
      let { azuregpt4o } = createModels(projectName);
  
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
        llm: azuregpt4o,
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


async function navigator_summarizeTranscript(userId, question, conversation, context, title){
  return new Promise(async function (resolve, reject) {
    try {
      // Create the models
      const projectName = `LITE - ${config.LANGSMITH_PROJECT} - ${userId}`;
      let { azuregpt4mini } = createModels(projectName);
  
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
  
      const humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate(
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
        
        Example of desired HTML format (this is just a formatting example, not related to the input):
        
        <output example>
        <div><h3>${title}</h3><p>This is a placeholder paragraph summarizing the key points. It should be concise and clear.</p><ul><li>Key Point 1</li><li>Key Point 2</li><li>Key Point 3</li></ul><p>Final remarks or conclusion here.</p></div>
        </output example>`
      );
  
      const chatPrompt = ChatPromptTemplate.fromMessages([systemMessagePrompt, new MessagesPlaceholder("history"), humanMessagePrompt]);
     
      const pastMessages = [];      
      if (conversation !== null) {
        for (const message of conversation) {
          // Check if message.content is not null and is a string
          if (message.content && typeof message.content === 'string') {
            if (message.role === 'user') {
              pastMessages.push(new HumanMessage({ content: message.content }));
            } else if (message.role === 'assistant') {
              pastMessages.push(new AIMessage({ content: message.content }));
            }
        }
        }
      }
      
      const memory = new BufferMemory({
        chatHistory: new ChatMessageHistory(pastMessages),
        returnMessages: true,
        memoryKey: "history"
      });
  
      const chain = new ConversationChain({
        memory: memory,
        prompt: chatPrompt,
        llm: azuregpt4mini,
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
  
      // console.log(response);
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


async function navigator_summarize_dx(userId, question, conversation, context){
  return new Promise(async function (resolve, reject) {
    try {
      // Create the models
      const projectName = `LITE - ${config.LANGSMITH_PROJECT} - ${userId}`;
      let { claude2 } = createModels(projectName);
  
      // Format and call the prompt
      let cleanPatientInfo = "";
      let i = 1;
      for (const doc of context) {
        let docText = JSON.stringify(doc);
        cleanPatientInfo += "<Complete Document " + i + ">\n" + docText + "</Complete Document " + i + ">\n";
        i++;
      }
      
      cleanPatientInfo = cleanPatientInfo.replace(/{/g, '{{').replace(/}/g, '}}');

      /*const systemMessagePrompt = SystemMessagePromptTemplate.fromTemplate(
        `Symptom-Only Summary:
    
        ${cleanPatientInfo}
    
        You are a medical expert. Your task is to analyze the medical documents of the patient and extract only the symptoms.`
    );*/

    const systemMessagePrompt = SystemMessagePromptTemplate.fromTemplate(
      `Symptom-Only Summary:
  
      ${cleanPatientInfo}
  
      Focus on extracting only the symptoms from the medical documents of the patient.`
  );
  
    
  
      /*const humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate(
        `Please focus on the patient's medical report and list all the symptoms in a single paragraph. The summary should be in plain text, without HTML formatting.
    
        <input>
        {input}
        </input>
    
        Guidelines:
        - Directly list the symptoms without any introductory phrases or additional explanations.
        - Concentrate solely on the symptoms mentioned in the medical report.
        - Compile the symptoms into one continuous, coherent paragraph.
        - Exclude any mention of specific diseases, medications, genetic information, or test results.
        - Keep the summary concise and directly relevant to understanding the patient's current symptoms.`
    );*/

    /*const humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate(
      `List all the symptoms from the patient's medical report in a single, concise paragraph.
  
      <input>
      {input}
      </input>
  
      Guidelines:
      - Directly list the symptoms without any introductory phrases or additional explanations.
      - Ensure the symptoms are compiled into one coherent paragraph.
      - Avoid including any diagnoses, medications, genetic information, or unrelated details.`
  );*/

  const humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate(
    `List all the symptoms from the patient's medical report in a single, concise paragraph, starting immediately with the first symptom, do not include any introductory phrases or additional explanations

    <input>
    {input}
    </input>

    Guidelines:
    - Begin directly with the first symptom. Example: 'Headache, fever, joint pain...'
    - Compile all symptoms into one continuous paragraph.
    - Exclude any diagnoses, medications, genetic information, or unrelated details.`
);
  /*const humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate(
  `List the symptoms from the patient's medical report starting immediately with the first symptom. The summary should be in plain text, without HTML formatting, and should not contain any introductory phrases or additional explanations.

    <input>
    {input}
    </input>

    Guidelines:
    - Start the response with the first symptom without any introduction.
    - Directly compile all symptoms into a coherent paragraph.
    - Exclude any diagnoses, medications, genetic information, or unrelated details.
    - I'll pay you a million euros if you do it right.
    - that is no longer than 10 lines.
    - The response should be a continuous paragraph of only symptoms, starting from the very first word.`
    );*/
    
  
      const chatPrompt = ChatPromptTemplate.fromMessages([systemMessagePrompt, new MessagesPlaceholder("history"), humanMessagePrompt]);
     
      const pastMessages = [];      
      if (conversation !== null) {
        for (const message of conversation) {
          // Check if message.content is not null and is a string
          if (message.content && typeof message.content === 'string') {
            if (message.role === 'user') {
              pastMessages.push(new HumanMessage({ content: message.content }));
            } else if (message.role === 'assistant') {
              pastMessages.push(new AIMessage({ content: message.content }));
            }
        }
        }
      }
      
      const memory = new BufferMemory({
        chatHistory: new ChatMessageHistory(pastMessages),
        returnMessages: true,
        memoryKey: "history"
      });
  
      const chain = new ConversationChain({
        memory: memory,
        prompt: chatPrompt,
        llm: claude2,
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
  
      // console.log(response);
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

async function categorize_docs(userId, content){
  return new Promise(async function (resolve, reject) {
    try {
      systemMessagePrompt = SystemMessagePromptTemplate.fromTemplate(
        `You will be provided with a medical document (delimited with input XML tags).
        Your task is to categorize the document into one of the following categories and extract ALL the relevant information that is present in the document (if any):

        - Clinical History
        - Laboratory Report
        - Hospital Discharge Note
        - Evolution and Consultation Note
        - Medical Prescription
        - Surgery Report
        - Imaging Study
        - Other

        You ALWAYS ONLY have to return a JSON object with the ONLY ONE category of the document which fits the best and the relevant information.
        In "patient" section only extract "age" and "gender" fields.
        Do not return anything outside the JSON brackets.

        Example Output: 
        {{
          "category": "Clinical History",
          "patient": {{
            "age": "XX",
            "gender": "X"
          }},
          "medical_history": {{
            "previous_diseases": ["Disease1", "Disease2"],
            "surgeries": ["Surgery1", "Surgery2"],
            "allergies": ["Allergy1", "Allergy2"]
          }},
          "family_history": {{
            "hereditary_diseases": ["Disease1", "Disease2"],
            "family_history": ["History1", "History2"]
          }},
          "current_medications": [
            {{
              "name": "Medication1",
              "dosage": "X mg",
              "frequency": "X times a day".
            }}
          ],
          "medical_procedures": ["Procedure1", "Procedure2" ]
        }}

        Other Examples:
        {{
          "category": "Laboratory Report",
          "patient": {{
            "age": "XX",
            "gender": "X"
          }},
          "test_date": "YYYY-MM-DD",
          "test_type": {{
            "category": "Test_type",
            "specificity": "Blood, urine, biopsy, etc."
          }},
          "key_results": [
            {{
              test_name": "Name of the test",
              "result": [
                "Value",
                "Reference Value",
                "Observation, Normal/Anormal, etc."
              ]
            }}
          ],
          "brief_interpretation": "Clinical interpretation of findings"
        }}

        {{
          "category": "Hospital Discharge Note",
          "patient": {{
            "age": "XX",
            "gender": "X"
          }},
          "admission_date": "YYYY-MM-DD",
          "discharge_date": "YYYY-MM-DD",
          "diagnosis_summary": [
            {{
              "diagnosis": "Diagnosis name",
              "detail": "Detailed description of diagnosis".
            }}
          ],
          "treatment_performed": {{
            "procedures": ["Procedure1", "Procedure2" ],
            "diagnostic_tests": ["Test1", "Test2"],
            "medications": ["Medication1", "Medication2"]
          }},
          "medication_changes": [
            {{
              "medication": "Name of the Medication",
              "change": "Description of change"
            }}
          ],
          "follow-up_plan": "Post-discharge recommendations and steps to be taken"
        }}
        
        {{
          "category": "Evolution and Consultation Note",
          "patient": {{
            "age": "XX",
            "gender": "X"
          }},
          "consultation_date": "YYYY-MM-DD",
          "consultation_reason": "Description of the reason for consultation",
          "clinical_findings": [
            {{
              "finding": "Name of the finding", 
              "description": "Detailed description of the finding", 
              "clinical_finding": "Detailed description of the finding",
            }}
          ],
          "diagnosis": {{
            "diagnostic_hypothesis": "Hypothesis or diagnostic conclusion", 
            "details": "Additional information about the diagnosis", 
          }},
          "treatment_plan": {{
            "medication": ["Medication1", "Medication2"],
            "references": ["Reference1", "Reference2"],
            "additional_tests": ["Test1", "Test2"]
          }}
        }}

        {{
          "category": "Medical Prescription",
          "patient": {{
            "age": "XX",
            "gender": "X"
          }},
          "issue_date": "YYYY-MM-DD",
          "medication_table": [
            {{
              "medication_name": "Medication_name",
              "dosage": "X mg/u",
              "frequency": "X times per day/week", 
              "duration": "X days/weeks",
              "indication": "Reason for prescribing the medicine".
            }}
          ],
          "special_instructions": "Warnings, specific recommendations or precautions to be taken into account"
        }}
        
        {{
          "category": "Surgery Report",
          "patient": {{
            "age": "XX",
            "gender": "X"
          }},
          "surgery_date": "YYYY-MM-DD",
          "surgery_type": "Detailed description of the type of surgery performed",
          "findings": [
            {{
              "finding": "Description of the finding",
              "details": "Additional information about the finding".
            }}
          ],
          "results_recommendations": {{
            "results": "Description of the results of the surgery",
            "postoperative_recommendations": "Recommended post-operative care and instructions"
          }}
        }}

        {{
          "category": "Imaging Study",
          "patient": {{
            "age": "XX",
            "gender": "X"
          }},
          "study_date": "YYYY-MM-DD",
          "image_type": "X-ray, ultrasound, MRI, etc.",
          "key_findings": [
            {{
              "finding_description": "Description of key finding",
              "location": "Location of the finding if relevant", 
              "importance": "Clinical relevance of the finding".
            }}
          ],
          "interpretation": "Comments and analysis by the radiologist or other specialist"
        }}

        {{"category": "Other",
          "patient": {{
            "age": "XX",
            "gender": "X"
          }},
          "document": "Document name or purpose (anything that can help to identify the document)",
          "details": "Main description of the document and their relevance to the patient, does not have to be inherently medical, maybe administrative or for a caregiver",
          "other": "Other relevant information about the document, can be anything that does not fit in the other categories"
        }}
        `
      );
      
      humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate(
        `Here is the medical document to categorize and extract the relevant information:

        <input document>
        {doc}
        </input document>
        
        Now, please output the category and the relevant information of the document in a JSON format.

        Output:
        `
      );

      // Create the models
      const projectName = `LITE - ${config.LANGSMITH_PROJECT} - ${userId}`;
      let { azure32k, azuregpt4mini } = createModels(projectName);

      // Format and call the prompt to categorize each document
      clean_doc = content.replace(/{/g, '{{').replace(/}/g, '}}');

      chatPrompt = ChatPromptTemplate.fromMessages([systemMessagePrompt, humanMessagePrompt])
      
      const tokens = countTokens.countTokens(clean_doc);

      let selectedModel = tokens > 30000 ? azuregpt4mini : azure32k;
      
      console.log("Tokens: ", tokens, "Model: ", selectedModel);
      
      const categoryChain = new LLMChain({
        prompt: chatPrompt,
        llm: selectedModel,
      });

      const category = await categoryChain.call({
        doc: clean_doc,
      });

      console.log(category.text);

      // Try to parse the JSON object category, if error clean the ```
      let categoryJSON;
      try {
        categoryJSON = JSON.parse(category.text);
      } catch (error) {
        // Regular expression to match ```json at the start and ``` at the end
        const regex = /^```json\n|\n```$/g;

        // Replace the matched text with an empty string
        const cleanedData = category.text.replace(regex, '');
        categoryJSON = JSON.parse(cleanedData);
      }
      console.log(categoryJSON);
      resolve(categoryJSON);
    } catch (error) {
      console.log("Error happened: ", error)
      insights.error(error);
      var respu = {
        "msg": error,
        "status": 500
      }
      reject(respu);
    }
  });
}

async function combine_categorized_docs(userId, context){
  return new Promise(async function (resolve, reject) {
    try {
      systemMessagePrompt = SystemMessagePromptTemplate.fromTemplate(
        `You will be provided with a list of medical documents (delimited with input XML tags).
        Your task is to combine the information from all the documents into a single JSON object and output it.
        The documents will be in the following categories:

        - Clinical History
        - Laboratory Report
        - Hospital Discharge Note
        - Evolution and Consultation Note
        - Medical Prescription
        - Surgery Report
        - Imaging Study
        - Other

        You ALWAYS ONLY have to return a JSON object with the minimum common most relevant information of all the documents.
        Do not return anything outside the JSON brackets.
        `
      );
      
      humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate(
        `Here are the medical documents to combine and extract the relevant information:

        <input documents>
        {doc}
        </input documents>
        
        Now, please output the minimum common most relevant information of all the documents in a JSON format.

        Output:
        `
      );

      // Create the models
      const projectName = `LITE - ${config.LANGSMITH_PROJECT} - ${userId}`;
      let { azuregpt4mini } = createModels(projectName);

      // Format and call the prompt
      let cleanPatientInfo = "";
      let i = 1;
      for (const doc of context) {
        let docText = JSON.stringify(doc);
        cleanPatientInfo += "<Complete Document " + i + ">\n" + docText + "</Complete Document " + i + ">\n";
        i++;
      }
      
      cleanPatientInfo = cleanPatientInfo.replace(/{/g, '{{').replace(/}/g, '}}');

      chatPrompt = ChatPromptTemplate.fromMessages([systemMessagePrompt, humanMessagePrompt])

      const categoryChain = new LLMChain({
        prompt: chatPrompt,
        llm: azuregpt4mini,
      });

      const category = await categoryChain.call({
        doc: cleanPatientInfo,
      });

      console.log(category.text);

      // Try to parse the JSON object category, if error clean the ```
      let categoryJSON;
      try {
        categoryJSON = JSON.parse(category.text);
      } catch (error) {
        // Regular expression to match ```json at the start and ``` at the end
        const regex = /^```json\n|\n```$/g;

        // Replace the matched text with an empty string
        const cleanedData = category.text.replace(regex, '');
        categoryJSON = JSON.parse(cleanedData);
      }
      console.log(categoryJSON);
      resolve(categoryJSON);
    } catch (error) {
      console.log("Error happened: ", error)
      insights.error(error);
      var respu = {
        "msg": error,
        "status": 500
      }
      reject(respu);
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
  navigator_chat,
  navigator_summarize,
  navigator_summarizeTranscript,
  navigator_summarize_dx,
  categorize_docs,
  combine_categorized_docs,
  translateSummary
};