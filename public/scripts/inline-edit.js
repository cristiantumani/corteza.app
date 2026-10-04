/**
 * Click-to-edit for the outcome detail modal (#detail-modal).
 *
 * Clicking a field (content, why, accountable person, meeting context, Jira epic)
 * turns it into an input. The type is changed from the Edit button. Enter (Ctrl/⌘+Enter in text areas) or
 * clicking away saves just that field with PUT /api/decisions/:id; Esc cancels.
 * Empty optional fields show an "Add …" prompt so they can be filled in, except the ones
 * an outcome type doesn't use (`skipTypes`: a risk has no accountable person, and the why of
 * a question or risk is usually in its own text).
 * The accountable person is picked from the workspace members (people.js) and saved as
 * owner_user_id. Due dates belong to action items (decision-actions.js), not to outcomes.
 *
 * dashboard.js calls CortezaInlineEdit.attach() every time it renders the modal.
 */
(function() {
  'use strict';

  /**
   * key: field in the decision and in the PUT body
   * valueId / sectionId: element that shows the value / wrapper hidden when empty
   * input: textarea | text | member
   * prompt: shown when the field is empty (optional fields only)
   * noPromptTypes: outcome types where an empty field stays hidden (editable once it has a value)
   * skipTypes: outcome types that don't use the field (not editable there)
   */
  const FIELDS = [
    { key: 'text', valueId: 'detail-decision-text', input: 'textarea', required: true },
    { key: 'rationale', valueId: 'detail-rationale', sectionId: 'detail-rationale-section', input: 'textarea', prompt: 'Add why', noPromptTypes: ['open_question', 'risk'] },
    { key: 'owner_name', valueId: 'detail-owner', sectionId: 'detail-owner-container', input: 'member', prompt: 'Add who’s accountable', skipTypes: ['risk'] },
    { key: 'alternatives', valueId: 'detail-meeting-info', sectionId: 'detail-meeting-section', input: 'textarea' },
    { key: 'epic_key', valueId: 'detail-epic-info', sectionId: 'detail-epic-section', input: 'text', hint: 'Jira epic key, e.g. PROJ-12' }
  ];

  let context = null; // { decision, workspaceId, onSaved }
  let editing = null; // { field, element, originalHtml }

  function inputValue(field, decision) {
    const value = decision[field.key];
    return value == null ? '' : String(value);
  }

  const KEEP = '__keep__'; // owner typed by hand (or by the AI) that isn't a member: leave it

  /** The value to send, or undefined when it didn't change */
  function newValue(field, raw, decision) {
    if (field.input === 'member') {
      if (raw === KEEP || raw === (decision.owner_user_id || '')) return undefined;
      return raw || null;
    }
    const trimmed = raw.trim();
    const current = decision[field.key] == null ? '' : String(decision[field.key]);
    if (trimmed === current) return undefined;
    return trimmed === '' ? null : trimmed;
  }

  /** Body sent for a field: the owner goes as owner_user_id */
  function bodyKey(field) {
    return field.input === 'member' ? 'owner_user_id' : field.key;
  }

  function buildInput(field, decision, people) {
    let input;
    if (field.input === 'member') {
      input = document.createElement('select');
      input.add(new Option('Nobody', ''));
      if (decision.owner_name && !people.some(person => person.user_id === decision.owner_user_id)) {
        input.add(new Option(`${decision.owner_name} (not linked to a member)`, KEEP));
      }
      for (const person of people) input.add(new Option(person.name, person.user_id));
      input.className = 'inline-edit-input';
      input.value = decision.owner_user_id && people.some(person => person.user_id === decision.owner_user_id)
        ? decision.owner_user_id
        : (decision.owner_name ? KEEP : '');
      return input;
    }
    if (field.input === 'textarea') {
      input = document.createElement('textarea');
      input.rows = field.key === 'text' ? 4 : 3;
    } else {
      input = document.createElement('input');
      input.type = field.input;
    }
    input.className = 'inline-edit-input';
    input.value = inputValue(field, decision);
    return input;
  }

  async function startEdit(field, element) {
    if (!context || editing) return;
    const { decision } = context;
    editing = { field, element, originalHtml: element.innerHTML };
    element.classList.remove('inline-editable');

    const people = field.input === 'member' && window.CortezaPeople ? await window.CortezaPeople.load() : [];
    if (!editing || editing.element !== element) return; // modal changed while loading
    const input = buildInput(field, decision, people);
    const hint = document.createElement('div');
    hint.className = 'inline-edit-hint';
    const saveKey = field.input === 'textarea' ? 'Ctrl+Enter' : (field.input === 'member' ? 'Pick a person' : 'Enter');
    hint.textContent = `${field.hint ? `${field.hint} · ` : ''}${saveKey} to save · Esc to cancel`;
    element.replaceChildren(input, hint);
    input.focus();
    if (input.select && field.input !== 'member') input.select();

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
    if (field.input === 'member') input.addEventListener('change', () => finish(true));
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
        body: JSON.stringify({ [bodyKey(field)]: value })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || 'Couldn’t save');

      const saved = data.decision || {};
      if (field.input === 'member') {
        decision.owner_user_id = saved.owner_user_id || null;
        decision.owner_name = saved.owner_name || null;
      } else {
        decision[field.key] = field.key in saved ? saved[field.key] : value;
      }
      if (field.key === 'epic_key') decision.jira_data = saved.jira_data || null;
    } catch (error) {
      hint.textContent = `${error.message}. Esc to cancel.`;
      hint.classList.add('inline-edit-error');
      return false;
    }
    // Saved: redraw the modal. A failure here isn't a failed save, and must not leave the field stuck
    editing = null;
    try {
      onSaved(field.key);
    } catch (error) {
      console.error('Could not refresh the outcome after saving:', error);
    }
    return true;
  }

  /**
   * Makes the modal's fields editable in place (or read-only when the user can't modify it)
   * @param {{ decision: Object, canModify: boolean, workspaceId: string, onSaved: Function }} options
   */
  function attach({ decision, canModify, workspaceId, onSaved }) {
    context = canModify ? { decision, workspaceId, onSaved } : null;
    editing = null;
    if (canModify && window.CortezaPeople) window.CortezaPeople.load(); // ready for the owner picker

    for (const field of FIELDS) {
      const element = document.getElementById(field.valueId);
      if (!element) continue;
      element.onclick = null;
      element.onkeydown = null;
      element.classList.remove('inline-editable');
      element.removeAttribute('tabindex');
      element.removeAttribute('title');
      if (!canModify) continue;
      if (field.skipTypes && field.skipTypes.includes(decision.type)) continue;

      const section = field.sectionId ? document.getElementById(field.sectionId) : null;
      const isEmpty = inputValue(field, decision) === '';
      if (isEmpty && section) {
        if (!field.prompt) continue; // only shown when it has a value
        if (field.noPromptTypes && field.noPromptTypes.includes(decision.type)) continue;
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
