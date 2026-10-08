// Sensitive topics (docs/specs/2026-10-sensitive-topics.md): an outcome or action item, with its
// thread, visible only to the person who marked it. Shown in the outcome detail modal and on
// Action items (the lock chip and the editor's toggle).
//
// API: PUT /api/sensitive { kind: 'decision'|'action_item', id, sensitive }
(function() {
  'use strict';
  const t = window.t || (key => key); // public/scripts/i18n.js

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /**
   * Marks or unmarks it (and its thread)
   * @param {'decision'|'action_item'} kind
   * @param {number|string} id
   * @param {boolean} value
   * @returns {Promise<{ decisions: number, action_items: number }>}
   */
  async function setSensitive(kind, id, value) {
    const response = await fetch('/api/sensitive', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, id, sensitive: value })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.error || t('common.couldNotSave'));
    return data;
  }

  /** The lock chip for lists */
  function chip() {
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-inverse-surface text-inverse-on-surface" title="${esc(t('sensitive.help'))}"><span class="material-symbols-outlined" style="font-size: 14px; font-variation-settings: 'FILL' 1" aria-hidden="true">lock</span>${esc(t('sensitive.label'))}</span>`;
  }

  /**
   * The detail modal's line: "Sensitive: only you see it" with Remove, or "Mark as sensitive"
   * @param {Object} decision - with id, sensitive
   * @param {() => void} [onChange] - after it changed (e.g. refresh the page's lists)
   */
  function renderDetail(decision, onChange) {
    const container = document.getElementById('detail-sensitive');
    if (!container || !decision) return;
    container.dataset.decisionId = String(decision.id);
    container.innerHTML = decision.sensitive
      ? `<div class="flex flex-wrap items-center gap-3 rounded-lg bg-surface-container-low px-3 py-2 text-sm">
           ${chip()}<span class="text-on-surface-variant">${esc(t('sensitive.onlyYou'))}</span>
           <button type="button" class="sensitive-toggle font-semibold text-on-surface hover:underline" data-value="false">${esc(t('sensitive.remove'))}</button>
           <span class="sensitive-error text-error" role="alert"></span>
         </div>`
      : `<div class="flex flex-wrap items-center gap-2 text-sm">
           <button type="button" class="sensitive-toggle inline-flex items-center gap-1 font-semibold text-on-surface-variant hover:text-on-surface hover:underline" data-value="true">
             <span class="material-symbols-outlined" style="font-size: 16px; font-variation-settings: 'FILL' 0" aria-hidden="true">lock</span>${esc(t('sensitive.mark'))}
           </button>
           <span class="text-xs text-on-surface-variant">${esc(t('sensitive.help'))}</span>
           <span class="sensitive-error text-error" role="alert"></span>
         </div>`;
    container.style.display = 'block';
    container.querySelector('.sensitive-toggle').addEventListener('click', async event => {
      const button = event.currentTarget;
      const value = button.dataset.value === 'true';
      button.disabled = true;
      try {
        await setSensitive('decision', decision.id, value);
        decision.sensitive = value;
        if (container.dataset.decisionId === String(decision.id)) renderDetail(decision, onChange);
        if (onChange) onChange();
        document.dispatchEvent(new CustomEvent('corteza:home-refresh'));
      } catch (error) {
        button.disabled = false;
        container.querySelector('.sensitive-error').textContent = error.message;
      }
    });
  }

  window.CortezaSensitive = { setSensitive, chip, renderDetail };
})();
