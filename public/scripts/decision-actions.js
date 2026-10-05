/**
 * Action items of a decision, in the detail modal (#detail-actions-section).
 *
 * Lists the decision's action items (GET /api/action-items?decision_id=) and,
 * for people who can add to the decision's space, a "+ Add action item" form:
 * what needs to be done, owners picked from the workspace members (people.js)
 * and an optional due date (POST /api/action-items).
 * Fires `corteza:action-items-changed` after adding one (Home refreshes "My action items").
 * Closing the modal with the form filled in saves it (flush), like the click-to-edit fields.
 */
(function() {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  const t = window.t || (key => key); // public/scripts/i18n.js
  const locale = (window.CortezaI18n && window.CortezaI18n.locale) || undefined;
  let current = null; // decision id the modal shows, so late responses for another decision are ignored
  let openSave = null; // saves the open "Add action item" form, if any

  function renderItems(items) {
    return items.map(item => {
      const owners = item.owners.map(owner => owner.name).join(', ') || t('detail.noOwner');
      const due = item.due_date ? new Date(`${item.due_date}T00:00:00`).toLocaleDateString(locale) : t('detail.noDue');
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
    openSave = null;
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
        ${canAdd ? `<button type="button" class="inline-edit-prompt decision-action-add">+ ${escapeHtml(t('actions.add'))}</button>` : ''}
        ${items.length ? `<a href="/actions">${escapeHtml(t('detail.openActions'))}</a>` : ''}
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
      <input type="text" name="text" class="inline-edit-input" placeholder="${escapeHtml(t('actions.whatPlaceholder'))}" maxlength="500" required>
      <div class="decision-action-row">
        <div class="decision-action-owners"></div>
        <label class="decision-action-due">${escapeHtml(t('actions.due'))} <input type="date" name="due_date" class="inline-edit-input"></label>
      </div>
      <div class="decision-action-buttons">
        <button type="submit" class="modal-btn modal-btn-primary">${escapeHtml(t('common.save'))}</button>
        <button type="button" class="modal-btn modal-btn-cancel" data-cancel>${escapeHtml(t('common.cancel'))}</button>
        <span class="inline-edit-hint"></span>
      </div>`;
    footer.replaceWith(form);
    const owners = window.CortezaPeople.ownerPicker(form.querySelector('.decision-action-owners'), people);

    form.querySelector('[data-cancel]').addEventListener('click', () => load({ decision, canAdd }));
    form.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation(); // keep the modal open
        load({ decision, canAdd });
      }
    });

    const save = async () => {
      const hint = form.querySelector('.inline-edit-hint');
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      hint.classList.remove('inline-edit-error');
      hint.textContent = t('common.saving');
      try {
        const response = await fetch('/api/action-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            decision_id: decision.id,
            text: form.elements.text.value,
            owner_user_ids: owners.selected(),
            due_date: form.elements.due_date.value || null
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || t('actions.addFailed'));
        openSave = null;
        document.dispatchEvent(new CustomEvent('corteza:action-items-changed', { detail: { item: data.item } }));
        if (current === decision.id) await load({ decision, canAdd });
        return true;
      } catch (error) {
        hint.textContent = error.message;
        hint.classList.add('inline-edit-error');
        submit.disabled = false;
        return false;
      }
    };
    form.addEventListener('submit', event => {
      event.preventDefault();
      save();
    });
    // Closing the modal saves what was typed (nothing to save without a description)
    openSave = () => (form.isConnected && form.elements.text.value.trim() ? save() : Promise.resolve(true));

    form.elements.text.focus();
  }

  /**
   * Saves the "Add action item" form if it's open and filled in (the modal is closing)
   * @returns {Promise<boolean>} false when saving failed (the form shows why)
   */
  function flush() {
    const save = openSave;
    openSave = null;
    return save ? save() : Promise.resolve(true);
  }

  window.CortezaDecisionActions = { load, flush };
})();
