/**
 * Open questions & risks page (/questions): what meetings left unresolved, with a way to
 * mark a question answered or a risk mitigated (with an optional note), and to reopen it.
 * API: src/http/questions-risks.js
 */
(function() {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const state = {
    type: ['open_question', 'risk'].includes(params.get('type')) ? params.get('type') : 'all',
    status: 'open'
  };
  const LABELS = {
    open_question: { name: 'Open question', resolve: 'Mark answered', resolved: 'Answered', note: 'What was the answer? (optional)', icon: 'contact_support', color: 'bg-[#e3e7fb] text-[#3953bd]' },
    risk: { name: 'Risk', resolve: 'Mark mitigated', resolved: 'Mitigated', note: 'How was it handled? (optional)', icon: 'warning', color: 'bg-[#fff4e5] text-[#8a5300]' }
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function formatDate(value) {
    const date = new Date(value);
    return isNaN(date) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function age(value) {
    const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
    if (!(days >= 0)) return '';
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  }

  function renderFilters(counts) {
    document.querySelectorAll('.type-filter').forEach(button => {
      const active = button.dataset.type === state.type;
      button.className = `type-filter px-4 py-2 text-sm font-semibold ${active ? 'bg-primary text-on-primary' : 'bg-surface text-on-surface hover:bg-surface-container-low'}`;
    });
    if (counts) {
      document.querySelectorAll('[data-count]').forEach(el => {
        const count = counts[el.dataset.count] || 0;
        el.textContent = count ? `(${count})` : '';
      });
    }
    document.getElementById('status-filter').value = state.status;
  }

  function sourceHtml(item) {
    const parts = [];
    const source = item.source_details || {};
    if (source.title) {
      const url = source.url && /^https:\/\//.test(source.url) ? source.url : null;
      parts.push(url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="text-primary hover:underline">${escapeHtml(source.title)}</a>`
        : escapeHtml(source.title));
    }
    if (item.timestamp) parts.push(`raised ${escapeHtml(age(item.timestamp))} (${escapeHtml(formatDate(item.timestamp))})`);
    if (item.owner_name) parts.push(`Owner: ${escapeHtml(item.owner_name)}`);
    return parts.length ? `<p class="text-xs text-on-surface-variant">${parts.join(' · ')}</p>` : '';
  }

  function itemHtml(item) {
    const label = LABELS[item.type] || LABELS.open_question;
    const resolved = item.resolution_status === 'resolved';
    const by = item.resolved_by && item.resolved_by.name;
    return `
      <div id="item-${escapeHtml(item.id)}" class="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 flex flex-col gap-2 ${resolved ? 'opacity-80' : ''}">
        <div class="flex flex-wrap items-center gap-2">
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${label.color}">
            <span class="material-symbols-outlined text-sm" aria-hidden="true">${label.icon}</span>${label.name}
          </span>
          ${resolved ? `<span class="px-2 py-0.5 rounded-full bg-[#e6f4ea] text-[#1e6b34] text-xs font-semibold">${label.resolved}${by ? ` by ${escapeHtml(by)}` : ''}${item.resolved_at ? ` · ${escapeHtml(formatDate(item.resolved_at))}` : ''}</span>` : ''}
          ${item.capture === 'ai' && !item.review_status ? '<span class="text-xs text-on-surface-variant">AI-captured, not reviewed yet</span>' : ''}
        </div>
        <p class="text-on-surface font-medium ${resolved ? 'line-through text-on-surface-variant' : ''}">${escapeHtml(item.text)}</p>
        ${item.rationale ? `<p class="text-sm text-on-surface-variant">Why it matters: ${escapeHtml(item.rationale)}</p>` : ''}
        ${item.evidence_quote ? `<p class="text-xs italic text-on-surface-variant">“${escapeHtml(item.evidence_quote)}”</p>` : ''}
        ${sourceHtml(item)}
        ${resolved && item.resolution_note ? `<p class="text-sm text-on-surface bg-surface-container-low rounded-lg p-3">${escapeHtml(item.resolution_note)}</p>` : ''}
        <div class="flex flex-wrap items-center gap-2 mt-1" data-actions="${escapeHtml(item.id)}">
          ${resolved
            ? `<button type="button" class="reopen-btn text-sm font-semibold text-primary hover:underline" data-id="${escapeHtml(item.id)}">Reopen</button>`
            : `<button type="button" class="resolve-btn border border-outline-variant rounded-lg py-1.5 px-3 text-sm font-semibold hover:bg-surface-container-low" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.type)}">${label.resolve}</button>`}
        </div>
      </div>`;
  }

  async function load() {
    renderFilters();
    const container = document.getElementById('items');
    const query = new URLSearchParams({ type: state.type, status: state.status });
    try {
      const response = await fetch(`/api/questions-risks?${query}`, { credentials: 'include' });
      if (response.status === 401) {
        window.location.href = `/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load open questions and risks');
      renderFilters(data.counts);
      const items = data.items;
      document.getElementById('items-count').textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
      container.innerHTML = items.length
        ? items.map(itemHtml).join('')
        : `<p class="text-on-surface-variant">${state.status === 'open' ? 'Nothing open here. Open questions and risks are captured automatically from your meetings.' : 'Nothing matches these filters.'}</p>`;
    } catch (error) {
      container.innerHTML = `<p class="text-error">${escapeHtml(error.message)}</p>`;
    }
  }

  /** Inline form: optional note, then save */
  function showResolveForm(id, type) {
    const label = LABELS[type] || LABELS.open_question;
    const actions = document.querySelector(`[data-actions="${CSS.escape(String(id))}"]`);
    if (!actions) return;
    actions.innerHTML = `
      <textarea class="resolve-note w-full bg-surface-container-low border border-outline-variant rounded-lg p-2 text-sm" rows="2" maxlength="1000" placeholder="${escapeHtml(label.note)}"></textarea>
      <button type="button" class="resolve-save bg-primary text-on-primary rounded-lg py-1.5 px-3 text-sm font-semibold" data-id="${escapeHtml(id)}">${label.resolve}</button>
      <button type="button" class="resolve-cancel text-sm text-on-surface-variant hover:underline">Cancel</button>`;
    actions.querySelector('.resolve-note').focus();
  }

  async function post(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) alert(data.error || 'Could not save');
    return load();
  }

  document.addEventListener('click', event => {
    const typeButton = event.target.closest('.type-filter');
    if (typeButton) { state.type = typeButton.dataset.type; return load(); }
    const resolve = event.target.closest('.resolve-btn');
    if (resolve) return showResolveForm(resolve.dataset.id, resolve.dataset.type);
    const save = event.target.closest('.resolve-save');
    if (save) {
      const note = save.parentElement.querySelector('.resolve-note').value;
      return post(`/api/questions-risks/${encodeURIComponent(save.dataset.id)}/resolve`, { note });
    }
    if (event.target.closest('.resolve-cancel')) return load();
    const reopen = event.target.closest('.reopen-btn');
    if (reopen) return post(`/api/questions-risks/${encodeURIComponent(reopen.dataset.id)}/reopen`);
  });

  document.addEventListener('change', event => {
    if (event.target.id === 'status-filter') { state.status = event.target.value; load(); }
  });

  document.addEventListener('DOMContentLoaded', load);
})();
