/**
 * Home overview (COR-41, docs/specs/2026-10-home-overview.md): the three questions in one place.
 *
 * - #home-summary: one sentence on the last 24 hours and what needs the person now, each count a link
 * - #home-ask: ask across meetings (semantic search, the same API as Search) and read the answer here
 * - #home-review: AI-captured outcomes to confirm, one at a time, with their quote and meeting;
 *   "Confirm all from this meeting"; dismiss with undo
 * - #home-owe / #home-open / #home-decided: what I owe (tick to mark done, with undo), what is
 *   still open (with when it was raised), what was decided
 * - Tabs: Overview (default) and All outcomes (the list in dashboard.js), remembered in the URL hash
 *
 * APIs: GET /api/home, POST /api/semantic-search, PATCH /api/action-items/:id,
 *       POST /api/decisions/:id/review, POST /api/decisions/:id/restore
 * Everything from meetings or the AI is escaped (escapeHtml) or set with textContent.
 */
(function() {
  'use strict';

  const t = window.t || (key => key); // public/scripts/i18n.js
  const locale = (window.CortezaI18n && window.CortezaI18n.locale) || undefined;
  /** Short type label ("Question", "Risk"); "Outcome" for anything else */
  const typeLabel = type => (['decision', 'open_question', 'risk', 'action_item'].includes(type) ? t(`types.short.${type}`) : t('detail.title'));
  let overview = null;
  let reviewIndex = 0;
  let spaceId = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  /** A text whose {placeholders} are HTML we built (links): the text is escaped, the HTML isn't */
  const tHtml = (key, html, count) => escapeHtml(t(key, { count })).replace(/\{(\w+)\}/g, (match, name) => (html[name] === undefined ? match : html[name]));
  const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the browser's time zone
  const shortDate = value => new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString(locale, { month: 'short', day: 'numeric' });

  function ago(value) {
    const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
    if (days < 1) return t('time.today');
    if (days === 1) return t('time.yesterday');
    if (days < 30) return t('time.daysAgo', { count: days });
    return t('time.onDate', { date: shortDate(value) });
  }

  function sourceLine(source, timestamp) {
    if (!source || !source.title) return timestamp ? escapeHtml(shortDate(timestamp)) : '';
    const label = source.type === 'google_meet' || !source.type ? t('detail.googleMeet') : t('detail.source');
    return `${label}: ${escapeHtml(source.title)}${timestamp ? ` · ${escapeHtml(shortDate(timestamp))}` : ''}`;
  }

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

  // ---------- Toast with undo ----------

  let toastTimer = null;
  function toast(message, undo) {
    clearTimeout(toastTimer);
    let box = document.getElementById('home-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'home-toast';
      box.setAttribute('role', 'status');
      box.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 rounded-lg bg-inverse-surface text-inverse-on-surface px-4 py-3 text-sm shadow-lg';
      document.body.appendChild(box);
    }
    box.innerHTML = `<span>${escapeHtml(message)}</span>${undo ? `<button type="button" class="font-semibold text-inverse-primary hover:underline">${escapeHtml(t('common.undo'))}</button>` : ''}`;
    box.hidden = false;
    if (undo) {
      box.querySelector('button').addEventListener('click', async () => {
        box.hidden = true;
        try { await undo(); } catch (error) { toast(error.message); }
      });
    }
    toastTimer = setTimeout(() => { box.hidden = true; }, 6000);
  }

  // ---------- Summary ----------

  function renderSummary() {
    const s = overview.summary;
    const el = document.getElementById('home-summary');
    const last = [];
    if (s.new_outcomes) {
      last.push(`<a href="#all" data-home-tab="all" class="text-primary font-semibold hover:underline">${escapeHtml(t('home.summary.newOutcomes', { count: s.new_outcomes }))}</a>${s.meetings ? escapeHtml(t('home.summary.fromMeetings', { count: s.meetings })) : ''}`);
    }
    const now = [];
    if (s.overdue) now.push(`<a href="/actions?due=overdue" class="text-error font-semibold hover:underline">${escapeHtml(t('home.summary.overdue', { count: s.overdue }))}</a>`);
    else if (s.due_today) now.push(`<a href="/actions?due=today" class="text-primary font-semibold hover:underline">${escapeHtml(t('home.summary.dueToday', { count: s.due_today }))}</a>`);
    if (s.to_review) now.push(`<a href="#home-review" class="text-primary font-semibold hover:underline">${escapeHtml(t('home.summary.toReview', { count: s.to_review }))}</a>`);

    if (!last.length && !now.length) {
      el.textContent = t('home.summary.caughtUp');
      return;
    }
    el.innerHTML = [
      last.length ? tHtml('home.summary.last', { items: last.join(', ') }) : escapeHtml(t('home.summary.nothingNew')),
      now.length ? tHtml('home.summary.needsYou', { items: now.join(' · ') }) : ''
    ].filter(Boolean).join(' ');
  }

  // ---------- What I owe ----------

  function dueLabel(due) {
    if (!due) return `<span class="text-on-surface-variant">${escapeHtml(t('due.none'))}</span>`;
    if (due < today()) return `<span class="text-error font-semibold">${escapeHtml(t('due.overdueOn', { date: shortDate(due) }))}</span>`;
    if (due === today()) return `<span class="text-primary font-semibold">${escapeHtml(t('due.today'))}</span>`;
    return `<span class="text-on-surface-variant">${escapeHtml(t('due.on', { date: shortDate(due) }))}</span>`;
  }

  function renderOwe() {
    const s = overview.summary;
    const el = document.getElementById('home-owe');
    const items = overview.owe;
    el.innerHTML = `
      <div class="flex items-baseline justify-between gap-2">
        <h2 class="text-lg font-semibold">${escapeHtml(t('home.owe.title'))}</h2>
        <a href="/actions" class="text-sm font-semibold text-primary hover:underline">${escapeHtml(t('home.owe.all'))}</a>
      </div>
      <p class="text-sm text-on-surface-variant">${s.open_action_items ? `${escapeHtml(t('home.owe.open', { count: s.open_action_items }))}${s.overdue ? ` · <span class="text-error font-semibold">${escapeHtml(t('home.owe.overdue', { count: s.overdue }))}</span>` : ''}` : ''}</p>
      ${items.length ? `<ul class="flex flex-col divide-y divide-outline-variant/60">${items.map(item => `
        <li class="flex items-start gap-3 py-2.5" data-owe="${escapeHtml(item.item_id)}">
          <label class="flex items-center justify-center w-6 h-6 mt-0.5 shrink-0 cursor-pointer">
            <input type="checkbox" class="w-5 h-5 rounded" data-done="${escapeHtml(item.item_id)}" aria-label="${escapeHtml(t('home.owe.markDone', { text: item.text }))}">
          </label>
          <div class="min-w-0 flex flex-col gap-0.5">
            <a href="/actions?item=${encodeURIComponent(item.item_id)}" class="text-sm text-on-surface hover:text-primary line-clamp-2">${escapeHtml(item.text)}</a>
            <span class="text-xs">${dueLabel(item.due_date)}${item.source ? ` <span class="text-on-surface-variant">· ${escapeHtml(item.source.title)}</span>` : ''}</span>
          </div>
        </li>`).join('')}</ul>`
        : `<p class="text-sm text-on-surface-variant">${escapeHtml(t('home.owe.empty'))}</p>`}`;

    el.querySelectorAll('[data-done]').forEach(box => box.addEventListener('change', () => markDone(box)));
  }

  async function markDone(box) {
    const id = box.dataset.done;
    box.disabled = true;
    try {
      await request('PATCH', `/api/action-items/${encodeURIComponent(id)}`, { status: 'done' });
      toast(t('home.owe.markedDone'), async () => {
        await request('PATCH', `/api/action-items/${encodeURIComponent(id)}`, { status: 'open' });
        load();
      });
      load();
    } catch (error) {
      box.checked = false;
      box.disabled = false;
      toast(error.message);
    }
  }

  // ---------- Still open ----------

  function renderOpen() {
    const s = overview.summary;
    const el = document.getElementById('home-open');
    const items = overview.open;
    el.innerHTML = `
      <div class="flex items-baseline justify-between gap-2">
        <h2 class="text-lg font-semibold">${escapeHtml(t('home.open.title'))}</h2>
        <a href="/questions" class="text-sm font-semibold text-primary hover:underline">${escapeHtml(t('nav.questions'))}</a>
      </div>
      <p class="text-sm text-on-surface-variant">${s.open_questions || s.open_risks ? escapeHtml([s.open_questions && t('home.open.questions', { count: s.open_questions }), s.open_risks && t('home.open.risks', { count: s.open_risks })].filter(Boolean).join(' · ')) : ''}</p>
      ${items.length ? `<ul class="flex flex-col divide-y divide-outline-variant/60">${items.map(item => `
        <li class="py-2.5">
          <button type="button" data-open="${escapeHtml(item.id)}" class="w-full text-left flex flex-col gap-0.5 group">
            <span class="flex items-center gap-2 text-xs">
              <span class="px-2 py-0.5 rounded-full font-semibold ${item.type === 'risk' ? 'bg-error/10 text-error' : 'bg-primary/10 text-primary'}">${escapeHtml(typeLabel(item.type))}</span>
              <span class="text-on-surface-variant">${escapeHtml(t('home.open.raised', { when: ago(item.timestamp) }))}</span>
            </span>
            <span class="text-sm text-on-surface group-hover:text-primary line-clamp-2">${escapeHtml(item.text)}</span>
          </button>
        </li>`).join('')}</ul>`
        : `<p class="text-sm text-on-surface-variant">${escapeHtml(t('home.open.empty'))}</p>`}`;

    el.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => {
      const item = overview.open.find(i => String(i.id) === button.dataset.open);
      if (item && typeof window.openDecision === 'function') window.openDecision(item);
    }));
  }

  // ---------- Decided ----------

  function renderDecided() {
    const el = document.getElementById('home-decided');
    const items = overview.decided;
    el.innerHTML = `
      <div class="flex items-baseline justify-between gap-2">
        <h2 class="text-lg font-semibold">${escapeHtml(t('home.decided.title'))}</h2>
        <a href="#all" data-home-tab="all" class="text-sm font-semibold text-primary hover:underline">${escapeHtml(t('home.tabs.all'))}</a>
      </div>
      <p class="text-sm text-on-surface-variant">${escapeHtml(t('home.decided.subtitle'))}</p>
      ${items.length ? `<ul class="flex flex-col divide-y divide-outline-variant/60">${items.map(item => `
        <li class="py-2.5">
          <button type="button" data-decided="${escapeHtml(item.id)}" class="w-full text-left flex flex-col gap-0.5 group">
            <span class="text-sm text-on-surface group-hover:text-primary line-clamp-2">${escapeHtml(item.text)}</span>
            <span class="text-xs text-on-surface-variant">${sourceLine(item.source_details, item.timestamp)}</span>
          </button>
        </li>`).join('')}</ul>`
        : `<p class="text-sm text-on-surface-variant">${escapeHtml(t(overview.summary.to_review ? 'home.decided.emptyToReview' : 'home.decided.empty'))}</p>`}`;

    el.querySelectorAll('[data-decided]').forEach(button => button.addEventListener('click', () => {
      const item = overview.decided.find(i => String(i.id) === button.dataset.decided);
      if (item && typeof window.openDecision === 'function') window.openDecision(item);
    }));
  }

  // ---------- Review queue ----------

  function renderReview() {
    const el = document.getElementById('home-review');
    const queue = overview.review;
    // The class, not the attribute: Tailwind's `flex` would override [hidden]
    if (!queue.length) {
      el.classList.add('hidden');
      return;
    }
    if (reviewIndex >= queue.length) reviewIndex = 0;
    const item = queue[reviewIndex];
    const meetingId = item.source_details && item.source_details.external_id;
    const sameMeeting = meetingId ? queue.filter(i => i.source_details && i.source_details.external_id === meetingId) : [item];
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-lg font-semibold">${escapeHtml(t('home.review.title'))} <span class="text-on-surface-variant font-normal">${escapeHtml(t('home.review.position', { n: reviewIndex + 1, total: overview.summary.to_review }))}</span></h2>
        <p class="text-sm text-on-surface-variant">${escapeHtml(t('home.review.subtitle'))}</p>
      </div>
      <div class="flex flex-col gap-2 rounded-lg bg-surface-container-low p-4">
        <span class="self-start px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">${escapeHtml(typeLabel(item.type))}</span>
        <p class="text-on-surface font-medium">${escapeHtml(item.text)}</p>
        ${item.rationale ? `<p class="text-sm text-on-surface-variant">${escapeHtml(t('home.review.why', { text: item.rationale }))}</p>` : ''}
        ${item.evidence_quote ? `<p class="text-sm italic text-on-surface-variant">“${escapeHtml(item.evidence_quote)}”</p>` : ''}
        <p class="text-xs text-on-surface-variant">${sourceLine(item.source_details, item.timestamp)}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" data-review="confirm" class="bg-primary text-on-primary rounded-lg py-2 px-4 text-sm font-semibold hover:bg-on-primary-fixed-variant disabled:opacity-50">${escapeHtml(t('review.confirm'))}</button>
        <button type="button" data-review="dismiss" class="border border-outline-variant rounded-lg py-2 px-4 text-sm font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-50">${escapeHtml(t('review.dismiss'))}</button>
        ${queue.length > 1 ? `<button type="button" data-review="skip" class="text-sm font-semibold text-on-surface-variant hover:underline px-2">${escapeHtml(t('review.skip'))}</button>` : ''}
        ${sameMeeting.length > 1 ? `<button type="button" data-review="meeting" class="ml-auto text-sm font-semibold text-primary hover:underline">${escapeHtml(t('home.review.confirmMeeting', { count: sameMeeting.length }))}</button>` : ''}
      </div>
      <p id="home-review-error" class="hidden text-sm text-error" role="alert"></p>`;

    el.querySelectorAll('[data-review]').forEach(button => button.addEventListener('click', () => review(button.dataset.review, item, sameMeeting, el)));
  }

  async function review(action, item, sameMeeting, el) {
    if (action === 'skip') {
      reviewIndex += 1;
      renderReview();
      return;
    }
    const error = el.querySelector('#home-review-error');
    el.querySelectorAll('[data-review]').forEach(button => { button.disabled = true; });
    try {
      if (action === 'confirm') {
        await request('POST', `/api/decisions/${item.id}/review`, { action: 'confirm' });
      } else if (action === 'meeting') {
        for (const outcome of sameMeeting) await request('POST', `/api/decisions/${outcome.id}/review`, { action: 'confirm' });
        toast(t('home.review.confirmedMeeting', { count: sameMeeting.length }));
      } else {
        await request('POST', `/api/decisions/${item.id}/review`, { action: 'dismiss' });
        toast(t('review.dismissed'), async () => {
          await request('POST', `/api/decisions/${item.id}/restore`);
          load();
        });
      }
      changed = true;
      await load();
    } catch (err) {
      error.textContent = err.message;
      error.classList.remove('hidden');
      el.querySelectorAll('[data-review]').forEach(button => { button.disabled = false; });
    }
  }

  // ---------- Ask across meetings ----------

  function setupAsk() {
    const form = document.getElementById('home-ask');
    if (!form) return;
    const input = form.querySelector('input');
    const button = form.querySelector('button');
    const result = document.getElementById('home-ask-result');

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const query = input.value.trim();
      if (!query) return;
      button.disabled = true;
      button.textContent = t('home.ask.searching');
      result.hidden = false;
      result.innerHTML = `<p class="text-sm text-on-surface-variant">${escapeHtml(t('home.ask.looking'))}</p>`;
      try {
        const space = spaceId || storedSpace();
        if (!space) throw new Error(t('home.ask.noSpace'));
        const data = await request('POST', '/api/semantic-search', { query, workspace_id: window.WORKSPACE_ID, space_id: space, conversational: true, limit: 8 });
        renderAnswer(query, data, result);
      } catch (error) {
        result.innerHTML = `<p class="text-sm text-error" role="alert">${escapeHtml(error.message)}</p>`;
      } finally {
        button.disabled = false;
        button.textContent = t('home.ask.button');
      }
    });
  }

  function renderAnswer(query, data, result) {
    const sources = Array.isArray(data.decisions) ? data.decisions : [];
    const usedIds = Array.isArray(data.used_ids) ? data.used_ids : sources.map(s => s.id);
    const used = usedIds.map(id => sources.find(s => s.id === id)).filter(Boolean).slice(0, 3);
    const pending = used.filter(s => s.capture === 'ai' && !s.review_status).length;
    result.innerHTML = `
      <div class="flex flex-col gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
        <p class="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">${escapeHtml(t('detail.answer'))}</p>
        <p class="text-on-surface" id="home-answer-text"></p>
        ${used.length ? `<p class="text-xs text-on-surface-variant">${escapeHtml(t('home.ask.basedOn', { count: used.length }))}${pending ? ` · ${escapeHtml(t('home.ask.notReviewed', { count: pending }))}` : ''}</p>
        <ul class="flex flex-col gap-2">${used.map(source => `
          <li><button type="button" data-source="${escapeHtml(source.id)}" class="w-full text-left rounded-lg bg-surface-container-low px-3 py-2 hover:bg-surface-container group">
            <span class="text-xs font-semibold text-primary">${escapeHtml(typeLabel(source.type))}</span>
            <span class="block text-sm text-on-surface group-hover:text-primary line-clamp-2">${escapeHtml(source.text)}</span>
            <span class="block text-xs text-on-surface-variant">${sourceLine(source.source_details, source.timestamp)}</span>
          </button></li>`).join('')}</ul>` : ''}
        <a href="/ai-search?q=${encodeURIComponent(query)}" class="self-start text-sm font-semibold text-primary hover:underline">${escapeHtml(t('home.ask.openInSearch'))}</a>
      </div>`;
    result.querySelector('#home-answer-text').textContent = data.response || t('home.ask.noAnswer');
    result.querySelectorAll('[data-source]').forEach(button => button.addEventListener('click', () => {
      const source = used.find(s => String(s.id) === button.dataset.source);
      if (source && typeof window.openDecision === 'function') window.openDecision(source);
    }));
  }

  function storedSpace() {
    try {
      const stored = localStorage.getItem('corteza_last_space_id');
      if (stored) return stored;
    } catch (e) { /* storage blocked */ }
    const boot = window.__CORTEZA_BOOTSTRAP__;
    return boot && Array.isArray(boot.spaces) && boot.spaces[0] ? boot.spaces[0].space_id : null;
  }

  // ---------- Tabs ----------

  let changed = false;
  function showTab(tab) {
    const all = tab === 'all';
    document.getElementById('home-overview').classList.toggle('hidden', all);
    document.getElementById('home-all').classList.toggle('hidden', !all);
    document.querySelectorAll('[role="tab"][data-home-tab]').forEach(button => {
      const selected = button.dataset.homeTab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle('bg-primary', selected);
      button.classList.toggle('text-on-primary', selected);
      button.classList.toggle('text-on-surface-variant', !selected);
    });
    if (all && changed && typeof window.fetchDecisions === 'function') {
      changed = false;
      window.fetchDecisions();
    }
    try { history.replaceState(null, '', all ? '#all' : location.pathname + location.search); } catch (e) { /* ignore */ }
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('[data-home-tab]');
    if (!link) return;
    event.preventDefault();
    showTab(link.dataset.homeTab);
    if (link.getAttribute('role') !== 'tab') window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ---------- Load ----------

  async function load() {
    try {
      overview = await request('GET', '/api/home');
      renderSummary();
      renderReview();
      renderOwe();
      renderOpen();
      renderDecided();
    } catch (error) {
      document.getElementById('home-summary').innerHTML = `<span class="text-error">${escapeHtml(error.message)}</span> <button type="button" id="home-retry" class="text-primary font-semibold hover:underline">Try again</button>`;
      const retry = document.getElementById('home-retry');
      if (retry) retry.addEventListener('click', load);
    }
  }

  window.CortezaHome = { reload: load };
  document.addEventListener('corteza:home-refresh', load);
  document.addEventListener('corteza:action-items-changed', load);
  document.addEventListener('corteza:decisions-loaded', event => { if (event.detail && event.detail.spaceId) spaceId = event.detail.spaceId; });

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('home-overview')) return;
    showTab(location.hash === '#all' ? 'all' : 'overview');
    setupAsk();
    load();
  });
})();
