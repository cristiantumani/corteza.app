# Calidad de la captura: análisis, benchmark y propuesta

*Septiembre 2026. Base para decidir cómo mejorar la extracción de outcomes (decisiones, pendientes, preguntas abiertas y riesgos) de las reuniones.*

## 1. Resumen

- **El problema:** Corteza guarda lo que se dijo, no solo lo que importa. En la reunión de revisión de indicadores guardó tres cosas que no son de negocio: "reprogramar la reunión", "fallas técnicas" y "traspasar la base de datos al computador nuevo". Esas tres cosas taparon las dos que sí importaban: el reajuste salarial y la revisión de gastos por mercado en el PNL.
- **Las demás herramientas tienen el mismo problema.** La diferencia es que casi todas ponen a una persona a revisar antes de publicar: Gemini habla de *suggested* next steps, y Fellow y Granola dejan editar. Corteza guarda sin revisión humana, así que necesita más precisión que ellas.
- **La investigación define una decisión y un pendiente por su estructura, no por sus palabras.**
  - Una **decisión** necesita un tema, una propuesta y un acuerdo.
  - Un **pendiente** necesita una tarea, un dueño, un acuerdo y, si se dijo, un plazo.

  Nuestro prompt define los tipos por ejemplos y no le exige a la IA que encuentre el acuerdo.
- **Encontré un bug que afecta la calidad hoy.** Antes de enviar el transcript a la IA borramos todos los saltos de línea (`sanitizeTranscriptText`). Llega como una sola línea larga, sin turnos de habla claros y con el transcript y las notas de Gemini pegados. Eso empeora sobre todo la detección de dueños.
- **Mi recomendación:** primero **medir**, después cambiar. Armar un set de 15 a 20 reuniones reales etiquetadas, que incluya lo que *no* debe capturarse. Con ese set medimos un pipeline en dos pasos:
  1. extraer candidatos con estructura estricta y citas;
  2. verificar cada candidato con una rúbrica de relevancia de negocio.

  A eso se suma aprender de lo que cada equipo descarta. El PR #48 (reglas de relevancia en el prompt) queda como un candidato más a medir; no lo mergearía todavía.

## 2. Cómo funciona hoy y qué encontré

Flujo actual:
1. `ingestion/sources/google-meet.js` arma el texto con los turnos "Nombre: texto" y las notas de Gemini.
2. `ingestTranscript` lo pasa a `extractDecisionsFromTranscript`, que hace **una sola llamada** a Claude (modelo `claude-sonnet-5` por defecto).
3. Claude responde con un array JSON libre, que parseamos a mano.
4. Se guarda todo lo que es válido, sin revisión humana.

| # | Hallazgo | Dónde | Efecto |
|---|---|---|---|
| P1 | **Se borran los saltos de línea** antes de enviar el texto: `text.replace(/\s+/g, ' ')` | `src/middleware/ai-validation.js` → `sanitizeTranscriptText` | El transcript llega como una línea. Se pierden los límites entre turnos y entre "Transcript" y "Meeting notes (Gemini)". Peor atribución de dueños y más confusión entre lo que se dijo y lo que resumió Gemini. **Además rompe la detección de idioma:** `spokenText` busca `"Transcript:\n"` para mirar solo lo hablado; al no encontrarlo usa todo el texto, incluidas las notas de Gemini (a menudo en inglés). Verificado con un ejemplo. |
| P2 | **Un solo paso sin verificación.** La IA extrae y guardamos. | `src/services/claude.js` | Cualquier error de criterio va directo a Home. La investigación y la guía de Anthropic recomiendan verificar cada ítem contra su cita. |
| P3 | **No hay un criterio de relevancia de negocio.** El prompt dice qué tipos existen, pero no qué hace que algo valga la pena. | prompt v2 | Logística, fallas técnicas y temas personales cuentan como decisión, riesgo o pendiente si "suenan" como tal. |
| P4 | **La IA no conoce el contexto de la empresa**: a qué se dedica, qué prioriza, quién es quién. | — | No puede distinguir el CAC de España (negocio) del computador de José Tomás (logística) salvo por sentido común. |
| P5 | **Las notas de Gemini se tratan igual que el transcript.** Las notas ya traen "next steps" sugeridos que incluyen logística. | `google-meet.js` | Se hereda el ruido de Gemini. |
| P6 | **JSON libre parseado a mano**, sin esquema garantizado | `parseLeadingJsonArray` | Ítems con campos inválidos se descartan en silencio y los índices `decision_ref` se corren. |
| P7 | **El aprendizaje por ejemplos solo viene de la revisión manual** (`ai_suggestions`) y no de la captura automática. | `getApprovedExamples` / `getRejectedExamples` | Borrar un outcome mal capturado no le enseña nada a la IA. |
| P8 | **La evaluación es débil:** 3 reuniones sintéticas, comparación por palabras clave y sin lista de "no debe aparecer". | `scripts/eval-extraction.js` | No podemos saber si un cambio de prompt mejora o empeora. |
| P9 | **No se considera el tipo de reunión** (1:1, daily, comercial, directorio, planificación). | — | Una daily genera "pendientes" de estado. En un 1:1 salen temas personales. |
| P10 | **La confianza se guarda pero no se usa.** | `pipeline.js` | Ítems con confianza 0.5 se guardan igual que los de 0.95. |

## 3. Benchmark: cómo lo hacen otras herramientas

| Herramienta | Cómo captura | Qué aprendemos |
|---|---|---|
| **Gemini "Take notes for me"** (Google Meet) | Escribe un Doc con resumen, detalles y **"suggested next steps"**. La persona los revisa, edita y asigna. Deja elegir el nivel de detalle (estándar o más largo). | Google los presenta como **sugerencias**, no como registro: asume que alguien revisa. Nosotros guardamos sin revisión, así que necesitamos más precisión. Sus next steps también traen logística, y los leemos como fuente (P5). |
| **Fellow** | Recap después de cada reunión con decisiones y **action items sugeridos por IA**, que se comparten con los participantes. Hace seguimiento de cuántos se cumplen. | El valor está en el seguimiento, pero su propio material insiste en la **revisión humana** por errores de contexto. |
| **Fireflies, Otter, Read.ai** | Resumen, action items y búsqueda. Envían a CRM y gestores de tareas. | Compiten en integraciones, no en precisión. La queja común de sus usuarios es que los resúmenes "necesitan edición antes de compartirse". |
| **Granola** | **Plantillas por tipo de reunión** (ventas, 1:1, daily, etc.). Cada plantilla es un prompt con propósito, largo, estilo y secciones. | El **tipo de reunión** cambia qué es relevante. Adaptar la extracción a la reunión es práctica estándar. |
| **Gong (AI Data Extractor)** | Cada extractor se define con una pregunta, **instrucciones con la definición que usa la empresa** y un destino (campo de CRM). Gong dice que las instrucciones detalladas mejoran mucho la calidad. | La relevancia depende de cada empresa: conviene dejar que cada workspace describa qué le importa. |
| **Microsoft (paper del sistema de recaps, ACM 2025)** | Dos vistas: *highlights* (lo importante, 1 o 2 frases) y minuta jerárquica. Estudio con usuarios reales. | 6 de 7 participantes dijeron que algunos highlights **no eran relevantes** para ellos, o que capturaban action items de baja prioridad. Pendientes ya hechos, erróneos o redundantes **confunden**, y atribuirlos a la persona equivocada **daña la dinámica del equipo**. Conclusión de los autores: la IA no entiende qué es relevante para cada persona y debe **aprender de las ediciones** del usuario. |

**Conclusión del benchmark:** nadie resolvió la relevancia solo con el prompt. Los que mejor lo hacen combinan tres cosas:
1. definición clara y adaptada al contexto (el tipo de reunión y lo que le importa a la empresa);
2. revisión (humana o automática) antes de publicar;
3. aprendizaje de las correcciones.

## 4. Qué dice la investigación

- **Pendientes (Purver et al., SIGdial 2007).** Un action item no es una frase: es una pequeña conversación con cuatro roles:
  - la **descripción de la tarea**;
  - el **plazo**;
  - la **asignación o aceptación del dueño**;
  - el **acuerdo** (el compromiso con la tarea).

  Detectar esa estructura funciona mejor que buscar frases sueltas. *Para nosotros:* un pendiente necesita tarea, dueño y acuerdo. "Traspaso la base al computador nuevo" cumple la forma, pero no es trabajo del negocio. Hace falta una segunda condición: la relevancia.
- **Decisiones (Fernández et al., SIGdial 2008; Hsueh & Moore 2007, corpus AMI).** Una decisión se detecta por los roles de las intervenciones:
  - el **tema** que se plantea;
  - la **propuesta de resolución**;
  - el **acuerdo**.

  Modelar esa estructura supera a los enfoques "planos". *Para nosotros:* pedirle a la IA que identifique el tema, la propuesta y la cita del acuerdo para cada decisión filtra propuestas que nunca se aceptaron y "decisiones" triviales.
- **Errores de las IA en resúmenes de reuniones (Kirstein et al., COLING y EMNLP 2025).** Los tres errores principales son la **omisión** de lo importante, la **alucinación** y la **irrelevancia**. Lo que mejor funciona es un ciclo en el que **se detectan los errores con una rúbrica y se corrige** (MESA/FRAME): reduce alucinación y omisión de forma medible.
- **Anclaje en citas (guía de Anthropic, "Reduce hallucinations"; SafePassage 2025).**
  - En documentos largos, extraer primero las citas textuales y basar la respuesta en ellas.
  - Verificar cada afirmación buscando su cita, y retirarla si no aparece.
  - Un chequeo simple de que la cita existe en el texto original reduce mucho las alucinaciones.
- **Buenas prácticas de prompts para los modelos actuales de Claude (guía oficial):**
  - explicar el **porqué** de cada regla, no solo la regla;
  - 3 a 5 **ejemplos diversos**, envueltos en `<example>`;
  - separar instrucciones, contexto y datos con **etiquetas XML**;
  - poner el **documento largo arriba** y la tarea después;
  - evitar el lenguaje exagerado ("CRITICAL", "MUST"), porque los modelos nuevos lo sobreaplican;
  - para tareas con varios pasos, **encadenar llamadas** (generar, revisar contra criterios, refinar) cuando se quiere inspeccionar cada paso.
- **Salida estructurada (API de Claude).** `output_config.format` con un JSON Schema **garantiza** que la respuesta cumpla el esquema. Está disponible en Sonnet 5, Sonnet 5.5, Opus 5.5 y Haiku 4.5. Reemplaza nuestro parseo manual (P6).

## 5. Principios para Corteza

1. **Precisión antes que cobertura.** Guardamos sin revisión, así que un outcome irrelevante le cuesta más al usuario que uno omitido: le hace perder confianza en todo lo demás. Es mejor 3 outcomes correctos que 8 con 3 malos. **Objetivo: al menos 90% de precisión en decisiones y pendientes.**
2. **Cada tipo se define por su estructura:**
   - **Decisión:** tema de negocio, propuesta y acuerdo explícito.
   - **Pendiente:** tarea de trabajo, dueño y acuerdo, más el plazo si se dijo.
   - **Pregunta abierta:** planteada, importante para el trabajo y explícitamente sin resolver.
   - **Riesgo:** amenaza a un resultado del negocio.
3. **Relevancia de negocio como prueba explícita, con tres preguntas:**
   - **¿Es material?** Toca estrategia, clientes, ventas, producto, finanzas, personas, operaciones, legal o un entregable.
   - **¿Es durable?** ¿Alguien que no estuvo querría encontrarlo en un mes?
   - **¿No es logística?** Agenda, fallas técnicas, equipos personales o el flujo de la propia reunión quedan fuera.
4. **Todo outcome tiene evidencia verificable:** una cita textual que existe en el transcript y el hablante que la dijo.
5. **El contexto importa.** El tipo de reunión y lo que le importa a cada empresa cambian qué es relevante.
6. **El sistema aprende.** Cada "no es relevante" que marca un usuario se convierte en un ejemplo para su workspace.

## 6. Propuesta: pipeline en dos pasos (v3)

**Paso 0 · Preparar la entrada** (sin costo de IA):
- Corregir P1 y conservar los saltos de línea.
- Separar las fuentes con etiquetas: `<transcript>` (lo dicho, con hablante) y `<gemini_notes>` (un resumen de terceros que sirve de pista y no de evidencia).
- Agregar metadatos:
  - título y fecha;
  - participantes y cuáles son miembros del workspace;
  - el tipo de reunión, si se puede inferir.
- *(Fase 3)* **Contexto del workspace**: 2 o 3 líneas de "a qué se dedica la empresa y qué le importa este trimestre", editables en Settings.

**Paso 1 · Extraer candidatos** (una llamada, salida con JSON Schema estricto):
- La IA primero clasifica la reunión (1:1, daily, planificación, comercial, directorio u otra) y luego lista candidatos.
- Cada candidato trae:
  - tipo y texto;
  - dueño y plazo;
  - por qué (rationale);
  - **cita del acuerdo** y hablante;
  - área de negocio (enum que incluye `logistics`);
  - relevancia (alta, media o baja) con una razón corta.
- Los ejemplos del prompt: 3 a 5 casos cortos y diversos, con buenos y malos. Uno de ellos es la reunión del CAC, con el reajuste como "sí" y la reprogramación como "no".

**Paso 2 · Verificar** (código y una segunda llamada barata):
- **Chequeo en código:** la cita tiene que aparecer en el transcript (coincidencia aproximada). Si no aparece, el candidato se descarta. Se descarta también el área `logistics`, la relevancia baja y el dueño que no está entre los participantes (este último pasa a "sin dueño", no se descarta el ítem).
- **Revisión con rúbrica:** una segunda llamada recibe el transcript (desde caché, así que cuesta ~10%) y la lista de candidatos, y decide *mantener, corregir o descartar* cada uno con el motivo:
  - ¿Es de negocio?
  - ¿Hubo acuerdo?
  - ¿Es un duplicado?
  - ¿El dueño y el plazo son correctos?
- **A medir:** si la revisión aporta frente a un solo paso con razonamiento (thinking) y auto-revisión. La guía de Anthropic dice que el encadenamiento sirve cuando quieres inspeccionar cada paso, y aquí sí queremos: podremos loguear qué se descartó y por qué.

**Paso 3 · Aprender** (producto):
- Botón **"No es relevante"** en cada outcome capturado automáticamente. Guarda el ítem y el motivo en `ai_feedback` del workspace.
- Esos ejemplos (buenos y malos, los 5 más recientes) entran al prompt del workspace. Es lo que ya hacemos para la revisión manual, extendido a la captura automática (P7).
- Métrica en producción: **tasa de descarte** por workspace y tipo de outcome.

## 7. Cómo vamos a medir, antes de cambiar nada

- **Set de evaluación:** 15 a 20 reuniones reales de Ninja, con permiso de los participantes y **fuera del repositorio** (carpeta local o base privada). Tienen que ser diversas: 1:1, daily, planificación, comercial y directorio. Incluye la reunión del CAC.
- **Etiquetas por reunión:**
  - (a) lo que **debe** capturarse;
  - (b) lo que **no debe** capturarse (logística, técnica, personal).

  Yo propongo las etiquetas y tú las corriges. Te toma unos 5 minutos por reunión.
- **Métricas:**
  - precisión y cobertura por tipo;
  - **ítems irrelevantes por reunión** (el número que más le importa al usuario);
  - exactitud de dueño y plazo.
- **Juez:** pasar de comparar palabras clave a un juez de IA calibrado contra tus etiquetas, para decidir si un ítem extraído equivale a uno esperado.
- **Protocolo:**
  1. baseline con el prompt actual;
  2. cada cambio se mide contra el mismo set;
  3. no se publica un cambio que baje la precisión.

  Costo estimado: 2 a 4 USD por corrida completa del set.

## 8. Modelo y costos

Hoy usamos `claude-sonnet-5` ($2 / $10 por millón de tokens de entrada / salida). Una reunión de una hora tiene unos 15.000 tokens de texto.

| Configuración | Costo aprox. por reunión de 1 h |
|---|---|
| Hoy (1 paso, Sonnet 5) | ~0,05 USD |
| v3 con Sonnet 5.5 (2 pasos, transcript en caché) | ~0,07 a 0,08 USD |
| v3 con Opus 5.5 ($4 / $20) | ~0,15 USD |

El costo es bajo frente al valor de un registro confiable. Propongo comparar Sonnet 5.5 y Opus 5.5 en el set, y elegir por precisión, no por precio. Sonnet 5.5 tiene el mismo precio que Sonnet 5.

## 9. Plan por fases

| Fase | Qué | Resultado esperado |
|---|---|---|
| **0. Medir** | Corregir P1 (saltos de línea). Armar el set real con etiquetas positivas y negativas. Mejorar el juez de la evaluación. Medir el baseline. | Un número de partida: precisión e ítems irrelevantes por reunión |
| **1. Prompt v3** | Criterios por estructura y relevancia, entrada en XML, JSON Schema estricto, citas, tipo de reunión, 3 a 5 ejemplos. Incorpora las ideas del PR #48. | Mejora medida frente al baseline |
| **2. Verificación** | Chequeo de citas en código y revisión con rúbrica. Medir si compensa el costo. | Precisión ≥ 90% en decisiones y pendientes |
| **3. Aprendizaje y contexto** | Botón "No es relevante", ejemplos por workspace, contexto de empresa en Settings | La calidad mejora con el uso de cada equipo |
| **4. Modelo** | Comparar Sonnet 5.5 y Opus 5.5 en el set | Elección basada en datos |

## 10. Decisiones

**Tomadas (29 de septiembre de 2026):**
1. **Set de evaluación:** solo reuniones de Cristian, exportadas a su Mac, fuera del repo (`scripts/eval/export-meetings.js`).
2. **Precisión antes que cobertura:** confirmado. Preferimos perder un ítem menor antes que guardar ruido.
3. **Contexto de la empresa:** sí, pero como descripción general (no "este trimestre"), con la opción de subir un diccionario u otra información relevante (siglas, clientes, productos, nombres). Ver la propuesta de abajo.

**Pendientes:**
- **Quién administra el contexto.** No todos tienen el mismo acceso: quien crea el workspace es **admin** y los colegas que entran por el dominio son **miembros**. Propuesta en dos niveles:
  - **Contexto de la empresa** (workspace): lo editan los admins y los miembros lo leen. Incluye descripción, diccionario o glosario y documentos de referencia. Lo usan las capturas de todos.
  - **Mi contexto** (usuario, opcional): el rol de cada persona, sus áreas y su glosario personal. Lo usan solo sus capturas.

  Empezar solo con el nivel de usuario duplicaría la descripción de la empresa en cada persona y dejaría de estar sincronizada.
- **PR #48:** propuesta de no mergearlo y medirlo como una variante más en la Fase 1.

**Cómo usa la IA el contexto:** va en el prompt, antes del transcript y en caché, así que casi no suma costo después de la primera reunión. El diccionario también ayuda con otras dos cosas:
- **siglas** que la transcripción escribe mal (CAC, PNL);
- **nombres de personas y clientes**, para asignar bien los dueños.

Hay un tope de tamaño: si alguien sube documentos grandes, hay que buscar en ellos la parte relevante (con embeddings) en vez de pegarlos enteros en el prompt.

## Estado de la Fase 0

- ✅ **P1 corregido:** `sanitizeTranscriptText` conserva los saltos de línea. `spokenText` vuelve a encontrar el transcript para detectar el idioma.
- ✅ **`scripts/eval/export-meetings.js`:** exporta las reuniones de una persona a una carpeta fuera del repo. Se niega a escribir dentro del repo y nunca sobrescribe archivos ya revisados.
- ✅ **`scripts/eval/draft-labels.js`:** Claude (Opus 5.5) propone `expected` y `not_expected` para que la persona solo revise. Usa salida con JSON Schema estricto.
- ✅ **Evaluación:** acepta `--dir` (reuniones reales) y `not_expected`. Reporta ítems de ruido e ítems inesperados por reunión, y omite las reuniones con etiquetas en borrador.
- ⏳ **Baseline:** falta exportar, etiquetar y correr la evaluación. El juez de IA (en vez de palabras clave) queda para después de ver cuánto fallan las palabras clave con reuniones reales.

## Fuentes

- Anthropic, [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) y [Reduce hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations)
- Asthana et al., [Summaries, Highlights, and Action Items: Design, Implementation and Evaluation of an LLM-powered Meeting Recap System](https://arxiv.org/abs/2307.15793) (ACM HCI, 2025)
- Purver et al., [Detecting and Summarizing Action Items in Multi-Party Dialogue](https://aclanthology.org/2007.sigdial-1.4) (SIGdial 2007)
- Fernández et al., [Modelling and Detecting Decisions in Multi-party Dialogue](https://aclanthology.org/W08-0125/) (SIGdial 2008); Hsueh & Moore, [Automatic Decision Detection in Meeting Speech](https://www.research.ed.ac.uk/en/publications/automatic-decision-detection-in-meeting-speech/)
- Kirstein et al., [What's Wrong? Refining Meeting Summaries with LLM Feedback](https://aclanthology.org/2025.coling-main.143/) (COLING 2025); [Is my Meeting Summary Good?](https://arxiv.org/pdf/2411.18444); [Re-FRAME the Meeting Summarization SCOPE](https://arxiv.org/html/2509.15901)
- [SafePassage: High-Fidelity Information Extraction with Black Box LLMs](https://arxiv.org/html/2510.00276) (2025)
- [Meeting Action Item Detection with Regularized Context Modeling](https://arxiv.org/html/2303.16763v1); [Action-Item-Driven Summarization of Long Meeting Transcripts](https://arxiv.org/html/2312.17581v2)
- Google, [Take notes for me now captures next steps](https://workspaceupdates.googleblog.com/2025/02/google-meet-take-notes-for-me-next-steps.html)
- Fellow, [Action Items](https://fellow.ai/features/action-items); Granola, [Customise notes with templates](https://docs.granola.ai/help-center/taking-notes/customise-notes-with-templates); Gong, [AI Data Extractor](https://help.gong.io/v1/docs/ai-data-extractor)
- Comparativas de mercado: [Zapier](https://zapier.com/blog/best-ai-meeting-assistant/), [TechRepublic](https://www.techrepublic.com/article/news-best-ai-meeting-note-takers-2026/)
