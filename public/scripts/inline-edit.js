/**
 * Click-to-edit for the outcome detail modal (#detail-modal).
 *
 * Clicking a field (content, why, type, owner, due date, tags, meeting context,
 * Jira epic) turns it into an input. Enter (Ctrl/⌘+Enter in text areas) or
 * clicking away saves just that field with PUT /api/decisions/:id; Esc cancels.
 * Empty optional fields show an "Add …" prompt so they can be filled in.
 *
 * dashboard.js calls CortezaInlineEdit.attach() every time it renders the modal.
 */
(function() {
  'use strict';

  const TYPE_OPTIONS = [
    ['decision', 'Decision'], ['open_question', 'Open question'], ['risk', 'Risk'],
    ['action_item', 'Action item'], ['context', 'Context'], ['explanation', 'Explanation'],
    ['learning', 'Learning'], ['assumption', 'Assumption']
  ];

  /**
   * key: field in the decision and in the PUT body
   * valueId / sectionId: element that shows the value / wrapper hidden when empty
   * input: textarea | text | date | select
   * prompt: shown when the field is empty (optional fields only)
   */
  const FIELDS = [
    { key: 'text', valueId: 'detail-decision-text', input: 'textarea', required: true },
    { key: 'rationale', valueId: 'detail-rationale', sectionId: 'detail-rationale-section', input: 'textarea', prompt: 'Add why' },
    { key: 'type', valueId: 'detail-type', input: 'select' },
    { key: 'owner_name', valueId: 'detail-owner', sectionId: 'detail-owner-container', input: 'text', prompt: 'Add owner' },
    { key: 'due_date', valueId: 'detail-due', sectionId: 'detail-due-container', input: 'date', prompt: 'Add due date' },
    { key: 'tags', valueId: 'detail-tags', sectionId: 'detail-tags-section', input: 'text', prompt: 'Add tags', hint: 'Separate tags with commas' },
    { key: 'alternatives', valueId: 'detail-meeting-info', sectionId: 'detail-meeting-section', input: 'textarea' },
    { key: 'epic_key', valueId: 'detail-epic-info', sectionId: 'detail-epic-section', input: 'text', hint: 'Jira epic key, e.g. PROJ-12' }
  ];

  let context = null; // { decision, workspaceId, onSaved }
  let editing = null; // { field, element, originalHtml }

  function inputValue(field, decision) {
    const value = decision[field.key];
    if (field.key === 'tags') return Array.isArray(value) ? value.join(', ') : '';
    return value == null ? '' : String(value);
  }

  /** The value to send, or undefined when it didn't change */
  function newValue(field, raw, decision) {
    const trimmed = raw.trim();
    if (field.key === 'tags') {
      const tags = trimmed ? trimmed.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [];
      return tags.join(',') === (decision.tags || []).join(',') ? undefined : tags;
    }
    const current = decision[field.key] == null ? '' : String(decision[field.key]);
    if (trimmed === current) return undefined;
    return trimmed === '' ? null : trimmed;
  }

  function buildInput(field, decision) {
    let input;
    if (field.input === 'textarea') {
      input = document.createElement('textarea');
      input.rows = field.key === 'text' ? 4 : 3;
    } else if (field.input === 'select') {
      input = document.createElement('select');
      for (const [value, label] of TYPE_OPTIONS) input.add(new Option(label, value));
    } else {
      input = document.createElement('input');
      input.type = field.input;
    }
    input.className = 'inline-edit-input';
    input.value = inputValue(field, decision);
    return input;
  }

  function startEdit(field, element) {
    if (!context || editing) return;
    const { decision } = context;
    editing = { field, element, originalHtml: element.innerHTML };
    element.classList.remove('inline-editable');

    const input = buildInput(field, decision);
    const hint = document.createElement('div');
    hint.className = 'inline-edit-hint';
    const saveKey = field.input === 'textarea' ? 'Ctrl+Enter' : 'Enter';
    hint.textContent = `${field.hint ? `${field.hint} · ` : ''}${saveKey} to save · Esc to cancel`;
    element.replaceChildren(input, hint);
    input.focus();
    if (input.select && field.input !== 'select' && field.input !== 'date') input.select();

    let done = false;
    const finish = async save => {
      if (done) return;
      done = true;
      if (save) {
        const ok = await saveField(field, input.value, hint);
        if (!ok) { done = false; input.focus(); }
      } else {
        cancelEdit();
      }
    };

    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation(); // keep the modal open
        finish(false);
      } else if (event.key === 'Enter' && (field.input !== 'textarea' || event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        finish(true);
      }
    });
    input.addEventListener('blur', () => finish(true));
    if (field.input === 'select') input.addEventListener('change', () => finish(true));
  }

  function cancelEdit() {
    if (!editing) return;
    editing.element.innerHTML = editing.originalHtml;
    editing.element.classList.add('inline-editable');
    editing = null;
  }

  async function saveField(field, raw, hint) {
    const { decision, workspaceId, onSaved } = context;
    const value = newValue(field, raw, decision);
    if (value === undefined) { cancelEdit(); return true; }
    if (field.required && !value) {
      hint.textContent = 'This can’t be empty.';
      hint.classList.add('inline-edit-error');
      return false;
    }

    hint.textContent = 'Saving…';
    hint.classList.remove('inline-edit-error');
    try {
      const response = await fetch(`/api/decisions/${encodeURIComponent(decision.id)}?workspace_id=${encodeURIComponent(workspaceId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ [field.key]: value })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || 'Couldn’t save');

      const saved = data.decision || {};
      decision[field.key] = field.key in saved ? saved[field.key] : value;
      if (field.key === 'epic_key') decision.jira_data = saved.jira_data || null;
      editing = null;
      onSaved(field.key);
      return true;
    } catch (error) {
      hint.textContent = `${error.message}. Esc to cancel.`;
      hint.classList.add('inline-edit-error');
      return false;
    }
  }

  /**
   * Makes the modal's fields editable in place (or read-only when the user can't modify it)
   * @param {{ decision: Object, canModify: boolean, workspaceId: string, onSaved: Function }} options
   */
  function attach({ decision, canModify, workspaceId, onSaved }) {
    context = canModify ? { decision, workspaceId, onSaved } : null;
    editing = null;

    for (const field of FIELDS) {
      const element = document.getElementById(field.valueId);
      if (!element) continue;
      element.onclick = null;
      element.onkeydown = null;
      element.classList.remove('inline-editable');
      element.removeAttribute('tabindex');
      element.removeAttribute('title');
      if (!canModify) continue;

      const section = field.sectionId ? document.getElementById(field.sectionId) : null;
      const isEmpty = inputValue(field, decision) === '';
      if (isEmpty && section) {
        if (!field.prompt) continue; // only shown when it has a value
        section.style.display = '';
        element.innerHTML = `<span class="inline-edit-prompt">+ ${field.prompt}</span>`;
      }

      element.classList.add('inline-editable');
      element.tabIndex = 0;
      element.title = 'Click to edit';
      element.onclick = event => {
        if (event.target.closest('a')) return; // links (meeting, Jira) still open
        startEdit(field, element);
      };
      element.onkeydown = event => {
        if (event.target === element && event.key === 'Enter') {
          event.preventDefault();
          startEdit(field, element);
        }
      };
    }
  }

  window.CortezaInlineEdit = { attach, FIELDS };
})();
