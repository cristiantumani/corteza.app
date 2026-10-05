const { getWorkspaceMembersCollection } = require('../../config/database');
const { isLanguage } = require('../i18n/i18n');

/**
 * The language a person picked in Settings (`workspace_members.language`: 'en' | 'es').
 * Not set means "follow my browser" (core/i18n/i18n.js requestLanguage).
 */

/**
 * @param {string} workspaceId
 * @param {string} userId
 * @returns {Promise<'en'|'es'|null>}
 */
async function getLanguage(workspaceId, userId) {
  const member = await getWorkspaceMembersCollection().findOne({ workspace_id: workspaceId, user_id: userId }, { projection: { _id: 0, language: 1 } });
  return member && isLanguage(member.language) ? member.language : null;
}

/**
 * @param {string} workspaceId
 * @param {string} userId
 * @param {unknown} language - 'en' | 'es', or null to follow the browser again
 * @returns {Promise<boolean>} false for an unknown language
 */
async function setLanguage(workspaceId, userId, language) {
  if (language !== null && !isLanguage(language)) return false;
  await getWorkspaceMembersCollection().updateOne(
    { workspace_id: workspaceId, user_id: userId },
    language === null ? { $unset: { language: '' } } : { $set: { language } }
  );
  return true;
}

module.exports = { getLanguage, setLanguage };
