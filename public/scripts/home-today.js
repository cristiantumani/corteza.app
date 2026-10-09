/**
 * "Prepare your day" on Home (docs/specs/2026-10-home-today.md): today's meetings still ahead, each
 * with what is open from its own history (the same prep as the morning summary).
 *
 * - One row per meeting: time, title, a summary; the next one open ("in 40 min", "Now"), the others
 *   open in place; meetings with nothing connected in grey. At most 4, then "Show N more".
 * - Mark as done: the circle on the person's own open action items (PATCH /api/action-items/:id),
 *   with undo in the row and the close-the-loop prompt (public/scripts/close-loop.js) under the list.
 *
 * API: GET /api/home/today → { status: 'ok'|'no_calendar'|'no_google', meetings }
 * Everything from meetings goes through escapeHtml.
 */
(function() {
  'use strict';

  const t = window.t || (key => key); // public/scripts/i18n.js
  const locale = (window.CortezaI18n && window.CortezaI18n.locale) || undefined;
  const VISIBLE = 4;
  const SOON_MS = 2 * 60 * 60 * 1000; // "in 40 min" only for the next couple of hours
  let state = { meetings: [], showAll: false, open: new Set(), done: new Map() };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  const section = () => document.getElementById('home-today');
  const body = () => document.getElementById('home-today-body');
  const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
  const time = iso => new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const shortDate = value => new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString(locale, { month: 'short', day: 'numeric' });

  const isNow = meeting => new Date(meeting.start).getTime() <= Date.now();
  const hasContent = meeting => (meeting.items || []).length > 0 || (meeting.questions || []).length > 0 || (meeting.closed || []).length > 0;
  const openItems = meeting => (meeting.suggested ? 0 : (meeting.items || []).length + (meeting.more || 0));

  /** "in 40 min" / "Now" for the next meeting */
  function whenLabel(meeting, index) {
    if (isNow(meeting)) return `<span class="rounded-full bg-signal-wash text-signal-ink px-2 py-0.5 text-xs font-semibold">${escapeHtml(t('home.today.now'))}</span>`;
    const minutes = Math.round((new Date(meeting.start).getTime() - Date.now()) / 60000);
    if (index !== 0 || minutes * 60000 > SOON_MS) return '';
    return `<span class="text-xs font-semibold text-signal-ink">${escapeHtml(t('home.today.inMinutes', { count: Math.max(1, minutes) }))}</span>`;
  }

  function summary(meeting) {
    if (meeting.suggested) return t('home.today.suggestedSummary', { count: meeting.items.length + (meeting.more || 0), name: (meeting.people || [])[0] || '' });
    if (meeting.kind === 'new') return t('home.today.nothingConnected');
    const parts = [];
    const open = openItems(meeting);
    if (open) parts.push(t('home.today.open', { count: open }));
    if (meeting.overdue) parts.push(t('home.tiles.overdue', { count: meeting.overdue }));
    const questions = (meeting.questions || []).filter(q => q.type === 'open_question').length;
    const risks = (meeting.questions || []).filter(q => q.type === 'risk').length;
    if (questions) parts.push(t('home.today.questions', { count: questions }));
    if (risks) parts.push(t('home.today.risks', { count: risks }));
    return parts.length ? parts.join(' · ') : t('home.today.nothingOpen');
  }

  function itemHtml(item) {
    const done = state.done.has(item.item_id);
    const overdue = item.due_date && item.due_date < today();
    const who = item.mine ? t('home.today.you') : (item.owner || t('home.today.noOwner'));
    const due = item.due_date
      ? `<span class="${overdue && !done ? 'text-error font-semibold' : ''}">${escapeHtml(t(overdue ? 'home.today.overdueDate' : 'home.today.dueDate', { date: shortDate(item.due_date) }))}</span>`
      : '';
    const toggle = item.mine
      ? `<button type="button" class="today-done shrink-0 w-11 h-11 -m-3 flex items-center justify-center rounded-full text-on-surface-variant hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary"
           data-id="${escapeHtml(item.item_id)}" aria-pressed="${done}" aria-label="${escapeHtml(t('home.today.markDone', { text: item.text }))}">
           <span class="material-symbols-outlined text-xl ${done ? 'text-success' : ''}" aria-hidden="true">${done ? 'check_circle' : 'radio_button_unchecked'}</span>
         </button>`
      : '<span class="shrink-0 w-5" aria-hidden="true"></span>';
    return `
      <li class="flex items-start gap-3 py-2" data-item="${escapeHtml(item.item_id)}">
        ${toggle}
        <div class="min-w-0 flex-1">
          <a href="/actions?item=${encodeURIComponent(item.item_id)}" class="text-sm text-on-surface hover:underline break-words ${done ? 'line-through text-on-surface-variant' : ''}">${escapeHtml(item.text)}</a>
          <p class="text-xs text-on-surface-variant flex flex-wrap gap-x-2">
            <span>${escapeHtml(who)}</span>${due ? `<span aria-hidden="true">·</span>${due}` : ''}
            ${done ? `<span aria-hidden="true">·</span><span class="text-success-ink font-semibold">${escapeHtml(t('home.today.done'))}</span>
              <button type="button" class="today-undo font-semibold text-on-surface underline" data-id="${escapeHtml(item.item_id)}">${escapeHtml(t('common.undo'))}</button>` : ''}
          </p>
        </div>
      </li>`;
  }

  function outcomeHtml(outcome, closed) {
    const icon = closed ? 'check' : outcome.type === 'risk' ? 'warning' : outcome.type === 'action_item' ? 'task_alt' : 'contact_support';
    const href = outcome.type === 'action_item' ? '/actions' : `/questions?type=${outcome.type === 'risk' ? 'risk' : 'open_question'}`;
    return `
      <li class="flex items-start gap-3 py-1.5">
        <span class="material-symbols-outlined shrink-0 text-lg ${closed ? 'text-success' : 'text-on-surface-variant'}" aria-hidden="true">${icon}</span>
        <div class="min-w-0 flex-1">
          <a href="${href}" class="text-sm ${closed ? 'text-on-surface-variant' : 'text-on-surface'} hover:underline break-words">${escapeHtml(outcome.text)}</a>
          ${outcome.owner ? `<p class="text-xs text-on-surface-variant">${escapeHtml(outcome.owner)}</p>` : ''}
        </div>
      </li>`;
  }

  function detailHtml(meeting) {
    const blocks = [];
    if (meeting.suggested) blocks.push(`<p class="text-sm text-on-surface-variant">${escapeHtml(t('home.today.suggestedHelp', { name: (meeting.people || [])[0] || '' }))}</p>`);
    if ((meeting.items || []).length) {
      blocks.push(`
        <div>
          ${meeting.suggested ? '' : `<h4 class="text-xs font-semibold text-on-surface-variant">${escapeHtml(t('nav.actions'))}</h4>`}
          <ul>${meeting.items.map(itemHtml).join('')}</ul>
          ${meeting.more ? `<a href="/actions" class="text-xs font-semibold text-on-surface hover:underline">${escapeHtml(t('home.today.moreItems', { count: meeting.more }))}</a>` : ''}
        </div>`);
    }
    if ((meeting.questions || []).length) {
      blocks.push(`
        <div>
          <h4 class="text-xs font-semibold text-on-surface-variant">${escapeHtml(t('nav.questions'))}</h4>
          <ul>${meeting.questions.map(q => outcomeHtml(q, false)).join('')}</ul>
        </div>`);
    }
    if ((meeting.closed || []).length) {
      const since = meeting.last_met ? t('home.today.closedSinceDate', { date: shortDate(meeting.last_met) }) : t('email.digest.closedSince');
      blocks.push(`
        <div>
          <h4 class="text-xs font-semibold text-on-surface-variant">${escapeHtml(since)}</h4>
          <ul>${meeting.closed.map(c => outcomeHtml(c, true)).join('')}</ul>
        </div>`);
    }
    return blocks.join('');
  }

  function meetingHtml(meeting, index) {
    const id = `today-${index}`;
    const expandable = hasContent(meeting);
    const open = expandable && state.open.has(index);
    const muted = !expandable;
    const people = !meeting.suggested && (meeting.people || []).length ? t('home.today.with', { people: meeting.people.slice(0, 3).join(', ') + (meeting.people.length > 3 ? '…' : '') }) : '';
    const head = `
      <span class="w-14 shrink-0 text-sm font-semibold tabular-nums ${muted ? 'text-on-surface-variant' : 'text-on-surface'}">${escapeHtml(time(meeting.start))}</span>
      <span class="min-w-0 flex-1">
        <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="text-sm font-semibold break-words ${muted ? 'text-on-surface-variant' : 'text-on-surface'}">${escapeHtml(meeting.title)}</span>
          ${whenLabel(meeting, index)}
        </span>
        <span class="block text-xs text-on-surface-variant">${escapeHtml(summary(meeting))}${people ? ` · ${escapeHtml(people)}` : ''}</span>
      </span>`;
    if (!expandable) return `<li class="flex items-start gap-3 px-5 py-3 border-t border-outline-variant">${head}<span class="w-6" aria-hidden="true"></span></li>`;
    return `
      <li class="border-t border-outline-variant">
        <button type="button" class="today-toggle w-full flex items-start gap-3 px-5 py-3 text-left hover:bg-surface-container-low focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          data-index="${index}" aria-expanded="${open}" aria-controls="${id}">
          ${head}
          <span class="material-symbols-outlined text-xl text-on-surface-variant transition-transform ${open ? 'rotate-180' : ''}" aria-hidden="true">expand_more</span>
        </button>
        <div id="${id}" class="${open ? '' : 'hidden'} flex flex-col gap-3 pl-5 md:pl-[5.75rem] pr-5 pb-4">${open ? detailHtml(meeting) : ''}</div>
      </li>`;
  }

  function render() {
    const meetings = state.meetings;
    const shown = state.showAll ? meetings : meetings.slice(0, VISIBLE);
    const hidden = meetings.length - shown.length;
    document.getElementById('home-today-count').textContent = meetings.length ? t('home.today.remaining', { count: meetings.length }) : '';
    if (!meetings.length) {
      body().innerHTML = `<p class="px-5 pb-4 text-sm text-on-surface-variant">${escapeHtml(t('home.today.noMeetings'))}</p>`;
      return;
    }
    body().innerHTML = `
      <ul>${shown.map(meetingHtml).join('')}</ul>
      ${hidden > 0 ? `<div class="border-t border-outline-variant px-5 py-3"><button type="button" id="today-more" class="text-sm font-semibold text-on-surface hover:underline">${escapeHtml(t('home.today.showMore', { count: hidden }))}</button></div>` : ''}`;
  }

  function renderStatus(status) {
    if (status === 'no_calendar') {
      body().innerHTML = `
        <p class="px-5 pb-4 text-sm text-on-surface-variant">${escapeHtml(t('home.today.noCalendar'))}
          <a href="/integrations/google/connect" class="font-semibold text-on-surface underline">${escapeHtml(t('home.today.connect'))}</a></p>`;
    }
  }

  async function setDone(itemId, done) {
    const previous = state.done.get(itemId);
    if (done) state.done.set(itemId, true); else state.done.delete(itemId);
    render();
    try {
      const response = await fetch(`/api/action-items/${encodeURIComponent(itemId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: done ? 'done' : 'open' })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.error || t('actions.updateFailed'));
      if (window.CortezaLoop) window.CortezaLoop.afterItemChange(data);
    } catch (error) {
      if (previous) state.done.set(itemId, previous); else state.done.delete(itemId);
      render();
      const row = document.querySelector(`[data-item="${CSS.escape(itemId)}"] p`);
      if (row) row.insertAdjacentHTML('beforeend', `<span class="text-error" role="alert">${escapeHtml(error.message)}</span>`);
    }
  }

  document.addEventListener('click', event => {
    const toggle = event.target.closest('.today-toggle');
    if (toggle) {
      const index = Number(toggle.dataset.index);
      if (state.open.has(index)) state.open.delete(index); else state.open.add(index);
      render();
      const again = document.querySelector(`.today-toggle[data-index="${index}"]`);
      if (again) again.focus();
      return;
    }
    const doneButton = event.target.closest('.today-done');
    if (doneButton) return void setDone(doneButton.dataset.id, !state.done.has(doneButton.dataset.id));
    const undo = event.target.closest('.today-undo');
    if (undo) return void setDone(undo.dataset.id, false);
    if (event.target.closest('#today-more')) {
      state.showAll = true;
      render();
    }
  });

  async function load() {
    const el = section();
    if (!el) return;
    try {
      const response = await fetch('/api/home/today', { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.error || t('home.today.failed'));
      if (data.status === 'no_google') {
        el.hidden = true;
        return;
      }
      if (data.status !== 'ok') return renderStatus(data.status);
      state.meetings = data.meetings || [];
      // The next meeting opens by itself when there's something in it
      if (state.meetings.length && hasContent(state.meetings[0])) state.open.add(0);
      render();
    } catch (error) {
      body().innerHTML = `<p class="px-5 pb-4 text-sm text-error" role="alert">${escapeHtml(t('home.today.failed'))}
        <button type="button" id="today-retry" class="font-semibold text-on-surface underline">${escapeHtml(t('common.tryAgainButton'))}</button></p>`;
      document.getElementById('today-retry').addEventListener('click', () => {
        body().innerHTML = `<p class="px-5 pb-4 text-sm text-on-surface-variant">${escapeHtml(t('home.today.loading'))}</p>`;
        load();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (window.CortezaLoop) window.CortezaLoop.init(document.getElementById('home-today-loop'), null);
    load();
  });
})();
