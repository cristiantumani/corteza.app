/**
 * Action items page (/actions): list with filters, mark done, set due dates.
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
 * /questions?topic=<id>; marking it done offers to mark the thread's open questions
 * answered (close-loop.js).
 */
(function() {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const focusItemId = params.get('item');
  // ?due=overdue|today|none|week opens the list filtered (links in the daily digest email)
  const dueParam = ['overdue', 'today', 'none', 'week'].includes(params.get('due')) ? params.get('due') : '';
  const state = {
    owner: focusItemId ? 'all' : 'me',
    status: focusItemId ? 'all' : 'open',
    due: dueParam
  };

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
    return isNaN(date) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function renderFilters() {
    document.querySelectorAll('.owner-filter').forEach(button => {
      const active = button.dataset.owner === state.owner;
      button.classList.toggle('bg-primary', active);
      button.classList.toggle('text-on-primary', active);
      button.classList.toggle('text-on-surface-variant', !active);
    });
    document.getElementById('status-filter').value = state.status;
    document.getElementById('due-filter').value = state.due;
  }

  function ownersHtml(item) {
    if (!item.owners || item.owners.length === 0) {
      return '<span class="px-2 py-0.5 rounded-full bg-error/10 text-error text-xs font-semibold">No owner</span>';
    }
    return item.owners.map(owner => `
      <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${owner.user_id ? 'bg-primary/10 text-primary' : 'bg-surface-container text-on-surface-variant'}"
            title="${owner.user_id ? escapeHtml(owner.email || '') : 'Not matched to a Corteza member'}">${escapeHtml(owner.name)}</span>`).join(' ');
  }

  function dueHtml(item) {
    const overdue = item.status === 'open' && item.due_date && item.due_date < today();
    const label = item.due_date
      ? `<span class="text-xs font-semibold ${overdue ? 'text-error' : 'text-on-surface-variant'}">${overdue ? 'Overdue · ' : 'Due '}${escapeHtml(formatDate(item.due_date))}</span>`
      : '<span class="px-2 py-0.5 rounded-full bg-[#fff4e5] text-[#8a5300] text-xs font-semibold">No due date</span>';
    return `
      <div class="flex items-center gap-2">
        ${label}
        <input type="date" class="due-input bg-surface-container-low border border-outline-variant rounded-lg py-1 px-2 text-xs"
               data-id="${escapeHtml(item.item_id)}" value="${escapeHtml(item.due_date || '')}" aria-label="Due date">
      </div>`;
  }

  function sourceHtml(item) {
    const parts = [];
    if (item.decision_id) parts.push(`From decision #${escapeHtml(item.decision_id)}`);
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
      badges.push(`<span class="px-2 py-0.5 rounded-full bg-primary text-on-primary text-xs font-semibold">New</span><span class="text-xs text-on-surface-variant">Assigned to you from ${by ? `${escapeHtml(by)}’s` : 'a colleague’s'} meeting</span>`);
    }
    if (item.completed_earlier) badges.push('<span class="text-xs text-on-surface-variant">Already done: the owner had finished it before this meeting was captured</span>');
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
      banner.innerHTML = `<strong>${data.count} new action item${data.count === 1 ? '' : 's'} assigned to you by colleagues.</strong> They came from meetings captured by ${people}, and are marked <strong>New</strong> below. If one is already done, mark it done.`;
      banner.classList.remove('hidden');
      fetch('/api/action-items/from-colleagues/seen', { method: 'POST', credentials: 'include' }).catch(() => {});
    } catch (error) { /* the list still works */ }
  }

  /** "Part of: ISO 27001 · 1 question, 1 risk" */
  function threadHtml(item) {
    const thread = item.thread || threadById.get(item.item_id);
    if (!thread) return '';
    const counts = [
      thread.questions ? `${thread.questions} question${thread.questions === 1 ? '' : 's'}` : '',
      thread.risks ? `${thread.risks} risk${thread.risks === 1 ? '' : 's'}` : ''
    ].filter(Boolean).join(', ');
    return `
      <a href="/questions?topic=${encodeURIComponent(thread.topic_id)}" class="self-start inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#e3e7fb] text-[#3953bd] text-xs font-semibold hover:underline">
        <span class="material-symbols-outlined text-sm" aria-hidden="true">contact_support</span>
        ${thread.topic ? `Part of: ${escapeHtml(thread.topic)}` : 'Linked'}${counts ? ` · ${escapeHtml(counts)}` : ''}
      </a>`;
  }

  function itemHtml(item) {
    const done = item.status === 'done';
    const cancelled = item.status === 'cancelled';
    return `
      <div id="item-${escapeHtml(item.item_id)}" class="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 flex flex-wrap sm:flex-nowrap gap-x-4 gap-y-3 items-start ${item.item_id === focusItemId ? 'ring-2 ring-primary' : ''}">
        <input type="checkbox" class="done-toggle mt-1 w-5 h-5 rounded" data-id="${escapeHtml(item.item_id)}" ${done ? 'checked' : ''} ${cancelled ? 'disabled' : ''} aria-label="Done">
        <div class="flex-1 min-w-0 flex flex-col gap-2">
          ${badgesHtml(item)}
          <p class="text-on-surface font-medium ${done || cancelled ? 'line-through text-on-surface-variant' : ''}">${escapeHtml(item.text)}</p>
          ${item.rationale ? `<p class="text-sm text-on-surface-variant">Why: ${escapeHtml(item.rationale)}</p>` : ''}
          <div class="flex flex-wrap items-center gap-2">${ownersHtml(item)}</div>
          ${threadHtml(item)}
          ${sourceHtml(item)}
          ${item.evidence_quote ? `<p class="text-xs italic text-on-surface-variant">“${escapeHtml(item.evidence_quote)}”</p>` : ''}
        </div>
        <!-- Due date and status: beside the text on wider screens, under it on a phone -->
        <div class="w-full sm:w-auto pl-9 sm:pl-0 flex flex-wrap sm:flex-col items-center sm:items-end gap-2">
          ${dueHtml(item)}
          <select class="status-select bg-surface-container-low border border-outline-variant rounded-lg py-1 px-2 text-xs" data-id="${escapeHtml(item.item_id)}" aria-label="Status">
            ${['open', 'done', 'cancelled'].map(status => `<option value="${status}" ${item.status === status ? 'selected' : ''}>${status[0].toUpperCase() + status.slice(1)}</option>`).join('')}
          </select>
        </div>
      </div>`;
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
      if (!response.ok) throw new Error(data.error || 'Could not load action items');
      const items = data.items;
      for (const item of items) if (item.thread) threadById.set(item.item_id, item.thread);
      // Remember what was new on arrival: the flags clear once the visit marks them seen
      if (!newIds) newIds = new Set(items.filter(item => item.new_from_colleague).map(item => item.item_id));
      document.getElementById('items-count').textContent = `${items.length} action item${items.length === 1 ? '' : 's'}`;
      container.innerHTML = items.length
        ? items.map(itemHtml).join('')
        : `<p class="text-on-surface-variant">${state.owner === 'me' ? 'Nothing assigned to you here.' : 'No action items match these filters.'} Action items are captured automatically from your meetings.</p>`;

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

  async function update(itemId, changes) {
    const response = await fetch(`/api/action-items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes)
    });
    const data = await response.json();
    if (!response.ok) {
      alert(data.error || 'Could not update the action item');
      return load();
    }
    const element = document.getElementById(`item-${itemId}`);
    if (element) element.outerHTML = itemHtml(data.item);
    if (window.CortezaLoop) window.CortezaLoop.offerAnswer(data.linked_questions);
  }

  document.addEventListener('change', event => {
    const target = event.target;
    if (target.classList.contains('done-toggle')) update(target.dataset.id, { status: target.checked ? 'done' : 'open' });
    if (target.classList.contains('status-select')) update(target.dataset.id, { status: target.value });
    if (target.classList.contains('due-input')) update(target.dataset.id, { due_date: target.value || null });
    if (target.id === 'status-filter') { state.status = target.value; load(); }
    if (target.id === 'due-filter') { state.due = target.value; load(); }
  });

  document.addEventListener('click', event => {
    const button = event.target.closest('.owner-filter');
    if (button) { state.owner = button.dataset.owner; load(); }
  });

  document.addEventListener('DOMContentLoaded', async () => {
    if (window.CortezaLoop) window.CortezaLoop.init(document.getElementById('loop-notice'), load);
    await load();
    showFromColleagues();
  });
})();
