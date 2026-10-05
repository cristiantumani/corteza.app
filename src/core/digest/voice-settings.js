const { getDatabase, getWorkspaceMembersCollection } = require('../../config/database');
const { VOICES, SAMPLES, defaultVoice, resolveVoice } = require('./voice');

/**
 * Who picks the morning partner: each person (`workspace_members.digest_voice`), within the
 * workspace switch (`workspaces.digest_voices_enabled`, admins only; missing means on).
 */

/**
 * A person's morning partner setting, for Settings
 * @param {string} workspaceId
 * @param {string} userId
 * @param {'en'|'es'} [lang] - language of the sample lines
 * @returns {Promise<{ voice: string, chosen: string|null, default_voice: string, workspace_enabled: boolean, voices: string[], samples: Record<string, string> }>}
 *   voice: what tomorrow's summary uses; chosen: what the person picked (null: never picked)
 */
async function getVoiceSetting(workspaceId, userId, lang = 'en') {
  const [member, workspace] = await Promise.all([
    getWorkspaceMembersCollection().findOne({ workspace_id: workspaceId, user_id: userId }, { projection: { _id: 0, digest_voice: 1 } }),
    getDatabase().collection('workspaces').findOne({ workspace_id: workspaceId }, { projection: { _id: 0, digest_voices_enabled: 1 } })
  ]);
  const chosen = member && VOICES.includes(member.digest_voice) ? member.digest_voice : null;
  return {
    voice: resolveVoice(member || {}, workspace),
    chosen,
    default_voice: defaultVoice(),
    workspace_enabled: !workspace || workspace.digest_voices_enabled !== false,
    voices: [...VOICES],
    samples: SAMPLES[lang] || SAMPLES.en
  };
}

/**
 * Saves the person's pick
 * @param {string} workspaceId
 * @param {string} userId
 * @param {unknown} voice
 * @returns {Promise<boolean>} false for an unknown voice
 */
async function setVoice(workspaceId, userId, voice) {
  if (typeof voice !== 'string' || !VOICES.includes(/** @type {any} */ (voice))) return false;
  await getWorkspaceMembersCollection().updateOne(
    { workspace_id: workspaceId, user_id: userId },
    { $set: { digest_voice: voice, digest_voice_set_at: new Date() } }
  );
  return true;
}

/**
 * Turns personalities on or off for the whole workspace (the caller checked it's an admin)
 * @param {string} workspaceId
 * @param {boolean} enabled
 */
async function setWorkspaceVoicesEnabled(workspaceId, enabled) {
  await getDatabase().collection('workspaces').updateOne(
    { workspace_id: workspaceId },
    { $set: { digest_voices_enabled: enabled === true } },
    { upsert: true }
  );
}

module.exports = { getVoiceSetting, setVoice, setWorkspaceVoicesEnabled };
