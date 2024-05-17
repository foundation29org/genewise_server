'use strict'

const config = require('../config')
const key = config.TA_KEY;
const endpoint = config.TA_ENDPOINT;
const insights = require('../services/insights')

const {
    AzureKeyCredential,
    TextAnalysisClient,
  } = require("@azure/ai-language-text");

  console.log(key)
  const client = new TextAnalysisClient(endpoint, new AzureKeyCredential(key));


async function callTextAnalytics (req, res){
    var jsonText = req.body;
    const documents = [
        jsonText.text
      ];
    const actions = [
        {
          kind: "Healthcare",
        },
      ];

  const poller = await client.beginAnalyzeBatch(actions, documents, "en");
  const results = await poller.pollUntilDone();
  for await (const actionResult of results) {
    if (actionResult.kind !== "Healthcare") {
      //throw new Error(`Expected a healthcare results but got: ${actionResult.kind}`);
      insights.error(`Expected a healthcare results but got: ${actionResult.kind}`)
      res.status(500).send(`Expected a healthcare results but got: ${actionResult.kind}`)
    }
    if (actionResult.error) {
      const { code, message } = actionResult.error;
      //throw new Error(`Unexpected error (${code}): ${message}`);
      insights.error(`Unexpected error (${code}): ${message}`)
      res.status(500).send(`Unexpected error (${code}): ${message}`)
    }
    for (const result of actionResult.results) {
      if (result.error) {
        const { code, message } = result.error;
        //throw new Error(`Unexpected error (${code}): ${message}`);
        insights.error(`Unexpected error (${code}): ${message}`)
        res.status(500).send(`Unexpected error (${code}): ${message}`)
      }
      res.status(200).send(result)
    }
  }
}


module.exports = {
	callTextAnalytics
}
