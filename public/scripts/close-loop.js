/**
 * Close-the-loop prompts for topic threads (docs/specs/2026-10-topic-threads.md). Corteza
 * only suggests; nothing closes until the person clicks.
 *   - an action item marked done whose thread has open questions → "Mark it answered?"
 *   - a question answered whose thread has open risks → "Close the linked risk too?"
 * Used by the Action items page (actions.js) and Open questions & risks (questions.js).
 * API: POST /api/questions-risks/:id/resolve (returns `linked_risks` for a question).
 */
(function() {
  'use strict';

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
          ? `This was a next step on <strong>“${escapeHtml(outcome.text)}”</strong>. Mark it answered?`
          : `Close the linked risk too? <strong>“${escapeHtml(outcome.text)}”</strong>`}</p>
        ${isQuestion ? '<textarea class="loop-note w-full bg-surface-container-low border border-outline-variant rounded-lg p-2 text-sm" rows="2" maxlength="1000" placeholder="What was the answer? (optional)"></textarea>' : ''}
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" class="loop-yes ${BUTTON}" data-id="${escapeHtml(outcome.id)}" data-kind="${kind}">${isQuestion ? 'Mark answered' : 'Mark mitigated'}</button>
          <button type="button" class="loop-no ${LINK}">Not yet</button>
        </div>
      </div>`;
  }

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
    yes.disabled = true;
    const response = await fetch(`/api/questions-risks/${encodeURIComponent(yes.dataset.id)}/resolve`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: note ? note.value : '' })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      yes.disabled = false;
      alert(data.error || 'Could not save');
      return;
    }
    removeRow(row);
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
    offerMitigate: risks => offer(risks, 'risk')
  };
})();
