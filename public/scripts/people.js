/**
 * Workspace members to pick owners from (GET /api/people), loaded once per page.
 * Used by inline-edit.js (decision owner), decision-actions.js and the Log modal (action item owners).
 */
(function() {
  'use strict';

  let request = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  /** @returns {Promise<Array<{user_id: string, name: string, email: string|null}>>} */
  function load() {
    if (!request) {
      request = fetch('/api/people', { credentials: 'include' })
        .then(response => (response.ok ? response.json() : { people: [] }))
        .then(data => data.people || [])
        .catch(() => {
          request = null; // try again next time
          return [];
        });
    }
    return request;
  }

  /**
   * Owner picker: chosen people as removable chips, plus a "+ Add owner…" select.
   * Styled by the decision-action-* classes (dashboard styles).
   * @param {HTMLElement} root - emptied and filled with the picker
   * @param {Array<{user_id: string, name: string}>} people
   * @param {string[]} [initial] - user_ids chosen from the start
   * @returns {{ selected: () => string[] }}
   */
  function ownerPicker(root, people, initial = []) {
    const chosen = initial.filter(id => people.some(person => person.user_id === id));
    root.innerHTML = `
      <div class="decision-action-chips"></div>
      <select class="inline-edit-input" aria-label="Add owner">
        <option value="">+ Add owner…</option>
        ${people.map(person => `<option value="${escapeHtml(person.user_id)}">${escapeHtml(person.name)}</option>`).join('')}
      </select>`;
    const chips = root.querySelector('.decision-action-chips');
    const select = root.querySelector('select');
    const render = () => {
      chips.innerHTML = chosen.map(id => {
        const person = people.find(p => p.user_id === id);
        return `<span class="tag decision-action-chip">${escapeHtml(person ? person.name : id)} <button type="button" data-remove="${escapeHtml(id)}" aria-label="Remove">×</button></span>`;
      }).join('');
      for (const option of select.options) option.hidden = option.disabled = !!option.value && chosen.includes(option.value);
    };
    select.addEventListener('change', () => {
      if (select.value && !chosen.includes(select.value)) chosen.push(select.value);
      select.value = '';
      render();
    });
    chips.addEventListener('click', event => {
      const id = event.target.dataset && event.target.dataset.remove;
      if (!id) return;
      chosen.splice(chosen.indexOf(id), 1);
      render();
    });
    render();
    return { selected: () => chosen.slice() };
  }

  window.CortezaPeople = { load, ownerPicker };
})();
