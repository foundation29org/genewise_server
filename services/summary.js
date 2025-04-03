'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml'); // Requires: npm install js-yaml
const config = require('../config'); // Assuming config exists for potential future use
const langchain = require('./langchain'); // The refactored Langchain service
const f29azureService = require("./f29azure"); // Service for Azure Blob operations

// --- Constants ---
const GUIDELINES_DIR = path.join(__dirname, 'Guidelines');
const REP_SCHEMA_PATH = path.join(GUIDELINES_DIR, 'repSchema.YAML');
const GEN_RULES_PATH = path.join(GUIDELINES_DIR, 'genRules.YAML');

// --- Load YAML Content (Once at startup) ---
let repSchemaContent = '';
let genRulesContent = '';
try {
    repSchemaContent = fs.readFileSync(REP_SCHEMA_PATH, 'utf8');
    genRulesContent = fs.readFileSync(GEN_RULES_PATH, 'utf8');
    console.log("[SummaryService] YAML Guidelines (repSchema, genRules) loaded successfully.");
} catch (error) {
    console.error("[SummaryService] FATAL ERROR: Could not load YAML guideline files. Service cannot generate summaries without them.", error);
    process.exit(1); // Exit if essential files are missing
}

// --- Helper Functions ---

/**
 * Gets role-specific prompt instructions (strt phrase and detailed guidance).
 * NOTE: Updated instructions to mention required HTML tags.
 * @param {string} role - The role ('child', 'adolescent', 'adult').
 * @returns {object} - Object with startPhrase and instructions.
 */
function getRoleSpecificInstructions(role) {
    switch (role) {
        case 'child':
            return {
                startPhrase: `<p>"The genetic information you shared is called [document type] and it helps us understand [purpose]"</p>`, // Wrap start phrase in <p>
                instructions: `Create a simple and engaging explanation using basic HTML. Use clear, age-appropriate language. Structure the explanation logically according to **genRules.YAML**, simplifying content. Use HTML headings (like '<h2>Title</h2>') for main sections and paragraphs ('<p>Text...</p>'). For the glossary, use an unordered list ('<ul><li>Term: Definition</li>...</ul>'). Focus on clarity and reassurance. If no pathogenic variants, explain this simply within a paragraph.`
            };
        case 'adolescent':
            return {
                startPhrase: `<p>"The genetic information you uploaded is a [document type] and it helps us understand [purpose]"</p>`, // Wrap start phrase in <p>
                instructions: `Generate a clear explanation suitable for an adolescent using well-structured HTML. Include key information about variants, implications, and conditions. Structure logically following **genRules.YAML**. Use HTML headings ('<h2>Title</h2>', '<h3>Subtitle</h3>'), paragraphs ('<p>Text...</p>'), unordered lists ('<ul><li>Item</li></ul>') for things like glossary or key messages, and bold text ('<strong>important</strong>'). Empower the patient but remain neutral. If no pathogenic variants, explain this within a paragraph.`
            };
        case 'adult':
        default: // Default to 'adult'
            return {
                startPhrase: `<p>"The genetic information you uploaded is a [document type] and it helps explain [purpose]"</p>`, // Wrap start phrase in <p>
                instructions: `Generate a clear, concise explanation for an adult using well-structured HTML. Include essential information on variants, implications, and conditions based on **genRules.YAML**. Use appropriate HTML tags: '<h2>' for main section titles, '<h3>' for subsections (like 3.1, 3.2), '<p>' for text, '<strong>' for emphasis, and '<ul><li>' for lists (especially Glossary and Key Messages). Ensure neutrality and explain limitations if no pathogenic variants are found within a paragraph.`
            };
    }
}


// --- Main Endpoint Logic ---

/**
 * Generates a simplified summary (text report), associated metadata (JSON),
 * and a timeline (JSON) based on provided genetic context and YAML guidelines.
 * @param {object} req - Express request object. Body must contain: userId, context, role, nameFiles, paramForm.
 * @param {object} res - Express response object.
 */
async function callSummary(req, res) {
    // Step 1: Log entry and identify request
    const userId = req.body.userId;
    const role = req.body.role;
    const paramForm = req.body.paramForm; // Unique identifier for this generation task
    const contextInput = req.body.context; // Content of the official genetic report or related dat
    const nameFiles = req.body.nameFiles;   // Original file name(s)
    console.log(`[SummaryService] Received request for callSummary. User: ${userId}, Role: ${role}, ParamForm: ${paramForm}`);

    // Step 2: Input Validation
    if (!userId || !contextInput || !role || !paramForm || !nameFiles) {
        console.error("[SummaryService] Bad Request: Missing required fields in request body (userId, context, role, paramForm, nameFiles).");
        return res.status(400).send({ msg: "Bad Request: Missing required fields.", status: 400 });
    }
    // YAML files are checked at startup, no need to re-check here unless dynamic loading is introduced.

    try {
        // Step 3: Prepare System Prompt (Common Context for LLM)
        // Provides the raw materil and schema understanding for all subsequent tasks.
        const systemPromptBase = `
You are an expert genetics assistant analyzing patient genetic information.
You will be given context from an official genetic report and relevant schemas/rules.
Analyze the provided **Official Genetic Report Context** carefully.
Understand the expected structure of that report using the **Official Report Schema (repSchema.YAML)**.

**Official Genetic Report Context:**
\`\`\`text
${contextInput}
\`\`\`

**Official Report Schema (repSchema.YAML):**
\`\`\`yaml
${repSchemaContent}
\`\`\`
`;

        // Step 4: Prepare Prompts & Call Langchin Service for Each Task in Prallel
        // 4a. Task 1: Generate Simplified Report HTML
        const roleInstructions = getRoleSpecificInstructions(role);
        const userPromptSummaryText = `
Your task is to generate a simplified report as **well-structured HTML** based on the provided context and rules.

**Detailed Generation Rules (genRules.YAML):**
\`\`\`yaml
${genRulesContent}
\`\`\`

**HTML Formatting Requirements:**
1. **Format the entire output as valid HTML.** Use appropriate semantic tags (e.g., '<h3>', '<p>', '<ul>', '<li>', '<strong>').
2. Verify HTML validity multiple times before submitting.
3. Keep headings concise and informative.
4. Do NOT use CSS or Javascript.

**Content Structure:**
1. The simplified report HTML MUST **start exactly with the phrase**: ${roleInstructions.startPhrase}. Fill in '[document type]' and '[purpose]' placeholders based on context analysis.
2. **Strictly follow the structure and logic in genRules.YAML** to build the report section by section.
3. Clearly mark optional sections that can be omitted if not applicable.

**Audience Adaptation:**
1. **Adapt language, tone, and detail level** for the target audience: **'${role}'**.
2. Use the specific guidance provided below for this role.
3. Ensure the report is clear, informative, neutral, and avoids definitive medical conclusions.
4. Explain limitations if no causal findings exist, using standard HTML paragraphs.

**Output Format:**
1. **Return ONLY the generated HTML content.**
2. Do not include any explanatory text, markdown formatting, or code block markers.

**Specific Instructions for Role '${role}':**
${roleInstructions.instructions}
`;

        // 4b. Task 2: Extract Metadta JSON
        const userPromptMetadataJson = `
Based on your analysis of the **Official Genetic Report Context** and understanding of the **Official Report Schema (repSchema.YAML)**:

1.  Extract the following metadata points.
2.  Return the information **strictly as a single JSON object**.
3.  **Do NOT include any text before or after the JSON object**.
4.  Ensure the JSON values adhere to the specified types/options.

**Required Metadata Keys and Values:**
\`\`\`json
{
  "type_of_technique": "<'WGS'|'Exome'|'Panel'|'Unknown'>", // Determine from report sections like Title, Methodology
  "pathogenic_variants_present": <true|false>, // Based on genRules logic for 'primary_finding_exists' (P/LP explicitly stated as causal for phenotype)
  "genetic_inheritance_pattern": "<'autosomal dominant'|'autosomal recessive'|'X-linked dominant'|'X-linked recessive'|'Y-linked'|'mitochondrial'|'multifactorial'|'uncertain'|'not applicable'>", // Determine based on primary finding (if present and pattern is clear) or state 'uncertain'/'not applicable'
  "paternal_tests_confirmation_needed": <true|false> // Determine based on genRules section 6 logic (parental study recommended for interpretation)
}
\`\`\`

**Example Output (ensure your output is ONLY the JSON):**
\`\`\`json
{
  "type_of_technique": "Exome",
  "pathogenic_variants_present": false,
  "genetic_inheritance_pattern": "uncertain",
  "paternal_tests_confirmation_needed": true
}
\`\`\`
`;

        // 4c. Task 3: Extrct Timeline JSON
        const userPromptTimelineJson = `
Based on your analysis of the **Official Genetic Report Context**:

1.  Create a chronological timeline of key events mentioned in the text.
2.  Structure the timeline as a JSON array of event objects.
3.  Each event object must have the keys: 'date', 'eventType', 'keyGeneticEvent'.
4.  Standardize dates to 'YYYY-MM-DD' if possible. Use 'Unknown' if no date is found for a key event.
5.  Choose 'eventType' from: 'diagnosis', 'treatment', 'test', 'genetic_finding', 'consultation', 'birth_date', 'sample_collection', 'report_date', 'other'.
6.  'keyGeneticEvent' should be a concise description (e.g., "WES performed", "VUS in GENEX identified", "Pathogenic variant confirmed", "Patient born", "Report issued").
7.  **Return ONLY the JSON array (starting with '[' and ending with ']').** Do not include any explanatory text, markdown formatting, or anything else.

**Example Output (ensure your output is ONLY the JSON array):**
\`\`\`json
[
  { "date": "2013-11-15", "eventType": "birth_date", "keyGeneticEvent": "Patient born" },
  { "date": "2021-02-28", "eventType": "sample_collection", "keyGeneticEvent": "Peripheral blood sample collected" },
  { "date": "Unknown", "eventType": "test", "keyGeneticEvent": "WES performed (Agilent SSel XT HS+XT)" },
  { "date": "2023-05-11", "eventType": "report_date", "keyGeneticEvent": "WES Report issued" }
]
\`\`\`
`;

        // Step 5: Execute LLM calls in parallel using the refactored Langchain service
        console.log("[SummaryService] Sending prompts to Langchain service...");
        const promises = [
            langchain.generateStructuredText(userId, systemPromptBase, userPromptSummaryText),
            langchain.extractJson(userId, systemPromptBase, userPromptMetadataJson),
            langchain.extractJson(userId, systemPromptBase, userPromptTimelineJson)
        ];

        // Wait for all LLM calls to complete
        // Use Promise.allSettled to handle potential individual failures gracefully
        const results = await Promise.allSettled(promises);

        const summaryTextResult = results[0];
        const metadataJsonResult = results[1];
        const timelineJsonResult = results[2];

        console.log("[SummaryService] Langchain responses received.");

        // Step 6: Process LLM Responses (handle settled promises)

        let finalSummaryHtml = "<p>Error: Could not generate the simplified summary.</p>";
        let finalMetadataJson = { error: "Metadata extraction failed." };
        let finalTimelineJson = []; // Default to empty array

        // Process Summary HTML
        if (summaryTextResult.status === 'fulfilled' && typeof summaryTextResult.value === 'string') {
            finalSummaryHtml = summaryTextResult.value.trim();
            if (!finalSummaryHtml.startsWith('<') || !finalSummaryHtml.endsWith('>')) {
                console.warn("[SummaryService] LLM response for HTML doesn't seem to start/end with tags. Check output.");
            }
            console.log("[SummaryService] Simplified Report HTML generated successfully.");
        } else {
            console.error("[SummaryService] Failed to generate Simplified Report HTML:", summaryTextResult.reason || "Unknown error");
            // Keep default error message for finalSummaryHtml
            // Log the raw prompt used for debugging
            console.error("[SummaryService] Failed Prompt (Summary HTML):\n", userPromptSummaryText);
        }

        // Process Metadata JSON
        if (metadataJsonResult.status === 'fulfilled' && typeof metadataJsonResult.value === 'object') {
            finalMetadataJson = metadataJsonResult.value; // Already parsed by langchain.extractJson
            console.log("[SummaryService] Metadata JSON extracted successfully:", finalMetadataJson);
        } else {
            console.error("[SummaryService] Failed to extract Metadata JSON:", metadataJsonResult.reason || "Unknown error");
             // Keep default error message for finalMetadataJson
             // Log the raw prompt used for debugging
            console.error("[SummaryService] Failed Prompt (Metadata JSON):\n", userPromptMetadataJson);
        }

        // Process Timeline JSON
        if (timelineJsonResult.status === 'fulfilled' && Array.isArray(timelineJsonResult.value)) {
            finalTimelineJson = timelineJsonResult.value; // Already parsed by langchain.extractJson
            console.log("[SummaryService] Timeline JSON extracted successfully.");
        } else {
            console.error("[SummaryService] Failed to extract Timeline JSON:", timelineJsonResult.reason || "Unknown error");
            finalTimelineJson = [{ date: "Error", eventType: "error", keyGeneticEvent: "Timeline extraction failed." }]; // Provide error entry in timeline
            // Log the raw prompt used for debugging
            console.error("[SummaryService] Failed Prompt (Timeline JSON):\n", userPromptTimelineJson);
        }

        // Step 7: Persist Generation Details to Azure Blob Storage
        const blobPromises = [];
        const timestamp = new Date().toISOString();
        const generationBaseUrl = `${paramForm}/${timestamp.replace(/:/g, '-')}`; // Unique path per request/timestamp

        // 7a. Save Summary Generation Details
        const summaryDataToSave = {
            generationJobId: paramForm,
            userId: userId,
            role: role,
            sourceFileNames: nameFiles,
            // contextUsed: contextInput, // Optional: Exclude if too large/sensitive
            promptUsedForSummaryHtml: userPromptSummaryText,
            promptUsedForMetadata: userPromptMetadataJson,
            llmRawResponseSummaryHtml: summaryTextResult.status === 'fulfilled' ? summaryTextResult.value : `Error: ${summaryTextResult.reason}`,
            llmRawResponseMetadata: metadataJsonResult.status === 'fulfilled' ? JSON.stringify(metadataJsonResult.value) : `Error: ${metadataJsonResult.reason}`,
            generatedSummaryHtml: finalSummaryHtml,
            extractedMetadata: finalMetadataJson,
            generationTimestamp: timestamp,
            status: (summaryTextResult.status === 'fulfilled' && metadataJsonResult.status === 'fulfilled') ? 'Success' : 'Partial Failure or Failure'
        };
        const summaryBlobUrl = `${generationBaseUrl}/summary_generation_details.json`;
        blobPromises.push(
            f29azureService.createBlobSimple('data', summaryBlobUrl, summaryDataToSave)
                .then(() => console.log(`[SummaryService] Summary generation details saved to blob: ${summaryBlobUrl}`))
                .catch(err => console.error(`[SummaryService] Failed to save summary details blob: ${summaryBlobUrl}`, err))
        );

        // 7b. Save Timeline Generation Details
        const timelineDataToSave = {
            generationJobId: paramForm,
            userId: userId,
            sourceFileNames: nameFiles,
            // contextUsed: contextInput, // Optional
            promptUsedForTimeline: userPromptTimelineJson,
            llmRawResponseTimeline: timelineJsonResult.status === 'fulfilled' ? JSON.stringify(timelineJsonResult.value) : `Error: ${timelineJsonResult.reason}`,
            generatedTimelineJson: finalTimelineJson, // Store the final array (or error object)
            generationTimestamp: timestamp,
            status: timelineJsonResult.status === 'fulfilled' ? 'Success' : 'Failure'
        };
        const timelineBlobUrl = `${generationBaseUrl}/timeline_generation_details.json`;
        blobPromises.push(
            f29azureService.createBlobSimple('data', timelineBlobUrl, timelineDataToSave)
                .then(() => console.log(`[SummaryService] Timeline generation details saved to blob: ${timelineBlobUrl}`))
                .catch(err => console.error(`[SummaryService] Failed to save timeline details blob: ${timelineBlobUrl}`, err))
        );

        // Wait for blob saving (optional, depending on requirements)
        await Promise.allSettled(blobPromises); // Use allSettled here too
        console.log("[SummaryService] Blob saving operations attempted.");

        // Step 8: Format and Send Final Response to Client
        const finalResult = {
            msg: "done", // Indicate processing finished, check results for success/failure
            // Result 1: The simplified text report
            result1: finalSummaryHtml,
             // Result 2: The timeline as a JSON array (client can stringify if needed)
            result2: finalTimelineJson,
             // Metadata: The extracted metadata object
            metadata: finalMetadataJson,
            status: 200 // HTTP status is 200, but content indicates success/failure of individual parts
        };

        res.status(200).send(finalResult);
        console.log(`[SummaryService] Successfully processed request for User: ${userId}, Role: ${role} (check results for individual task success)`);

    } catch (error) {
        // Step 9: Global Error Handling (Errors not caught during specific task processing)
        console.error("[SummaryService] Critical Error in callSummary function:", error);
        // Log the specific error if possible
        insights.error(error); // Log to monitoring if available

        res.status(500).send({
            msg: "Internal Server Error",
            error: "An unexpected error occurred during summary generation.",
            error_details: error.message, // Provide error message for debugging
            status: 500
        });
    }
}

// --- Exports ---
module.exports = {
    callSummary,
};