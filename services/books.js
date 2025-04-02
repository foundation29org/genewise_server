// /genewise_server/services/books.js
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml'); // Necesitarás instalar js-yaml: npm install js-yaml
const config = require('../config');
const f29azureService = require("./f29azure");
const langchain = require('../services/langchain'); // Lo usaremos para la llamada de estructuración
// const { DocumentAnalysisClient, AzureKeyCredential } = require("@azure/ai-form-recognizer"); // Alternativa si el input es PDF complejo

// --- Constante para la ruta del schema (leído una vez) ---
const SCHEMA_YAML_PATH = path.resolve(__dirname, '../orquestador/report_schema.yaml');
let REPORT_SCHEMA_YAML_CONTENT = '';
try {
    REPORT_SCHEMA_YAML_CONTENT = fs.readFileSync(SCHEMA_YAML_PATH, 'utf8');
    console.log("[Init] Schema YAML cargado correctamente.");
} catch (err) {
    console.error(`[Init Fatal Error] No se pudo leer el archivo schema YAML en ${SCHEMA_YAML_PATH}: ${err.message}`);
    // Podrías detener el inicio del servidor aquí si este archivo es esencial
    process.exit(1);
}

// --- Función para Ejecutar Python (sin cambios respecto a la anterior) ---
function executePythonOrchestrator(officialReportJsonString) {
    // ... (pega aquí la función executePythonOrchestrator completa de la respuesta anterior) ...
        return new Promise((resolve, reject) => {
        const pythonConfig = config.PYTHON_ORCHESTRATOR;
        const scriptFullPath = path.resolve(process.cwd(), pythonConfig.SCRIPT_PATH); // Ruta absoluta al script

        // Verificar que el script existe
        if (!fs.existsSync(scriptFullPath)) {
            console.error(`[Orchestrator Error] Script Python no encontrado en: ${scriptFullPath}`);
            return reject(new Error(`Configuration error: Python script not found at ${pythonConfig.SCRIPT_PATH}`));
        }

        console.log(`[Orchestrator] Ejecutando: ${pythonConfig.EXECUTABLE} ${scriptFullPath}`);
        // Pasar la API Key de OpenAI como variable de entorno al proceso hijo
        const env = {
             ...process.env, // Heredar entorno actual
             OPENAI_API_KEY: process.env.OPENAI_API_KEY, // Asegúrate que esta var de entorno está disponible para Node.js
             // Podrías añadir otras vars de entorno si Python las necesita
        };
        if (!env.OPENAI_API_KEY) {
            console.error("[Orchestrator Error] La variable de entorno OPENAI_API_KEY no está disponible para pasarla a Python.");
            return reject(new Error("Server configuration error: Missing OpenAI API Key for Python script."));
        }

        const pythonProcess = spawn(pythonConfig.EXECUTABLE, [scriptFullPath], {
            env: env, // Pasar el entorno con la API key
            timeout: pythonConfig.TIMEOUT_MS // Añadir timeout
        });

        let scriptOutput = '';
        let scriptError = '';

        pythonProcess.stdout.on('data', (data) => {
            scriptOutput += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            // Loggear stderr de Python para debugging en Node
            console.error(`[Python stderr] ${data.toString().trim()}`);
            scriptError += data.toString();
        });

        pythonProcess.on('close', (code) => {
            console.log(`[Orchestrator] Proceso Python terminado con código ${code}.`);
            if (code === 0) {
                try {
                    // Añadir un log para ver la salida cruda antes de parsear
                    console.log("[Orchestrator Raw stdout]:\n", scriptOutput);
                    const resultJson = JSON.parse(scriptOutput);
                    // Verificar si el JSON devuelto es un objeto de error del propio script
                    if (resultJson && resultJson.error) {
                         console.error(`[Orchestrator Error] El script Python devolvió un error interno: ${resultJson.error}`);
                         reject(new Error(`Python script failed: ${resultJson.error}`));
                    } else {
                         console.log("[Orchestrator] Resultado JSON de Python parseado correctamente.");
                         resolve(resultJson);
                    }
                } catch (parseError) {
                    console.error("[Orchestrator Error] Error al parsear la salida JSON de stdout:", parseError);
                    // console.error("[Orchestrator Raw stdout]:", scriptOutput); // Mostrar salida cruda - ya se logea arriba
                    reject(new Error(`Failed to parse Python script output. ${scriptError ? 'Python stderr: ' + scriptError.substring(0, 200) : ''}`));
                }
            } else {
                console.error(`[Orchestrator Error] Script Python falló con código ${code}.`);
                reject(new Error(`Python script exited with code ${code}. ${scriptError ? 'Error details: ' + scriptError.substring(0, 500) : 'No details on stderr.'}`));
            }
        });

        pythonProcess.on('error', (err) => {
            console.error('[Orchestrator Error] Error al iniciar el proceso Python:', err);
            reject(new Error(`Failed to spawn Python script: ${err.message}`));
        });

         // Enviar datos a stdin DESPUÉS de configurar los listeners
         try {
            pythonProcess.stdin.write(officialReportJsonString);
            pythonProcess.stdin.end();
            console.log("[Orchestrator] Datos enviados a stdin de Python.");
         } catch (stdinError) {
              console.error("[Orchestrator Error] Error escribiendo a stdin de Python:", stdinError);
              // Intentar terminar el proceso si falla stdin
              try { pythonProcess.kill(); } catch(killErr) { console.error("Error trying to kill python process", killErr); }
              reject(new Error(`Failed to send data to Python script: ${stdinError.message}`));
         }
    });
}


// --- FUNCIÓN REVISADA: Obtener y Preparar Informe usando LLM para Estructurar ---
/**
 * Descarga el informe oficial (texto o PDF simple) y usa un LLM para
 * estructurarlo como un string JSON según report_schema.yaml.
 * @param {string} containerName - Nombre del contenedor de Azure Blob.
 * @param {string} blobName - Nombre del blob del informe.
 * @param {string} userId - ID del usuario (para pasarlo a langchain si es necesario).
 * @returns {Promise<string|null>} - String JSON del informe estructurado, o null si falla.
 */
async function getAndPrepareOfficialReportJson_WithLLM(containerName, blobName, userId) {
    console.log(`[PreprocessorLLM] Iniciando preprocesamiento LLM para blob: ${containerName}/${blobName}`);
    let reportRawContent = '';

    try {
        // 1. Descargar el contenido del blob
        const reportBuffer = await f29azureService.downloadBlob(containerName, blobName);
        if (!reportBuffer || reportBuffer.length === 0) {
            console.error("[PreprocessorLLM Error] El blob descargado está vacío.");
            return null;
        }
        // Intentar detectar si es PDF (muy básico)
        if (reportBuffer.slice(0, 5).toString() === '%PDF-') {
             console.warn("[PreprocessorLLM] Detectado posible PDF. La extracción LLM directa puede ser menos fiable. Considerar Form Recognizer para PDFs complejos.");
             // Por ahora, intentaremos pasarlo como texto, el LLM podría manejar PDFs simples.
             // Si falla consistentemente, aquí iría la llamada a Form Recognizer.
             // reportRawContent = await procesarPDFConFormRecognizer(reportBuffer); // Necesitarías esta función
             reportRawContent = reportBuffer.toString('utf8'); // Intentar como texto (puede fallar en binario)
             // Una mejor aproximación sería usar una librería como pdf-parse en Node.js para extraer texto de PDF
             // npm install pdf-parse
             /*
             try {
                 const pdf = require('pdf-parse');
                 const data = await pdf(reportBuffer);
                 reportRawContent = data.text;
                 console.log("[PreprocessorLLM] Texto extraído de PDF.");
             } catch(pdfError) {
                 console.error("[PreprocessorLLM Error] Fallo al extraer texto del PDF:", pdfError);
                 reportRawContent = "Error: No se pudo extraer texto del PDF."; // Informar al LLM
             }
             */
             // Solución simple por ahora: pasar buffer como utf8 puede dar basura si es binario
             console.warn("[PreprocessorLLM] Pasando contenido de PDF como texto UTF8 (puede contener caracteres inválidos).");


        } else {
            // Asumir que es texto plano (TXT, MD, etc.)
            reportRawContent = reportBuffer.toString('utf8');
            console.log("[PreprocessorLLM] Contenido del blob tratado como texto plano.");
        }

        if (!reportRawContent) {
             console.error("[PreprocessorLLM Error] Contenido del informe está vacío después de la descarga/procesamiento inicial.");
             return null;
        }
        console.log(`[PreprocessorLLM] Contenido bruto preparado (${reportRawContent.length} caracteres).`);


        // 2. Construir el Prompt para la Extracción Estructurada
        const extractionPrompt = `****** TAREA DE EXTRACCIÓN ESTRUCTURADA ******
Eres un asistente experto en procesar informes genéticos clínicos (WES/CES). Tu tarea es analizar el siguiente INFORME GENÉTICO COMPLETO y extraer TODO su contenido relevante, estructurándolo EXACTAMENTE según el schema YAML proporcionado a continuación.

****** SCHEMA YAML REQUERIDO ******
${REPORT_SCHEMA_YAML_CONTENT}
****** FIN SCHEMA YAML ******

****** INSTRUCCIONES DETALLADAS ******
1.  Lee TODO el INFORME GENÉTICO proporcionado al final.
2.  Identifica cada una de las secciones definidas en el SCHEMA YAML dentro del informe.
3.  Para CADA sección del schema, extrae TODO el texto y contenido relevante que encuentres en el informe.
4.  Si una sección definida en el schema NO se encuentra en el informe, utiliza un string vacío "" como valor para esa clave en el JSON de salida. NO omitas la clave.
5.  Presta especial atención a tablas (como en Anexo_I). Intenta representar la tabla como texto formateado legible dentro del string del valor JSON para esa sección.
6.  Asegúrate de que la salida sea un ÚNICO objeto JSON VÁLIDO que siga la estructura del schema. No incluyas NINGÚN texto antes o después del JSON (ni explicaciones, ni saludos, ni comentarios, ni markdown). Solo el JSON.

****** INFORME GENÉTICO COMPLETO ******
${reportRawContent}
****** FIN INFORME GENÉTICO ******

****** JSON ESTRUCTURADO EXTRAÍDO ******:`;


        // 3. Llamar al LLM para la extracción
        console.log("[PreprocessorLLM] Enviando prompt de extracción estructurada al LLM...");
        // Usaremos langchain.navigator_summarize, asumiendo que puede manejar prompts largos y devolver JSON.
        // Necesitamos asegurarnos que NO intente resumir, sino extraer JSON.
        // Quizás necesites una función específica en langchain.js o llamar directo a OpenAI API.
        // Usando navigator_summarize por ahora, pero ajusta si es necesario.
        // El 'context' aquí podría no ser relevante si el prompt ya lo tiene todo.
        // El flag 'timeline' debería ser false, y el último flag (¿parseJson?) debería ser true.
        const llmResult = await langchain.navigator_summarize(
            userId,
            extractionPrompt,
            null, // Sin contexto adicional si el prompt es completo
            false, // No es timeline
            true // ¡Importante! Indica que esperamos JSON (o que parsearemos nosotros)
        );

        if (!llmResult || !llmResult.text) {
            console.error("[PreprocessorLLM Error] La llamada al LLM para extracción no devolvió texto.");
            throw new Error("LLM failed to return structured data.");
        }
        console.log("[PreprocessorLLM] Respuesta recibida del LLM.");
        log_debug(`[PreprocessorLLM Raw LLM Output]: ${llmResult.text.substring(0, 500)}...`); // Loggear inicio de respuesta

        // 4. Validar y Limpiar la Salida JSON del LLM
        let extractedJsonString = llmResult.text;
        try {
            // A veces los LLMs añaden ```json ... ``` o texto antes/después. Intentar limpiar.
            const jsonMatch = extractedJsonString.match(/```json\s*([\s\S]*?)\s*```|({[\s\S]*})/);
            if (jsonMatch) {
                 // Priorizar lo que está dentro de ```json ... ```, si no, el primer {..}
                extractedJsonString = jsonMatch[1] ? jsonMatch[1].trim() : jsonMatch[2].trim();
                console.log("[PreprocessorLLM] JSON limpiado de posible formato markdown.");
            } else {
                 console.warn("[PreprocessorLLM] No se encontró formato JSON claro (```json o {...}), usando la respuesta tal cual.");
            }

            // Parsear para validar que es JSON
            const parsedJson = JSON.parse(extractedJsonString);

            // Validación adicional: ¿Contiene claves esperadas del schema?
            const requiredKeys = ['Header', 'Report_Title', 'Resultados', 'Anexo_I']; // Mínimo esperado
            if (!requiredKeys.every(key => key in parsedJson)) {
                 console.error(`[PreprocessorLLM Error] JSON extraído no contiene claves requeridas (${requiredKeys.join(', ')}). JSON: ${JSON.stringify(parsedJson).substring(0,300)}`);
                 throw new Error("Extracted JSON is missing required report sections.");
            }

            console.log("[PreprocessorLLM] Extracción estructurada con LLM exitosa y validada.");
            return extractedJsonString; // Devolver el string JSON validado

        } catch (jsonError) {
            console.error("[PreprocessorLLM Error] La salida del LLM para extracción no es JSON válido:", jsonError.message);
            console.error("[PreprocessorLLM Raw LLM Output]:", extractedJsonString); // Mostrar salida completa si falla
            throw new Error("LLM output for structured extraction was not valid JSON.");
        }

    } catch (error) {
        console.error(`[PreprocessorLLM Error] Error general durante el preprocesamiento LLM de ${blobName}:`, error.message);
        // Asegurarse de no devolver una cadena JSON parcial o inválida
        return null; // Indicar fallo
    }
}

// --- Función callSummary (Usa la nueva función de preprocesamiento) ---
async function callSummary(req, res) {
    // Extraer parámetros como antes
    const { role, userId, context, nameFiles, paramForm, conversation } = req.body;
    console.log(`[callSummary] Iniciando para userId: ${userId}, role: ${role}, file(s): ${nameFiles}`);

    // --- 1. Validar Entrada ---
    if (!nameFiles || nameFiles.length === 0 || !nameFiles[0]) {
        console.error("[callSummary Error] No se proporcionó 'nameFiles' o está vacío.");
        return res.status(400).json({ msg: "Error: Falta el nombre del archivo del informe genético.", status: 400 });
    }
    const reportBlobName = nameFiles[0];
    const containerName = config.BLOB.CONTAINER_NAME;

    // --- 2. Obtener y Preparar el Informe Oficial como JSON (usando LLM) ---
    let officialReportJsonString;
    try {
        // Llama a la función de preprocesamiento CON LLM
        officialReportJsonString = await getAndPrepareOfficialReportJson_WithLLM(containerName, reportBlobName, userId);

        if (!officialReportJsonString) {
            throw new Error("No se pudo procesar el informe oficial al formato JSON requerido usando LLM.");
        }
        console.log("[callSummary] Informe oficial preparado como JSON string vía LLM.");
        console.log(`[callSummary] Tamaño del JSON preparado: ${officialReportJsonString.length} caracteres.`);

    } catch (error) {
        console.error("[callSummary Error] Fallo en la preparación del informe (vía LLM):", error.message);
        // insights.error({ message: "Error preparing official report via LLM", error, userId, reportBlobName });
        return res.status(500).json({ msg: `Error al procesar el archivo del informe: ${error.message}`, status: 500 });
    }

    // --- 3. Ejecutar el Orquestador Python ---
    let simplifiedReportResult = null;
    try {
        console.log("[callSummary] Ejecutando el orquestador Python...");
        simplifiedReportResult = await executePythonOrchestrator(officialReportJsonString);

        if (!simplifiedReportResult || typeof simplifiedReportResult !== 'object' || (simplifiedReportResult.error && Object.keys(simplifiedReportResult).length === 1) || Object.keys(simplifiedReportResult).length === 0 ) {
             // Considerar un objeto con solo 'error' como fallo
             const errorMessage = simplifiedReportResult?.error || "El script Python no devolvió un resultado válido.";
             console.error(`[callSummary Error] Python script returned invalid or error result: ${errorMessage}`);
             throw new Error(errorMessage);
        }
        console.log("[callSummary] Orquestador Python ejecutado con éxito. Resultado recibido.");
        console.log(`[callSummary] Claves del resultado simplificado: ${Object.keys(simplifiedReportResult).join(', ')}`);

    } catch (pythonError) {
        console.error("[callSummary Error] Fallo al ejecutar el script Python:", pythonError.message);
        // insights.error({ message: "Python script execution failed", error: pythonError, userId });
        return res.status(500).json({
            msg: `Error durante la generación del resumen simplificado: ${pythonError.message}`,
            status: 500
        });
    }

    // --- 4. Procesamiento Posterior y Respuesta (Sin cambios respecto a la versión anterior) ---
    try {
        // A. Formatear a HTML
        const finalResult1Html = formatSimplifiedReportAsHtml(simplifiedReportResult);
        console.log("[callSummary] Resultado simplificado formateado a HTML.");

        // B. Guardar JSON crudo simplificado en Azure
        const simplifiedJsonBlobName = `${paramForm || userId}/simplified_report_${Date.now()}.json`;
        try {
             await f29azureService.createBlobSimple(
                 containerName,
                 simplifiedJsonBlobName,
                 JSON.stringify(simplifiedReportResult, null, 2)
             );
             console.log(`[callSummary] Resultado JSON simplificado guardado en Azure: ${simplifiedJsonBlobName}`);
        } catch (saveError) {
             console.error(`[callSummary Warning] No se pudo guardar el resultado JSON simplificado en Azure:`, saveError);
             // insights.warn({ message: "Failed to save simplified JSON to Azure", error: saveError, userId, blobName: simplifiedJsonBlobName });
        }

        // C. Generar Timeline (si aplica)
        let finalResult2Timeline = null;
        const generateTimeline = false; // <-- Poner a false si el nuevo resumen reemplaza la necesidad de la timeline original
        if (generateTimeline) {
           // ... (código para generar timeline como antes) ...
        } else {
            console.log("[callSummary] Generación de timeline omitida según configuración.");
        }

        // D. Enviar Respuesta
        const finalResponse = {
            msg: "done",
            result1: finalResult1Html,
            result2: finalResult2Timeline,
            status: 200
        };
        console.log("[callSummary] Enviando respuesta exitosa.");
        res.status(200).json(finalResponse);

    } catch (postProcessingError) {
        console.error("[callSummary Error] Fallo en el post-procesamiento o envío de respuesta:", postProcessingError);
        // insights.error({ message: "Error in post-processing or sending response", error: postProcessingError, userId });
        return res.status(500).json({ msg: `Error interno finalizando la solicitud: ${postProcessingError.message}`, status: 500 });
    }
}

// --- Función formatSimplifiedReportAsHtml (Sin cambios) ---
function formatSimplifiedReportAsHtml(reportJson) {
    // ... (pega aquí la función formatSimplifiedReportAsHtml completa de la respuesta anterior) ...
        if (!reportJson || typeof reportJson !== 'object') {
        return '<p>Error: No se recibió un informe simplificado válido para mostrar.</p>';
    }
    // Añadir manejo si reportJson contiene la clave 'error'
    if (reportJson.error) {
        return `<p><strong>Error durante la generación del informe:</strong> ${reportJson.error}</p>`;
    }

    let html = `<h1>Informe Genético Simplificado</h1>`;
    // Iterar sobre las secciones del JSON (asumiendo la estructura devuelta por Python)
    // Es mejor iterar en el orden definido en las reglas si es posible, o alfabético
    const sectionOrder = [ // Definir un orden deseado
       '1_Antecedentes', '2_Estudio_Realizado', '3_Resultado',
       '4_Otros_Hallazgos', '5_Hallazgos_Secundarios', '6_Recomendaciones',
       '7_Mensajes_Clave', '8_Glosario'
    ];

    for (const sectionId of sectionOrder) {
        // Comprobar si la sección existe y tiene contenido antes de renderizarla
        if (reportJson.hasOwnProperty(sectionId) && reportJson[sectionId] && reportJson[sectionId].content) {
            const section = reportJson[sectionId];
            // Comprobar si el título existe, si no, usar el ID formateado
            const title = section.title ? section.title.trim() : sectionId.replace(/_/g, ' ');
            html += `<h2 style="margin-top: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.3em;">${title}</h2>`;

            // Formatear el contenido
            const contentParagraphs = section.content
                                         .split('\n\n')
                                         .map(p => p.trim()) // Eliminar espacios extra
                                         .filter(p => p) // Filtrar párrafos vacíos
                                         .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`) // Convertir saltos simples a <br>
                                         .join('');
            html += contentParagraphs;

            // Buscar placeholders de imagen
             html = html.replace(/\[IMAGEN_PLACEHOLDER: (.*?)\.(png|jpg|jpeg|gif)\]/gi, (match, imageName, extension) => {
                 // Reemplazar con una etiqueta <img> real
                 const imageUrl = `/images/herencia/${imageName}.${extension}`; // Ajusta la ruta base si es necesario
                 console.log(`[HTML Formatter] Insertando imagen: ${imageUrl}`);
                 return `<div style="text-align:center; margin: 1em 0; padding: 0.5em; border: 1px solid #ddd; background-color: #f9f9f9;">` +
                        `<img src="${imageUrl}" alt="Diagrama de herencia ${imageName.replace(/_/g, ' ')}" style="max-width: 300px; max-height: 250px; height: auto; display: block; margin: 0 auto;">` +
                        `</div>`;
             });

             // Hacer que **texto** se vea en negrita
             html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
             // Hacer que - texto (listas simples) se vean como listas ul/li
             // Esto es una heurística simple, puede necesitar ajustes
             html = html.replace(/<p>\s*-\s+(.*?)(?:<br>|$)/g, (match, item) => `<ul style="margin-left: 20px; padding-left: 0; margin-top: 0.5em; margin-bottom: 0.5em;"><li>${item.trim()}</li></ul>`);
             // Corregir múltiples <ul> seguidos que pueden resultar de lo anterior
             html = html.replace(/<\/ul>\s*<ul[^>]*>/g, '');

        } else {
             log_debug(`[HTML Formatter] Omitiendo sección ${sectionId} porque no existe o no tiene contenido.`);
        }
    }
    // Añadir CSS básico
    html = `<div style="font-family: sans-serif; line-height: 1.6;">${html}</div>`;
    return html;
}


// Exportar la función principal
module.exports = {
    callSummary,
};