'use strict';

// --- Dependencias ---
const axios = require('axios');
const config = require('./../config'); // Assuming config is in the parent directory
const countTokens = require('@anthropic-ai/tokenizer');

// --- Constantes y Configuración Específicas de Form Recognizer ---
// Ensure these are correctly defined in your './../config.js' file
const SAS_TOKEN = config.BLOB.SAS;
const BLOB_ACCOUNT_NAME = config.BLOB.NAMEBLOB;
const FORM_RECOGNIZER_KEY = config.FORM_RECOGNIZER_KEY;
const FORM_RECOGNIZER_ENDPOINT = config.FORM_RECOGNIZER_ENDPOINT;

// --- Lógica de Form Recognizer ---

/**
 * Analiza un documento usando Azure Form Recognizer (Document Intelligence).
 * @param {string} userId - ID del usuario (para posible logging o auditoría futura, no usado en la llamada directa a Azure).
 * @param {string} documentId - ID del documento (para asociar la respuesta).
 * @param {string} containerName - Nombre del contenedor Blob donde está el documento.
 * @param {string} url - Nombre/ruta del blob dentro del contenedor.
 * @returns {Promise<object>} - Promesa que resuelve con el contenido analizado y metadatos.
 */
async function form_recognizer(userId, documentId, containerName, url) {
    // Check if required config values are present
    if (!SAS_TOKEN || !BLOB_ACCOUNT_NAME || !FORM_RECOGNIZER_KEY || !FORM_RECOGNIZER_ENDPOINT) {
        console.error("FATAL ERROR: Missing required configuration for Form Recognizer (SAS, Blob Name, FR Key/Endpoint).");
        return Promise.reject({
             msg: "Configuration Error",
             error: "Missing required configuration for Form Recognizer service.",
             status: 500
         });
    }

    return new Promise(async (resolve, reject) => {
        try {
            // Construct the full blob URL with SAS token for Azure Function access
            const documentUrlWithSas = `https://${BLOB_ACCOUNT_NAME}.blob.core.windows.net/${containerName}/${url}${SAS_TOKEN}`;

            // Configuration for the Form Recognizer API call
            const modelId = "prebuilt-layout"; // Using the prebuilt layout model
            const apiVersion = "2023-10-31-preview"; // Use a specific, tested API version
            const analyzeUrl = `${FORM_RECOGNIZER_ENDPOINT}/documentintelligence/documentModels/${modelId}:analyze?_overload=analyzeDocument&api-version=${apiVersion}&outputContentFormat=markdown`; // Request markdown output

            const headers = {
                'Ocp-Apim-Subscription-Key': FORM_RECOGNIZER_KEY,
                'Content-Type': 'application/json'
            };

            const body = {
                urlSource: documentUrlWithSas // Pointing the service to the document URL
            };

            console.log(`[FormRecognizer] Analyzing document: ${url} for user ${userId} with model ${modelId}`);
            // Initial POST request to start the analysis job
            const initialResponse = await axios.post(analyzeUrl, body, { headers: headers });

            // Get the URL to poll for the result from the 'operation-location' header
            const operationLocation = initialResponse.headers['operation-location'];
            if (!operationLocation) {
                throw new Error("Form Recognizer did not return an operation-location header.");
            }
            console.log(`[FormRecognizer] Analysis job started. Polling location: ${operationLocation}`);

            let resultResponse;
            let retryCount = 0;
            const maxRetries = 45; // Increased max wait time slightly (e.g., 45 seconds)
            const retryDelayMs = 1000; // Poll every 1 second

            // Polling loop to check the status of the analysis job
            do {
                await new Promise(resolve => setTimeout(resolve, retryDelayMs)); // Wait before next poll

                resultResponse = await axios.get(operationLocation, { headers: headers });
                retryCount++;
                const status = resultResponse.data.status;
                console.log(`[FormRecognizer] Polling status: ${status} (Attempt ${retryCount}/${maxRetries})`);

                if (status === 'succeeded') {
                    console.log("[FormRecognizer] Analysis succeeded.");
                    break; // Exit loop on success
                } else if (status === 'failed') {
                    console.error("[FormRecognizer] Analysis failed:", resultResponse.data.error);
                    throw new Error(`Form Recognizer analysis failed: ${resultResponse.data.error?.message || 'Unknown analysis error'}`);
                } else if (status !== 'running' && status !== 'notStarted') {
                     // Log unexpected statuses but continue polling unless it's failed
                     console.warn(`[FormRecognizer] Unexpected status encountered: ${status}`);
                }

                if (retryCount >= maxRetries) {
                    throw new Error(`Form Recognizer analysis timed out after ${maxRetries} attempts.`);
                }

            } while (resultResponse.data.status === 'running' || resultResponse.data.status === 'notStarted');


            // Process the successful result
            if (resultResponse.data.status === 'succeeded') {
                const analysisResult = resultResponse.data.analyzeResult;
                if (!analysisResult || !analysisResult.content) {
                     console.warn("[FormRecognizer] Analysis succeeded but content is missing in the result.");
                     // Decide how to handle this - reject or resolve with empty content?
                     // Let's resolve with empty content for now, but log a warning.
                     analysisResult = { content: "" };
                }
                const content = analysisResult.content;

                const responsePayload = {
                    msg: "done",
                    data: content, // Analyzed content in Markdown format
                    // summary: content, // Removed redundant summary field
                    doc_id: documentId,
                    status: 200,
                    tokens: 0 // Initialize tokens
                };

                // Safely count tokens
                try {
                    responsePayload.tokens = countTokens.countTokens(content || "");
                } catch(tokenError) {
                    console.error("[FormRecognizer] Could not count tokens for Form Recognizer content:", tokenError);
                    responsePayload.tokens = -1; // Indicate token counting error
                }

                resolve(responsePayload);

            } else {
                 // This case should theoretically not be reached due to the loop's exit conditions
                 throw new Error(`[FormRecognizer] Analysis ended with unexpected final status: ${resultResponse.data.status}`);
            }

        } catch (error) {
            console.error("[FormRecognizer] Error in form_recognizer function:", error.response ? error.response.data : error.message);
            reject({
                msg: "Form Recognizer Error",
                error: error.message || "Unknown error during form recognition",
                details: error.response ? JSON.stringify(error.response.data) : null, // Stringify details
                status: error.response ? error.response.status : 500
            });
        }
    });
}


// --- Exportaciones ---
module.exports = {
    form_recognizer,
};