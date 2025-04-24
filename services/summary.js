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
const EASY_READING_PATH = path.join(GUIDELINES_DIR, 'easyReading.YAML');

// --- Load YAML Content (Once at startup) ---
let repSchemaContent = '';
let genRulesContent = '';
let easyReadingContent = '';
try {
    repSchemaContent = fs.readFileSync(REP_SCHEMA_PATH, 'utf8');
    genRulesContent = fs.readFileSync(GEN_RULES_PATH, 'utf8');
    easyReadingContent = fs.readFileSync(EASY_READING_PATH, 'utf8');
    console.log("[SummaryService] YAML Guidelines (repSchema, genRules, easyReading) loaded successfully.");
} catch (error) {
    console.error("[SummaryService] FATAL ERROR: Could not load YAML guideline files. Service cannot generate summaries without them.", error);
    process.exit(1); // Exit if essential files are missing
}

// --- Helper Functions ---

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
    const role = req.body.role; // Role is logged but generation logic is unified
    const paramForm = req.body.paramForm; // Unique identifier for this generation task
    let contextInput = req.body.context; // Content of the official genetic report or related data
    const nameFiles = req.body.nameFiles;   // Original file name(s)
    console.log(`[SummaryService] Received request for callSummary. User: ${userId}, Role: ${role}, ParamForm: ${paramForm}`);

    // Step 2: Input Validation & Context Processing
    if (!userId || !contextInput || !role || !paramForm || !nameFiles) {
        console.error(`[SummaryService] Bad Request (ParamForm: ${paramForm}, User: ${userId}): Missing required fields.`);
        return res.status(400).send({ msg: "Bad Request: Missing required fields.", status: 400 });
    }
    // YAML files are checked at startup.

    // Ensure context is a single string
    if (Array.isArray(contextInput)) {
        console.log(`[SummaryService] (ParamForm: ${paramForm}, User: ${userId}) Input context is an array, joining into a single string.`);
        contextInput = contextInput.join('\\n\\n---\\n\\n'); // Join sections if provided as an array
    } else if (typeof contextInput !== 'string') {
        console.error(`[SummaryService] Bad Request (ParamForm: ${paramForm}, User: ${userId}): Context must be a string or an array of strings.`);
        return res.status(400).send({ msg: "Bad Request: Invalid context format.", status: 400 });
    }
    const processedContext = contextInput; // Use this variable henceforth

    try {
        // Step 3: Prepare System Prompt (Common Context for LLM)
        const systemPromptBase = `
You are an expert genetics assistant analyzing patient genetic information.
You will be given context from an official genetic report and relevant schemas/rules.
Analyze the provided **Official Genetic Report Context** carefully.
Understand the expected structure of that report using the **Official Report Schema (repSchema.YAML)**.
Apply the **Easy Reading (easyReading.YAML)** to make the report easier to understand.

**Official Genetic Report Context:**
\`\`\`text
${processedContext}
\`\`\`

**Official Report Schema (repSchema.YAML):**
\`\`\`yaml
${repSchemaContent}
\`\`\`
`;

        // Step 4: Prepare Prompts & Call Langchain Service for Each Task in Parallel
        // 4a. Task 1: Generate Simplified Report HTML (Role-unified)
        // Note: Role-specific instructions are removed/standardized, the 'role' variable is kept for logging.
        const userPromptSummaryText = `
Your task is to generate a simplified report as **well-structured HTML** based on the provided context and rules, intended for an adult/adolescent audience.

**Detailed Generation Rules (genRules.YAML):**
\`\`\`yaml
${genRulesContent}
\`\`\`

**Easy Reading (easyReading.YAML):**
\`\`\`yaml
${easyReadingContent}
\`\`\`

**Specific Instructions:**

- Use clear, respectful language appropriate for non-experts (adults/adolescents). Avoid overly technical jargon.
- Explain key terms (e.g., variant, gene name) simply when first introduced.
- Include key findings if present (e.g., gene, type of variant, potential relevance).
- If no causal variant is identified, explain this clearly and mention test limitations briefly.
- Mention possible inheritance patterns *only if* explicitly stated and clear in the source report.

**HTML Formatting Requirements:**
1. **Format the entire output as valid HTML.** Use appropriate semantic tags (e.g., '<h3>', '<p>', '<ul>', '<li>', '<strong>').
2. Verify HTML validity multiple times before submitting.
3. Keep headings concise and informative.
4. Do NOT use CSS or Javascript.
5. Use '<h3>' tags for section headers and down to '<h6>' for subheaders.

**Content Structure:**
1. **Strictly follow the structure and logic in genRules.YAML** to build the report section by section.
2. Adjust header numbering if some sections are not present.
3. Insert "[IMAGE]" (exactly this one) placeholder at the end of the hereditary section when applicable (!important).

**Audience Adaptation:**
1. **Maintain a consistent tone and detail level** suitable for an adult/adolescent non-expert.
2. Ensure the report is clear, informative, neutral, and avoids definitive medical conclusions or advice.
3. Explain limitations if no causal findings exist, using standard HTML paragraphs.

**Output Format:**
1. **Return ONLY the generated HTML content.**
2. Do not include any explanatory text, markdown formatting, or code block markers.
`;

        // 4b. Task 2: Extract Inheritance Pattern JSON
        const userPromptInheritanceJson = `
Based on your analysis of the **Official Genetic Report Context** and understanding of the **Official Report Schema (repSchema.YAML)**:

1.  Determine the **genetic inheritance pattern** based *only* on the primary finding if a P/LP variant is explicitly stated as causal for the phenotype.
2.  Choose the pattern from: 'autosomal dominant', 'autosomal recessive', 'X-linked dominant', 'X-linked recessive', 'Y-linked', 'mitochondrial', 'multifactorial'.
3.  If no causal P/LP variant is found, or if the inheritance pattern is not clearly stated or derivable from the primary finding, use 'uncertain'.
4.  If the concept of inheritance is not applicable (e.g., somatic findings), use 'not applicable'.
5.  Return the information **strictly as a single JSON object** with only the key "genetic_inheritance_pattern".
6.  **Do NOT include any text before or after the JSON object**.

**Required JSON Structure:**
\`\`\`json
{
  "genetic_inheritance_pattern": "<'autosomal dominant'|'autosomal recessive'|'X-linked dominant'|'X-linked recessive'|'Y-linked'|'mitochondrial'|'multifactorial'|'uncertain'|'not applicable'>"
}
\`\`\`

**Example Output (ensure your output is ONLY the JSON):**
\`\`\`json
{
  "genetic_inheritance_pattern": "uncertain"
}
\`\`\`
`;

        // Step 5: Execute LLM calls in parallel using the refactored Langchain service
        console.log(`[SummaryService] Sending prompts to Langchain service... (ParamForm: ${paramForm}, User: ${userId})`);
        const promises = [
            langchain.generateStructuredText(userId, systemPromptBase, userPromptSummaryText),
            langchain.extractJson(userId, systemPromptBase, userPromptInheritanceJson) // Changed from userPromptMetadataJson
            // Timeline call removed
        ];

        // Wait for all LLM calls to complete
        const results = await Promise.allSettled(promises);

        const summaryTextResult = results[0];
        const inheritanceJsonResult = results[1]; // Renamed from metadataJsonResult
        // timelineJsonResult removed

        console.log(`[SummaryService] Langchain responses received. (ParamForm: ${paramForm}, User: ${userId})`);

        // Step 6: Process LLM Responses (handle settled promises)

        let finalSummaryHtml = `<p>Apologies, the simplified summary could not be generated at this time. Please try again later or contact support if the issue persists. (Ref: ${paramForm})</p>`; // More user-friendly error
        let inheritancePatternData = { genetic_inheritance_pattern: "extraction_failed" }; // Renamed from finalMetadataJson, simplified structure

        // Process Summary HTML
        if (summaryTextResult.status === 'fulfilled' && typeof summaryTextResult.value === 'string') {
            finalSummaryHtml = summaryTextResult.value.trim();
            if (!finalSummaryHtml.startsWith('<') || !finalSummaryHtml.endsWith('>')) {
                console.warn(`[SummaryService] (ParamForm: ${paramForm}, User: ${userId}) LLM response for HTML doesn't seem to start/end with tags. Check output.`);
            }
            console.log(`[SummaryService] Simplified Report HTML generated successfully. (ParamForm: ${paramForm}, User: ${userId})`);
        } else {
            const errorReason = summaryTextResult.reason || "Unknown error";
            console.error(`[SummaryService] (ParamForm: ${paramForm}, User: ${userId}) Failed to generate Simplified Report HTML:`, errorReason);
            // Log the raw prompt used for debugging
            console.error(`[SummaryService] (ParamForm: ${paramForm}, User: ${userId}) Failed Prompt (Summary HTML):\n`, userPromptSummaryText);
            // insights.error(`Summary HTML generation failed for ${paramForm}, User: ${userId}`, { error: errorReason, prompt: userPromptSummaryText }); // Optional: Log to insights
        }

        // Process Inheritance Pattern JSON
        if (inheritanceJsonResult.status === 'fulfilled'
            && typeof inheritanceJsonResult.value === 'object'
            && inheritanceJsonResult.value !== null
            && inheritanceJsonResult.value.hasOwnProperty('genetic_inheritance_pattern'))
        {
            inheritancePatternData = { genetic_inheritance_pattern: inheritanceJsonResult.value.genetic_inheritance_pattern }; // Extract only the required key
            console.log(`[SummaryService] Inheritance Pattern JSON extracted successfully:`, inheritancePatternData, `(ParamForm: ${paramForm}, User: ${userId})`);
        } else {
            const errorReason = inheritanceJsonResult.reason || "Invalid or missing response object/key";
            console.error(`[SummaryService] (ParamForm: ${paramForm}, User: ${userId}) Failed to extract Inheritance Pattern JSON:`, errorReason, "Received:", inheritanceJsonResult.value);
             // Log the raw prompt used for debugging
            console.error(`[SummaryService] (ParamForm: ${paramForm}, User: ${userId}) Failed Prompt (Inheritance JSON):\n`, userPromptInheritanceJson);
            // insights.error(`Inheritance JSON extraction failed for ${paramForm}, User: ${userId}`, { error: errorReason, prompt: userPromptInheritanceJson, response: inheritanceJsonResult.value }); // Optional: Log to insights
            // Keep default error message for inheritancePatternData
        }

        // Timeline processing block removed

        // Step 7: Persist Generation Details to Azure Blob Storage
        const blobPromises = []; // Only one blob now
        const timestamp = new Date().toISOString();
        const generationBaseUrl = `${paramForm}/${timestamp.replace(/:/g, '-')}`; // Unique path per request/timestamp

        // 7a. Save Generation Details (consolidated)
        const generationDetailsToSave = { // Renamed from summaryDataToSave
            generationJobId: paramForm,
            userId: userId,
            role: role, // Keep role for tracking
            sourceFileNames: nameFiles,
            // contextUsed: processedContext, // Optional: Exclude if too large/sensitive
            promptUsedForSummaryHtml: userPromptSummaryText,
            promptUsedForInheritance: userPromptInheritanceJson, // Renamed
            llmRawResponseSummaryHtml: summaryTextResult.status === 'fulfilled' ? summaryTextResult.value : `Error: ${summaryTextResult.reason}`,
            llmRawResponseInheritance: inheritanceJsonResult.status === 'fulfilled' ? JSON.stringify(inheritanceJsonResult.value) : `Error: ${inheritanceJsonResult.reason}`, // Renamed
            generatedSummaryHtml: finalSummaryHtml,
            extractedInheritancePattern: inheritancePatternData, // Renamed and simplified
            generationTimestamp: timestamp,
            status: (summaryTextResult.status === 'fulfilled' && inheritanceJsonResult.status === 'fulfilled') ? 'Success' : 'Partial Failure or Failure' // Adjusted status check
        };
        const generationDetailsBlobUrl = `${generationBaseUrl}/generation_details.json`; // Consolidated blob name
        blobPromises.push(
            f29azureService.createBlobSimple('data', generationDetailsBlobUrl, generationDetailsToSave)
                .then(() => console.log(`[SummaryService] Generation details saved to blob: ${generationDetailsBlobUrl} (ParamForm: ${paramForm}, User: ${userId})`))
                .catch(err => console.error(`[SummaryService] Failed to save generation details blob: ${generationDetailsBlobUrl} (ParamForm: ${paramForm}, User: ${userId})`, err))
        );

        // Timeline blob saving logic removed

        // Wait for blob saving
        await Promise.allSettled(blobPromises);
        console.log(`[SummaryService] Blob saving operation attempted. (ParamForm: ${paramForm}, User: ${userId})`);

        // Step 8: Format and Send Final Response to Client
        const finalResult = {
            msg: "done", // Indicate processing finished, check results for success/failure
            result1: finalSummaryHtml, // Result 1: The simplified text report
            // result2 (timeline) removed
            metadata: inheritancePatternData, // Metadata: Simplified inheritance pattern object
            status: 200 // HTTP status is 200, individual task success indicated within payload
        };

        res.status(200).send(finalResult);
        console.log(`[SummaryService] Successfully processed request for User: ${userId}, Role: ${role}, ParamForm: ${paramForm} (check results for individual task success)`);

    } catch (error) {
        // Step 9: Global Error Handling
        console.error(`[SummaryService] Critical Error in callSummary (ParamForm: ${paramForm}, User: ${userId}):`, error);
        // Log the specific error if possible
        // insights.error(`Critical error in callSummary for ${paramForm}, User: ${userId}`, error); // Log to monitoring

        res.status(500).send({
            msg: "Internal Server Error",
            error: `An unexpected error occurred during summary generation. Please contact support if the issue persists. (Ref: ${paramForm})`, // More user-friendly, includes ref
            // error_details: error.message, // Potentially remove raw message from client response for security
            status: 500
        });
    }
}

// --- Exports ---
module.exports = {
    callSummary,
};