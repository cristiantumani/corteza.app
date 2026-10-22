/**
 * Close-the-loop prompts (docs/specs/2026-10-topic-threads.md, docs/specs/2026-10-close-loop-actions.md).
 * Corteza only suggests; nothing closes until the person clicks.
 *   - an action item marked done → "Does this also resolve…?": its open questions and risks, unchecked
 *   - an action item cancelled that leaves a question or risk with no action items → "Add an action item?"
 *   - a question answered whose thread has open risks → "Close the linked risk too?"
 * Used by the Action items page (actions.js) and Open questions & risks (questions.js).
 * API: POST /api/questions-risks/:id/resolve (returns `linked_risks` for a question),
 * POST /api/action-items ({ decision_id, text, owner_user_ids }).
 */
(function() {
  'use strict';
  const t = window.t || (key => key); // public/scripts/i18n.js

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  const BUTTON = 'bg-primary text-on-primary rounded-lg py-1.5 px-3 text-sm font-semibold';
  const LINK = 'text-sm text-on-surface-variant hover:underline';

  /** @type {{ container: HTMLElement|null, onChange: Function|null }} */
  const target = { container: null, onChange: null };

  function rowHtml(outcome, kind) {
    const isQuestion = kind === 'question';
    return `
      <div class="loop-row flex flex-col gap-2 rounded-lg bg-surface-container-lowest border border-outline-variant p-3" data-loop-id="${escapeHtml(outcome.id)}">
        <p class="text-sm text-on-surface">${isQuestion
          ? escapeHtml(t('loop.question')).replace('{question}', `<strong>“${escapeHtml(outcome.text)}”</strong>`)
          : escapeHtml(t('loop.risk')).replace('{risk}', `<strong>“${escapeHtml(outcome.text)}”</strong>`)}</p>
        ${isQuestion ? answerBoxHtml('loop-note', false) : ''}
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" class="loop-yes ${BUTTON}" data-id="${escapeHtml(outcome.id)}" data-kind="${kind}">${escapeHtml(t(isQuestion ? 'detail.markAnswered' : 'detail.markMitigated'))}</button>
          <button type="button" class="loop-no ${LINK}">${escapeHtml(t('loop.notYet'))}</button>
        </div>
        <span class="loop-error text-sm text-error" role="alert"></span>
      </div>`;
  }

  /**
   * The answer to a question: a labelled box, Enter saves and Shift+Enter starts a new line
   * @param {string} className - loop-note (one question) or loop-pick-note (a checked one in a list)
   * @param {boolean} hidden - shown only once its question is checked
   */
  function answerBoxHtml(className, hidden) {
    const id = `loop-answer-${++answerBoxes}`;
    return `
      <div class="loop-answer flex flex-col gap-1${hidden ? ' hidden' : ''}">
        <label for="${id}" class="text-xs font-semibold text-on-surface-variant">${escapeHtml(t('loop.answerLabel'))}</label>
        <textarea id="${id}" class="${className} w-full bg-surface-container-low border border-outline-variant rounded-lg p-2 text-sm" rows="2" maxlength="1000" placeholder="${escapeHtml(t('loop.answerPlaceholder'))}" aria-describedby="${id}-hint"></textarea>
        <span id="${id}-hint" class="text-xs text-on-surface-variant">${escapeHtml(t('loop.enterHint'))}</span>
      </div>`;
  }
  let answerBoxes = 0;

  /**
   * Shows the prompts in the page's notice area
   * @param {{ id: number, text: string }[]} outcomes
   * @param {'question'|'risk'} kind
   */
  function offer(outcomes, kind) {
    const container = target.container;
    if (!container || !outcomes || outcomes.length === 0) return;
    container.insertAdjacentHTML('beforeend', outcomes.map(outcome => rowHtml(outcome, kind)).join(''));
    container.classList.remove('hidden');
  }

  const typeLabel = type => t(`types.short.${type === 'risk' ? 'risk' : 'open_question'}`);

  /** Drops the prompts an action item raised (it was reopened, or changed again) */
  function clearFor(itemId) {
    if (!target.container) return;
    target.container.querySelectorAll(`.loop-row[data-loop-item="${CSS.escape(String(itemId))}"]`).forEach(removeRow);
  }

  /**
   * Done: its open questions and risks, unchecked; a checked question takes an answer
   * @param {{ item_id: string, text: string }} item
   * @param {{ id: number, type: string, text: string }[]} outcomes
   */
  function offerResolve(item, outcomes) {
    const container = target.container;
    if (!container || !outcomes || outcomes.length === 0) return;
    container.insertAdjacentHTML('beforeend', `
      <div class="loop-row loop-resolve flex flex-col gap-2 rounded-lg bg-surface-container-lowest border border-outline-variant p-3" data-loop-item="${escapeHtml(item.item_id)}">
        <p class="text-sm text-on-surface"><span class="font-semibold">${escapeHtml(t('loop.doneTitle'))}</span> ${escapeHtml(t('loop.resolveAsk'))}</p>
        <ul class="flex flex-col gap-1">
          ${outcomes.map(outcome => `
          <li>
            <label class="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" class="loop-pick mt-0.5" data-id="${escapeHtml(outcome.id)}" data-type="${escapeHtml(outcome.type)}">
              <span><span class="text-xs font-semibold text-on-surface-variant">${escapeHtml(typeLabel(outcome.type))}</span> ${escapeHtml(outcome.text)}</span>
            </label>
            ${outcome.type === 'open_question' ? `<div class="pl-6 mt-1">${answerBoxHtml('loop-pick-note', true)}</div>` : ''}
          </li>`).join('')}
        </ul>
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" class="loop-close-picked ${BUTTON} disabled:opacity-50" disabled>${escapeHtml(t('loop.closeSelected'))}</button>
          <button type="button" class="loop-no ${LINK}">${escapeHtml(t('loop.notNow'))}</button>
        </div>
        <span class="loop-error text-sm text-error" role="alert"></span>
      </div>`);
    const row = container.lastElementChild;
    row.dataset.itemText = item.text || '';
    container.classList.remove('hidden');
  }

  /**
   * Cancelled: the questions and risks it leaves with no action items
   * @param {{ item_id: string }} item
   * @param {{ id: number, type: string, text: string }[]} outcomes
   * @param {string|null} viewerId - owner of an action item added here
   */
  function warnOrphaned(item, outcomes, viewerId) {
    const container = target.container;
    if (!container || !outcomes || outcomes.length === 0) return;
    container.insertAdjacentHTML('beforeend', outcomes.map(outcome => `
      <div class="loop-row loop-orphan flex flex-col gap-2 rounded-lg bg-surface-container-lowest border border-outline-variant p-3" data-loop-item="${escapeHtml(item.item_id)}" data-outcome-id="${escapeHtml(outcome.id)}" data-viewer="${escapeHtml(viewerId || '')}">
        <p class="text-sm text-on-surface">${escapeHtml(t(outcome.type === 'risk' ? 'loop.orphanedRisk' : 'loop.orphanedQuestion'))} <strong>“${escapeHtml(outcome.text)}”</strong></p>
        <form class="loop-add-form hidden flex flex-wrap items-center gap-2">
          <input type="text" class="loop-add-text flex-1 min-w-0 bg-surface-container-low border border-outline-variant rounded-lg p-2 text-sm" maxlength="500" required placeholder="${escapeHtml(t('loop.addPlaceholder'))}" aria-label="${escapeHtml(t('loop.addPlaceholder'))}">
          <button type="submit" class="${BUTTON}">${escapeHtml(t('loop.addSave'))}</button>
        </form>
        <div class="loop-orphan-actions flex flex-wrap items-center gap-3">
          <button type="button" class="loop-add ${BUTTON}">${escapeHtml(t('loop.addAction'))}</button>
          <button type="button" class="loop-no ${LINK}">${escapeHtml(t('loop.thatsFine'))}</button>
        </div>
        <span class="loop-error text-sm text-error" role="alert"></span>
      </div>`).join(''));
    container.classList.remove('hidden');
  }

  async function postJson(url, body) {
    const response = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.error || t('common.couldNotSave'));
    return data;
  }

  // Checking a question opens its answer box; Close selected is enabled while something is checked
  document.addEventListener('change', event => {
    const pick = event.target.closest('.loop-pick');
    if (!pick) return;
    const answer = pick.closest('li').querySelector('.loop-answer');
    if (answer) {
      answer.classList.toggle('hidden', !pick.checked);
      if (pick.checked) answer.querySelector('textarea').focus();
    }
    updateCloseButton(pick.closest('.loop-row'));
  });

  /** Close selected says it saves the answer once one is written */
  function updateCloseButton(row) {
    const button = row.querySelector('.loop-close-picked');
    if (!button || button.dataset.busy) return;
    const checked = [...row.querySelectorAll('.loop-pick:checked')];
    button.disabled = checked.length === 0;
    const answered = checked.some(pick => {
      const note = pick.closest('li').querySelector('.loop-pick-note');
      return note && note.value.trim();
    });
    button.textContent = t(answered ? 'loop.saveAnswerClose' : 'loop.closeSelected');
  }

  document.addEventListener('input', event => {
    if (event.target.closest('.loop-pick-note')) updateCloseButton(event.target.closest('.loop-row'));
  });

  // In an answer box, Enter saves (like the row's main button) and Shift+Enter starts a new line
  document.addEventListener('keydown', event => {
    const box = event.target.closest && event.target.closest('.loop-note, .loop-pick-note');
    if (!box || event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    const button = box.closest('.loop-row').querySelector('.loop-close-picked, .loop-yes');
    if (button && !button.disabled) button.click();
  });

  /**
   * Replaces a prompt with a short confirmation that fades away
   * @param {HTMLElement} row
   * @param {string} message
   */
  function confirmRow(row, message) {
    row.innerHTML = `<p class="text-sm text-on-surface flex items-center gap-2"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">check_circle</span>${escapeHtml(message)}</p>`;
    row.setAttribute('role', 'status');
    setTimeout(() => removeRow(row), 4000);
  }

  function showError(row, message) {
    const error = row.querySelector('.loop-error');
    if (error) error.textContent = message;
  }

  document.addEventListener('click', async event => {
    const closePicked = event.target.closest('.loop-close-picked');
    if (closePicked) {
      const row = closePicked.closest('.loop-row');
      const fallback = t('loop.resolvedByItem', { item: row.dataset.itemText || '' });
      const label = closePicked.textContent;
      closePicked.disabled = true;
      closePicked.dataset.busy = '1';
      closePicked.textContent = t('common.saving');
      showError(row, '');
      let closed = 0;
      try {
        for (const pick of row.querySelectorAll('.loop-pick:checked')) {
          const note = pick.closest('li').querySelector('.loop-pick-note');
          await postJson(`/api/questions-risks/${encodeURIComponent(pick.dataset.id)}/resolve`, { note: (note && note.value.trim()) || fallback });
          pick.checked = false;
          pick.disabled = true;
          closed++;
        }
        confirmRow(row, t('loop.closedCount', { count: closed }));
        if (target.onChange) target.onChange();
      } catch (error) {
        delete closePicked.dataset.busy;
        closePicked.textContent = label;
        updateCloseButton(row);
        showError(row, error.message);
        if (closed && target.onChange) target.onChange();
      }
      return;
    }
    const add = event.target.closest('.loop-add');
    if (add) {
      const row = add.closest('.loop-row');
      row.querySelector('.loop-add-form').classList.remove('hidden');
      row.querySelector('.loop-orphan-actions').classList.add('hidden');
      row.querySelector('.loop-add-text').focus();
    }
  });

  document.addEventListener('submit', async event => {
    const form = event.target.closest('.loop-add-form');
    if (!form) return;
    event.preventDefault();
    const row = form.closest('.loop-row');
    const text = form.querySelector('.loop-add-text').value.trim();
    if (!text) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await postJson('/api/action-items', { decision_id: Number(row.dataset.outcomeId), text, owner_user_ids: row.dataset.viewer ? [row.dataset.viewer] : [] });
      removeRow(row);
      if (target.onChange) target.onChange();
    } catch (error) {
      button.disabled = false;
      row.querySelector('.loop-error').textContent = error.message;
    }
  });

  function removeRow(row) {
    row.remove();
    if (target.container && !target.container.querySelector('.loop-row')) target.container.classList.add('hidden');
  }

  document.addEventListener('click', async event => {
    const no = event.target.closest('.loop-no');
    if (no) return removeRow(no.closest('.loop-row'));
    const yes = event.target.closest('.loop-yes');
    if (!yes) return;
    const row = yes.closest('.loop-row');
    const note = row.querySelector('.loop-note');
    const label = yes.textContent;
    yes.disabled = true;
    yes.textContent = t('common.saving');
    showError(row, '');
    const response = await fetch(`/api/questions-risks/${encodeURIComponent(yes.dataset.id)}/resolve`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: note ? note.value : '' })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      yes.disabled = false;
      yes.textContent = label;
      showError(row, data.error || t('common.couldNotSave'));
      return;
    }
    confirmRow(row, t('loop.closedCount', { count: 1 }));
    offer(data.linked_risks, 'risk');
    if (target.onChange) target.onChange();
  });

  window.CortezaLoop = {
    /**
     * @param {HTMLElement|null} container - where prompts go (hidden when empty)
     * @param {Function} [onChange] - called after something was closed (e.g. reload the list)
     */
    init(container, onChange) {
      target.container = container;
      target.onChange = onChange || null;
    },
    offerAnswer: questions => offer(questions, 'question'),
    offerMitigate: risks => offer(risks, 'risk'),
    /**
     * After an action item changed (PATCH /api/action-items/:id): drops its earlier prompts, then
     * offers what it may resolve (done) or warns about what it leaves alone (cancelled)
     * @param {Object} data - { item, may_resolve, orphaned, viewer_id }
     */
    afterItemChange(data) {
      if (!data || !data.item) return;
      clearFor(data.item.item_id);
      offerResolve(data.item, data.may_resolve);
      warnOrphaned(data.item, data.orphaned, data.viewer_id || null);
    }
  };
})();
