const crypto = require('crypto');

/**
 * Topic threads: outcomes and action items about the same subject (an open question, the
 * risk behind it, the next step to answer it) share a `topic_id` (`top_<hex>`) and a short
 * `topic` label, so the app can show them together and suggest closing the loop.
 * See docs/specs/2026-10-topic-threads.md. Threads only exist inside one capture for now;
 * linking across meetings is roadmap B4.
 */

const MAX_TOPIC = 80;

/** @returns {string} a new thread id */
function newTopicId() {
  return `top_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Key that treats "Certificación ISO 27001" and "certificacion iso-27001." as the same label
 * @param {unknown} label
 * @returns {string} '' when there's no usable label
 */
function topicKey(label) {
  if (typeof label !== 'string') return '';
  return label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Groups one capture's extracted items into threads (pure). Items join a thread when they
 * have the same topic label, or when an action item carries out a decision (`decision_ref`).
 * A thread needs at least two items; a lone item gets no thread.
 * @param {{ topic?: string|null, decision_type?: string, decision_ref?: number|null }[]} items
 * @param {{ newId?: () => string }} [options]
 * @returns {({ topicId: string, topic: string|null }|null)[]} per item, in the same order
 */
function assignTopics(items, { newId = newTopicId } = {}) {
  const parent = items.map((_, index) => index);
  const find = index => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  const union = (a, b) => { parent[find(a)] = find(b); };

  const firstByKey = new Map();
  items.forEach((item, index) => {
    const key = topicKey(item && item.topic);
    if (key) {
      if (firstByKey.has(key)) union(index, firstByKey.get(key));
      else firstByKey.set(key, index);
    }
    const ref = item && item.decision_ref;
    if (item && item.decision_type === 'action_item' && Number.isInteger(ref) && ref >= 0 && ref < items.length && ref !== index) {
      union(index, ref);
    }
  });

  const members = new Map();
  items.forEach((_, index) => {
    const root = find(index);
    if (!members.has(root)) members.set(root, []);
    members.get(root).push(index);
  });

  const result = items.map(() => null);
  for (const group of members.values()) {
    if (group.length < 2) continue;
    const labelled = group.find(index => topicKey(items[index].topic));
    const topic = labelled === undefined ? null : items[labelled].topic.trim().slice(0, MAX_TOPIC);
    const thread = { topicId: newId(), topic };
    for (const index of group) result[index] = thread;
  }
  return result;
}

module.exports = { newTopicId, topicKey, assignTopics, MAX_TOPIC };
