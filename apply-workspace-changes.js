/**
 * Script to apply remaining workspace_id changes to ai-decisions.js
 * This handles all remaining action handlers and queries
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/routes/ai-decisions.js');
let content = fs.readFileSync(filePath, 'utf8');

// Update handleRejectAction
content = content.replace(
  /async function handleRejectAction\(\{ ack, body, client \}\) \{\n  await ack\(\);\n\n  try \{\n    const suggestionId = body\.actions\[0\]\.value;/,
  `async function handleRejectAction({ ack, body, client }) {
  await ack();

  try {
    const workspace_id = body.team.id;
    const suggestionId = body.actions[0].value;`
);

content = content.replace(
  /const suggestion = await suggestionsCollection\.findOne\(\{ suggestion_id: suggestionId \}\);/g,
  `const suggestion = await suggestionsCollection.findOne({ workspace_id: workspace_id, suggestion_id: suggestionId });`
);

// Update handleEditAction
content = content.replace(
  /async function handleEditAction\(\{ ack, body, client \}\) \{\n  await ack\(\);\n\n  try \{\n    const suggestionId = body\.actions\[0\]\.value;/,
  `async function handleEditAction({ ack, body, client }) {
  await ack();

  try {
    const workspace_id = body.team.id;
    const suggestionId = body.actions[0].value;`
);

// Update handleEditModalSubmit
content = content.replace(
  /async function handleEditModalSubmit\(\{ ack, view, client \}\) \{/,
  `async function handleEditModalSubmit({ ack, view, body, client }) {`
);

content = content.replace(
  /async function handleEditModalSubmit\(\{ ack, view, body, client \}\) \{\n  try \{\n    await ack\(\);\n\n    const metadata = JSON\.parse\(view\.private_metadata\);/,
  `async function handleEditModalSubmit({ ack, view, body, client }) {
  try {
    await ack();

    const workspace_id = body.team.id;
    const metadata = JSON.parse(view.private_metadata);`
);

// Update handleConnectJiraAction
content = content.replace(
  /async function handleConnectJiraAction\(\{ ack, body, client \}\) \{\n  await ack\(\);\n\n  try \{\n    const suggestionId = body\.actions\[0\]\.value;/,
  `async function handleConnectJiraAction({ ack, body, client }) {
  await ack();

  try {
    const workspace_id = body.team.id;
    const suggestionId = body.actions[0].value;`
);

// Update handleConnectJiraModalSubmit
content = content.replace(
  /async function handleConnectJiraModalSubmit\(\{ ack, view, client \}\) \{/,
  `async function handleConnectJiraModalSubmit({ ack, view, body, client }) {`
);

content = content.replace(
  /async function handleConnectJiraModalSubmit\(\{ ack, view, body, client \}\) \{\n  try \{\n    await ack\(\);\n\n    const metadata = JSON\.parse\(view\.private_metadata\);/,
  `async function handleConnectJiraModalSubmit({ ack, view, body, client }) {
  try {
    await ack();

    const workspace_id = body.team.id;
    const metadata = JSON.parse(view.private_metadata);`
);

// Update saveFeedback function signature
content = content.replace(
  /async function saveFeedback\(suggestion, action, finalVersion, userId\) \{/,
  `async function saveFeedback(suggestion, action, finalVersion, userId, workspace_id) {`
);

// Update saveFeedback to add workspace_id to feedback object
content = content.replace(
  /const feedback = \{\n      feedback_id: `feedback_\$\{Date\.now\(\)\}_\$\{Math\.random\(\)\.toString\(36\)\.substring\(7\)\}`,\n      suggestion_id: suggestion\.suggestion_id,/,
  `const feedback = {
      workspace_id: workspace_id,
      feedback_id: \`feedback_\${Date.now()}_\${Math.random().toString(36).substring(7)}\`,
      suggestion_id: suggestion.suggestion_id,`
);

// Add workspace_id to all decision objects created in edit/connect flows
// This regex finds decision objects and adds workspace_id as first property
content = content.replace(
  /(const decision = \{)\n(\s+)id: nextId,/g,
  `$1\n$2workspace_id: workspace_id,\n$2id: nextId,`
);

// Update suggestion status updates to include workspace_id filter
content = content.replace(
  /await suggestionsCollection\.updateOne\(\n\s+\{ suggestion_id: suggestionId \},/g,
  `await suggestionsCollection.updateOne(\n      { workspace_id: workspace_id, suggestion_id: suggestionId },`
);

// Update all lastDecision queries to scope by workspace
content = content.replace(
  /const lastDecision = await decisionsCollection\.findOne\(\{\}, \{ sort: \{ id: -1 \} \}\);/g,
  `const lastDecision = await decisionsCollection.findOne({ workspace_id: workspace_id }, { sort: { id: -1 } });`
);

// Write the updated content back
fs.writeFileSync(filePath, content, 'utf8');
console.log('✅ Applied all workspace_id changes to ai-decisions.js');
