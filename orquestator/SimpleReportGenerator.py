# /genewise_server/orquestador/SimpleReportGenerator.py
import yaml
import json
import os
import sys
import traceback # Para errores detallados
from openai import OpenAI

# --- Constantes y Configuración ---
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__)) # Directorio del script
SCHEMA_PATH = os.path.join(SCRIPT_DIR, 'report_schema.yaml')
RULES_PATH = os.path.join(SCRIPT_DIR, 'transformation_rules.yaml')
MODEL_NAME = "gpt-4o" # O el modelo que prefieras

# --- Logging a stderr ---
def log_error(message):
    print(f"[ERROR] {message}", file=sys.stderr)

def log_info(message):
    print(f"[INFO] {message}", file=sys.stderr)

def log_debug(message):
    # Podrías activar/desactivar esto con una variable de entorno si necesitas más detalle
    # print(f"[DEBUG] {message}", file=sys.stderr)
    pass

# --- Carga de Configuración Inicial ---
try:
    openai_api_key = os.environ.get("OPENAI_API_KEY")
    if not openai_api_key:
        raise ValueError("La variable de entorno OPENAI_API_KEY no está configurada.")

    # Inicializar cliente OpenAI globalmente o pasarlo a la clase
    client = OpenAI(api_key=openai_api_key)

    log_info("Cliente OpenAI inicializado.")

    with open(SCHEMA_PATH, 'r', encoding='utf-8') as f:
        report_schema = yaml.safe_load(f)
    log_info(f"Schema cargado desde {SCHEMA_PATH}")

    with open(RULES_PATH, 'r', encoding='utf-8') as f:
        rules = yaml.safe_load(f)
    log_info(f"Reglas cargadas desde {RULES_PATH}")

except FileNotFoundError as e:
    log_error(f"No se encontró un archivo de configuración esencial: {e.filename}")
    sys.exit(1)
except (ValueError, yaml.YAMLError) as e:
    log_error(f"Error al cargar configuración o inicializar cliente: {e}")
    sys.exit(1)
except Exception as e:
    log_error(f"Error inesperado durante la inicialización: {e}")
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)


# --- Funciones Auxiliares (LLM Interaction - Sin cambios respecto a la versión anterior) ---
# (Se mantienen las funciones call_llm, ask_llm_for_determination, etc., usando el 'client' global)
# ... (Pega aquí las funciones auxiliares de la respuesta anterior, asegurándote que usan el 'client' definido arriba) ...
# --- Funciones Auxiliares (LLM Interaction) ---

def call_llm(prompt, max_tokens=500, temperature=0.2):
    """Función wrapper para llamar a la API de OpenAI con manejo básico de errores."""
    log_debug(f"Llamando a LLM con prompt: {prompt[:100]}...") # Log corto del prompt
    try:
        response = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": "Eres un asistente experto en genética y simplificación de informes médicos para pacientes. Responde de forma clara y precisa a la tarea solicitada."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=max_tokens,
            temperature=temperature,
            # response_format={ "type": "json_object" } # Considerar si es útil aquí
        )
        content = response.choices[0].message.content
        if content is None:
            log_error("LLM devolvió contenido nulo.")
            return ""
        log_debug(f"Respuesta LLM recibida: {content[:100]}...")
        return content.strip()
    except Exception as e:
        log_error(f"Error llamando a la API de OpenAI: {e}")
        # Podrías querer añadir más detalles del error aquí si es necesario
        return None

def ask_llm_for_determination(section_texts, question):
    """Pide al LLM una determinación específica (e.g., Sí/No) basada en texto."""
    context = "\n\n".join([f"Texto de la sección '{k}':\n{v}" for k, v in section_texts.items() if v])
    if not context:
        log_error("Intento de determinación sin contexto de texto.")
        return None, "Sin contexto"

    prompt = f"Basándote EXCLUSIVAMENTE en los siguientes textos extraídos de un informe genético:\n\n{context}\n\n{question} Responde únicamente con 'SÍ' o 'NO'. Si la respuesta es SÍ, cita brevemente la frase o idea clave que lo justifica."
    response = call_llm(prompt, max_tokens=100, temperature=0.0)
    if response:
        log_info(f"Respuesta LLM para determinación '{question[:30]}...': {response}")
        if response.upper().startswith("SÍ"):
            return True, response
        elif response.upper().startswith("NO"):
            return False, response
    log_error(f"No se obtuvo respuesta clara (SÍ/NO) para: {question}")
    return None, response # Indicar fallo o incertidumbre

def ask_llm_to_extract_variant(section_texts, criteria_description):
    """Pide al LLM extraer detalles de una variante específica en JSON."""
    context = "\n\n".join([f"Texto de la sección '{k}':\n{v}" for k, v in section_texts.items() if v])
    if not context:
        log_error("Intento de extracción de variante sin contexto de texto.")
        return None

    prompt = f"""
Analiza los siguientes textos de un informe genético:
{context}

Busca la variante genética que cumple con los siguientes criterios: {criteria_description}.
Extrae los siguientes detalles para ESA variante específica y devuélvelos en formato JSON VÁLIDO con las claves: "Gen", "Localizacion", "Transcrito", "CDNA", "Proteina", "Genotipo", "Clasificacion".
Si no encuentras una variante que cumpla los criterios, devuelve un JSON VÁLIDO vacío {{}}. NO añadas texto explicativo antes o después del JSON.

JSON:
"""
    response = call_llm(prompt, max_tokens=350, temperature=0.0) # Ajustar tokens si es necesario
    if not response:
        log_error("No se recibió respuesta del LLM para extracción de variante.")
        return None
    try:
        # Intenta encontrar el JSON (puede haber ruido antes/después)
        start_index = response.find('{')
        end_index = response.rfind('}') + 1
        if start_index == -1 or end_index == 0:
            raise json.JSONDecodeError("No se encontró JSON ({...}) en la respuesta.", response, 0)

        json_str = response[start_index:end_index]
        log_debug(f"Intentando parsear JSON extraído: {json_str}")
        details = json.loads(json_str)

        # Validación básica de estructura
        if details and not all(k in details for k in ["Gen", "CDNA", "Proteina", "Genotipo", "Clasificacion"]):
             log_error(f"JSON extraído para variante incompleto: {details}")
             # Decidir si devolver None o el dict parcial
             return None
        log_info(f"Variante extraída con criterio '{criteria_description[:30]}...': {details if details else 'Ninguna'}")
        return details if details else None
    except json.JSONDecodeError as e:
        log_error(f"Error al parsear JSON de variante extraída: {e}. Respuesta LLM: {response}")
        return None
    except Exception as e:
        log_error(f"Error inesperado procesando respuesta de extracción de variante: {e}")
        return None


def ask_llm_to_extract_list(section_text, item_description, output_format_keys):
    """Pide al LLM extraer una lista de elementos (variantes, genes) en JSON."""
    if not section_text:
         log_error(f"Intento de extracción de lista '{item_description}' sin texto.")
         return []

    prompt = f"""
Analiza el siguiente texto de una sección de informe genético:
{section_text}

Identifica y extrae todos los **{item_description}**.
Para cada uno, devuelve los siguientes detalles en una lista de objetos JSON VÁLIDO. Cada objeto debe tener EXACTAMENTE las claves: {output_format_keys}.
Si no encuentras ninguno, devuelve una lista JSON VÁLIDA vacía []. NO añadas texto explicativo antes o después del JSON.

Lista JSON:
"""
    response = call_llm(prompt, max_tokens=1500, temperature=0.0) # Ajustar max_tokens según la posible longitud
    if not response:
        log_error(f"No se recibió respuesta del LLM para extracción de lista '{item_description}'.")
        return []
    try:
        # Intenta encontrar el JSON array
        start_index = response.find('[')
        end_index = response.rfind(']') + 1
        if start_index == -1 or end_index == 0:
             # Quizás devolvió un objeto vacío {} si no encontró nada, lo cual es incorrecto para una lista
             if response.strip() == '{}':
                  log_info(f"LLM devolvió objeto vacío en lugar de lista para '{item_description}', interpretando como lista vacía.")
                  return []
             raise json.JSONDecodeError("No se encontró array JSON ([...]) en la respuesta.", response, 0)

        json_str = response[start_index:end_index]
        log_debug(f"Intentando parsear JSON de lista extraída: {json_str}")
        items = json.loads(json_str)

        if not isinstance(items, list):
            log_error(f"La respuesta parseada para '{item_description}' no es una lista: {type(items)}")
            return []

        # Opcional: Validación más profunda de cada item en la lista
        # for i, item in enumerate(items):
        #     if not isinstance(item, dict) or not all(k in item for k in output_format_keys):
        #         log_error(f"Item {i} en la lista extraída para '{item_description}' tiene formato incorrecto: {item}")
        #         # Decidir si filtrar este item o fallar toda la lista
        log_info(f"Lista extraída para '{item_description}': {len(items)} items encontrados.")
        return items
    except json.JSONDecodeError as e:
        log_error(f"Error al parsear JSON de lista extraída '{item_description}': {e}. Respuesta LLM: {response}")
        return []
    except Exception as e:
        log_error(f"Error inesperado procesando respuesta de extracción de lista '{item_description}': {e}")
        return []


def ask_llm_to_simplify(technical_text, target_audience="paciente sin conocimientos médicos"):
    """Pide al LLM simplificar un texto técnico."""
    if not technical_text:
        log_info("Intento de simplificar texto vacío.")
        return ""
    prompt = f"Simplifica la siguiente explicación técnica para que sea comprensible por un {target_audience}. Mantén la precisión esencial pero evita jerga compleja. NO añadas introducciones ni conclusiones genéricas, solo simplifica el texto proporcionado:\n\n{technical_text}\n\nExplicación simplificada:"
    result = call_llm(prompt, max_tokens=int(len(technical_text.split())*2.5 + 50)) # Estimar tokens con margen
    log_info(f"Texto simplificado para '{target_audience}': {result[:100]}...")
    return result or "" # Devolver cadena vacía si falla

def ask_llm_for_gene_info(gene_symbol, context_info="asociado a una enfermedad genética"):
    """Pide al LLM información simplificada sobre un gen y patología."""
    prompt = f"""
Basándote en conocimiento médico general (similar a OMIM/Orphanet, hasta tu fecha de corte de conocimiento), proporciona una breve descripción para un paciente sobre:
1. La función general del gen **{gene_symbol}**.
2. La principal patología o tipo de problemas de salud asociados a variantes en este gen, en el contexto de **{context_info}**.
3. El patrón de herencia más común asociado a esa patología (Responde solo el nombre: Autosómica Dominante, Autosómica Recesiva, Ligada al X Recesiva, Ligada al X Dominante, Y-linked, Mitocondrial, Desconocido).

Sé claro, conciso y evita detalles excesivamente técnicos o pronósticos específicos. Si hay varias patologías o patrones, menciona el más común o relevante para el contexto dado. Si no tienes información fiable, indícalo claramente. Estructura la respuesta claramente en 3 puntos.
"""
    result = call_llm(prompt, max_tokens=450)
    log_info(f"Información de gen obtenida para {gene_symbol}: {result[:100]}...")
    return result or f"No se pudo obtener información detallada para el gen {gene_symbol}."


def get_inheritance_explanation_and_image(pattern_name, genotype):
    """Devuelve texto explicativo estándar e ID de imagen para un patrón de herencia."""
    # Normalizar el nombre del patrón recibido (puede variar ligeramente del LLM)
    pattern_key = pattern_name.strip().lower()
    genotype_norm = genotype.strip().lower() if genotype else ""

    log_debug(f"Buscando explicación para patrón: '{pattern_key}', genotipo: '{genotype_norm}'")

    explanations = {
        # Claves en minúscula para matching insensible
        "autosómica dominante": {
            "text": "Herencia Autosómica Dominante: Normalmente, una sola copia de la variante genética (heredada de uno de los padres, o a veces nueva en el paciente) es suficiente para causar la condición. Cada hijo de una persona afectada tiene un 50% de probabilidad de heredar la variante y la condición.",
            "image_id": "AD_image"
        },
        "autosómica recesiva": {
            "text": "Herencia Autosómica Recesiva: Se necesitan dos copias de la variante genética (una heredada de cada padre) para causar la condición. Los padres suelen ser portadores sanos (tienen una sola copia). Cada hijo de dos padres portadores tiene un 25% de probabilidad de tener la condición, un 50% de ser portador sano y un 25% de no tener la variante.",
            "image_id": "AR_image"
        },
        "ligada al x recesiva": {
            "text": "Herencia Ligada al X Recesiva: El gen se encuentra en el cromosoma X. Las mujeres tienen dos cromosomas X, los hombres uno (XY). Las mujeres portadoras de una variante en un X suelen ser sanas o tener síntomas leves. Los hombres con una variante en su único cromosoma X suelen desarrollar la condición. Las mujeres portadoras tienen un 50% de probabilidad de pasar la variante a cada hijo (varón afectado, hija portadora).",
            "image_id": "XLR_image"
        },
         "ligada al x dominante": {
            "text": "Herencia Ligada al X Dominante: El gen se encuentra en el cromosoma X. Una sola copia de la variante es suficiente para causar la condición tanto en hombres como en mujeres (aunque puede ser más severa en hombres). Un hombre afectado pasará la variante a todas sus hijas pero a ninguno de sus hijos. Una mujer afectada tiene un 50% de probabilidad de pasar la variante a cada hijo o hija.",
            "image_id": "XLD_image"
        },
         "y-linked": { # Añadido Y-linked
             "text": "Herencia Ligada al Y: El gen se encuentra en el cromosoma Y, que solo tienen los hombres. La condición solo afecta a hombres y se transmite de padres a hijos varones.",
             "image_id": "Y_linked_image" # Necesitarás esta imagen
         },
         "mitocondrial": { # Añadido Mitocondrial
              "text": "Herencia Mitocondrial: El gen se encuentra en el ADN de las mitocondrias (pequeñas 'baterías' dentro de nuestras células). Este ADN se hereda casi exclusivamente de la madre. Una madre afectada pasará la variante a todos sus hijos e hijas, pero solo las hijas la transmitirán a la siguiente generación.",
              "image_id": "Mito_image" # Necesitarás esta imagen
         },
        # ... añadir otros patrones si son comunes (e.g., digénica, imprinted - más complejos)
    }

    # Refinar AR si el genotipo es homocigoto
    if "autosómica recesiva" in pattern_key and "homocigosis" in genotype_norm:
         explanation = {
            "text": "Herencia Autosómica Recesiva (detectada en Homocigosis): Se han detectado dos copias idénticas de la variante genética. Esto suele ocurrir cuando ambos padres son portadores de la misma variante. Para que aparezca la condición asociada, se necesitan ambas copias. Cada hijo de dos padres portadores tiene un 25% de probabilidad de heredar ambas copias y tener la condición.",
            "image_id": "AR_image"
         }
         log_info(f"Usando explicación AR (Homocigosis) para {pattern_name}")
         return explanation["text"], explanation["image_id"]

    # Buscar el patrón normalizado
    result = None
    for key in explanations:
        if key in pattern_key: # Permitir matching parcial (e.g., "ligada al x recesiva" vs "x-linked recessive")
            result = explanations[key]
            log_info(f"Patrón de herencia mapeado: '{pattern_name}' -> '{key}'")
            break

    if result:
        return result["text"], result["image_id"]
    else:
        log_error(f"Patrón de herencia '{pattern_name}' no mapeado o desconocido.")
        # Intentar obtener una explicación genérica del LLM como fallback
        simplified_explanation = ask_llm_to_simplify(f"Explica brevemente el patrón de herencia llamado '{pattern_name}'", target_audience="paciente")
        return simplified_explanation or f"Patrón de herencia: {pattern_name} (No se encontró explicación estándar).", None


# --- Clase Orquestadora Principal (Refinada) ---

class SimpleReportGenerator:
    # Pasar reglas y cliente OpenAI en la inicialización
    def __init__(self, official_report_content, rules_config, openai_client):
        self.report_data = official_report_content # Asumimos dict ya parseado
        self.rules = rules_config # Las reglas YAML cargadas
        self.client = openai_client # Usar el cliente pasado
        self.process_variables = {}
        self.simplified_report = {}
        log_info("Instancia de SimpleReportGenerator creada.")

    def _get_section_text(self, section_id):
        """Obtiene el texto de una sección del informe original de forma segura."""
        text = self.report_data.get(section_id, "")
        if not isinstance(text, str):
            log_error(f"El contenido de la sección '{section_id}' no es texto (tipo: {type(text)}). Usando cadena vacía.")
            return ""
        log_debug(f"Texto obtenido para sección '{section_id}': {text[:60]}...")
        return text

    def _determine_process_variables(self):
        """Calcula las variables clave definidas en las reglas."""
        log_info("--- Iniciando determinación de variables de proceso ---")

        # 1. primary_finding_exists
        log_info("Determinando 'primary_finding_exists'...")
        q1 = "¿El informe (especialmente en Resultados, Conclusiones o Interpretación/Anexo I) indica CLARAMENTE que se ha identificado una variante Patogénica (P) o Probablemente Patogénica (LP) que EXPLICA la clínica o fenotipo del paciente?"
        # Asegurarse de obtener todas las secciones relevantes aunque no existan en el input
        sections_to_check_pfe = {id: self._get_section_text(id) for id in ['Resultados', 'Conclusiones', 'Interpretacion', 'Anexo_I']}
        exists, reason = ask_llm_for_determination(sections_to_check_pfe, q1)
        if exists is None:
             log_error("No se pudo determinar 'primary_finding_exists' vía LLM. Se requiere revisión o mejora del prompt/modelo. Asumiendo FALSE por seguridad.")
             self.process_variables['primary_finding_exists'] = False
        else:
             self.process_variables['primary_finding_exists'] = exists
        log_info(f"Resultado 'primary_finding_exists': {self.process_variables['primary_finding_exists']} (Razón LLM: {reason})")

        # 2. primary_finding_details
        if self.process_variables['primary_finding_exists']:
            log_info("Buscando detalles del hallazgo primario ('primary_finding_details')...")
            sections_to_check_pfd = {id: self._get_section_text(id) for id in ['Interpretacion', 'Anexo_I', 'Conclusiones']}
            criteria = "la variante clasificada como Patogénica (P) o Probablemente Patogénica (LP) que se describe como la causa principal de la clínica del paciente"
            details = ask_llm_to_extract_variant(sections_to_check_pfd, criteria)
            if details:
                self.process_variables['primary_finding_details'] = details
                log_info(f"Resultado 'primary_finding_details': {details}")
            else:
                 log_error("primary_finding_exists=True pero no se pudieron extraer detalles claros de la variante primaria. 'primary_finding_details' será None.")
                 self.process_variables['primary_finding_details'] = None
        else:
            self.process_variables['primary_finding_details'] = None
            log_info("'primary_finding_details' es None porque 'primary_finding_exists' es False.")

        # 3. other_findings_list
        log_info("Buscando otros hallazgos ('other_findings_list')...")
        anexo1_text = self._get_section_text('Anexo_I')
        other_findings = []
        if anexo1_text:
             # Extraer TODAS las variantes del Anexo I primero
             log_info("Extrayendo todas las variantes del Anexo I...")
             all_variants_annex1 = ask_llm_to_extract_list(
                 anexo1_text,
                 "variantes genéticas listadas en la tabla o texto (incluyendo VUS, P, LP, etc.)",
                 # Asegúrate que estas claves coinciden con lo que realmente puede extraer el LLM de tu formato de Anexo I
                 ["Gen", "Localizacion", "Transcrito", "CDNA", "Proteina", "Genotipo", "Clasificacion"]
             )
             log_info(f"Total variantes extraídas del Anexo I: {len(all_variants_annex1)}")

             primary_details = self.process_variables.get('primary_finding_details')

             for i, variant in enumerate(all_variants_annex1):
                 log_debug(f"Procesando variante {i} del Anexo I: {variant}")
                 is_primary = False
                 # Comprobar si esta variante es la primaria (robustecer la comparación)
                 if primary_details and isinstance(variant, dict) and isinstance(primary_details, dict):
                     # Comparar por Gen y CDNA (o Proteina si CDNA falta) puede ser suficiente
                     if (variant.get('Gen') and variant.get('Gen') == primary_details.get('Gen') and
                         variant.get('CDNA') and variant.get('CDNA') == primary_details.get('CDNA')):
                         is_primary = True
                         log_info(f"Variante {i} ({variant.get('Gen')}/{variant.get('CDNA')}) identificada como primaria. Excluyendo de 'other_findings'.")
                     elif (not variant.get('CDNA') and not primary_details.get('CDNA') and # Fallback a proteína si no hay CDNA
                           variant.get('Gen') and variant.get('Gen') == primary_details.get('Gen') and
                           variant.get('Proteina') and variant.get('Proteina') == primary_details.get('Proteina')):
                          is_primary = True
                          log_info(f"Variante {i} ({variant.get('Gen')}/{variant.get('Proteina')}) identificada como primaria (por proteína). Excluyendo de 'other_findings'.")


                 if not is_primary and isinstance(variant, dict):
                     # Aplicar lógica de filtrado y añadir 'Tipo' según las reglas YAML
                     classification_raw = variant.get('Clasificacion', '').upper()
                     classification = ""
                     if "VUS" in classification_raw or "SIGNIFICADO INCIERTO" in classification_raw:
                         classification = "VUS"
                     elif "PATOGÉNICA" in classification_raw or "PATHOGENIC" in classification_raw :
                          if "PROBABLEMENTE" in classification_raw or "LIKELY" in classification_raw:
                               classification = "LP"
                          else:
                               classification = "P"
                     else:
                          classification = "Desconocida" # O dejarla vacía

                     variant['Clasificacion_Norm'] = classification # Guardar clasificación normalizada
                     log_debug(f"Variante {i} no primaria. Clasificación normalizada: {classification}")

                     # Aquí deberías implementar la lógica de las reglas YAML para asignar el 'Tipo'
                     # (VUS, P_LP_Recessive_Het, P_LP_VUS_AR, CNV, etc.)
                     # Esto puede requerir más llamadas al LLM para saber herencia del gen si no está en el anexo
                     variant_type = "Desconocido" # Placeholder - NECESITA IMPLEMENTACIÓN BASADA EN REGLAS
                     if classification == 'VUS':
                         variant_type = 'VUS'
                     elif classification in ['P', 'LP']:
                         # Simplificación: Marcarla como P/LP no primaria por ahora
                         # La lógica real necesitaría chequear herencia, genotipo...
                         variant_type = 'P_LP_NonPrimary'

                     variant['Tipo'] = variant_type # Añadir el tipo determinado
                     other_findings.append(variant)
                     log_info(f"Añadida variante {i} a 'other_findings' con tipo '{variant_type}'.")

             self.process_variables['other_findings_list'] = other_findings
             log_info(f"Resultado 'other_findings_list': {len(other_findings)} variantes encontradas.")
        else:
             self.process_variables['other_findings_list'] = []
             log_info("Resultado 'other_findings_list': Anexo I vacío o no encontrado, lista vacía.")

        # 4. secondary_findings_list
        log_info("Buscando hallazgos secundarios ('secondary_findings_list')...")
        hs_text = self._get_section_text('Hallazgos_secundarios')
        secondary_findings = []
        if hs_text and "sin hallazgos" not in hs_text.lower() and "no se identifican" not in hs_text.lower():
             # Extraer hallazgos secundarios
             log_info("Extrayendo hallazgos secundarios del texto...")
             secondary_findings = ask_llm_to_extract_list(
                 hs_text,
                 "hallazgos secundarios (variantes genéticas P/LP en genes específicos)",
                 # Ajustar claves según lo que realmente contenga esa sección
                 ["Gen", "Variante", "Genotipo", "Clasificacion"]
             )
             self.process_variables['secondary_findings_list'] = secondary_findings
             log_info(f"Resultado 'secondary_findings_list': {len(secondary_findings)} hallazgos encontrados.")
        else:
            self.process_variables['secondary_findings_list'] = []
            log_info("Resultado 'secondary_findings_list': No se reportaron hallazgos secundarios o sección vacía.")

        log_info("--- Determinación de variables de proceso completada ---")


    def _generate_section_content(self, section_def):
        """Genera el contenido para una sección específica del informe simplificado."""
        section_id = section_def['section_id']
        title = section_def['title']
        content = [] # Lista de párrafos o elementos

        log_info(f"--- Generando sección: {section_id} ('{title}') ---")

        # Manejar condición global de la sección (si existe en las reglas)
        if 'condition' in section_def:
             try:
                # Evaluar la condición dinámicamente (¡CUIDADO CON LA SEGURIDAD SI LAS REGLAS NO SON FIABLES!)
                # Asumimos condiciones simples como 'len(variable) > 0'
                condition_met = eval(section_def['condition'], {"len": len}, self.process_variables)
                log_debug(f"Evaluando condición '{section_def['condition']}': {condition_met}")
             except Exception as e:
                 log_error(f"Error evaluando la condición '{section_def['condition']}' para la sección {section_id}: {e}. Omitiendo sección por seguridad.")
                 condition_met = False

             if not condition_met:
                 log_info(f"Sección '{title}' omitida porque la condición '{section_def['condition']}' no se cumple.")
                 return None # Omitir sección si la condición no se cumple

        # --- Lógica específica por sección (usando self.rules para acceder a detalles si es necesario) ---
        # (El código de generación de cada sección de la respuesta anterior se mantiene aquí,
        #  pero asegurándose de usar log_info/log_error y de acceder a self.rules y
        #  self.process_variables correctamente)
        # ... (Pega aquí la lógica de generación de contenido por sección de la respuesta anterior) ...
        # ... (Asegúrate de adaptar los accesos a self.rules donde sea necesario y añadir logging) ...

        # Ejemplo de adaptación para Sección 3:
        elif section_id == '3_Resultado':
             primary_finding_exists = self.process_variables.get('primary_finding_exists', False)
             # Acceder a las definiciones de las reglas para los títulos y lógica
             rule_sec3 = next((s for s in self.rules['simplified_report_sections'] if s['section_id'] == section_id), None)
             if not rule_sec3:
                 log_error(f"No se encontraron definiciones de reglas para la sección {section_id}")
                 return None # No se puede generar sin reglas

             if not primary_finding_exists:
                 # CASO A: No hay hallazgo primario
                 log_info("Generando Sección 3 - Caso SIN hallazgo primario.")
                 if_false_def = rule_sec3['conditional_logic']['if_false']
                 title = if_false_def['title'] # Usar título de las reglas
                 content.append("El estudio genético realizado **no ha identificado variantes genéticas** (cambios en el ADN) que se clasifiquen actualmente como 'Patogénicas' o 'Probablemente Patogénicas' y que expliquen de forma concluyente los síntomas o características clínicas del paciente.")
                 limitations_text = self._get_section_text('Limitaciones') # ID definido en schema
                 simplified_limitations = ask_llm_to_simplify(limitations_text, "paciente recibiendo resultado negativo") if limitations_text else "Es importante saber que esta técnica tiene algunas limitaciones: no analiza absolutamente todo el ADN y hay ciertos tipos de cambios genéticos que no puede detectar bien. Por tanto, un resultado sin hallazgos no descarta al 100% que exista una causa genética."
                 content.append(f"**Limitaciones importantes:** {simplified_limitations}")
             else:
                 # CASO B: Sí hay hallazgo primario
                 log_info("Generando Sección 3 - Caso CON hallazgo primario.")
                 if_true_def = rule_sec3['conditional_logic']['if_true']
                 title = if_true_def['title'] # Usar título de las reglas
                 details = self.process_variables.get('primary_finding_details')

                 if not details:
                     log_error("Hallazgo primario existente pero sin detalles extraídos. Generando mensaje de error.")
                     content.append("Se indicó la presencia de un hallazgo genético relevante, pero hubo dificultades técnicas para extraer o procesar los detalles específicos. Por favor, consulte con su médico para una interpretación completa.")
                 else:
                     # Generar subsecciones 3.1, 3.2, 3.3 usando definiciones de las reglas
                     for sub_sec_def in if_true_def.get('subsections', []):
                         sub_id = sub_sec_def['subsection_id']
                         sub_title = sub_sec_def['title']
                         log_info(f"Generando subsección {sub_id} ('{sub_title}')...")
                         content.append(f"**{sub_title}**") # Añadir título de subsección

                         if sub_id == '3.1_Variante_Genetica':
                             variant_str = f"Gen: **{details.get('Gen', 'N/A')}**, Notación ADNc: c.{details.get('CDNA', 'N/A')}, Notación Proteína: p.{details.get('Proteina', 'N/A')}"
                             content.append(f"Se ha identificado la siguiente variante genética: {variant_str}.")
                             content.append("Una 'variante genética' es un cambio en la secuencia de nuestro ADN. Algunas no tienen efecto, otras pueden influir en la salud.")
                             content.append(f"**Clasificación:** Esta variante se ha clasificado como **{details.get('Clasificacion', 'N/A')}**. Esto significa que es considerada (Probablemente) la causa de la condición clínica.")
                             content.append(f"**Genotipo:** Se encontró en **{details.get('Genotipo', 'N/A')}** (indica si en una o ambas copias del gen).")
                             # Simplificar interpretación original
                             interpretacion_raw = self._get_section_text('Interpretacion') # Texto completo
                             # Podríamos intentar hacer un prompt más enfocado si supiéramos dónde está la interpretación EXACTA de ESTA variante
                             interpretacion_prompt = f"Del siguiente texto de interpretación, extrae y simplifica SOLO la parte que explica por qué la variante c.{details.get('CDNA', 'N/A')} en el gen {details.get('Gen', 'N/A')} se considera relevante o causal para la clínica del paciente:\n\n{interpretacion_raw}"
                             simplified_interpretation = ask_llm_to_simplify(interpretacion_prompt, "paciente")
                             if simplified_interpretation:
                                 content.append(f"**Relevancia clínica (simplificada):** {simplified_interpretation}")
                             else:
                                 content.append("El informe técnico original detalla la evidencia científica que apoya la relación de esta variante con la clínica observada.")

                         elif sub_id == '3.2_Gen_Patologia':
                             gene = details.get('Gen')
                             if gene:
                                 gene_info_text = ask_llm_for_gene_info(gene, f"la condición clínica asociada a la variante c.{details.get('CDNA', 'N/A')}")
                                 if gene_info_text:
                                     # Extraer solo la parte de función y patología (asumiendo formato 1., 2., 3.)
                                     parts = gene_info_text.split('\n')
                                     func_pat_info = "\n".join(p for p in parts if p.strip().startswith(('1.', '2.')))
                                     content.append(func_pat_info or gene_info_text) # Usar partes o todo si falla el split
                                 else:
                                     content.append(f"El gen afectado es **{gene}**. Consulte con su médico para detalles sobre su función y la patología asociada.")
                             else:
                                 content.append("No se pudo determinar claramente el gen asociado a la variante primaria.")

                         elif sub_id == '3.3_Patron_Herencia':
                             gene = details.get('Gen')
                             inheritance_pattern = "Desconocido" # Default
                             # Intentar obtener patrón del LLM (ya podría estar en gene_info_text)
                             gene_info_full = self.process_variables.get('gene_info_text_cache', {}).get(gene) # Reusar si se guardó
                             if not gene_info_full and gene: # Si no se guardó, llamar de nuevo
                                  gene_info_full = ask_llm_for_gene_info(gene, f"la condición clínica asociada a la variante c.{details.get('CDNA', 'N/A')}")
                                  self.process_variables.setdefault('gene_info_text_cache', {})[gene] = gene_info_full # Guardar en caché

                             if gene_info_full:
                                   parts = gene_info_full.split('\n')
                                   pattern_line = next((p for p in parts if p.strip().startswith('3.')), None)
                                   if pattern_line:
                                       # Extraer nombre del patrón (puede tener texto adicional)
                                       pattern_name_raw = pattern_line.split(':', 1)[-1].strip()
                                       # Extraer solo el nombre estándar
                                       known_patterns = ["Autosómica Dominante", "Autosómica Recesiva", "Ligada al X Recesiva", "Ligada al X Dominante", "Y-linked", "Mitocondrial"]
                                       found_pattern = next((p for p in known_patterns if p.lower() in pattern_name_raw.lower()), "Desconocido")
                                       inheritance_pattern = found_pattern

                             log_info(f"Patrón de herencia determinado para {gene}: {inheritance_pattern}")
                             inh_text, inh_image = get_inheritance_explanation_and_image(inheritance_pattern, details.get('Genotipo'))
                             content.append(inh_text)
                             if inh_image:
                                 content.append(f"[IMAGEN_PLACEHOLDER: {inh_image}.png]") # Placeholder para imagen
                             else:
                                 log_info(f"No se encontró imagen para el patrón de herencia: {inheritance_pattern}")

             # Limpiar título por si acaso
             title = title.strip() if title else "Resultado"

        # ... (Resto de la lógica para secciones 4, 5, 6, 7, 8 adaptada similarmente) ...
        # Asegúrate de usar los títulos definidos en `rules` y añadir logging

        # --- Ensamblaje Final de la Sección ---
        if content: # Solo añadir la sección si tiene contenido
            final_content = "\n\n".join(filter(None, content)) # Unir párrafos no vacíos
            self.simplified_report[section_id] = {
                 "title": title.strip(), # Asegurar que no hay espacios extra
                 "content": final_content
             }
            log_info(f"--- Sección '{title}' generada ({len(final_content)} caracteres) ---")
            return self.simplified_report[section_id]
        else:
            log_info(f"--- Sección '{title}' generada SIN contenido. Omitiendo. ---")
            return None


    def generate_report(self):
        """Orquesta la generación completa del informe simplificado."""
        log_info("****** Iniciando generación de informe simplificado ******")
        try:
            # 1. Determinar variables de proceso (crucial)
            self._determine_process_variables()

            # 2. Iterar sobre las secciones definidas en las reglas para generar contenido
            simplified_sections_defs = self.rules.get('simplified_report_sections', [])
            if not simplified_sections_defs:
                 raise ValueError("No se encontraron definiciones de 'simplified_report_sections' en las reglas.")

            for section_def in simplified_sections_defs:
                 # La generación real ocurre aquí, sección por sección
                 # El resultado se guarda en self.simplified_report dentro de _generate_section_content
                 self._generate_section_content(section_def)

            log_info("****** Generación de informe simplificado completada ******")
            # Filtrar secciones que pudieron quedar vacías
            final_report = {k: v for k, v in self.simplified_report.items() if v and v.get('content')}
            return final_report

        except Exception as e:
            log_error(f"Error CRÍTICO durante la generación del informe: {e}")
            traceback.print_exc(file=sys.stderr)
            # Devolver un objeto de error o lanzar excepción podría ser mejor que devolver None
            return {"error": f"Fallo en la generación: {e}"}


# --- Punto de Entrada Principal ---
if __name__ == "__main__":
    log_info("***** Ejecutando SimpleReportGenerator como script principal *****")
    # 1. Leer JSON desde stdin
    input_json_str = ""
    try:
        log_info("Leyendo datos del informe oficial desde stdin...")
        input_json_str = sys.stdin.read()
        if not input_json_str:
             raise ValueError("No se recibió entrada (stdin).")
        official_report_data = json.loads(input_json_str)
        log_info("Datos JSON de entrada parseados correctamente.")
        log_debug(f"Datos de entrada (primeros 500 chars): {input_json_str[:500]}")

    except json.JSONDecodeError as e:
        log_error(f"Fallo al parsear JSON de entrada: {e}")
        log_error(f"Entrada recibida (primeros 500 chars): {input_json_str[:500]}")
        sys.exit(1)
    except ValueError as e:
         log_error(f"Error con la entrada: {e}")
         sys.exit(1)
    except Exception as e:
         log_error(f"Error inesperado leyendo stdin: {e}")
         traceback.print_exc(file=sys.stderr)
         sys.exit(1)

    # 2. Crear instancia del generador (ya tenemos client y rules cargados)
    try:
        generator = SimpleReportGenerator(official_report_data, rules, client)
    except Exception as e:
        log_error(f"Error creando la instancia de SimpleReportGenerator: {e}")
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

    # 3. Generar el informe
    simplified_report_dict = generator.generate_report()

    # 4. Imprimir resultado JSON a stdout o mensaje de error
    if simplified_report_dict and "error" not in simplified_report_dict:
        try:
            final_json_output = json.dumps(simplified_report_dict, ensure_ascii=False, indent=2)
            print(final_json_output) # <-- Salida final a stdout
            log_info("Informe simplificado generado y enviado a stdout.")
            sys.exit(0) # Salida exitosa
        except Exception as e:
            log_error(f"Error al convertir el resultado final a JSON: {e}")
            # Imprimir un JSON de error estándar a stdout si falla la serialización
            print(json.dumps({"error": f"Fallo al serializar resultado: {e}"}, indent=2))
            sys.exit(1)
    else:
        log_error("La generación del informe falló o resultó vacía.")
        # Imprimir un JSON de error estándar a stdout
        error_msg = simplified_report_dict.get("error", "Fallo desconocido en la generación.") if isinstance(simplified_report_dict, dict) else "Fallo desconocido."
        print(json.dumps({"error": error_msg}, indent=2))
        sys.exit(1)