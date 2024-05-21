'use strict'
const config = require('./../config')
const axios = require('axios');
const langchain = require('../services/langchain')
const f29azureService = require("../services/f29azure")
const countTokens = require( '@anthropic-ai/tokenizer'); 
const {
	SearchClient,
	SearchIndexClient,
	AzureKeyCredential,
	odata,
  } = require("@azure/search-documents");  
const sas = config.BLOB.SAS;
const accountname = config.BLOB.NAMEBLOB;
const form_recognizer_key = config.FORM_RECOGNIZER_KEY
const form_recognizer_endpoint = config.FORM_RECOGNIZER_ENDPOINT



async function callNavigator(req, res) {
	var result = await langchain.navigator_chat(req.body.userId, req.body.question, req.body.conversation, req.body.context);
	res.status(200).send(result);
}

async function callSummary(req, res) {
	let prompt = '';
	if (req.body.role == 'physician') {
		prompt = `Please provide a comprehensive and detailed explanation of the patient's genetic information.
		Include all relevant genetic data, variants, and their implications, ensuring the information is precise and thorough for expert medical analysis.
		The explanation should facilitate a deep understanding of the patient's genetic situation, suitable for a healthcare professional.
		Start with an overview of the document type and its purposes (Always start with: "The genetic information you just uploaded is a [document type] and its purposes are to [purpose]"),
		followed by a detailed breakdown of genetic variants, their clinical significance, associated conditions, and recommended actions or treatments,
		and include any pertinent non-genetic information in the "Other" category.`;
	} else if (req.body.role == 'young') {
		prompt = `Please create a simple and engaging explanation of the patient's genetic information, tailored for a young audience.
		Use clear and straightforward language to explain the patient's genetic situation, including any important genetic variants and their effects.
		The explanation should be informative yet easy to understand, enabling a young patient to grasp their genetic health status and ask questions.
		Begin with a basic explanation of the document type and its purpose (Always start with: "The genetic information you just uploaded is a [document type] and it is important because [purpose]"),
		followed by a friendly introduction of the patient, a simplified breakdown of genetic information into categories like important variants and their effects,
		and any other relevant information in an easy-to-understand "Other" category.`;
	} else if (req.body.role == 'adult') {
		prompt = `Please generate a clear and concise explanation of the patient's genetic information, suitable for an adult audience.
		The explanation should include essential information about genetic variants, their implications, and any associated conditions, presented in a way that is easy to understand for a non-expert.
		Aim to empower the patient with knowledge about their genetic situation to facilitate informed discussions with healthcare providers.
		Start with a brief overview of the document type and its purpose (Always start with: "The genetic information you just uploaded is a [document type] and it helps to explain [purpose]"),
		followed by an introduction of the patient, a well-organized presentation of genetic data in categories like important variants, their effects, associated conditions, etc.,
		and include any relevant additional information in the "Other" category.`;
	}

	let prompt2 = `Please create a JSON timeline from the patient's genetic information and individual events, with keys for 'date', 'eventType', and 'keyGeneticEvent'.
	Extract main genetic events from the documents and individual events, and add them to the timeline. EventType could only be 'diagnosis', 'treatment', 'test'.
	The timeline should be structured as a list of events, with each individual event containing a date, type, and a small description of the event.`;

	// var result = await langchain.navigator_summarize(req.body.userId, promt, req.body.conversation, req.body.context);
	let timeline = true;
	let promises = [
		azureFuncSummary(req, prompt),
		azureFuncSummary(req, prompt2, timeline)
	];
	
	// Utilizar Promise.all para esperar a que todas las promesas se resuelvan
	let [result, result2] = await Promise.all(promises);

	if(result.data){
		let data = {
			nameFiles: req.body.nameFiles,
			promt: prompt,
			role: req.body.role,
			conversation: req.body.conversation,
			context: req.body.context,
			result: result.data
		}
		let nameurl = req.body.paramForm+'/summary.json';
		f29azureService.createBlobSimple('data', nameurl, data);
	}

	if(result2.data){
		let data = {
			nameFiles: req.body.nameFiles,
			promt: prompt2,
			role: req.body.role,
			conversation: req.body.conversation,
			context: req.body.context,
			result: result2.data
		}
		let nameurl = req.body.paramForm+'/timeline.json';
		f29azureService.createBlobSimple('data', nameurl, data);
	}

	let finalResult = {
		"msg": "done", 
		"result1": result.data,
		"result2": result2.data,
		"status": 200
		}

	res.status(200).send(finalResult);
	}


async function azureFuncSummary(req, prompt, timeline=false){
    return new Promise(async function (resolve, reject) {
        const functionUrl = config.AF29URL + `/api/HttpTriggerSummarizer?code=${config.functionKey}`;
        axios.post(functionUrl, req.body.context, {
            params: {
                prompt: prompt,
                userId: req.body.userId,
				timeline: timeline
            },
            headers: {
                'Content-Type': 'application/json'
            },
        }).then(async response => {
            resolve(response);
        }).catch(error => {
          console.error("Error:", error);
          reject(error);
        });
    });
}

async function form_recognizer(userId, documentId, containerName, url) {
	return new Promise(async function (resolve, reject) {
		var url2 = "https://" + accountname + ".blob.core.windows.net/" + containerName + "/" + url + sas;
		const modelId = "prebuilt-layout"; // replace with your model id
		const endpoint = form_recognizer_endpoint; // replace with your endpoint
		const apiVersion = "2023-10-31-preview";
		const analyzeUrl = `${endpoint}/documentintelligence/documentModels/${modelId}:analyze?_overload=analyzeDocument&api-version=${apiVersion}&outputContentFormat=markdown`;

		const headers = {
			'Ocp-Apim-Subscription-Key': form_recognizer_key
		  };
		  
		  const body = {
			urlSource: url2
		  };
		  
		  axios.post(analyzeUrl, body, { headers: headers })
		  .then(async response => {
			
			const operationLocation = response.headers['operation-location'];
			let resultResponse;
			do {
			  resultResponse = await axios.get(operationLocation, { headers: headers });
			  if (resultResponse.data.status !== 'running') {
				break;
			  }
			  await new Promise(resolve => setTimeout(resolve, 1000));
			} while (true);
			
			// console.log(resultResponse);
			// console.log(resultResponse.data.error.details);
			let content = resultResponse.data.analyzeResult.content;

			const category_summary = await langchain.categorize_docs(userId, content);
	
			var response = {
			"msg": "done", 
			"data": content,
			"summary": category_summary,
			"doc_id": documentId, 
			"status": 200
			}

			const tokens = countTokens.countTokens(response.data);
			response.tokens = tokens;
			resolve(response);
		})
		.catch(error => {
		  console.error("Error in analyzing document:", error);
		  reject(error);
		});
	  }
	);
  }

module.exports = {
	callNavigator,
	callSummary,
	form_recognizer,
}
