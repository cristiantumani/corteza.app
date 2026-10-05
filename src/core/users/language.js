const { getWorkspaceMembersCollection } = require('../../config/database');
const { isLanguage } = require('../i18n/i18n');

/**
 * The language a person picked in Settings (`workspace_members.language`: 'en' | 'es').
 * Not set means "follow my browser" (core/i18n/i18n.js requestLanguage).
 *
 * Emails have no browser to ask, so the app also remembers the browser's language
 * (`workspace_members.browser_language`) when a signed-in person without a pick opens a page.
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

/**
 * The language to email someone in: their pick, else their browser's last seen, else null
 * @param {{ language?: string|null, browser_language?: string|null }|null} member
 * @returns {'en'|'es'|null}
 */
function memberLanguage(member) {
  if (!member) return null;
  if (isLanguage(member.language)) return member.language;
  if (isLanguage(member.browser_language)) return member.browser_language;
  return null;
}

/**
 * Same as memberLanguage, looked up by membership; English when nothing is known
 * @param {string} workspaceId
 * @param {string} userId
 * @returns {Promise<'en'|'es'>}
 */
async function getEmailLanguage(workspaceId, userId) {
  const member = await getWorkspaceMembersCollection().findOne(
    { workspace_id: workspaceId, user_id: userId },
    { projection: { _id: 0, language: 1, browser_language: 1 } }
  );
  return memberLanguage(member) || 'en';
}

/**
 * Remembers the browser's language for someone who hasn't picked one (once per session and language)
 * @param {{ session?: any }} req
 * @param {'en'|'es'} language - from Accept-Language
 */
function rememberBrowserLanguage(req, language) {
  const user = req.session && req.session.user;
  if (!user || !user.workspace_id || !user.user_id || isLanguage(user.language)) return;
  if (req.session.browser_language === language) return;
  req.session.browser_language = language;
  getWorkspaceMembersCollection().updateOne(
    { workspace_id: user.workspace_id, user_id: user.user_id },
    { $set: { browser_language: language } }
  ).catch(error => console.warn('⚠️  Could not save the browser language:', error.message));
}

module.exports = { getLanguage, setLanguage, memberLanguage, getEmailLanguage, rememberBrowserLanguage };
