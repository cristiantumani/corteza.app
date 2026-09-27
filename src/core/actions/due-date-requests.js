const { markDueDateRequested } = require('./action-service');

/**
 * Asks owners of new action items that have no due date to set one.
 *
 * One email per owner per meeting, listing their undated items with a link to
 * set the date in Corteza (/actions). Only for recent meetings: importing past
 * meetings doesn't email people about old commitments. Each item is asked once.
 */

const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @param {Object[]} actionItems - items just created by the pipeline
 * @param {Object} transcript - { title, url, occurredAt }
 * @param {Object} [options]
 * @param {Function} [options.send] - ({ email, name, meetingTitle, meetingUrl, items }) => Promise
 * @param {Date} [options.now]
 * @returns {Promise<{ sent: number }>}
 */
async function requestMissingDueDates(actionItems, transcript, { send = defaultSend, now = new Date() } = {}) {
  const occurredAt = transcript.occurredAt ? new Date(transcript.occurredAt) : null;
  if (!occurredAt || now - occurredAt > RECENT_MS) return { sent: 0 };

  const byOwner = new Map();
  for (const item of actionItems) {
    if (item.due_date || item.due_date_requested_at || item.status !== 'open') continue;
    for (const owner of item.owners || []) {
      if (!owner.email) continue;
      const key = owner.email.toLowerCase();
      if (!byOwner.has(key)) byOwner.set(key, { email: owner.email, name: owner.name, items: [] });
      byOwner.get(key).items.push(item);
    }
  }

  let sent = 0;
  const asked = new Set();
  for (const { email, name, items } of byOwner.values()) {
    try {
      await send({ email, name, meetingTitle: transcript.title || 'a meeting', meetingUrl: transcript.url || null, items });
      sent++;
      items.forEach(item => asked.add(item.item_id));
    } catch (error) {
      console.error(`❌ Due date request to ${email} failed:`, error.message);
    }
  }
  await markDueDateRequested([...asked]);
  if (sent > 0) console.log(`📅 Asked ${sent} owner(s) for due dates on ${asked.size} action item(s) from "${transcript.title}"`);
  return { sent };
}

async function defaultSend(params) {
  if (!process.env.RESEND_API_KEY) return;
  const { sendDueDateRequestEmail } = require('../../utils/n8n-client');
  await sendDueDateRequestEmail(params);
}

module.exports = { requestMissingDueDates, RECENT_MS };
