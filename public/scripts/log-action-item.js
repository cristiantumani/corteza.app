/**
 * "Log manually" with the type Action item: asks who owns it and when it's due, and saves it
 * to Action items (POST /api/action-items with space_id), not as an outcome card.
 *
 * dashboard.js calls CortezaLogActionItem.reset() when the modal opens and delegates to
 * CortezaLogActionItem.submit() when the type is action_item.
 */
(function() {
  'use strict';

  const $ = id => document.getElementById(id);
  let picker = null;

  function isActionItem() {
    const type = $('log-memory-type');
    return !!type && type.value === 'action_item';
  }

  /** Shows the owner and due date fields for action items, the outcome-only fields otherwise */
  async function toggle() {
    const actionItem = isActionItem();
    const fields = $('log-action-fields');
    if (!fields) return;
    fields.style.display = actionItem ? 'block' : 'none';
    fields.hidden = !actionItem;
    document.querySelectorAll('#log-memory-modal [data-log-not-action]').forEach(el => {
      el.style.display = actionItem ? 'none' : '';
    });
    if (actionItem && !picker && window.CortezaPeople) {
      const people = await window.CortezaPeople.load();
      const me = window.currentUser && window.currentUser.user_id;
      // The person logging it owns it unless they choose otherwise
      picker = window.CortezaPeople.ownerPicker($('log-action-owners'), people, me ? [me] : []);
    }
  }

  /** Clears the fields (the modal is opening) */
  function reset() {
    picker = null;
    if ($('log-action-owners')) $('log-action-owners').innerHTML = '';
    if ($('log-action-due')) $('log-action-due').value = '';
    toggle();
  }

  /**
   * Saves the action item
   * @param {{ text: string, spaceId: string }} params
   * @returns {Promise<Object>} the saved item; throws with a readable message
   */
  async function submit({ text, spaceId }) {
    const response = await fetch('/api/action-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        space_id: spaceId,
        text,
        owner_user_ids: picker ? picker.selected() : [],
        due_date: $('log-action-due').value || null
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || (window.t ? window.t('actions.saveFailed') : 'Couldn’t save the action item'));
    document.dispatchEvent(new CustomEvent('corteza:action-items-changed', { detail: { item: data.item } }));
    return data.item;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const type = $('log-memory-type');
    if (type) type.addEventListener('change', toggle);
  });

  window.CortezaLogActionItem = { reset, submit, isActionItem };
})();
