# Security questionnaire: ready answers

Answers to the questions customers usually ask before they sign (SIG Lite, CAIQ and the usual
company cybersecurity questionnaires), in English and Spanish, to copy and paste. Public summary:
`/security` (`src/views/legal/security.*.html`). Linear COR-50.

**Rules for this file**

- Only what is true today. When something isn't in place, say so and say what's planned; a wrong
  "yes" in a questionnaire is worse than an honest "not yet".
- Lines marked ⚠️ need Cristian to confirm a fact before they're sent the first time. Remove the mark
  once confirmed.
- When the product changes (a provider, a Google scope, a new kind of data, a security control),
  update this file, `/security` and the privacy policy in the same PR. The weekly review agent
  (`docs/agents/weekly-review.md`) checks they agree.

Last reviewed: October 24, 2026.

---

## 1. Company and governance

**Who operates Corteza, and who is responsible for security?**

- EN: Corteza is operated by Cristian Tumani, its founder, who is responsible for security and data
  protection. Contact: cristian@corteza.app.
- ES: Corteza es operado por Cristian Tumani, su fundador, responsable de la seguridad y la
  protección de datos. Contacto: cristian@corteza.app.

**Do you have written information security policies?**

- EN: Our security practices are documented in the product's engineering rules and in our public
  security page and privacy policy. Formal written policies (information security, access control,
  incident response, vendor management, business continuity) are being written now and will be
  reviewed yearly.
- ES: Nuestras prácticas de seguridad están documentadas en las reglas de ingeniería del producto y en
  nuestra página de seguridad y política de privacidad públicas. Las políticas formales escritas
  (seguridad de la información, control de acceso, respuesta a incidentes, gestión de proveedores,
  continuidad del negocio) se están redactando ahora y se revisarán cada año.

**Do you hold SOC 2, ISO 27001 or another certification?**

- EN: Not yet. SOC 2 and ISO 27001 are on our roadmap. In the meantime we answer security
  questionnaires, sign a DPA and explain our controls in detail, as in this document.
- ES: Todavía no. SOC 2 e ISO 27001 están en nuestro roadmap. Mientras tanto respondemos cuestionarios
  de seguridad, firmamos un DPA y explicamos nuestros controles en detalle, como en este documento.

**Have you had a penetration test?**

- EN: Not an external one yet; it's planned before our SOC 2 audit. Every change goes through
  automated checks (tests, linting, type checks and a dependency vulnerability scan), and the code
  follows written secure-coding rules (output escaping, input validation, workspace isolation).
- ES: Todavía no uno externo; está planificado antes de la auditoría SOC 2. Cada cambio pasa por
  revisiones automáticas (tests, lint, chequeo de tipos y escaneo de vulnerabilidades en dependencias),
  y el código sigue reglas escritas de desarrollo seguro (escapado de salida, validación de entradas,
  aislamiento entre workspaces).

## 2. Data

**What data does Corteza process?**

- EN: Account data from Google sign-in (name, email, profile picture, Workspace domain). With the
  user's consent, the transcripts and Gemini notes of their Google Meet meetings, which are read to
  find the outcomes (decisions, action items, open questions, risks). We keep the outcomes, their
  owner, due date, reasoning, a short quote as evidence, and the meeting's title and date. Also the
  context users give the AI (company description, glossary, documents they pick) and their search
  questions.
- ES: Datos de cuenta del inicio de sesión con Google (nombre, correo, foto de perfil, dominio de
  Workspace). Con el consentimiento del usuario, las transcripciones y notas de Gemini de sus reuniones
  de Google Meet, que se leen para encontrar lo que salió de ellas (decisiones, pendientes, preguntas
  abiertas, riesgos). Guardamos esos resultados, su responsable, fecha, razonamiento, una cita breve
  como evidencia, y el título y la fecha de la reunión. También el contexto que los usuarios dan a la
  IA (descripción de la empresa, glosario, documentos que eligen) y sus preguntas de búsqueda.

**Do you store meeting transcripts or recordings?**

- EN: No. Transcripts and notes are read, sent to our AI provider to find the outcomes, and discarded.
  We keep only a hash of the transcript (so a meeting isn't processed twice), its file name and
  counts. We never access recordings or join meetings with a bot.
- ES: No. Las transcripciones y notas se leen, se envían a nuestro proveedor de IA para encontrar los
  resultados y se descartan. Solo guardamos un hash de la transcripción (para no procesar dos veces una
  reunión), el nombre del archivo y conteos. Nunca accedemos a grabaciones ni entramos a las reuniones
  con un bot.

**Which Google permissions does Corteza ask for, and why?**

- EN: Only after the user connects Google in Settings, and each one is explained before Google's
  consent screen: `meetings.space.readonly` (list the user's meetings and their transcripts and notes),
  `drive.meet.readonly` (read the transcript and notes files Meet saves), `drive.readonly` (read the
  Gemini notes document linked to a meeting when the previous scope doesn't cover it; no other files
  are read), and optionally `calendar.events.readonly` (today's meetings, to prepare the day; never
  stored) and `drive.file` (only documents the user picks). Corteza follows the Google API Services
  User Data Policy, including Limited Use.
- ES: Solo después de que el usuario conecta Google en Configuración, y cada uno se explica antes de la
  pantalla de consentimiento de Google: `meetings.space.readonly` (listar sus reuniones y sus
  transcripciones y notas), `drive.meet.readonly` (leer los archivos de transcripción y notas que guarda
  Meet), `drive.readonly` (leer el documento de notas de Gemini vinculado a una reunión cuando el permiso
  anterior no lo cubre; no se lee ningún otro archivo), y opcionalmente `calendar.events.readonly` (las
  reuniones del día, para preparar la jornada; nunca se guardan) y `drive.file` (solo documentos que el
  usuario elige). Corteza cumple la Política de datos de usuario de los servicios de API de Google,
  incluido el Uso Limitado.

**Where is data stored?**

- EN: The database (MongoDB Atlas) is in the EU, on AWS in Paris (eu-west-3). The application runs on
  Railway. ⚠️ [Confirm Railway's region.] Error monitoring (Sentry) is in the EU.
  Our providers may process data in the United States under their contractual safeguards (standard
  contractual clauses where they apply).
- ES: La base de datos (MongoDB Atlas) está en la UE, en AWS París (eu-west-3). La aplicación corre en
  Railway. ⚠️ [Confirmar la región de Railway.] El monitoreo de errores (Sentry) está en la UE. Nuestros proveedores pueden procesar datos en Estados Unidos con sus garantías contractuales
  (cláusulas contractuales tipo cuando aplican).

**How long do you keep data, and how is it deleted?**

- EN: Outcomes are kept while the workspace uses Corteza; users can delete outcomes and action items at
  any time. Calendar events are never stored; transcripts are discarded after processing. Nightly
  backups are kept 30 days. Account or workspace deletion is done within 30 days of a request to
  cristian@corteza.app. Deleting a workspace destroys its encryption key, which makes any remaining
  copy of its content unreadable, backups included.
- ES: Los resultados se guardan mientras el workspace usa Corteza; los usuarios pueden borrar resultados
  y pendientes cuando quieran. Los eventos del calendario nunca se guardan; las transcripciones se
  descartan después de procesarlas. Los backups nocturnos se guardan 30 días. La eliminación de una
  cuenta o un workspace se hace en un plazo de 30 días desde el pedido a cristian@corteza.app. Al
  eliminar un workspace se destruye su clave de cifrado, lo que vuelve ilegible cualquier copia que
  quede de su contenido, backups incluidos.

**Is customer data used to train AI models?**

- EN: No. We use Anthropic (Claude) and OpenAI (embeddings) through their commercial APIs, whose terms
  don't allow training on the data sent. Corteza doesn't train models. Outcomes a user confirms or
  dismisses are used as examples only for that same workspace.
- ES: No. Usamos Anthropic (Claude) y OpenAI (embeddings) a través de sus APIs comerciales, cuyos
  términos no permiten entrenar con los datos enviados. Corteza no entrena modelos. Lo que un usuario
  confirma o descarta se usa como ejemplo solo dentro de ese mismo workspace.

**Can users connect Corteza to their own AI assistant (Claude, ChatGPT…)? What leaves Corteza then?**

- EN: Yes, through a standard MCP connector. The person signs in with Google and approves access
  (OAuth 2.1 with PKCE; no API keys): read, and changes they confirm (each previewed first, same
  permission rules as the app, marked as made through the assistant, undo for 24 hours, rate limited;
  admins can allow reading only). The assistant sees only what that person sees in
  Corteza, never colleagues' private spaces and never sensitive topics. What it reads is sent to that
  assistant's provider under the person's or company's own agreement with it. People can disconnect
  any time; workspace admins can turn the connector off, which revokes every assistant at once. Tokens
  are short-lived and stored hashed; we log tool names and counts only.
- ES: Sí, con un conector MCP estándar. La persona entra con Google y aprueba el acceso (OAuth 2.1 con
  PKCE; sin API keys): leer, y cambios que ella confirma (cada uno se muestra antes, mismas reglas de
  permisos que la app, marcado como hecho desde el asistente, deshacer durante 24 horas, con límite;
  los admins pueden permitir solo lectura). El asistente solo ve lo que esa persona ve en Corteza,
  nunca espacios privados de colegas ni temas sensibles. Lo que lee se envía al proveedor de ese
  asistente según el acuerdo de la persona o de su empresa con él. Se puede desconectar cuando se
  quiera; los admins del workspace pueden apagar el conector, lo que revoca todos los asistentes al
  instante. Los tokens duran poco y se guardan como hash; solo registramos nombres de herramientas y
  conteos.

## 3. Encryption

**Is data encrypted in transit?**

- EN: Yes. All traffic uses HTTPS (TLS) with HSTS. Connections to the database and to every provider
  are encrypted too.
- ES: Sí. Todo el tráfico usa HTTPS (TLS) con HSTS. Las conexiones a la base de datos y a cada proveedor
  también van cifradas.

**Is data encrypted at rest?**

- EN: Yes, in two layers. The database provider encrypts its storage. On top of that, Corteza encrypts
  meeting content (outcome text, reasoning, quotes, meeting titles, AI context and documents) in the
  application with AES-256-GCM before it's written, using a separate data key per workspace. Workspace
  keys are wrapped by a master key held outside the database. Google tokens and other integration
  credentials are encrypted as well. Backups are encrypted again (age) with a key held only by Corteza.
- ES: Sí, en dos capas. El proveedor de la base de datos cifra su almacenamiento. Además, Corteza cifra
  el contenido de las reuniones (textos, razonamientos, citas, títulos, contexto para la IA y documentos)
  en la aplicación con AES-256-GCM antes de escribirlo, con una clave de datos distinta por workspace.
  Las claves de cada workspace están cifradas con una clave maestra que vive fuera de la base de datos.
  Los tokens de Google y demás credenciales de integraciones también se cifran. Los backups se vuelven a
  cifrar (age) con una clave que solo tiene Corteza.

**How are keys managed?**

- EN: The master key is a 256-bit secret stored as an encrypted environment variable in our hosting
  provider, never in code or in the database. Moving it to a cloud KMS is planned. The backup key's
  private half is kept offline.
- ES: La clave maestra es un secreto de 256 bits guardado como variable de entorno cifrada en nuestro
  proveedor de hosting, nunca en el código ni en la base de datos. Está planificado pasarla a un KMS en
  la nube. La parte privada de la clave de los backups se guarda fuera de línea.

## 4. Access control

**How do users sign in? Is MFA supported?**

- EN: Only with Google; Corteza has no passwords. The customer's Google Workspace policies apply,
  including 2-step verification, session length and device rules. Sessions use HTTP-only, secure,
  SameSite cookies and expire after 7 days. A workspace is tied to the company's Google domain, as
  verified by Google (`hd` claim), never by the email's text.
- ES: Solo con Google; Corteza no tiene contraseñas. Se aplican las políticas de Google Workspace del
  cliente, incluida la verificación en 2 pasos, la duración de sesión y las reglas de dispositivos. Las
  sesiones usan cookies HTTP-only, seguras y SameSite, y vencen a los 7 días. Un workspace está atado al
  dominio de Google de la empresa, según lo verifica Google (claim `hd`), nunca por el texto del correo.

**How is one customer's data kept apart from another's?**

- EN: Every record carries its workspace, and every request is checked against the signed-in user's
  workspace from the server-side session (never from the request). Meeting content is encrypted with
  the workspace's own key, with the workspace bound to the ciphertext, so data copied into another
  workspace can't be decrypted.
- ES: Cada registro lleva su workspace, y cada pedido se valida contra el workspace del usuario según su
  sesión en el servidor (nunca según el pedido). El contenido se cifra con la clave propia del
  workspace, y el workspace queda atado al texto cifrado, así que un dato copiado a otro workspace no se
  puede descifrar.

**Who inside the customer's company can see what?**

- EN: What Corteza captures from a person's meetings goes to their personal space, which only they can
  open; workspace admins can't. Shared spaces are opt-in. Sensitive topics (people leaving,
  performance, pay, health, legal matters about a person) are detected automatically or marked by hand
  and stay visible only to that person. An action item assigned to a colleague is shown to that
  colleague.
- ES: Lo que Corteza captura de las reuniones de una persona va a su espacio personal, que solo ella
  puede abrir; los administradores del workspace no. Los espacios compartidos son opcionales. Los temas
  sensibles (salidas de personas, desempeño, sueldos, salud, temas legales sobre una persona) se detectan
  automáticamente o se marcan a mano y solo los ve esa persona. Un pendiente asignado a un colega se le
  muestra a ese colega.

**Who at Corteza can access production and customer data?**

- EN: Only the founder. Access to production systems (hosting, database, source code, email provider)
  is personal. Two-factor authentication is on for the Google and GitHub accounts and is being turned
  on for every other provider account. ⚠️ [Update when 2FA is on everywhere, COR-49.] Meeting content in the database is encrypted, and Corteza staff
  don't read customer content except at the customer's request for support, for a security
  investigation, or when the law requires it. The nightly backup job uses a read-only database user.
- ES: Solo el fundador. El acceso a los sistemas de producción (hosting, base de datos, código, proveedor
  de correo) es personal. La verificación en dos pasos está activa en las cuentas de Google y GitHub y
  se está activando en las de los demás proveedores. ⚠️ [Actualizar cuando 2FA esté en todas, COR-49.]
  El contenido de reuniones en la base de datos está
  cifrado, y el equipo de Corteza no lee contenido de clientes salvo a pedido del cliente para soporte,
  para una investigación de seguridad, o cuando la ley lo exige. El proceso de backup nocturno usa un
  usuario de base de datos de solo lectura.

## 5. Application security and development

**How do you develop and release software securely?**

- EN: All changes go through pull requests and automated CI before release: unit and integration
  tests, linting, type checks, and `npm audit` on production dependencies (a high or critical finding
  blocks the release). Secrets are never committed. Written secure-coding rules cover output escaping,
  input validation, workspace isolation, encryption of content fields and keeping content out of logs.
- ES: Todos los cambios pasan por pull requests y CI automático antes de publicarse: tests unitarios y de
  integración, lint, chequeo de tipos y `npm audit` sobre las dependencias de producción (un hallazgo
  alto o crítico bloquea la publicación). Los secretos nunca se suben al repositorio. Reglas escritas de
  desarrollo seguro cubren escapado de salida, validación de entradas, aislamiento entre workspaces,
  cifrado de campos de contenido y mantener el contenido fuera de los logs.

**What protections does the web application have?**

- EN: Strict Content-Security-Policy with no third-party scripts (one exception: Google's Drive Picker
  on the Settings page), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, HSTS, rate limits
  on sign-in (5 attempts per 15 minutes), the API and AI features, refusal of requests carrying database
  operators, and escaping of all user, meeting and AI content shown in the browser.
- ES: Content-Security-Policy estricta sin scripts de terceros (una excepción: el selector de Google
  Drive en la página de Configuración), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, HSTS,
  límites de uso en el inicio de sesión (5 intentos cada 15 minutos), la API y las funciones de IA,
  rechazo de pedidos con operadores de base de datos, y escapado de todo contenido de usuarios, reuniones
  e IA que se muestra en el navegador.

**How do you handle vulnerabilities?**

- EN: Dependencies are scanned on every change; high and critical findings are fixed before release.
  Vulnerabilities can be reported to cristian@corteza.app; we answer within 2 business days and fix
  critical issues as a priority.
- ES: Las dependencias se escanean en cada cambio; los hallazgos altos y críticos se corrigen antes de
  publicar. Las vulnerabilidades se pueden reportar a cristian@corteza.app; respondemos en 2 días
  hábiles y corregimos los problemas críticos con prioridad.

## 6. Logging, monitoring and incident response

**What do you log and monitor?**

- EN: Server logs and product analytics hold ids, counts and types only, never transcripts, outcome
  text, search questions or tokens. Application errors go to Sentry (EU region), scrubbed of request
  data, personal data and quoted text. Automatic alerts every 15 minutes cover failed meeting captures,
  stopped background jobs, failing daily emails, lost Google connections and AI provider billing or
  authentication failures.
- ES: Los logs del servidor y la analítica de producto llevan solo ids, conteos y tipos, nunca
  transcripciones, textos, preguntas de búsqueda ni tokens. Los errores de la aplicación van a Sentry
  (región UE), sin datos del pedido, datos personales ni texto citado. Alertas automáticas cada 15
  minutos cubren capturas de reuniones fallidas, procesos en segundo plano detenidos, correos diarios que
  fallan, conexiones de Google perdidas y fallas de facturación o autenticación del proveedor de IA.

**Do you have an incident response process? Will you notify us of a breach?**

- EN: Yes. Alerts reach the founder by email; incidents are contained, investigated and fixed, and
  affected customers are notified without undue delay, and within 72 hours of becoming aware of a
  personal data breach, as the GDPR requires. A written incident response plan is being formalized.
- ES: Sí. Las alertas llegan al fundador por correo; los incidentes se contienen, investigan y corrigen,
  y avisamos a los clientes afectados sin demora indebida, y dentro de las 72 horas de conocer una
  violación de datos personales, como exige el RGPD. El plan de respuesta a incidentes escrito se está
  formalizando.

## 7. Business continuity

**Do you back up data? Have you tested a restore?**

- EN: The database is backed up every night, encrypted, and kept for 30 days (recovery point: at most
  24 hours). A written restore procedure exists. ⚠️ [Restore test: not yet done / done on <date>.]
- ES: La base de datos se respalda cada noche, cifrada, y se guarda 30 días (punto de recuperación:
  como máximo 24 horas). Existe un procedimiento de restauración escrito. ⚠️ [Prueba de restauración:
  todavía no / hecha el <fecha>.]

**What are your availability commitments?**

- EN: Corteza runs on managed cloud infrastructure (Railway, MongoDB Atlas). We don't offer a contractual
  SLA yet. Target recovery time after a major failure: within one business day.
- ES: Corteza corre sobre infraestructura en la nube gestionada (Railway, MongoDB Atlas). Todavía no
  ofrecemos un SLA contractual. Tiempo objetivo de recuperación ante una falla grave: dentro de un día
  hábil.

## 8. Third parties (subprocessors)

**Which subprocessors do you use?**

| Provider | Purpose | Data |
|---|---|---|
| Anthropic | AI that finds outcomes and answers searches | Transcript and notes text (not stored), outcomes, AI context, search questions |
| OpenAI | Embeddings for semantic search | Outcome text and search questions |
| MongoDB Atlas | Database | Everything Corteza stores (meeting content encrypted by Corteza) |
| Railway | Application hosting | Data in transit through the app, server logs |
| Resend | Email | Email address and the content of the emails we send |
| PostHog | Product analytics | Ids, counts and feature usage; no meeting content |
| Sentry (EU) | Error monitoring | Error type and stack trace with internal ids; no meeting content |
| GitHub | Code and nightly backups | Encrypted backup only Corteza can decrypt |
| Google | Sign-in and integrations | As described in the privacy policy |

- EN: The list is kept current in our privacy policy (corteza.app/privacy). We'll notify customers
  before adding a subprocessor that receives meeting content.
- ES: La lista se mantiene al día en nuestra política de privacidad (corteza.app/privacy). Avisaremos a
  los clientes antes de agregar un subprocesador que reciba contenido de reuniones.

## 9. Privacy

**Are you GDPR compliant? Will you sign a DPA?**

- EN: We process personal data in line with the GDPR: we act as processor for the customer's meeting
  content, collect only what the features need, never sell data, and support access, correction,
  deletion and export requests within 30 days. We sign a Data Processing Agreement on request.
- ES: Tratamos los datos personales de acuerdo con el RGPD: actuamos como encargado del tratamiento del
  contenido de reuniones del cliente, recolectamos solo lo que las funciones necesitan, nunca vendemos
  datos, y atendemos pedidos de acceso, corrección, eliminación y portabilidad en 30 días. Firmamos un
  Acuerdo de Tratamiento de Datos (DPA) a pedido.

## 10. People and physical security

**Background checks, training, devices, offices?**

- EN: Corteza is a one-person company today; the founder is the only person with access. Work is done
  on a personal, disk-encrypted laptop with a screen lock (FileVault). There are no
  offices or own data centers: all infrastructure is with cloud providers that hold SOC 2 and ISO
  27001 certifications for their data centers. Policies for onboarding and offboarding staff will be in
  place before the first hire.
- ES: Hoy Corteza es una empresa de una persona; el fundador es el único con acceso. El trabajo se hace en
  una laptop personal con disco cifrado y bloqueo de pantalla (FileVault). No hay
  oficinas ni centros de datos propios: toda la infraestructura está en proveedores en la nube con
  certificaciones SOC 2 e ISO 27001 para sus centros de datos. Las políticas de alta y baja de personal
  estarán listas antes de la primera contratación.
