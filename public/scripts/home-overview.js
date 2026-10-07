/**
 * Home (docs/specs/2026-10-home-overview.md): close the loop.
 *
 * - #home-headline: the person's morning partner on where their day stands (same voice and
 *   line library as the morning summary; Classic: the plain counts)
 * - #home-tiles: what's open, one box each (my action items, open questions, open risks), each
 *   opening its page; overdue in orange, "All clear" in green when a box is at zero
 * - #home-ask: ask across meetings (semantic search, the same API as Search) and read the answer here
 * - #home-review: AI-captured outcomes to confirm, one at a time, with their quote, meeting and
 *   what they may close; "Confirm all from this meeting"; dismiss with undo
 * - Tabs: Overview (default) and All outcomes (the list in dashboard.js), remembered in the URL hash
 *
 * APIs: GET /api/home, POST /api/semantic-search, POST /api/decisions/:id/review, POST /api/decisions/:id/restore
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

  const shortDate = value => new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString(locale, { month: 'short', day: 'numeric' });

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

  // ---------- Headline ----------

  /** The page's main line, its last word in the brand's serif accent (design skill, typography) */
  function titleHtml(text) {
    const match = String(text).match(/^(.*\s)(\S+)$/);
    return match ? `${escapeHtml(match[1])}<em class="home-accent">${escapeHtml(match[2])}</em>` : escapeHtml(text);
  }

  /** Classic (no partner): the counts, plainly */
  function classicTitle(s) {
    if (s.overdue) return t('home.headline.overdue', { count: s.overdue });
    if (s.due_today) return t('home.headline.dueToday', { count: s.due_today });
    return t('home.headline.clear');
  }

  function renderHeadline() {
    const h = overview.headline || { voice: 'classic' };
    const s = overview.summary;
    const date = new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
    const eyebrow = document.getElementById('home-eyebrow');
    eyebrow.innerHTML = `<span>${escapeHtml(date.charAt(0).toUpperCase() + date.slice(1))}</span>${h.voice === 'sergeant' || h.voice === 'sarcastic'
      ? `<a href="/settings#digest" class="rounded-full border border-outline-variant bg-paper px-2.5 py-0.5 text-xs font-semibold text-graphite hover:border-on-surface" title="${escapeHtml(t('home.headline.changeVoice'))}">${escapeHtml(t(`settings.partner.${h.voice}`))}</a>`
      : ''}`;

    const title = document.getElementById('home-title');
    const follow = document.getElementById('home-follow');
    if (h.title) {
      title.innerHTML = titleHtml(h.title);
      follow.textContent = h.follow || '';
      if (h.item_id && h.follow) {
        // The line names one of the person's items: the sentence opens it
        follow.innerHTML = `<a href="/actions?item=${encodeURIComponent(h.item_id)}" class="text-on-surface underline decoration-signal underline-offset-4 hover:decoration-2">${escapeHtml(h.follow)}</a>`;
      }
    } else {
      title.innerHTML = titleHtml(classicTitle(s));
      follow.textContent = s.to_review ? t('home.headline.toReview', { count: s.to_review }) : '';
    }
    follow.hidden = !follow.textContent;
  }

  // ---------- What's open: one box per kind, each opens its page ----------

  function tile({ href, label, icon, count, note, tone, alert }) {
    const noteClass = { alert: 'text-error font-semibold', ok: 'text-success-ink font-semibold', muted: 'text-on-surface-variant' }[tone];
    return `
      <a href="${href}" class="home-tile group relative flex md:flex-col items-center md:items-stretch gap-3 md:gap-1.5 rounded-xl border ${alert ? 'border-signal' : 'border-outline-variant'} bg-surface-container-lowest p-4 md:p-5 hover:border-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal">
        <span class="text-3xl md:text-4xl font-extrabold tracking-tight text-on-surface min-w-[2.5rem] md:order-2">${escapeHtml(count)}</span>
        <span class="flex-1 flex flex-col md:contents min-w-0">
          <span class="flex items-center justify-between gap-2 text-sm font-semibold text-on-surface-variant md:order-1">${escapeHtml(label)}<span class="material-symbols-outlined text-xl hidden md:inline" style="font-variation-settings: 'FILL' 0" aria-hidden="true">${icon}</span></span>
          <span class="text-sm ${noteClass} md:order-3">${escapeHtml(note)}</span>
        </span>
        <span class="material-symbols-outlined text-xl text-on-surface md:absolute md:right-4 md:bottom-4 transition-transform group-hover:translate-x-0.5" style="font-variation-settings: 'FILL' 0" aria-hidden="true">arrow_forward</span>
      </a>`;
  }

  function renderTiles() {
    const s = overview.summary;
    const owed = s.open_action_items;
    const actionNote = s.overdue
      ? [t('home.tiles.overdue', { count: s.overdue }), s.due_today ? t('home.tiles.dueToday', { count: s.due_today }) : ''].filter(Boolean).join(' · ')
      : s.due_today ? t('home.tiles.dueToday', { count: s.due_today }) : owed ? t('home.tiles.nothingOverdue') : t('home.tiles.clear');
    const questionNote = s.new_questions ? t('home.tiles.newQuestions', { count: s.new_questions }) : s.open_questions ? t('home.tiles.waitingAnswer') : t('home.tiles.clear');
    const riskNote = s.new_risks ? t('home.tiles.newRisks', { count: s.new_risks }) : s.open_risks ? t('home.tiles.toMitigate') : t('home.tiles.clear');
    document.getElementById('home-tiles').innerHTML = [
      tile({ href: s.overdue ? '/actions?due=overdue' : '/actions', label: t('home.tiles.actions'), icon: 'task_alt', count: owed, note: actionNote, tone: s.overdue ? 'alert' : owed ? 'muted' : 'ok', alert: s.overdue > 0 }),
      tile({ href: '/questions?type=open_question', label: t('home.tiles.questions'), icon: 'contact_support', count: s.open_questions, note: questionNote, tone: s.open_questions ? 'muted' : 'ok' }),
      tile({ href: '/questions?type=risk', label: t('home.tiles.risks'), icon: 'warning', count: s.open_risks, note: riskNote, tone: s.open_risks ? 'muted' : 'ok' })
    ].join('');
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
      </div>
      <div class="flex flex-col gap-2 rounded-lg bg-surface-container-low p-4">
        <span class="self-start px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">${escapeHtml(typeLabel(item.type))}</span>
        <p class="text-on-surface font-medium">${escapeHtml(item.text)}</p>
        ${item.rationale ? `<p class="text-sm text-on-surface-variant">${escapeHtml(t('home.review.why', { text: item.rationale }))}</p>` : ''}
        ${item.evidence_quote ? `<p class="text-sm italic text-on-surface-variant">“${escapeHtml(item.evidence_quote)}”</p>` : ''}
        <p class="text-xs text-on-surface-variant">${sourceLine(item.source_details, item.timestamp)}</p>
      </div>
      ${item.may_close && item.may_close.length && window.CortezaMayClose ? `<div data-may-close data-decision-id="${escapeHtml(item.id)}">${window.CortezaMayClose.render(item.may_close)}</div>` : ''}
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" data-review="confirm" class="bg-primary text-on-primary rounded-lg py-2 px-4 text-sm font-semibold hover:bg-on-primary-fixed-variant disabled:opacity-50">${escapeHtml(t('review.confirm'))}</button>
        <button type="button" data-review="dismiss" class="border border-outline-variant rounded-lg py-2 px-4 text-sm font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-50">${escapeHtml(t('review.dismiss'))}</button>
        <button type="button" data-review="edit" class="border border-outline-variant rounded-lg py-2 px-4 text-sm font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-50">${escapeHtml(t('common.edit'))}</button>
        ${queue.length > 1 ? `<button type="button" data-review="skip" class="text-sm font-semibold text-on-surface-variant hover:underline px-2">${escapeHtml(t('review.skip'))}</button>` : ''}
        ${sameMeeting.length > 1 ? `<button type="button" data-review="meeting" class="ml-auto text-sm font-semibold text-primary hover:underline">${escapeHtml(t('home.review.confirmMeeting', { count: sameMeeting.length }))}</button>` : ''}
      </div>
      <p id="home-review-error" class="hidden text-sm text-error" role="alert"></p>`;

    el.querySelectorAll('[data-review]').forEach(button => button.addEventListener('click', () => review(button.dataset.review, item, sameMeeting, el)));
  }

  async function review(action, item, sameMeeting, el) {
    // Edit: the detail modal, where every field is click-to-edit (Home reloads when it closes)
    if (action === 'edit') {
      if (typeof window.openDecision === 'function') window.openDecision(item);
      return;
    }
    if (action === 'skip') {
      reviewIndex += 1;
      renderReview();
      return;
    }
    const error = el.querySelector('#home-review-error');
    el.querySelectorAll('[data-review]').forEach(button => { button.disabled = true; });
    try {
      if (action === 'confirm') {
        // And the checked earlier items it may close (cross-meeting links)
        const close = window.CortezaMayClose ? window.CortezaMayClose.checked(el.querySelector('[data-may-close]'), item.id) : [];
        const data = await request('POST', `/api/decisions/${item.id}/review`, { action: 'confirm', close });
        if (data.closed && data.closed.length) window.CortezaMayClose.showClosed(item.id, data.closed, 'links.confirmedClosed');
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
      renderHeadline();
      renderTiles();
      renderReview();
    } catch (error) {
      document.getElementById('home-follow').hidden = false;
      document.getElementById('home-follow').innerHTML = `<span class="text-error">${escapeHtml(error.message)}</span> <button type="button" id="home-retry" class="text-on-surface font-semibold underline">${escapeHtml(t('common.tryAgainButton'))}</button>`;
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
