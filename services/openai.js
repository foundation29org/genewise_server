const { Configuration, OpenAIApi } = require("openai");
const { OpenAIClient, AzureKeyCredential } = require("@azure/openai");
const config = require('../config')
const insights = require('../services/insights')
const configuration = new Configuration({
  apiKey: config.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);
const crypt = require('../services/crypt')
const langchain = require('../services/langchain')

const endpoint = config.AZURE_OPENAI_ENDPOINT;
const azureApiKey = config.OPENAI_API_KEY

function callOpenAiContext (req, res){
  var content = req.body;

  (async () => {
    try {
      const client = new OpenAIClient(endpoint, new AzureKeyCredential(azureApiKey));
    const deploymentId = "nav29turbo35";
    const result = await client.getChatCompletions({
        deploymentName: deploymentId, 
        messages: content,
        temperature: 0,
        max_tokens: 800,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
      });
      res.status(200).send(result)
    }catch(e){
      console.log(e)
      if (e.response) {
        console.log(e.response.status);
        console.log(e.response.data);
      } else {
        console.log(e.message);
      }
      console.error("[ERROR]: " + e)
      res.status(500).send(e)
    }
    
  })();
}


module.exports = {
  callOpenAiContext
}
