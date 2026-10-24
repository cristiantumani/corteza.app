/**
 * Open questions & risks page (/questions): what meetings left unresolved, with a way to
 * mark a question answered or a risk mitigated (with an optional note), and to reopen it.
 * API: src/http/questions-risks.js, src/http/threads.js
 *
 * Topic threads (docs/specs/2026-10-topic-threads.md, docs/specs/2026-10-thread-as-unit.md):
 *   - each open card says where it stands ("Open 12 days · next step: Ana, due Oct 16", or
 *     "No next step" with "Add a next step"), computed by the server (`status`);
 *   - each card lists the rest of its thread under "In this thread · <topic>" (next steps,
 *     decisions that may answer it, other questions and risks); a decision there can be used
 *     as the answer; anything there can be marked "Not related" (with Undo);
 *   - with "All" types, a risk whose thread has an open question in the list is shown inside
 *     that question's card;
 *   - /questions?topic=<id> is the thread view: its state, and every item grouped by meeting;
 *   - /questions?item=<id> shows that one card (links from Prepare your day and the morning email).
 * Answering a question offers to close its thread's open risks (close-loop.js).
 */
(function() {
  'use strict';
  const t = window.t || (key => key); // public/scripts/i18n.js
  const locale = (window.CortezaI18n && window.CortezaI18n.locale) || undefined;

  const params = new URLSearchParams(window.location.search);
  const topicParam = params.get('topic');
  const itemParam = Number(params.get('item'));
  const state = {
    type: ['open_question', 'risk'].includes(params.get('type')) ? params.get('type') : 'all',
    status: topicParam ? 'all' : 'open',
    topic: topicParam && /^top_[0-9a-f]{1,32}$/.test(topicParam) ? topicParam : null,
    item: Number.isInteger(itemParam) && itemParam > 0 ? itemParam : null
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

  const today = () => new Date().toISOString().slice(0, 10);
  const QUESTION_TYPES = ['open_question', 'risk'];

  /** "Not related" in a small menu, for whoever can edit the item */
  function menuHtml(kind, id, topicId) {
    if (!topicId) return '';
    return `
      <details class="thread-menu relative shrink-0 ml-auto">
        <summary class="list-none cursor-pointer rounded-full p-0.5 text-on-surface-variant hover:bg-surface-container" aria-label="${escapeHtml(t('threads.moreActions'))}" title="${escapeHtml(t('threads.moreActions'))}">
          <span class="material-symbols-outlined text-base align-middle" aria-hidden="true">more_horiz</span>
        </summary>
        <div class="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-lg border border-outline-variant bg-surface-container-lowest py-1 shadow-lg">
          <button type="button" class="unlink-btn flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-on-surface hover:bg-surface-container-low"
            data-kind="${escapeHtml(kind)}" data-id="${escapeHtml(id)}" data-topic="${escapeHtml(topicId)}">
            <span class="material-symbols-outlined text-base" aria-hidden="true">link_off</span>${escapeHtml(t('threads.notRelated'))}
          </button>
        </div>
      </details>`;
  }

  /**
   * Where an open question or risk stands: "Open 12 days · next step: Ana, due Oct 16",
   * or "No next step" with "Add a next step"
   */
  function statusLineHtml(item) {
    const status = item.status;
    if (!status) return '';
    const parts = [];
    if (status.age_days !== null && status.age_days !== undefined) {
      parts.push(escapeHtml(status.age_days === 0 ? t('threads.openToday') : t('threads.openFor', { count: status.age_days })));
    }
    let add = '';
    const step = status.next_step;
    if (step) {
      const owner = step.mine ? t('threads.you') : (step.owner || t('threads.noOwner'));
      if (!step.due_date) parts.push(escapeHtml(t('threads.nextStepNoDate', { owner })));
      else if (step.overdue) parts.push(`<span class="font-semibold text-error">${escapeHtml(t('threads.nextStepOverdue', { owner, date: formatDay(step.due_date) }))}</span>`);
      else parts.push(escapeHtml(t('threads.nextStep', { owner, date: formatDay(step.due_date) })));
    } else if (status.in_thread) {
      parts.push(`<span class="font-semibold text-signal-ink">${escapeHtml(t('threads.noNextStep'))}</span>`);
      add = `<button type="button" class="add-step-btn text-xs font-semibold text-on-surface underline hover:no-underline" data-id="${escapeHtml(item.id)}">${escapeHtml(t('threads.addNextStep'))}</button>`;
    }
    if (status.may_answer > 0) {
      parts.push(escapeHtml(t(item.type === 'risk' ? 'threads.mayMitigate' : 'threads.mayAnswer', { count: status.may_answer })));
    }
    if (!parts.length) return '';
    return `
      <div class="status-line flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-on-surface-variant" data-status-for="${escapeHtml(item.id)}">
        <span>${parts.join(' · ')}</span>${add}
      </div>`;
  }

  /** "Answered by: <decision>", linking to the decision in its thread */
  function answeredByHtml(item, decisions) {
    if (!item.answered_by) return '';
    const decision = (decisions || []).find(outcome => outcome.id === item.answered_by);
    if (!decision) return '';
    const key = item.type === 'risk' ? 'threads.mitigatedByDecision' : 'threads.answeredByDecision';
    const href = item.topic_id ? `/questions?topic=${encodeURIComponent(item.topic_id)}#outcome-${encodeURIComponent(decision.id)}` : `#outcome-${encodeURIComponent(decision.id)}`;
    return `<p class="text-sm text-on-surface"><span class="material-symbols-outlined text-base align-middle text-success-ink" aria-hidden="true">gavel</span>
      <a href="${href}" class="hover:underline">${escapeHtml(t(key, { text: decision.text }))}</a></p>`;
  }

  /** "Use as answer" / "Use as mitigation": a decision of the thread closes the question or risk */
  function useAsAnswerHtml(question, decision) {
    return `<button type="button" class="use-answer-btn ml-1 rounded-lg border border-outline-variant px-2 py-0.5 text-xs font-semibold text-on-surface hover:bg-surface-container-low"
      data-question="${escapeHtml(question.id)}" data-decision="${escapeHtml(decision.id)}" data-type="${escapeHtml(question.type)}">${escapeHtml(t(question.type === 'risk' ? 'threads.useAsMitigation' : 'threads.useAsAnswer'))}</button>`;
  }

  /** One linked action item: the next step, its owners, due date and status */
  function linkedActionHtml(action, topicId) {
    const done = action.status === 'done';
    const cancelled = action.status === 'cancelled';
    const overdue = action.status === 'open' && action.due_date && action.due_date < today();
    const owners = (action.owners || []).map(owner => owner.name).filter(Boolean).join(', ');
    const meta = [
      owners || t('detail.noOwner'),
      action.due_date ? t(overdue ? 'due.overdueOn' : 'due.on', { date: formatDay(action.due_date) }).toLowerCase() : '',
      done ? t('actions.statusOne.done').toLowerCase() : cancelled ? t('actions.statusOne.cancelled').toLowerCase() : ''
    ].filter(Boolean).join(' · ');
    return `
      <li class="flex items-start gap-2">
        <span class="material-symbols-outlined text-base ${done ? 'text-success-ink' : 'text-on-surface-variant'}" aria-hidden="true">${done ? 'task_alt' : 'radio_button_unchecked'}</span>
        <span class="text-sm min-w-0">
          <span class="text-xs font-semibold text-on-surface-variant">${escapeHtml(t('questions.nextStep'))}</span>
          <a href="/actions?item=${encodeURIComponent(action.item_id)}" class="text-on-surface hover:underline ${done || cancelled ? 'line-through text-on-surface-variant' : ''}">${escapeHtml(action.text)}</a>
          <span class="text-xs ${overdue ? 'text-error font-semibold' : 'text-on-surface-variant'}">(${escapeHtml(meta)})</span>
        </span>
        ${action.can_edit ? menuHtml('action_item', action.item_id, topicId) : ''}
      </li>`;
  }

  /** One linked outcome: a decision that may answer the question, or another question or risk */
  function linkedOutcomeHtml(outcome, parent) {
    const resolved = outcome.resolution_status === 'resolved';
    const parentOpen = QUESTION_TYPES.includes(parent.type) && parent.resolution_status !== 'resolved';
    const label = outcome.type === 'decision' && parent.type === 'open_question'
      ? t('questions.mayAnswer')
      : (OUTCOME_LABELS[outcome.type] || t('detail.title'));
    const status = outcome.type === 'decision' || !resolved ? '' : ` (${t(outcome.type === 'risk' ? 'detail.mitigated' : 'detail.answered').toLowerCase()})`;
    return `
      <li id="outcome-${escapeHtml(outcome.id)}" class="flex items-start gap-2">
        <span class="material-symbols-outlined text-base text-on-surface-variant" aria-hidden="true">${outcome.type === 'decision' ? 'gavel' : outcome.type === 'risk' ? 'warning' : 'contact_support'}</span>
        <span class="text-sm min-w-0">
          <span class="text-xs font-semibold text-on-surface-variant">${escapeHtml(label)}:</span>
          <span class="${resolved ? 'line-through text-on-surface-variant' : 'text-on-surface'}">${escapeHtml(outcome.text)}</span><span class="text-xs text-on-surface-variant">${status}</span>
          ${outcome.type === 'decision' && parentOpen ? useAsAnswerHtml(parent, outcome) : ''}
        </span>
        ${outcome.can_edit ? menuHtml('decision', outcome.id, parent.topic_id) : ''}
      </li>`;
  }

  /** "In this thread · <topic>": risks nested as cards, then decisions, other outcomes and next steps */
  function linkedHtml(item, nested) {
    const nestedIds = new Set(nested.map(risk => risk.id));
    const linked = item.linked || { outcomes: [], actions: [] };
    const outcomes = linked.outcomes.filter(outcome => !nestedIds.has(outcome.id))
      .sort((a, b) => (a.type === 'decision' ? 0 : 1) - (b.type === 'decision' ? 0 : 1));
    if (!nested.length && !outcomes.length && !linked.actions.length) return '';
    const heading = escapeHtml(t('threads.inThread'));
    return `
      <div class="mt-1 border-t border-outline-variant pt-3 flex flex-col gap-2">
        <p class="text-sm font-semibold text-on-surface">${item.topic_id
          ? `<a href="/questions?topic=${encodeURIComponent(item.topic_id)}" class="hover:underline">${heading}${item.topic ? ` · ${escapeHtml(item.topic)}` : ''}</a>`
          : heading}</p>
        ${nested.map(risk => itemHtml(risk, [], true)).join('')}
        ${outcomes.length || linked.actions.length ? `<ul class="flex flex-col gap-1.5">${outcomes.map(outcome => linkedOutcomeHtml(outcome, item)).join('')}${linked.actions.map(action => linkedActionHtml(action, item.topic_id)).join('')}</ul>` : ''}
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
    const answeredBy = answeredByHtml(item, (item.linked && item.linked.outcomes) || []);
    return `
      <div id="item-${escapeHtml(item.id)}" class="${isNested ? 'bg-surface-container-low rounded-lg p-3' : 'bg-surface-container-lowest border border-outline-variant rounded-xl p-4'} flex flex-col gap-2 ${resolved ? 'opacity-80' : ''}">
        <div class="flex flex-wrap items-center gap-2">
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${label.color}">
            <span class="material-symbols-outlined text-sm" aria-hidden="true">${label.icon}</span>${escapeHtml(label.name)}
          </span>
          ${item.sensitive && window.CortezaSensitive ? window.CortezaSensitive.chip() : ''}
          ${resolved ? `<span class="px-2 py-0.5 rounded-full bg-success-wash text-success-ink text-xs font-semibold">${escapeHtml(by ? t(label.resolvedBy, { name: by }) : label.resolved)}${item.resolved_at ? ` · ${escapeHtml(formatDate(item.resolved_at))}` : ''}</span>` : ''}
          ${item.changed_via && item.changed_via.client_name ? `<span class="text-xs text-on-surface-variant">${escapeHtml(t('mcp.via', { client: item.changed_via.client_name }))}</span>` : ''}
          ${item.capture === 'ai' && !item.review_status ? `<span class="text-xs text-on-surface-variant">${escapeHtml(t('questions.notReviewed'))}</span>` : ''}
          ${item.can_edit ? menuHtml('decision', item.id, item.topic_id) : ''}
        </div>
        <p class="text-on-surface font-medium ${resolved ? 'line-through text-on-surface-variant' : ''}">${escapeHtml(item.text)}</p>
        ${resolved ? '' : statusLineHtml(item)}
        ${item.rationale ? `<p class="text-sm text-on-surface-variant">${escapeHtml(t('questions.whyMatters', { text: item.rationale }))}</p>` : ''}
        ${sourceHtml(item)}
        ${resolved ? answeredBy : ''}
        ${resolved && item.resolution_note && !answeredBy ? `<p class="text-sm text-on-surface bg-surface-container-low rounded-lg p-3">${escapeHtml(item.resolution_note)}</p>` : ''}
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

  // ---- Thread view (/questions?topic=<id>) ----

  /** "2 open questions · 1 risk · 3 next steps (1 overdue) · last activity Oct 7", or "All settled · …" */
  function summaryText(summary) {
    const parts = [];
    if (summary.open_questions) parts.push(t('threads.summary.openQuestions', { count: summary.open_questions }));
    if (summary.risks) parts.push(t('threads.summary.risks', { count: summary.risks }));
    if (summary.next_steps) {
      parts.push(t('threads.summary.nextSteps', { count: summary.next_steps })
        + (summary.overdue ? ` (${t('threads.summary.overdue', { count: summary.overdue })})` : ''));
    }
    if (!summary.open_questions && !summary.risks && !summary.next_steps) parts.push(t('threads.summary.allSettled'));
    if (summary.last_activity) parts.push(t('threads.summary.lastActivity', { date: formatDate(summary.last_activity) }));
    return parts.join(' · ');
  }

  const ITEM_ICONS = { decision: 'gavel', open_question: 'contact_support', risk: 'warning', action_item: 'task_alt' };

  /** Status chip of a thread item: open / answered / mitigated / done / cancelled */
  function threadStatusChip(item) {
    let key = 'threads.open';
    let done = false;
    if (item.type === 'action_item') {
      if (item.status === 'done') { key = 'actions.statusOne.done'; done = true; }
      if (item.status === 'cancelled') { key = 'actions.statusOne.cancelled'; done = true; }
    } else if (QUESTION_TYPES.includes(item.type)) {
      if (item.resolution_status === 'resolved') { key = item.type === 'risk' ? 'detail.mitigated' : 'detail.answered'; done = true; }
    } else {
      return '';
    }
    return `<span class="px-2 py-0.5 rounded-full text-xs font-semibold ${done ? 'bg-success-wash text-success-ink' : 'bg-surface-container text-on-surface'}">${escapeHtml(t(key))}</span>`;
  }

  /** "Use as answer" on a decision row: one button for one open question or risk, a menu for several */
  function threadUseAsAnswerHtml(decision, openTargets) {
    if (!openTargets.length) return '';
    if (openTargets.length === 1) return useAsAnswerHtml(openTargets[0], decision);
    return `
      <details class="thread-menu relative inline-block ml-1">
        <summary class="list-none cursor-pointer inline-flex rounded-lg border border-outline-variant px-2 py-0.5 text-xs font-semibold text-on-surface hover:bg-surface-container-low">${escapeHtml(t('threads.useAsAnswer'))}…</summary>
        <div class="absolute left-0 z-20 mt-1 w-72 max-w-[80vw] rounded-lg border border-outline-variant bg-surface-container-lowest py-1 shadow-lg">
          ${openTargets.map(target => `
            <button type="button" class="use-answer-btn block w-full px-3 py-1.5 text-left text-sm text-on-surface hover:bg-surface-container-low"
              data-question="${escapeHtml(target.id)}" data-decision="${escapeHtml(decision.id)}" data-type="${escapeHtml(target.type)}">
              <span class="text-xs font-semibold text-on-surface-variant">${escapeHtml(OUTCOME_LABELS[target.type])}</span> ${escapeHtml(target.text)}
            </button>`).join('')}
        </div>
      </details>`;
  }

  function threadItemHtml(item, view, openTargets) {
    const isAction = item.type === 'action_item';
    const isQuestion = QUESTION_TYPES.includes(item.type);
    const resolved = isQuestion ? item.resolution_status === 'resolved' : isAction && item.status !== 'open';
    const label = isAction ? t('types.short.action_item') : OUTCOME_LABELS[item.type] || t('detail.title');
    const owners = isAction ? (item.owners || []).map(owner => owner.name).filter(Boolean).join(', ') : item.owner_name;
    const overdue = isAction && item.status === 'open' && item.due_date && item.due_date < today();
    const meta = [
      owners || (isAction ? t('detail.noOwner') : ''),
      isAction && item.due_date ? t(overdue ? 'due.overdueOn' : 'due.on', { date: formatDay(item.due_date) }) : ''
    ].filter(Boolean);
    const decisions = view.meetings.flatMap(group => group.items).filter(other => other.type === 'decision');
    const answeredBy = isQuestion && resolved ? answeredByHtml({ ...item, topic_id: view.topic_id }, decisions) : '';
    let actions = '';
    if (isQuestion) {
      const labels = LABELS[item.type];
      actions = resolved
        ? `<button type="button" class="reopen-btn text-sm font-semibold text-primary hover:underline" data-id="${escapeHtml(item.id)}">${escapeHtml(t('detail.reopen'))}</button>`
        : `<button type="button" class="resolve-btn border border-outline-variant rounded-lg py-1 px-3 text-sm font-semibold hover:bg-surface-container-low" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.type)}">${escapeHtml(labels.resolve)}</button>`;
    } else if (isAction && item.can_edit) {
      actions = item.status === 'open'
        ? `<button type="button" class="action-status-btn border border-outline-variant rounded-lg py-1 px-3 text-sm font-semibold hover:bg-surface-container-low" data-item="${escapeHtml(item.item_id)}" data-status="done">${escapeHtml(t('threads.markDone'))}</button>`
        : `<button type="button" class="action-status-btn text-sm font-semibold text-primary hover:underline" data-item="${escapeHtml(item.item_id)}" data-status="open">${escapeHtml(t('detail.reopen'))}</button>`;
    }
    const anchor = isAction ? `action-${item.item_id}` : `outcome-${item.id}`;
    return `
      <li id="${escapeHtml(anchor)}" class="flex flex-col gap-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest p-3 ${resolved ? 'opacity-80' : ''}">
        <div class="flex flex-wrap items-center gap-2">
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${item.type === 'risk' ? 'bg-signal-wash text-signal-ink' : 'bg-surface-container text-on-surface'}">
            <span class="material-symbols-outlined text-sm" aria-hidden="true">${ITEM_ICONS[item.type] || 'notes'}</span>${escapeHtml(label)}
          </span>
          ${threadStatusChip(item)}
          ${item.sensitive && window.CortezaSensitive ? window.CortezaSensitive.chip() : ''}
          ${item.can_edit ? menuHtml(isAction ? 'action_item' : 'decision', isAction ? item.item_id : item.id, view.topic_id) : ''}
        </div>
        <p class="text-sm text-on-surface break-words ${resolved ? 'line-through text-on-surface-variant' : ''}">${isAction
          ? `<a href="/actions?item=${encodeURIComponent(item.item_id)}" class="hover:underline">${escapeHtml(item.text)}</a>`
          : escapeHtml(item.text)}${item.type === 'decision' ? threadUseAsAnswerHtml(item, openTargets) : ''}</p>
        ${meta.length ? `<p class="text-xs ${overdue ? 'text-error font-semibold' : 'text-on-surface-variant'}">${escapeHtml(meta.join(' · '))}</p>` : ''}
        ${isQuestion && !resolved ? statusLineHtml(item) : ''}
        ${answeredBy}
        ${isQuestion && resolved && item.resolution_note && !answeredBy ? `<p class="text-sm text-on-surface bg-surface-container-low rounded-lg p-2">${escapeHtml(item.resolution_note)}</p>` : ''}
        ${actions ? `<div class="flex flex-wrap items-center gap-2" data-actions="${escapeHtml(isAction ? item.item_id : item.id)}">${actions}</div>` : ''}
      </li>`;
  }

  function meetingHeading(group) {
    const date = group.date ? formatDate(group.date) : '';
    return [group.title || t('threads.byHand'), date].filter(Boolean).join(' · ');
  }

  function threadHtml(view) {
    const all = view.meetings.flatMap(group => group.items);
    const openTargets = all.filter(item => QUESTION_TYPES.includes(item.type) && item.resolution_status !== 'resolved');
    return `
      <section class="flex flex-col gap-1 mb-2">
        <a href="/questions" class="inline-flex items-center gap-1 self-start text-sm font-semibold text-on-surface-variant hover:underline">
          <span class="material-symbols-outlined text-base" aria-hidden="true">arrow_back</span>${escapeHtml(t('threads.back'))}
        </a>
        <p class="text-xs font-semibold text-on-surface-variant mt-2">${escapeHtml(t('threads.label'))}</p>
        <h3 class="text-xl font-bold text-on-surface break-words">${escapeHtml(view.topic || t('threads.label'))}</h3>
        <p class="text-sm text-on-surface-variant">${escapeHtml(summaryText(view.summary))}</p>
      </section>
      <ol class="flex flex-col gap-5">
        ${view.meetings.map(group => `
          <li class="flex flex-col gap-2">
            <h4 class="flex items-center gap-2 text-sm font-semibold text-on-surface">
              <span class="material-symbols-outlined text-base text-on-surface-variant" aria-hidden="true">${group.title ? 'videocam' : 'edit_note'}</span>${escapeHtml(meetingHeading(group))}
            </h4>
            <ul class="flex flex-col gap-2 border-l-2 border-outline-variant pl-3 ml-2">
              ${group.items.map(item => threadItemHtml(item, view, openTargets)).join('')}
            </ul>
          </li>`).join('')}
      </ol>`;
  }

  function setListChrome(visible) {
    ['questions-intro', 'list-controls'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', !visible);
    });
  }

  async function loadThread(container) {
    setListChrome(false);
    try {
      const response = await fetch(`/api/threads/${encodeURIComponent(state.topic)}`, { credentials: 'include' });
      if (response.status === 401) {
        window.location.href = `/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      if (response.status === 404) {
        container.innerHTML = `<p class="text-on-surface-variant">${escapeHtml(t('threads.notFound'))}</p>
          <a href="/questions" class="text-primary font-semibold hover:underline">${escapeHtml(t('threads.back'))}</a>`;
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('threads.loadFailed'));
      document.title = `${data.topic || t('threads.label')} · Corteza`;
      container.innerHTML = threadHtml(data);
      if (window.location.hash) {
        const target = document.getElementById(window.location.hash.slice(1));
        if (target) target.scrollIntoView({ block: 'center' });
      }
    } catch (error) {
      container.innerHTML = `<p class="text-error">${escapeHtml(error.message)}</p>`;
    }
  }

  /** One question or risk on its own, with its thread; falls back to the list when it isn't visible */
  async function loadItem(container) {
    setListChrome(false);
    try {
      const response = await fetch('/api/questions-risks?type=all&status=all', { credentials: 'include' });
      if (response.status === 401) {
        window.location.href = `/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('questions.loadFailed'));
      const item = (data.items || []).find(entry => entry.id === state.item);
      if (!item) {
        state.item = null;
        return load();
      }
      container.innerHTML = `
        <a href="/questions" class="inline-flex items-center gap-1 self-start text-sm font-semibold text-on-surface-variant hover:underline">
          <span class="material-symbols-outlined text-base" aria-hidden="true">arrow_back</span>${escapeHtml(t('threads.back'))}
        </a>
        ${itemHtml(item)}`;
    } catch (error) {
      container.innerHTML = `<p class="text-error">${escapeHtml(error.message)}</p>`;
    }
  }

  async function load() {
    const container = document.getElementById('items');
    if (state.topic) return loadThread(container);
    if (state.item) return loadItem(container);
    setListChrome(true);
    renderFilters();
    const query = new URLSearchParams({ type: state.type, status: state.status });
    try {
      const response = await fetch(`/api/questions-risks?${query}`, { credentials: 'include' });
      if (response.status === 401) {
        window.location.href = `/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('questions.loadFailed'));
      renderFilters(data.counts);
      const items = data.items;
      document.getElementById('items-count').textContent = t('questions.count', { count: items.length });
      container.innerHTML = items.length
        ? cardsHtml(items)
        : `<p class="text-on-surface-variant">${escapeHtml(t(state.status === 'open' ? 'questions.emptyOpen' : 'questions.emptyFilters'))}</p>`;
    } catch (error) {
      container.innerHTML = `<p class="text-error">${escapeHtml(error.message)}</p>`;
    }
  }

  // ---- Actions ----

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

  /** Inline form under the status line: the next step, as an action item linked to the question */
  function showAddStepForm(id) {
    const line = document.querySelector(`[data-status-for="${CSS.escape(String(id))}"]`);
    if (!line || line.nextElementSibling?.classList.contains('add-step-form')) return;
    line.insertAdjacentHTML('afterend', `
      <form class="add-step-form flex flex-wrap items-center gap-2" data-id="${escapeHtml(id)}">
        <input type="text" class="add-step-text min-w-0 flex-1 bg-surface-container-low border border-outline-variant rounded-lg py-1.5 px-2 text-sm" maxlength="500"
          placeholder="${escapeHtml(t('threads.nextStepPlaceholder'))}" aria-label="${escapeHtml(t('threads.addNextStep'))}" required>
        <button type="submit" class="bg-primary text-on-primary rounded-lg py-1.5 px-3 text-sm font-semibold">${escapeHtml(t('threads.add'))}</button>
        <button type="button" class="add-step-cancel text-sm text-on-surface-variant hover:underline">${escapeHtml(t('common.cancel'))}</button>
      </form>`);
    line.nextElementSibling.querySelector('input').focus();
  }

  async function request(method, path, body) {
    const response = await fetch(path, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, data };
  }

  async function post(path, body) {
    const { ok, data } = await request('POST', path, body);
    if (!ok) alert(data.error || t('common.couldNotSave'));
    // An answered question with open risks in its thread: offer to close them too
    if (ok && window.CortezaLoop) window.CortezaLoop.offerMitigate(data.linked_risks);
    return load();
  }

  let toastTimer = null;
  /** "Taken out of this thread · Undo" */
  function showToast(message, undo) {
    clearTimeout(toastTimer);
    const old = document.getElementById('questions-toast');
    if (old) old.remove();
    const box = document.createElement('div');
    box.id = 'questions-toast';
    box.setAttribute('role', 'status');
    box.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 rounded-lg bg-inverse-surface text-inverse-on-surface px-4 py-3 text-sm shadow-lg';
    box.innerHTML = `<span>${escapeHtml(message)}</span>${undo ? `<button type="button" class="font-semibold text-inverse-primary hover:underline">${escapeHtml(t('common.undo'))}</button>` : ''}`;
    if (undo) {
      box.querySelector('button').addEventListener('click', async () => {
        box.remove();
        await undo();
        load();
      });
    }
    document.body.appendChild(box);
    toastTimer = setTimeout(() => box.remove(), 8000);
  }

  async function useAsAnswer(button) {
    button.disabled = true;
    const id = button.dataset.question;
    const { ok, data } = await request('POST', `/api/questions-risks/${encodeURIComponent(id)}/resolve`, { decision_id: Number(button.dataset.decision) });
    if (!ok) { button.disabled = false; alert(data.error || t('common.couldNotSave')); return; }
    showToast(t(button.dataset.type === 'risk' ? 'threads.markedMitigated' : 'threads.markedAnswered'),
      () => request('POST', `/api/questions-risks/${encodeURIComponent(id)}/reopen`));
    if (window.CortezaLoop) window.CortezaLoop.offerMitigate(data.linked_risks);
    load();
  }

  async function unlink(button) {
    const { kind, id, topic } = button.dataset;
    const itemId = kind === 'decision' ? Number(id) : id;
    const { ok, data } = await request('POST', '/api/threads/unlink', { kind, id: itemId });
    if (!ok) { alert(data.error || t('common.couldNotSave')); return; }
    showToast(t('threads.removed'), () => request('POST', '/api/threads/relink', { kind, id: itemId, topic_id: topic }));
    load();
  }

  async function setActionStatus(button) {
    const { item, status } = button.dataset;
    button.disabled = true;
    const { ok, data } = await request('PATCH', `/api/action-items/${encodeURIComponent(item)}`, { status });
    if (!ok) { button.disabled = false; alert(data.error || t('common.couldNotSave')); return; }
    load();
  }

  async function addStep(form) {
    const input = form.querySelector('.add-step-text');
    const text = input.value.trim();
    if (!text) return;
    form.querySelectorAll('button, input').forEach(el => { el.disabled = true; });
    const { ok, data } = await request('POST', '/api/action-items', { decision_id: Number(form.dataset.id), text });
    if (!ok) {
      form.querySelectorAll('button, input').forEach(el => { el.disabled = false; });
      alert(data.error || t('common.couldNotSave'));
      return;
    }
    load();
  }

  document.addEventListener('click', event => {
    // Menus close when clicking elsewhere
    document.querySelectorAll('details.thread-menu[open]').forEach(details => {
      if (!details.contains(event.target)) details.removeAttribute('open');
    });
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
    const use = event.target.closest('.use-answer-btn');
    if (use) return useAsAnswer(use);
    const unlinkButton = event.target.closest('.unlink-btn');
    if (unlinkButton) return unlink(unlinkButton);
    const status = event.target.closest('.action-status-btn');
    if (status) return setActionStatus(status);
    const addStepButton = event.target.closest('.add-step-btn');
    if (addStepButton) return showAddStepForm(addStepButton.dataset.id);
    const cancelStep = event.target.closest('.add-step-cancel');
    if (cancelStep) return cancelStep.closest('form').remove();
  });

  document.addEventListener('submit', event => {
    const form = event.target.closest('.add-step-form');
    if (!form) return;
    event.preventDefault();
    addStep(form);
  });

  document.addEventListener('change', event => {
    if (event.target.id === 'status-filter') { state.status = event.target.value; load(); }
  });

  document.addEventListener('DOMContentLoaded', () => {
    if (window.CortezaLoop) window.CortezaLoop.init(document.getElementById('loop-notice'), load);
    load();
  });
})();
