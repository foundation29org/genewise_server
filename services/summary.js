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
const BLOB_CONTAINER_NAME = 'data'; // Define container name as constant

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

/**
 * Builds the system prompt common to all LLM calls.
 * @param {string} context - The processed genetic report context.
 * @param {string} schemaContent - The content of repSchema.YAML.
 * @returns {string} The formatted system prompt.
 */
function _buildSystemPrompt(context, schemaContent) {
    return `
## SYSTEM PROMPT: Genetics Assistant Context

**Your Role:**
You are an expert genetics assistant specializing in post-counseling reinforcement. You will be given context from an official genetic report and relevant schemas/rules. Your primary goal is to create accessible materials that reinforce key genetic information discussed during counseling sessions, specifically designed for adults/adolescents who have received genetic counseling.

---

**Input: Official Genetic Report Context**
*Description: This is the primary source material from the official genetic report.*
*Content (text):*
\`\`\`text
${context}
\`\`\`

---

**Schema: Official Report Schema (repSchema.YAML)**
*Description: This schema describes the expected structure of the official genetic report provided in the Input Context.*
*Content (yaml):*
\`\`\`yaml
${schemaContent}
\`\`\`
`;
}

/**
 * Builds the user prompt for generating the simplified HTML report.
 * @param {string} rulesContent - The content of genRules.YAML.
 * @param {string} easyReadingRules - The content of easyReading.YAML.
 * @returns {string} The formatted user prompt for HTML generation.
 */
function _buildSummaryHtmlUserPrompt(rulesContent, easyReadingRules) {
    return `
## USER PROMPT: Generate Simplified HTML Report

**Task Description:**
Generate post-counseling reinforcement material as **well-structured, valid HTML** based on the context provided in the System Prompt and the rules below. Target audience: adults/adolescents who have received genetic counseling.

---

**Rules: Detailed Generation Rules (genRules.YAML)**
*Content (yaml):*
\`\`\`yaml
${rulesContent}
\`\`\`

---

**Rules: Easy Reading Guidelines (easyReading.YAML)**
*Content (yaml):*
\`\`\`yaml
${easyReadingRules}
\`\`\`

---

**Detailed Instructions:**

**General Principles:**
* **Audience:** Adult/adolescent, post-genetic counseling reinforcement.
* **Language:** Clear, respectful, non-expert. Explain key terms on first use.
* **Tone:** Informative, neutral, supportive. **Do NOT** provide medical advice.
* **Focus:** Reinforce information already discussed in counseling.

**Content Specifics:**
* **Section 2:** Include brief introductions for genes, exome, variants per genRules.YAML.
* **Limitations:** Include simplified limitations text. **NO coverage comments.**
* **Variant Description:** Use textual explanations. **NO structured "Gene: ... CDNA: ..." lists.**
* **Findings:** Clearly state key findings if present, or state no causal variant found.
* **Inheritance:** Mention inheritance patterns only if explicitly stated in source report.
* **Placeholder:** Insert "[IMAGE]" at end of hereditary section if applicable.

**HTML Requirements:**
* Valid HTML only with semantic tags (<h3>, <h4>-<h6>, <p>, <ul>, <li>, <strong>).
* Use <ul><li> for all lists.
* Keep headings concise.
* **Forbidden:** CSS, JavaScript, QR codes, logos, feedback links.
* **Header Numbering:** Adjust sequentially if sections are omitted.

**Report Structure:**
* Strictly follow section structure and logic defined in genRules.YAML.
`;
}

/**
 * Builds the user prompt for extracting the inheritance pattern JSON.
 * @returns {string} The formatted user prompt for inheritance extraction.
 */
function _buildInheritanceJsonUserPrompt() {
    return `
**Task Description:**
Analyze the **Official Genetic Report Context** to determine the most likely genetic inheritance pattern.

---

**Instructions:**
1. Identify primary P/LP variants explicitly stated as causal for the patient's phenotype.
2. Based only on this primary finding (if present):
   * Determine inheritance pattern.
   * Choose exactly one: 'autosomal dominant', 'autosomal recessive', 'X-linked dominant', 'X-linked recessive', 'Y-linked', 'mitochondrial', 'multifactorial'.
3. If no causal variant identified or pattern unclear: use 'uncertain'.
4. For non-inherited contexts (e.g., somatic variants): use 'not applicable'.
5. Return JSON with only the key "genetic_inheritance_pattern" and chosen value.

---

**Output Format:**
* Return ONLY the JSON object.
* NO text, explanations, or markdown before/after.
* NO code block fences around the JSON.
* Structure:
  {
    "genetic_inheritance_pattern": "<'autosomal dominant'|'autosomal recessive'|'X-linked dominant'|'X-linked recessive'|'Y-linked'|'mitochondrial'|'multifactorial'|'uncertain'|'not applicable'>"
  }
`;
}

/**
 * Prepares the data object to be saved as generation_details.json in Azure Blob Storage.
 * @param {object} params - Object containing necessary parameters.
 * @param {string} params.paramForm - Generation job ID.
 * @param {string} params.userId - User ID.
 * @param {string} params.role - User role.
 * @param {string[]} params.nameFiles - Original file names.
 * @param {string} params.userPromptSummaryText - Prompt used for HTML generation.
 * @param {string} params.userPromptInheritanceJson - Prompt used for inheritance extraction.
 * @param {object} params.summaryTextResult - Settled promise result for HTML generation.
 * @param {object} params.inheritanceJsonResult - Settled promise result for inheritance extraction.
 * @param {string} params.finalSummaryHtml - The generated HTML content.
 * @param {object} params.inheritancePatternData - The extracted inheritance data.
 * @param {string} params.timestamp - ISO timestamp string.
 * @returns {object} The data object ready for JSON serialization.
 */
function _prepareGenerationDetailsBlobData(params) {
    const {
        paramForm, userId, role, nameFiles,
        userPromptSummaryText, userPromptInheritanceJson,
        summaryTextResult, inheritanceJsonResult,
        finalSummaryHtml, inheritancePatternData, timestamp
    } = params;

    const generationStatus = (summaryTextResult.status === 'fulfilled' && inheritanceJsonResult.status === 'fulfilled')
        ? 'Success'
        : 'Partial Failure or Failure';

    return {
        generationJobId: paramForm,
        userId: userId,
        role: role,
        sourceFileNames: nameFiles,
        // contextUsed: processedContext, // Optional: Exclude if too large/sensitive
        promptUsedForSummaryHtml: userPromptSummaryText,
        promptUsedForInheritance: userPromptInheritanceJson,
        llmRawResponseSummaryHtml: summaryTextResult.status === 'fulfilled'
            ? summaryTextResult.value
            : `Error: ${summaryTextResult.reason}`,
        llmRawResponseInheritance: inheritanceJsonResult.status === 'fulfilled'
            ? JSON.stringify(inheritanceJsonResult.value) // Stringify for consistency if needed
            : `Error: ${inheritanceJsonResult.reason}`,
        generatedSummaryHtml: finalSummaryHtml,
        extractedInheritancePattern: inheritancePatternData,
        generationTimestamp: timestamp,
        status: generationStatus
    };
}


// --- Main Endpoint Logic ---

/**
 * Generates a simplified summary (HTML report) and extracts inheritance pattern (JSON)
 * based on provided genetic context and YAML guidelines.
 * @param {object} req - Express request object. Body must contain: userId, context, role, nameFiles, paramForm.
 * @param {object} res - Express response object.
 */
async function callSummary(req, res) {
    const { userId, context, role, nameFiles, paramForm } = req.body;
    const logPrefix = `[SummaryService] (ParamForm: ${paramForm}, User: ${userId})`; // Consistent log prefix

    console.log(`${logPrefix} Received request for callSummary. Role: ${role}`);

    // --- Step 1: Input Validation & Context Processing ---
    if (!userId || !context || !role || !paramForm || !nameFiles) {
        console.error(`${logPrefix} Bad Request: Missing required fields.`);
        return res.status(400).send({ msg: "Bad Request: Missing required fields.", status: 400 });
    }

    let processedContext;
    if (Array.isArray(context)) {
        console.log(`${logPrefix} Input context is an array, joining into a single string.`);
        processedContext = context.join('\\n\\n---\\n\\n');
    } else if (typeof context === 'string') {
        processedContext = context;
    } else {
        console.error(`${logPrefix} Bad Request: Context must be a string or an array of strings.`);
        return res.status(400).send({ msg: "Bad Request: Invalid context format.", status: 400 });
    }

    try {
        // --- Step 2: Prepare Prompts ---
        const systemPrompt = _buildSystemPrompt(processedContext, repSchemaContent);
        const userPromptSummaryText = _buildSummaryHtmlUserPrompt(genRulesContent, easyReadingContent);
        const userPromptInheritanceJson = _buildInheritanceJsonUserPrompt();

        // --- Step 3: Execute LLM calls in Parallel ---
        console.log(`${logPrefix} Sending prompts to Langchain service...`);
        const llmPromises = [
            langchain.generateStructuredText(userId, systemPrompt, userPromptSummaryText),
            langchain.extractJson(userId, systemPrompt, userPromptInheritanceJson)
        ];
        const results = await Promise.allSettled(llmPromises);
        const [summaryTextResult, inheritanceJsonResult] = results; // Destructure results
        console.log(`${logPrefix} Langchain responses received.`);

        // --- Step 4: Process LLM Responses ---
        let finalSummaryHtml = `<p>Apologies, the simplified summary could not be generated at this time. Please try again later or contact support if the issue persists. (Ref: ${paramForm})</p>`;
        let inheritancePatternData = { genetic_inheritance_pattern: "extraction_failed" };

        // Process Summary HTML
        if (summaryTextResult.status === 'fulfilled' && typeof summaryTextResult.value === 'string') {
            finalSummaryHtml = summaryTextResult.value.trim();
            if (!finalSummaryHtml.startsWith('<') || !finalSummaryHtml.endsWith('>')) {
                console.warn(`${logPrefix} LLM response for HTML doesn't seem to start/end with tags.`);
            }
            console.log(`${logPrefix} Simplified Report HTML generated successfully.`);
        } else {
            const errorReason = summaryTextResult.reason || "Unknown error";
            console.error(`${logPrefix} Failed to generate Simplified Report HTML:`, errorReason);
            console.error(`${logPrefix} Failed Prompt (Summary HTML):\n`, userPromptSummaryText);
            // Optional: Log to insights
        }

        // Process Inheritance Pattern JSON
        if (inheritanceJsonResult.status === 'fulfilled'
            && typeof inheritanceJsonResult.value === 'object'
            && inheritanceJsonResult.value !== null
            && inheritanceJsonResult.value.hasOwnProperty('genetic_inheritance_pattern'))
        {
            // Ensure only the expected key is included
            inheritancePatternData = { genetic_inheritance_pattern: inheritanceJsonResult.value.genetic_inheritance_pattern };
            console.log(`${logPrefix} Inheritance Pattern JSON extracted successfully:`, inheritancePatternData);
        } else {
            const errorReason = inheritanceJsonResult.reason || "Invalid or missing response object/key";
            console.error(`${logPrefix} Failed to extract Inheritance Pattern JSON:`, errorReason, "Received:", inheritanceJsonResult.value);
            console.error(`${logPrefix} Failed Prompt (Inheritance JSON):\n`, userPromptInheritanceJson);
            // Optional: Log to insights
        }

        // --- Step 5: Persist Generation Details to Azure Blob Storage ---
        const timestamp = new Date().toISOString();
        const generationBaseUrl = `${paramForm}/${timestamp.replace(/:/g, '-')}`;
        const generationDetailsBlobUrl = `${generationBaseUrl}/generation_details.json`;

        const generationDetailsToSave = _prepareGenerationDetailsBlobData({
            paramForm, userId, role, nameFiles,
            userPromptSummaryText, userPromptInheritanceJson,
            summaryTextResult, inheritanceJsonResult,
            finalSummaryHtml, inheritancePatternData, timestamp
            // processedContext, // Pass this in if needed for saving
        });

        try {
            await f29azureService.createBlobSimple(BLOB_CONTAINER_NAME, generationDetailsBlobUrl, generationDetailsToSave);
            console.log(`${logPrefix} Generation details saved to blob: ${generationDetailsBlobUrl}`);
        } catch (blobError) {
            console.error(`${logPrefix} Failed to save generation details blob: ${generationDetailsBlobUrl}`, blobError);
            // Decide if this failure should prevent sending a 200 OK to the client.
            // Currently, it proceeds but logs the error.
        }
        console.log(`${logPrefix} Blob saving operation attempted.`);


        // --- Step 6: Format and Send Final Response ---
        const finalResult = {
            msg: "done", // Client should check individual results
            result1: finalSummaryHtml,        // HTML Report
            metadata: inheritancePatternData, // Inheritance Pattern JSON
            status: 200 // HTTP status is 200 OK, even if parts of the generation failed internally
        };

        res.status(200).send(finalResult);
        console.log(`${logPrefix} Successfully processed request (check results for individual task success).`);

    } catch (error) {
        // --- Step 7: Global Error Handling ---
        console.error(`${logPrefix} Critical Error in callSummary:`, error);
        // Optional: Log to monitoring/insights

        res.status(500).send({
            msg: "Internal Server Error",
            error: `An unexpected error occurred during summary generation. Please contact support if the issue persists. (Ref: ${paramForm})`,
            status: 500
        });
    }
}

// --- Exports ---
module.exports = {
    callSummary,
};
