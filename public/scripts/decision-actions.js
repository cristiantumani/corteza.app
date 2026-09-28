/**
 * Action items of a decision, in the detail modal (#detail-actions-section).
 *
 * Lists the decision's action items (GET /api/action-items?decision_id=) and,
 * for people who can add to the decision's space, a "+ Add action item" form:
 * what needs to be done, owners picked from the workspace members (people.js)
 * and an optional due date (POST /api/action-items).
 * Fires `corteza:action-items-changed` after adding one (Home refreshes "My action items").
 */
(function() {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  let current = null; // decision id the modal shows, so late responses for another decision are ignored

  function renderItems(items) {
    return items.map(item => {
      const owners = item.owners.map(owner => owner.name).join(', ') || 'No owner';
      const due = item.due_date ? new Date(`${item.due_date}T00:00:00`).toLocaleDateString() : 'no due date';
      return `<div class="decision-action">${item.status === 'done' ? '✅' : '⬜'} ${escapeHtml(item.text)}<br><small>${escapeHtml(owners)} · ${escapeHtml(due)}</small></div>`;
    }).join('');
  }

  /**
   * Loads and shows the decision's action items
   * @param {{ decision: Object, canAdd: boolean }} options
   */
  async function load({ decision, canAdd }) {
    const section = document.getElementById('detail-actions-section');
    const list = document.getElementById('detail-actions');
    if (!section || !list) return;
    current = decision.id;
    section.style.display = 'none';
    list.innerHTML = '';

    let items = [];
    try {
      const response = await fetch(`/api/action-items?owner=all&status=all&decision_id=${encodeURIComponent(decision.id)}`, { credentials: 'include' });
      const data = await response.json();
      if (response.ok) items = data.items || [];
    } catch (error) {
      console.error('Could not load action items:', error);
    }
    if (current !== decision.id) return;
    if (items.length === 0 && !canAdd) return;

    list.innerHTML = `
      ${renderItems(items)}
      <div class="decision-actions-footer">
        ${canAdd ? '<button type="button" class="inline-edit-prompt decision-action-add">+ Add action item</button>' : ''}
        ${items.length ? '<a href="/actions">Open action items →</a>' : ''}
      </div>`;
    section.style.display = 'block';

    const addButton = list.querySelector('.decision-action-add');
    if (addButton) addButton.addEventListener('click', () => openForm({ decision, canAdd }));
  }

  async function openForm({ decision, canAdd }) {
    const list = document.getElementById('detail-actions');
    const footer = list.querySelector('.decision-actions-footer');
    const people = window.CortezaPeople ? await window.CortezaPeople.load() : [];
    if (current !== decision.id) return;

    const form = document.createElement('form');
    form.className = 'decision-action-form';
    form.innerHTML = `
      <input type="text" name="text" class="inline-edit-input" placeholder="What needs to be done?" maxlength="500" required>
      <div class="decision-action-row">
        <div class="decision-action-owners">
          <div class="decision-action-chips"></div>
          <select name="owner" class="inline-edit-input">
            <option value="">+ Add owner…</option>
            ${people.map(person => `<option value="${escapeHtml(person.user_id)}">${escapeHtml(person.name)}</option>`).join('')}
          </select>
        </div>
        <label class="decision-action-due">Due <input type="date" name="due_date" class="inline-edit-input"></label>
      </div>
      <div class="decision-action-buttons">
        <button type="submit" class="modal-btn modal-btn-primary">Add</button>
        <button type="button" class="modal-btn modal-btn-cancel" data-cancel>Cancel</button>
        <span class="inline-edit-hint"></span>
      </div>`;
    footer.replaceWith(form);

    const chosen = [];
    const chips = form.querySelector('.decision-action-chips');
    const ownerSelect = form.querySelector('select[name="owner"]');
    const renderChips = () => {
      chips.innerHTML = chosen.map(id => {
        const person = people.find(p => p.user_id === id);
        return `<span class="tag decision-action-chip">${escapeHtml(person ? person.name : id)} <button type="button" data-remove="${escapeHtml(id)}" aria-label="Remove">×</button></span>`;
      }).join('');
      for (const option of ownerSelect.options) option.hidden = option.disabled = !!option.value && chosen.includes(option.value);
    };
    ownerSelect.addEventListener('change', () => {
      if (ownerSelect.value && !chosen.includes(ownerSelect.value)) chosen.push(ownerSelect.value);
      ownerSelect.value = '';
      renderChips();
    });
    chips.addEventListener('click', event => {
      const id = event.target.dataset && event.target.dataset.remove;
      if (!id) return;
      chosen.splice(chosen.indexOf(id), 1);
      renderChips();
    });

    form.querySelector('[data-cancel]').addEventListener('click', () => load({ decision, canAdd }));
    form.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation(); // keep the modal open
        load({ decision, canAdd });
      }
    });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const hint = form.querySelector('.inline-edit-hint');
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      hint.classList.remove('inline-edit-error');
      hint.textContent = 'Saving…';
      try {
        const response = await fetch('/api/action-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            decision_id: decision.id,
            text: form.elements.text.value,
            owner_user_ids: chosen,
            due_date: form.elements.due_date.value || null
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Couldn’t add it');
        document.dispatchEvent(new CustomEvent('corteza:action-items-changed', { detail: { item: data.item } }));
        await load({ decision, canAdd });
      } catch (error) {
        hint.textContent = error.message;
        hint.classList.add('inline-edit-error');
        submit.disabled = false;
      }
    });

    form.elements.text.focus();
  }

  window.CortezaDecisionActions = { load };
})();
