/**
 * Action items page (/actions): Active / Resolved tabs, filters, mark done, edit what, why and owners, set due dates.
 * API: GET /api/action-items, PATCH /api/action-items/:id (src/http/action-items.js)
 *
 * /actions?item=<id> (link in the "when will this be done?" email) shows that
 * item and focuses its due date field.
 *
 * Items a colleague's meeting assigned to the person since their last visit are marked
 * "New", with a banner saying who; opening the page marks them seen
 * (GET/POST /api/action-items/from-colleagues, core/actions/colleague-assignments).
 *
 * An item in a topic thread shows "Part of: <topic> · N questions, M risks", linking to
 * /questions?topic=<id>; marking it done offers to close its open questions and risks, and
 * cancelling the last one of a question or risk says it's left alone (close-loop.js).
 */
(function() {
  'use strict';
  const t = window.t || (key => key); // public/scripts/i18n.js
  const locale = (window.CortezaI18n && window.CortezaI18n.locale) || undefined;

  const params = new URLSearchParams(window.location.search);
  const focusItemId = params.get('item');
  // ?due=overdue|today|none|week opens the list filtered (links in the daily digest email)
  const dueParam = ['overdue', 'today', 'none', 'week'].includes(params.get('due')) ? params.get('due') : '';
  const state = {
    owner: focusItemId ? 'all' : 'me',
    status: focusItemId ? 'all' : 'open',
    due: dueParam
  };

  const itemsById = new Map(); // item_id → the item as last loaded or saved (for the edit form)
  let newIds = null; // items new from colleagues on this visit (null until the first load)
  const threadById = new Map(); // item_id → its thread summary (PATCH answers don't carry it)

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function today() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function formatDate(value) {
    const date = new Date(`${value}T00:00:00`);
    return isNaN(date) ? value : date.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function renderFilters() {
    document.querySelectorAll('.owner-filter').forEach(button => {
      const active = button.dataset.owner === state.owner;
      button.classList.toggle('bg-primary', active);
      button.classList.toggle('text-on-primary', active);
      button.classList.toggle('text-on-surface-variant', !active);
    });
    document.querySelectorAll('.status-tab').forEach(button => {
      const active = button.dataset.status === state.status;
      button.classList.toggle('bg-primary', active);
      button.classList.toggle('text-on-primary', active);
      button.classList.toggle('text-on-surface-variant', !active);
      button.setAttribute('aria-selected', String(active));
    });
    document.getElementById('due-filter').value = state.due;
  }

  function ownersHtml(item) {
    if (!item.owners || item.owners.length === 0) {
      return `<span class="px-2 py-0.5 rounded-full bg-error/10 text-error text-xs font-semibold">${escapeHtml(t('detail.noOwner'))}</span>`;
    }
    return item.owners.map(owner => `
      <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${owner.user_id ? 'bg-primary/10 text-primary' : 'bg-surface-container text-on-surface-variant'}"
            title="${owner.user_id ? escapeHtml(owner.email || '') : escapeHtml(t('actions.notMatched'))}">${escapeHtml(owner.name)}</span>`).join(' ');
  }

  function dueHtml(item) {
    const overdue = item.status === 'open' && item.due_date && item.due_date < today();
    const label = item.due_date
      ? `<span class="text-xs font-semibold ${overdue ? 'text-error' : 'text-on-surface-variant'}">${escapeHtml(t(overdue ? 'due.overdueOn' : 'due.on', { date: formatDate(item.due_date) }))}</span>`
      : `<span class="px-2 py-0.5 rounded-full bg-signal-wash text-signal-ink text-xs font-semibold">${escapeHtml(t('due.none'))}</span>`;
    return `
      <div class="flex items-center gap-2">
        ${label}
        <input type="date" class="due-input bg-surface-container-low border border-outline-variant rounded-lg py-1 px-2 text-xs"
               data-id="${escapeHtml(item.item_id)}" value="${escapeHtml(item.due_date || '')}" aria-label="${escapeHtml(t('actions.dueDate'))}">
      </div>`;
  }

  function sourceHtml(item) {
    const parts = [];
    if (item.decision_id) parts.push(escapeHtml(t('actions.fromDecision', { id: item.decision_id })));
    if (item.source && item.source.title) {
      const url = item.source.url && /^https:\/\//.test(item.source.url) ? item.source.url : null;
      parts.push(url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="text-primary hover:underline">${escapeHtml(item.source.title)}</a>`
        : escapeHtml(item.source.title));
    }
    return parts.length ? `<p class="text-xs text-on-surface-variant">${parts.join(' · ')}</p>` : '';
  }

  function badgesHtml(item) {
    const badges = [];
    if (newIds && newIds.has(item.item_id)) {
      const by = item.created_by && item.created_by.name;
      badges.push(`<span class="px-2 py-0.5 rounded-full bg-primary text-on-primary text-xs font-semibold">${escapeHtml(t('actions.new'))}</span><span class="text-xs text-on-surface-variant">${escapeHtml(by ? t('actions.assignedBy', { name: by }) : t('actions.assignedByColleague'))}</span>`);
    }
    if (item.completed_earlier) badges.push(`<span class="text-xs text-on-surface-variant">${escapeHtml(t('actions.completedEarlier'))}</span>`);
    return badges.length ? `<div class="flex flex-wrap items-center gap-2">${badges.join('')}</div>` : '';
  }

  /** Who assigned the new items: "Martín (3), Ana (1)" */
  async function showFromColleagues() {
    const banner = document.getElementById('from-colleagues');
    try {
      const response = await fetch('/api/action-items/from-colleagues', { credentials: 'include' });
      const data = response.ok ? await response.json() : null;
      if (!banner || !data || !data.count) return;
      const people = data.from.map(row => `${escapeHtml(row.name)} (${row.count})`).join(', ');
      banner.innerHTML = `<strong>${escapeHtml(t('actions.fromColleagues.title', { count: data.count }))}</strong> ${escapeHtml(t('actions.fromColleagues.body')).replace('{people}', people)}`;
      banner.classList.remove('hidden');
      fetch('/api/action-items/from-colleagues/seen', { method: 'POST', credentials: 'include' }).catch(() => {});
    } catch (error) { /* the list still works */ }
  }

  /** "Part of: ISO 27001 · 1 question, 1 risk" */
  function threadHtml(item) {
    const thread = item.thread || threadById.get(item.item_id);
    if (!thread) return '';
    const counts = [
      thread.questions ? t('home.open.questions', { count: thread.questions }) : '',
      thread.risks ? t('home.open.risks', { count: thread.risks }) : ''
    ].filter(Boolean).join(', ');
    return `
      <a href="/questions?topic=${encodeURIComponent(thread.topic_id)}" class="self-start inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container text-on-surface text-xs font-semibold hover:underline">
        <span class="material-symbols-outlined text-sm" aria-hidden="true">contact_support</span>
        ${escapeHtml(thread.topic ? t('actions.partOf', { topic: thread.topic }) : t('actions.linked'))}${counts ? ` · ${escapeHtml(counts)}` : ''}
      </a>`;
  }

  function itemHtml(item) {
    const done = item.status === 'done';
    const cancelled = item.status === 'cancelled';
    return `
      <div id="item-${escapeHtml(item.item_id)}" class="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 flex flex-wrap sm:flex-nowrap gap-x-4 gap-y-3 items-start ${item.item_id === focusItemId ? 'ring-2 ring-primary' : ''}">
        <input type="checkbox" class="done-toggle mt-1 w-5 h-5 rounded" data-id="${escapeHtml(item.item_id)}" ${done ? 'checked' : ''} ${cancelled ? 'disabled' : ''} aria-label="${escapeHtml(t('actions.status.doneOne'))}">
        <div class="flex-1 min-w-0 flex flex-col gap-2">
          ${badgesHtml(item)}
          <p class="text-on-surface font-medium ${done || cancelled ? 'line-through text-on-surface-variant' : ''}">${escapeHtml(item.text)}</p>
          ${item.rationale ? `<p class="text-sm text-on-surface-variant">${escapeHtml(t('home.review.why', { text: item.rationale }))}</p>` : ''}
          <div class="flex flex-wrap items-center gap-2">${ownersHtml(item)}</div>
          ${threadHtml(item)}
          ${sourceHtml(item)}
          ${item.evidence_quote ? `<p class="text-xs italic text-on-surface-variant">“${escapeHtml(item.evidence_quote)}”</p>` : ''}
        </div>
        <!-- Due date and status: beside the text on wider screens, under it on a phone -->
        <div class="w-full sm:w-auto pl-9 sm:pl-0 flex flex-wrap sm:flex-col items-center sm:items-end gap-2">
          ${dueHtml(item)}
          <select class="status-select bg-surface-container-low border border-outline-variant rounded-lg py-1 px-2 text-xs" data-id="${escapeHtml(item.item_id)}" aria-label="${escapeHtml(t('actions.statusLabel'))}">
            ${['open', 'done', 'cancelled'].map(status => `<option value="${status}" ${item.status === status ? 'selected' : ''}>${escapeHtml(t(`actions.statusOne.${status}`))}</option>`).join('')}
          </select>
          <button type="button" class="edit-item text-xs font-semibold text-primary hover:underline px-1" data-id="${escapeHtml(item.item_id)}">${escapeHtml(t('common.edit'))}</button>
        </div>
      </div>`;
  }

  /** The card as a form: what, why and owners (Save / Cancel; Esc cancels, Ctrl/⌘+Enter saves) */
  async function openEditor(itemId) {
    const item = itemsById.get(itemId);
    const element = document.getElementById(`item-${itemId}`);
    if (!item || !element) return;
    const unmatched = (item.owners || []).filter(owner => !owner.user_id).map(owner => owner.name);
    element.innerHTML = `
      <form class="edit-form w-full flex flex-col gap-3" data-id="${escapeHtml(itemId)}">
        <label class="flex flex-col gap-1 text-sm font-semibold text-on-surface">${escapeHtml(t('actions.whatPlaceholder'))}
          <textarea name="text" rows="2" required maxlength="1000" class="inline-edit-input font-normal">${escapeHtml(item.text)}</textarea>
        </label>
        <label class="flex flex-col gap-1 text-sm font-semibold text-on-surface">${escapeHtml(t('detail.why'))}
          <textarea name="rationale" rows="2" maxlength="2000" class="inline-edit-input font-normal">${escapeHtml(item.rationale || '')}</textarea>
        </label>
        <div class="flex flex-col gap-1 text-sm font-semibold text-on-surface">${escapeHtml(t('actions.ownersLabel'))}
          ${unmatched.length ? `<div class="decision-action-chips font-normal">${unmatched.map(name => `<span class="decision-action-chip" title="${escapeHtml(t('actions.notMatched'))}">${escapeHtml(name)} <button type="button" data-keep-name="${escapeHtml(name)}" aria-label="${escapeHtml(t('common.remove'))}">×</button></span>`).join('')}</div>` : ''}
          <div class="owner-picker font-normal"><p class="text-on-surface-variant">${escapeHtml(t('common.loading'))}</p></div>
        </div>
        <p class="edit-error hidden text-sm text-error" role="alert"></p>
        <div class="flex items-center gap-2">
          <button type="submit" class="bg-primary text-on-primary rounded-lg py-2 px-4 text-sm font-semibold disabled:opacity-50">${escapeHtml(t('common.save'))}</button>
          <button type="button" class="cancel-edit border border-outline-variant rounded-lg py-2 px-4 text-sm font-semibold text-on-surface">${escapeHtml(t('common.cancel'))}</button>
        </div>
      </form>`;
    const form = element.querySelector('form');
    form.querySelector('textarea').focus();
    let picker = null;
    if (window.CortezaPeople) {
      const people = await window.CortezaPeople.load();
      const matched = (item.owners || []).map(owner => owner.user_id).filter(Boolean);
      picker = window.CortezaPeople.ownerPicker(form.querySelector('.owner-picker'), people, matched);
    }
    const keptNames = new Set(unmatched);
    form.addEventListener('click', event => {
      const name = event.target.dataset && event.target.dataset.keepName;
      if (name) {
        keptNames.delete(name);
        event.target.closest('.decision-action-chip').remove();
      }
      if (event.target.classList.contains('cancel-edit')) closeEditor(itemId);
    });
    form.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeEditor(itemId);
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) form.requestSubmit();
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const changes = {
        text: form.elements.text.value,
        rationale: form.elements.rationale.value,
        ...(picker ? { owner_ids: picker.selected(), keep_owner_names: [...keptNames] } : {})
      };
      form.querySelector('[type=submit]').disabled = true;
      const result = await save(itemId, changes);
      if (result.error) {
        const error = form.querySelector('.edit-error');
        error.textContent = result.error;
        error.classList.remove('hidden');
        form.querySelector('[type=submit]').disabled = false;
      }
    });
  }

  function closeEditor(itemId) {
    const element = document.getElementById(`item-${itemId}`);
    const item = itemsById.get(itemId);
    if (element && item) element.outerHTML = itemHtml(item);
  }

  /** Whether an item with this status belongs to the tab on screen */
  function belongsHere(item) {
    if (state.status === 'open') return item.status === 'open';
    if (state.status === 'resolved') return item.status === 'done' || item.status === 'cancelled';
    return true;
  }

  let toastTimer = null;
  /** "Marked as done: moved to Resolved · Undo" */
  function showMoved(item, previousStatus) {
    clearTimeout(toastTimer);
    const old = document.getElementById('actions-toast');
    if (old) old.remove();
    const key = item.status === 'done' ? 'actions.moved.done' : item.status === 'cancelled' ? 'actions.moved.cancelled' : 'actions.moved.reopened';
    const box = document.createElement('div');
    box.id = 'actions-toast';
    box.setAttribute('role', 'status');
    box.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 rounded-lg bg-inverse-surface text-inverse-on-surface px-4 py-3 text-sm shadow-lg';
    box.innerHTML = `<span>${escapeHtml(t(key))}</span><button type="button" class="font-semibold text-inverse-primary hover:underline">${escapeHtml(t('common.undo'))}</button>`;
    box.querySelector('button').addEventListener('click', async () => {
      box.remove();
      await save(item.item_id, { status: previousStatus });
      load();
    });
    document.body.appendChild(box);
    toastTimer = setTimeout(() => box.remove(), 8000);
  }

  async function load() {
    renderFilters();
    const container = document.getElementById('items');
    const query = new URLSearchParams({ owner: state.owner, status: state.status });
    if (state.due) query.set('due', state.due);

    try {
      const response = await fetch(`/api/action-items?${query}`, { credentials: 'include' });
      if (response.status === 401) {
        window.location.href = `/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('actions.loadFailed'));
      const items = data.items;
      for (const item of items) if (item.thread) threadById.set(item.item_id, item.thread);
      for (const item of items) itemsById.set(item.item_id, item);
      // Remember what was new on arrival: the flags clear once the visit marks them seen
      if (!newIds) newIds = new Set(items.filter(item => item.new_from_colleague).map(item => item.item_id));
      document.getElementById('items-count').textContent = t('outcomeCounts.action_item', { count: items.length });
      container.innerHTML = items.length
        ? items.map(itemHtml).join('')
        : state.status === 'resolved'
          ? `<p class="text-on-surface-variant">${escapeHtml(t('actions.emptyResolved'))}</p>`
          : `<p class="text-on-surface-variant">${escapeHtml(t(state.owner === 'me' ? 'actions.emptyMine' : 'actions.emptyFilters'))} ${escapeHtml(t('actions.emptyHelp'))}</p>`;

      const focused = focusItemId && document.getElementById(`item-${focusItemId}`);
      if (focused) {
        focused.scrollIntoView({ block: 'center' });
        const dateInput = focused.querySelector('.due-input');
        if (dateInput && !dateInput.value) dateInput.focus();
      }
    } catch (error) {
      container.innerHTML = `<p class="text-error">${escapeHtml(error.message)}</p>`;
    }
  }

  /**
   * Saves changes and redraws the card; an item that no longer belongs to this tab leaves it,
   * with Undo
   * @returns {Promise<{ error?: string }>}
   */
  async function save(itemId, changes) {
    const previous = itemsById.get(itemId);
    let data;
    try {
      const response = await fetch(`/api/action-items/${encodeURIComponent(itemId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes)
      });
      data = await response.json();
      if (!response.ok) return { error: data.error || t('actions.updateFailed') };
    } catch (error) {
      return { error: t('actions.updateFailed') };
    }
    itemsById.set(itemId, data.item);
    const element = document.getElementById(`item-${itemId}`);
    if (element && belongsHere(data.item)) {
      element.outerHTML = itemHtml(data.item);
    } else if (element) {
      element.remove();
      const remaining = document.querySelectorAll('#items > [id^="item-"]').length;
      document.getElementById('items-count').textContent = t('outcomeCounts.action_item', { count: remaining });
      if (previous && previous.status !== data.item.status) showMoved(data.item, previous.status);
    }
    if (window.CortezaLoop) window.CortezaLoop.afterItemChange(data);
    return {};
  }

  async function update(itemId, changes) {
    const result = await save(itemId, changes);
    if (result.error) {
      alert(result.error);
      load();
    }
  }

  document.addEventListener('change', event => {
    const target = event.target;
    if (target.classList.contains('done-toggle')) update(target.dataset.id, { status: target.checked ? 'done' : 'open' });
    if (target.classList.contains('status-select')) update(target.dataset.id, { status: target.value });
    if (target.classList.contains('due-input')) update(target.dataset.id, { due_date: target.value || null });
    if (target.id === 'due-filter') { state.due = target.value; load(); }
  });

  document.addEventListener('click', event => {
    const button = event.target.closest('.owner-filter');
    if (button) { state.owner = button.dataset.owner; load(); }
    const tab = event.target.closest('.status-tab');
    if (tab) { state.status = tab.dataset.status; load(); }
    const edit = event.target.closest('.edit-item');
    if (edit) openEditor(edit.dataset.id);
  });

  document.addEventListener('DOMContentLoaded', async () => {
    if (window.CortezaLoop) window.CortezaLoop.init(document.getElementById('loop-notice'), load);
    await load();
    showFromColleagues();
  });
})();
