/**
 * Action items page (/actions): list with filters, mark done, set due dates.
 * API: GET /api/action-items, PATCH /api/action-items/:id (src/http/action-items.js)
 *
 * /actions?item=<id> (link in the "when will this be done?" email) shows that
 * item and focuses its due date field.
 */
(function() {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const focusItemId = params.get('item');
  // ?due=overdue|none|week opens the list filtered (links in the daily digest email)
  const dueParam = ['overdue', 'none', 'week'].includes(params.get('due')) ? params.get('due') : '';
  const state = {
    owner: focusItemId ? 'all' : 'me',
    status: focusItemId ? 'all' : 'open',
    due: dueParam
  };

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

  function itemHtml(item) {
    const done = item.status === 'done';
    const cancelled = item.status === 'cancelled';
    return `
      <div id="item-${escapeHtml(item.item_id)}" class="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 flex gap-4 items-start ${item.item_id === focusItemId ? 'ring-2 ring-primary' : ''}">
        <input type="checkbox" class="done-toggle mt-1 w-5 h-5 rounded" data-id="${escapeHtml(item.item_id)}" ${done ? 'checked' : ''} ${cancelled ? 'disabled' : ''} aria-label="Done">
        <div class="flex-1 min-w-0 flex flex-col gap-2">
          <p class="text-on-surface font-medium ${done || cancelled ? 'line-through text-on-surface-variant' : ''}">${escapeHtml(item.text)}</p>
          ${item.rationale ? `<p class="text-sm text-on-surface-variant">Why: ${escapeHtml(item.rationale)}</p>` : ''}
          <div class="flex flex-wrap items-center gap-2">${ownersHtml(item)}</div>
          ${sourceHtml(item)}
          ${item.evidence_quote ? `<p class="text-xs italic text-on-surface-variant">“${escapeHtml(item.evidence_quote)}”</p>` : ''}
        </div>
        <div class="flex flex-col items-end gap-2">
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

  document.addEventListener('DOMContentLoaded', load);
})();
