const { getWorkspaceMembersCollection } = require('../../config/database');

/**
 * Owners of action items: names said in a meeting ("Martín", "Felipe Silva")
 * matched to workspace members so "My action items" and reminders work.
 */

/** Lowercase, no accents, single spaces */
function normalizeName(name) {
  return String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Finds the member a spoken name refers to. Tries, in order: the full name,
 * then a unique match on first name, then a unique member whose name starts
 * with the spoken name ("Martin M" → "Martin Marchant"). Ambiguous → null.
 * @param {string} name
 * @param {Object[]} members - [{ user_id, user_name, email }]
 * @returns {Object|null} member
 */
function matchMember(name, members) {
  const target = normalizeName(name);
  if (!target) return null;
  const named = members.filter(member => member.user_name);

  const exact = named.filter(member => normalizeName(member.user_name) === target);
  if (exact.length === 1) return exact[0];

  const firstName = target.split(' ')[0];
  const byFirstName = named.filter(member => normalizeName(member.user_name).split(' ')[0] === firstName);
  if (!target.includes(' ') && byFirstName.length === 1) return byFirstName[0];

  const byPrefix = named.filter(member => normalizeName(member.user_name).startsWith(target));
  if (byPrefix.length === 1) return byPrefix[0];

  // "Felipe Silva Rojas" said in full, member saved as "Felipe Silva"
  const contained = named.filter(member => target.startsWith(normalizeName(member.user_name)));
  if (contained.length === 1) return contained[0];

  return null;
}

/**
 * Resolves spoken owner names to owners ({ name, user_id, email }); unmatched names keep user_id null
 * @param {string} workspaceId
 * @param {string[]} names
 * @param {Object[]} [members] - workspace members, loaded if not given
 * @returns {Promise<Object[]>}
 */
async function resolveOwners(workspaceId, names, members) {
  const unique = [...new Set((names || []).map(name => String(name || '').trim()).filter(Boolean))].slice(0, 10);
  if (unique.length === 0) return [];
  const list = members || await getWorkspaceMembersCollection()
    .find({ workspace_id: workspaceId, removed_at: null })
    .project({ user_id: 1, user_name: 1, email: 1 })
    .toArray();

  const owners = [];
  for (const name of unique) {
    const member = matchMember(name, list);
    const owner = member
      ? { name: member.user_name, user_id: member.user_id, email: member.email || null }
      : { name, user_id: null, email: null };
    if (!owners.some(existing => owner.user_id && existing.user_id === owner.user_id)) owners.push(owner);
  }
  return owners;
}

module.exports = { normalizeName, matchMember, resolveOwners };
