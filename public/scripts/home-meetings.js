/**
 * Home → Meetings (docs/specs/2026-10-meetings-view.md): the person's meetings, newest first,
 * each with what came out of it. A row opens in place with its outcomes (confirm / dismiss while
 * waiting for review, "Confirm all"), skipped and failed meetings offer "Capture anyway" /
 * "Try again", and hand-logged outcomes sit in one "Logged by hand" row per day.
 *
 * Loads when the tab is shown (event `corteza:home-tab` from home-overview.js). The open meeting
 * is in the URL: /dashboard?tab=meetings&meeting=<id>.
 * APIs: GET /api/meetings, GET /api/meetings/outcomes, POST /api/decisions/:id/review,
 * POST /api/decisions/:id/restore, POST /api/integrations/google/imports.
 * Everything from meetings or the AI goes through escapeHtml.
 */
(function() {
  'use strict';
  const t = window.t || (key => key); // public/scripts/i18n.js
  const locale = (window.CortezaI18n && window.CortezaI18n.locale) || undefined;

  const state = { rows: [], next: null, loaded: false, loading: false, open: null };
  const TYPE_ORDER = ['decision', 'action_item', 'open_question', 'risk'];
  const ICONS = { decision: 'gavel', action_item: 'task_alt', open_question: 'contact_support', risk: 'warning' };
  const SKIP_KEYS = { one_on_one: 'capture.skip.one_on_one', excluded_title: 'capture.skip.excluded_title', no_transcript: 'capture.skip.no_transcript', too_short: 'capture.skip.too_short', ai_budget: 'meet.skip.ai_budget' };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  const container = () => document.getElementById('home-meetings-list');

  async function request(method, url, body) {
    const response = await fetch(url, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.message || data.error || t('common.somethingWrong'));
    return data;
  }

  function when(value) {
    if (!value) return '';
    const date = new Date(value);
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);
    const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    if (date.toDateString() === today.toDateString()) return t('meetings.todayAt', { time });
    if (date.toDateString() === yesterday.toDateString()) return t('meetings.yesterdayAt', { time });
    return date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function dayOnly(value) {
    return new Date(value).toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function countsText(counts) {
    const parts = TYPE_ORDER.filter(type => counts[type] > 0).map(type => t(`outcomeCounts.${type}`, { count: counts[type] }));
    return parts.join(' · ');
  }

  function rowStatus(row) {
    if (row.status === 'processing') return `<span class="text-on-surface-variant">${escapeHtml(t('meetings.reading'))}</span>`;
    if (row.status === 'failed') return `<span class="text-error">${escapeHtml(t('meetings.failed'))}</span>`;
    if (row.status === 'skipped') return `<span class="text-on-surface-variant">${escapeHtml(t(SKIP_KEYS[row.skip_reason] || 'capture.skipped'))}</span>`;
    const counts = countsText(row.counts);
    return `<span class="text-on-surface-variant">${escapeHtml(counts || t('meetings.nothing'))}</span>`;
  }

  function rowHtml(row) {
    const open = state.open === row.id;
    const greyed = row.status === 'skipped' || row.status === 'failed';
    const title = row.kind === 'manual' ? t('meetings.byHand') : (row.title || t('capture.meeting'));
    const expandable = row.status === 'completed';
    const action = row.can_capture
      ? `<button type="button" class="meeting-capture shrink-0 rounded-lg border border-outline-variant px-3 py-1.5 text-sm font-semibold text-on-surface hover:bg-surface-container-low" data-id="${escapeHtml(row.id)}">${escapeHtml(t(row.status === 'failed' ? 'meetings.tryAgain' : 'meetings.captureAnyway'))}</button>`
      : '';
    const head = `
        <span class="material-symbols-outlined shrink-0 text-on-surface-variant" aria-hidden="true">${row.kind === 'manual' ? 'edit_note' : 'videocam'}</span>
        <span class="min-w-0 flex-1">
          <span class="block font-semibold ${greyed ? 'text-on-surface-variant' : 'text-on-surface'} break-words">${escapeHtml(title)}</span>
          <span class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <span class="text-on-surface-variant">${escapeHtml(row.kind === 'manual' ? dayOnly(row.occurred_at) : when(row.occurred_at))}</span>
            <span aria-hidden="true" class="text-on-surface-variant">·</span>
            ${rowStatus(row)}
            ${row.to_review ? `<span class="font-semibold text-signal-ink">· ${escapeHtml(t('meetings.toReview', { count: row.to_review }))}</span>` : ''}
          </span>
        </span>`;
    return `
      <li class="meeting-row rounded-xl border border-outline-variant bg-surface-container-lowest" data-id="${escapeHtml(row.id)}">
        <div class="flex items-center gap-3 px-4 py-3">
          ${expandable
            ? `<button type="button" class="meeting-toggle flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded="${open}" data-id="${escapeHtml(row.id)}">${head}
                 <span class="material-symbols-outlined shrink-0 text-on-surface-variant" aria-hidden="true">${open ? 'expand_less' : 'expand_more'}</span></button>`
            : `<div class="flex min-w-0 flex-1 items-center gap-3">${head}</div>`}
          ${action}
        </div>
        ${open ? '<div class="meeting-detail border-t border-outline-variant px-4 py-3"><p class="text-sm text-on-surface-variant">' + escapeHtml(t('common.loading')) + '</p></div>' : ''}
      </li>`;
  }

  function outcomeHtml(outcome) {
    const resolved = outcome.resolution_status === 'resolved';
    const status = resolved ? t(outcome.type === 'risk' ? 'detail.mitigated' : 'detail.answered') : '';
    const meta = [outcome.owner_name, status].filter(Boolean).join(' · ');
    return `
      <li class="flex flex-col gap-1.5 py-2 border-t border-outline-variant/60 first:border-t-0" data-outcome="${escapeHtml(outcome.id)}">
        <div class="flex items-start gap-2">
          <span class="material-symbols-outlined text-base shrink-0 ${outcome.type === 'risk' ? 'text-signal-ink' : 'text-on-surface-variant'}" aria-hidden="true">${ICONS[outcome.type] || 'notes'}</span>
          <span class="min-w-0 flex-1">
            <button type="button" class="meeting-open text-left text-sm text-on-surface hover:underline break-words ${resolved ? 'line-through text-on-surface-variant' : ''}" data-outcome="${escapeHtml(outcome.id)}">${escapeHtml(outcome.text)}</button>
            ${meta ? `<span class="block text-xs text-on-surface-variant">${escapeHtml(meta)}</span>` : ''}
            ${outcome.topic_id ? `<a href="/questions?topic=${encodeURIComponent(outcome.topic_id)}" class="mt-0.5 flex w-fit items-center gap-1 text-xs font-semibold text-on-surface-variant hover:underline"><span class="material-symbols-outlined text-sm" aria-hidden="true">forum</span>${escapeHtml(t('threads.inThread'))}${outcome.topic ? ` · ${escapeHtml(outcome.topic)}` : ''}</a>` : ''}
          </span>
        </div>
        ${outcome.can_review ? `
          <div class="flex flex-wrap gap-2 pl-6">
            <button type="button" class="meeting-review rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-on-primary hover:bg-on-primary-fixed-variant" data-action="confirm" data-outcome="${escapeHtml(outcome.id)}">${escapeHtml(t('review.confirm'))}</button>
            <button type="button" class="meeting-review rounded-lg border border-outline-variant px-3 py-1 text-xs font-semibold text-on-surface hover:bg-surface-container-low" data-action="dismiss" data-outcome="${escapeHtml(outcome.id)}">${escapeHtml(t('review.dismiss'))}</button>
          </div>` : ''}
      </li>`;
  }

  function actionHtml(item) {
    const done = item.status === 'done';
    const cancelled = item.status === 'cancelled';
    const owners = (item.owners || []).map(owner => owner.name).filter(Boolean).join(', ');
    const meta = [owners, item.due_date ? t('due.on', { date: new Date(`${item.due_date}T00:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' }) }) : '', done ? t('actions.statusOne.done') : cancelled ? t('actions.statusOne.cancelled') : '']
      .filter(Boolean).join(' · ');
    return `
      <li class="flex items-start gap-2 py-2 border-t border-outline-variant/60 first:border-t-0">
        <span class="material-symbols-outlined text-base shrink-0 ${done ? 'text-success-ink' : 'text-on-surface-variant'}" aria-hidden="true">${done ? 'task_alt' : 'radio_button_unchecked'}</span>
        <span class="min-w-0 flex-1">
          <a href="/actions?item=${encodeURIComponent(item.item_id)}" class="text-sm text-on-surface hover:underline break-words ${done || cancelled ? 'line-through text-on-surface-variant' : ''}">${escapeHtml(item.text)}</a>
          ${meta ? `<span class="block text-xs text-on-surface-variant">${escapeHtml(meta)}</span>` : ''}
        </span>
      </li>`;
  }

  function detailHtml(row, data) {
    const outcomes = data.outcomes || [];
    const actions = data.action_items || [];
    if (!outcomes.length && !actions.length) return `<p class="text-sm text-on-surface-variant">${escapeHtml(t('meetings.nothing'))}</p>`;
    const pending = outcomes.filter(outcome => outcome.can_review);
    const groups = TYPE_ORDER.map(type => {
      const list = type === 'action_item' ? actions : outcomes.filter(outcome => outcome.type === type);
      if (!list.length) return '';
      return `
        <section class="flex flex-col">
          <h4 class="text-xs font-semibold text-on-surface-variant">${escapeHtml(t(`meetings.groups.${type}`))}</h4>
          <ul class="flex flex-col">${list.map(type === 'action_item' ? actionHtml : outcomeHtml).join('')}</ul>
        </section>`;
    }).join('');
    return `
      <div class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center gap-3">
          ${pending.length > 1 ? `<button type="button" class="meeting-confirm-all rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-on-primary hover:bg-on-primary-fixed-variant" data-id="${escapeHtml(row.id)}">${escapeHtml(t('meetings.confirmAll', { count: pending.length }))}</button>` : ''}
          ${row.url ? `<a href="${escapeHtml(row.url)}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-sm font-semibold text-on-surface-variant hover:underline"><span class="material-symbols-outlined text-base" aria-hidden="true">open_in_new</span>${escapeHtml(t('meetings.openInMeet'))}</a>` : ''}
        </div>
        ${groups}
        <p class="meeting-error hidden text-sm text-error" role="alert"></p>
      </div>`;
  }

  function render() {
    const el = container();
    if (!el) return;
    if (!state.rows.length) {
      el.innerHTML = `<p class="text-sm text-on-surface-variant">${escapeHtml(t('meetings.empty'))}</p>`;
      return;
    }
    el.innerHTML = `
      <ul class="flex flex-col gap-2">${state.rows.map(rowHtml).join('')}</ul>
      ${state.next ? `<button type="button" id="meetings-more" class="mt-3 self-start text-sm font-semibold text-on-surface underline">${escapeHtml(t('meetings.showMore'))}</button>` : ''}`;
    if (state.open) loadDetail(state.open);
  }

  /** @type {Map<string, any>} */
  const details = new Map();

  async function loadDetail(id) {
    const row = state.rows.find(entry => entry.id === id);
    const li = container().querySelector(`.meeting-row[data-id="${CSS.escape(id)}"] .meeting-detail`);
    if (!row || !li) return;
    try {
      const data = await request('GET', `/api/meetings/outcomes?id=${encodeURIComponent(id)}`);
      details.set(id, data);
      li.innerHTML = detailHtml(row, data);
    } catch (error) {
      li.innerHTML = `<p class="text-sm text-error">${escapeHtml(error.message)}</p>`;
    }
  }

  async function load(more = false) {
    if (state.loading) return;
    state.loading = true;
    try {
      const query = new URLSearchParams({ limit: '20' });
      if (more && state.next) query.set('before', state.next);
      const data = await request('GET', `/api/meetings?${query}`);
      state.rows = more ? state.rows.concat(data.meetings) : data.meetings;
      state.next = data.next_before;
      state.loaded = true;
      render();
    } catch (error) {
      const el = container();
      if (el) el.innerHTML = `<p class="text-sm text-error">${escapeHtml(error.message)}</p>`;
    } finally {
      state.loading = false;
    }
  }

  function setOpen(id) {
    state.open = state.open === id ? null : id;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'meetings');
      if (state.open) url.searchParams.set('meeting', state.open); else url.searchParams.delete('meeting');
      history.replaceState(null, '', url.pathname + url.search);
    } catch (e) { /* ignore */ }
    render();
  }

  async function reviewOutcome(button) {
    const id = Number(button.dataset.outcome);
    const action = button.dataset.action;
    button.closest('li').querySelectorAll('.meeting-review').forEach(b => { b.disabled = true; });
    try {
      await request('POST', `/api/decisions/${id}/review`, { action });
      await refreshOpen();
    } catch (error) {
      showError(error.message);
    }
  }

  async function confirmAll(button) {
    const data = details.get(button.dataset.id);
    if (!data) return;
    button.disabled = true;
    try {
      for (const outcome of data.outcomes.filter(entry => entry.can_review)) {
        await request('POST', `/api/decisions/${outcome.id}/review`, { action: 'confirm' });
      }
      await refreshOpen();
    } catch (error) {
      showError(error.message);
      button.disabled = false;
    }
  }

  async function capture(button) {
    button.disabled = true;
    button.textContent = t('meetings.reading');
    try {
      await request('POST', '/api/integrations/google/imports', { meeting_ids: [button.dataset.id] });
      const row = state.rows.find(entry => entry.id === button.dataset.id);
      if (row) { row.status = 'processing'; row.can_capture = false; }
      render();
      setTimeout(() => load(), 20000);
    } catch (error) {
      button.disabled = false;
      button.textContent = t('meetings.captureAnyway');
      showError(error.message, button.closest('.meeting-row'));
    }
  }

  function showError(message, scope) {
    const el = (scope || container()).querySelector('.meeting-error');
    if (el) { el.textContent = message; el.classList.remove('hidden'); } else alert(message);
  }

  /** Counts on the rows and the open meeting, after a change (the open row stays open) */
  async function refreshOpen() {
    await load();
  }

  document.addEventListener('click', event => {
    if (!container() || !container().contains(event.target)) return;
    const toggle = event.target.closest('.meeting-toggle');
    if (toggle) return setOpen(toggle.dataset.id);
    const review = event.target.closest('.meeting-review');
    if (review) return reviewOutcome(review);
    const all = event.target.closest('.meeting-confirm-all');
    if (all) return confirmAll(all);
    const captureButton = event.target.closest('.meeting-capture');
    if (captureButton) return capture(captureButton);
    const open = event.target.closest('.meeting-open');
    if (open && typeof window.openDecision === 'function') {
      const data = details.get(state.open);
      const outcome = data && data.outcomes.find(entry => String(entry.id) === open.dataset.outcome);
      if (outcome) window.openDecision(outcome);
      return;
    }
    if (event.target.id === 'meetings-more') load(true);
  });

  document.addEventListener('corteza:home-tab', event => {
    if (event.detail !== 'meetings') return;
    if (!state.loaded) {
      state.open = new URLSearchParams(window.location.search).get('meeting');
      load();
    }
  });
})();
