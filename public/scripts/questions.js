/**
 * Open questions & risks page (/questions): what meetings left unresolved, with a way to
 * mark a question answered or a risk mitigated (with an optional note), and to reopen it.
 * API: src/http/questions-risks.js
 *
 * Topic threads (docs/specs/2026-10-topic-threads.md): each card lists the rest of its
 * thread under "Linked" (next steps, decisions that may answer it, other questions and
 * risks). With "All" types, a risk whose thread has an open question in the list is shown
 * inside that question's card. /questions?topic=<id> shows one thread. Answering a question
 * offers to close its thread's open risks (close-loop.js).
 */
(function() {
  'use strict';
  const t = window.t || (key => key); // public/scripts/i18n.js
  const locale = (window.CortezaI18n && window.CortezaI18n.locale) || undefined;

  const params = new URLSearchParams(window.location.search);
  const topicParam = params.get('topic');
  const state = {
    type: ['open_question', 'risk'].includes(params.get('type')) ? params.get('type') : 'all',
    status: topicParam ? 'all' : 'open',
    topic: topicParam && /^top_[0-9a-f]{1,32}$/.test(topicParam) ? topicParam : null
  };
  const OUTCOME_LABELS = { decision: t('types.short.decision'), open_question: t('types.short.open_question'), risk: t('types.short.risk') };
  const LABELS = {
    open_question: { name: t('types.open_question'), resolve: t('detail.markAnswered'), resolved: t('detail.answered'), resolvedBy: 'detail.answeredBy', note: t('loop.answerPlaceholder'), icon: 'contact_support', color: 'bg-surface-container text-on-surface' },
    risk: { name: t('types.risk'), resolve: t('detail.markMitigated'), resolved: t('detail.mitigated'), resolvedBy: 'detail.mitigatedBy', note: t('questions.mitigationPlaceholder'), icon: 'warning', color: 'bg-signal-wash text-signal-ink' }
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function formatDate(value) {
    const date = new Date(value);
    return isNaN(date) ? '' : date.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function age(value) {
    const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
    if (!(days >= 0)) return '';
    if (days === 0) return t('time.today');
    if (days === 1) return t('time.yesterday');
    return t('time.daysAgo', { count: days });
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
    if (item.timestamp) parts.push(escapeHtml(`${t('home.open.raised', { when: age(item.timestamp) })} (${formatDate(item.timestamp)})`));
    if (item.owner_name) parts.push(escapeHtml(t('outcomes.card.accountable', { name: item.owner_name })));
    return parts.length ? `<p class="text-xs text-on-surface-variant">${parts.join(' · ')}</p>` : '';
  }

  function formatDay(value) {
    const date = new Date(`${value}T00:00:00`);
    return isNaN(date) ? value : date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  }

  /** One linked action item: the next step, its owners, due date and status */
  function linkedActionHtml(action) {
    const done = action.status === 'done';
    const cancelled = action.status === 'cancelled';
    const overdue = action.status === 'open' && action.due_date && action.due_date < new Date().toISOString().slice(0, 10);
    const owners = (action.owners || []).map(owner => owner.name).filter(Boolean).join(', ');
    const meta = [
      owners || t('detail.noOwner'),
      action.due_date ? t(overdue ? 'due.overdueOn' : 'due.on', { date: formatDay(action.due_date) }).toLowerCase() : '',
      done ? t('actions.statusOne.done').toLowerCase() : cancelled ? t('actions.statusOne.cancelled').toLowerCase() : ''
    ].filter(Boolean).join(' · ');
    return `
      <li class="flex items-start gap-2">
        <span class="material-symbols-outlined text-base ${done ? 'text-success-ink' : 'text-on-surface-variant'}" aria-hidden="true">${done ? 'task_alt' : 'radio_button_unchecked'}</span>
        <span class="text-sm">
          <span class="text-xs font-semibold text-on-surface-variant">${escapeHtml(t('questions.nextStep'))}</span>
          <a href="/actions?item=${encodeURIComponent(action.item_id)}" class="text-on-surface hover:underline ${done || cancelled ? 'line-through text-on-surface-variant' : ''}">${escapeHtml(action.text)}</a>
          <span class="text-xs ${overdue ? 'text-error font-semibold' : 'text-on-surface-variant'}">(${escapeHtml(meta)})</span>
        </span>
      </li>`;
  }

  /** One linked outcome: a decision that may answer the question, or another question or risk */
  function linkedOutcomeHtml(outcome, parent) {
    const resolved = outcome.resolution_status === 'resolved';
    const label = outcome.type === 'decision' && parent.type === 'open_question'
      ? t('questions.mayAnswer')
      : (OUTCOME_LABELS[outcome.type] || t('detail.title'));
    const status = outcome.type === 'decision' || !resolved ? '' : ` (${t(outcome.type === 'risk' ? 'detail.mitigated' : 'detail.answered').toLowerCase()})`;
    return `
      <li class="flex items-start gap-2">
        <span class="material-symbols-outlined text-base text-on-surface-variant" aria-hidden="true">${outcome.type === 'decision' ? 'gavel' : outcome.type === 'risk' ? 'warning' : 'contact_support'}</span>
        <span class="text-sm">
          <span class="text-xs font-semibold text-on-surface-variant">${escapeHtml(label)}:</span>
          <span class="${resolved ? 'line-through text-on-surface-variant' : 'text-on-surface'}">${escapeHtml(outcome.text)}</span><span class="text-xs text-on-surface-variant">${status}</span>
        </span>
      </li>`;
  }

  /** "Linked": risks nested as cards, then decisions, other outcomes and next steps */
  function linkedHtml(item, nested) {
    const nestedIds = new Set(nested.map(risk => risk.id));
    const linked = item.linked || { outcomes: [], actions: [] };
    const outcomes = linked.outcomes.filter(outcome => !nestedIds.has(outcome.id))
      .sort((a, b) => (a.type === 'decision' ? 0 : 1) - (b.type === 'decision' ? 0 : 1));
    if (!nested.length && !outcomes.length && !linked.actions.length) return '';
    return `
      <div class="mt-1 border-t border-outline-variant pt-3 flex flex-col gap-2">
        <p class="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">${escapeHtml(t('actions.linked'))}${item.topic ? ` · <a href="/questions?topic=${encodeURIComponent(item.topic_id)}" class="normal-case text-primary hover:underline">${escapeHtml(item.topic)}</a>` : ''}</p>
        ${nested.map(risk => itemHtml(risk, [], true)).join('')}
        ${outcomes.length || linked.actions.length ? `<ul class="flex flex-col gap-1.5">${outcomes.map(outcome => linkedOutcomeHtml(outcome, item)).join('')}${linked.actions.map(linkedActionHtml).join('')}</ul>` : ''}
      </div>`;
  }

  /**
   * @param {Object} item
   * @param {Object[]} [nested] - risks shown inside this question's card
   * @param {boolean} [isNested] - this card is inside a question's card
   */
  function itemHtml(item, nested = [], isNested = false) {
    const label = LABELS[item.type] || LABELS.open_question;
    const resolved = item.resolution_status === 'resolved';
    const by = item.resolved_by && item.resolved_by.name;
    return `
      <div id="item-${escapeHtml(item.id)}" class="${isNested ? 'bg-surface-container-low rounded-lg p-3' : 'bg-surface-container-lowest border border-outline-variant rounded-xl p-4'} flex flex-col gap-2 ${resolved ? 'opacity-80' : ''}">
        <div class="flex flex-wrap items-center gap-2">
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${label.color}">
            <span class="material-symbols-outlined text-sm" aria-hidden="true">${label.icon}</span>${escapeHtml(label.name)}
          </span>
          ${item.sensitive && window.CortezaSensitive ? window.CortezaSensitive.chip() : ''}
          ${resolved ? `<span class="px-2 py-0.5 rounded-full bg-success-wash text-success-ink text-xs font-semibold">${escapeHtml(by ? t(label.resolvedBy, { name: by }) : label.resolved)}${item.resolved_at ? ` · ${escapeHtml(formatDate(item.resolved_at))}` : ''}</span>` : ''}
          ${item.capture === 'ai' && !item.review_status ? `<span class="text-xs text-on-surface-variant">${escapeHtml(t('questions.notReviewed'))}</span>` : ''}
        </div>
        <p class="text-on-surface font-medium ${resolved ? 'line-through text-on-surface-variant' : ''}">${escapeHtml(item.text)}</p>
        ${item.rationale ? `<p class="text-sm text-on-surface-variant">${escapeHtml(t('questions.whyMatters', { text: item.rationale }))}</p>` : ''}
        ${item.evidence_quote ? `<p class="text-xs italic text-on-surface-variant">“${escapeHtml(item.evidence_quote)}”</p>` : ''}
        ${sourceHtml(item)}
        ${resolved && item.resolution_note ? `<p class="text-sm text-on-surface bg-surface-container-low rounded-lg p-3">${escapeHtml(item.resolution_note)}</p>` : ''}
        <div class="flex flex-wrap items-center gap-2 mt-1" data-actions="${escapeHtml(item.id)}">
          ${resolved
            ? `<button type="button" class="reopen-btn text-sm font-semibold text-primary hover:underline" data-id="${escapeHtml(item.id)}">${escapeHtml(t('detail.reopen'))}</button>`
            : `<button type="button" class="resolve-btn border border-outline-variant rounded-lg py-1.5 px-3 text-sm font-semibold hover:bg-surface-container-low" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.type)}">${escapeHtml(label.resolve)}</button>`}
        </div>
        ${isNested ? '' : linkedHtml(item, nested)}
      </div>`;
  }

  /** With "All" types, a risk goes inside the card of an open question from its thread */
  function cardsHtml(items) {
    if (state.type !== 'all') return items.map(item => itemHtml(item)).join('');
    const questionByTopic = new Map();
    for (const item of items) {
      if (item.type === 'open_question' && item.topic_id && item.resolution_status !== 'resolved' && !questionByTopic.has(item.topic_id)) {
        questionByTopic.set(item.topic_id, item);
      }
    }
    const nestedIn = new Map();
    const shown = [];
    for (const item of items) {
      const host = item.type === 'risk' && item.topic_id ? questionByTopic.get(item.topic_id) : null;
      if (host) {
        if (!nestedIn.has(host.id)) nestedIn.set(host.id, []);
        nestedIn.get(host.id).push(item);
      } else {
        shown.push(item);
      }
    }
    return shown.map(item => itemHtml(item, nestedIn.get(item.id) || [])).join('');
  }

  function renderTopicBanner(topic) {
    const banner = document.getElementById('topic-banner');
    if (!banner) return;
    if (!state.topic) { banner.classList.add('hidden'); return; }
    banner.innerHTML = `${topic ? escapeHtml(t('questions.oneThreadNamed')).replace('{topic}', `<strong>${escapeHtml(topic)}</strong>`) : escapeHtml(t('questions.oneThread'))} <a href="/questions" class="text-primary font-semibold hover:underline">${escapeHtml(t('questions.showAll'))}</a>`;
    banner.classList.remove('hidden');
  }

  async function load() {
    renderFilters();
    const container = document.getElementById('items');
    const query = new URLSearchParams({ type: state.type, status: state.status });
    if (state.topic) query.set('topic', state.topic);
    try {
      const response = await fetch(`/api/questions-risks?${query}`, { credentials: 'include' });
      if (response.status === 401) {
        window.location.href = `/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('questions.loadFailed'));
      renderFilters(data.counts);
      renderTopicBanner(data.topic);
      const items = data.items;
      document.getElementById('items-count').textContent = t('questions.count', { count: items.length });
      container.innerHTML = items.length
        ? cardsHtml(items)
        : `<p class="text-on-surface-variant">${escapeHtml(t(state.status === 'open' ? 'questions.emptyOpen' : 'questions.emptyFilters'))}</p>`;
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
      <button type="button" class="resolve-save bg-primary text-on-primary rounded-lg py-1.5 px-3 text-sm font-semibold" data-id="${escapeHtml(id)}">${escapeHtml(label.resolve)}</button>
      <button type="button" class="resolve-cancel text-sm text-on-surface-variant hover:underline">${escapeHtml(t('common.cancel'))}</button>`;
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
    if (!response.ok) alert(data.error || t('common.couldNotSave'));
    // An answered question with open risks in its thread: offer to close them too
    if (response.ok && window.CortezaLoop) window.CortezaLoop.offerMitigate(data.linked_risks);
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

  document.addEventListener('DOMContentLoaded', () => {
    if (window.CortezaLoop) window.CortezaLoop.init(document.getElementById('loop-notice'), load);
    load();
  });
})();
