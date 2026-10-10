/**
 * Decide and close (docs/specs/2026-10-decide-and-close.md), on Search and Home's "Ask across
 * meetings": a typed decision ("Decidimos no ir por ISO 27001 por ahora") shows a card with the
 * decision, an optional Why, and the open items it would close (sure ones checked). Confirm records
 * the decision and closes them; Undo reopens them and deletes the decision.
 *
 *   window.CortezaDecide.looksLikeDecision(text)
 *   window.CortezaDecide.start(text, container, { onSearch(text) })  // onSearch: it was a question
 *
 * API: POST /api/decide/preview, POST /api/decide, POST /api/decide/:id/undo
 * Everything from meetings or the AI goes through escapeHtml.
 */
(function() {
  'use strict';

  const t = window.t || (key => key); // public/scripts/i18n.js
  const locale = (window.CortezaI18n && window.CortezaI18n.locale) || undefined;
  const words = window.CortezaDecideWords || { looksLikeDecision: () => false };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  const shortDate = value => new Date(value).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  const typeLabel = type => t(`types.short.${type}`);
  const key = item => `${item.kind}:${item.id}`;

  async function post(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.message || data.error || t('common.somethingWrong'));
    return data;
  }

  /** "Answered", "Mitigated", "Done", "No longer applies", "Cancelled" */
  function outcomeLabel(item) {
    if (item.relation === 'drops') return t(item.type === 'action_item' ? 'decide.result.cancelled' : 'decide.result.dropped');
    return t(`decide.result.${item.relation}`);
  }

  function meta(item) {
    return [item.meeting, item.date ? shortDate(item.date) : null, (item.owners || []).join(', ') || null]
      .filter(Boolean).map(escapeHtml).join(' · ');
  }

  function itemRow(item) {
    const checked = item.can_close && item.confidence === 'high';
    const id = `decide-${escapeHtml(item.kind)}-${escapeHtml(item.id)}`;
    return `
      <li class="flex items-start gap-3 py-2 border-t border-outline-variant first:border-t-0">
        <input type="checkbox" id="${id}" class="decide-pick mt-1 h-4 w-4 shrink-0 accent-black" data-key="${escapeHtml(key(item))}"
          ${checked ? 'checked' : ''} ${item.can_close ? '' : 'disabled'}>
        <label for="${id}" class="min-w-0 flex-1 ${item.can_close ? 'cursor-pointer' : ''}">
          <span class="flex flex-wrap items-center gap-2">
            <span class="rounded-full bg-surface-container text-on-surface px-2 py-0.5 text-xs font-semibold">${escapeHtml(typeLabel(item.type))}</span>
            <span class="text-xs font-semibold text-on-surface-variant">→ ${escapeHtml(outcomeLabel(item))}</span>
          </span>
          <span class="block text-sm text-on-surface break-words mt-1">${escapeHtml(item.text)}</span>
          ${meta(item) ? `<span class="block text-xs text-on-surface-variant">${meta(item)}</span>` : ''}
          ${item.reason ? `<span class="block text-xs italic text-on-surface-variant">${escapeHtml(item.reason)}</span>` : ''}
          ${item.can_close ? '' : `<span class="block text-xs text-on-surface-variant">${escapeHtml(t('decide.cantClose'))}</span>`}
        </label>
      </li>`;
  }

  function relatedRow(item) {
    return `
      <li class="py-1.5">
        <span class="text-xs font-semibold text-on-surface-variant">${escapeHtml(typeLabel(item.type))}</span>
        <span class="block text-sm text-on-surface break-words">${escapeHtml(item.text)}</span>
        ${meta(item) ? `<span class="block text-xs text-on-surface-variant">${meta(item)}</span>` : ''}
      </li>`;
  }

  function card(preview) {
    const items = preview.items || [];
    const related = preview.related || [];
    return `
      <div class="decide-card flex flex-col gap-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-5 text-left">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="text-xs font-semibold text-signal-ink">${escapeHtml(t('decide.understood'))}</p>
            <h2 class="text-lg font-semibold text-on-surface">${escapeHtml(t('decide.title'))}</h2>
          </div>
          <button type="button" class="decide-search text-sm font-semibold text-on-surface underline">${escapeHtml(t('decide.wasQuestion'))}</button>
        </div>
        <label class="flex flex-col gap-1 text-sm font-semibold text-on-surface">${escapeHtml(t('decide.decision'))}
          <textarea class="decide-text w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-sm font-normal" rows="2" maxlength="500"></textarea>
        </label>
        <label class="flex flex-col gap-1 text-sm font-semibold text-on-surface">${escapeHtml(t('decide.why'))}
          <textarea class="decide-why w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-sm font-normal" rows="2" maxlength="1000" placeholder="${escapeHtml(t('decide.whyPlaceholder'))}"></textarea>
        </label>
        ${items.length ? `
          <div>
            <h3 class="text-sm font-semibold text-on-surface">${escapeHtml(t('decide.wouldClose'))}</h3>
            <p class="text-xs text-on-surface-variant">${escapeHtml(t('decide.wouldCloseHint'))}</p>
            <ul class="mt-2">${items.map(itemRow).join('')}</ul>
          </div>` : `<p class="text-sm text-on-surface-variant">${escapeHtml(t('decide.nothingFound'))}</p>`}
        ${related.length ? `
          <details class="text-sm">
            <summary class="cursor-pointer font-semibold text-on-surface-variant">${escapeHtml(t('decide.related', { count: related.length }))}</summary>
            <ul class="mt-1">${related.map(relatedRow).join('')}</ul>
          </details>` : ''}
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" class="decide-confirm bg-primary text-on-primary hover:bg-on-primary-fixed-variant rounded-lg py-2.5 px-4 text-sm font-semibold disabled:opacity-60"></button>
          <button type="button" class="decide-cancel text-sm text-on-surface-variant hover:underline">${escapeHtml(t('common.cancel'))}</button>
        </div>
        <p class="decide-error hidden text-sm text-error" role="alert"></p>
      </div>`;
  }

  function confirmLabel(container) {
    const count = container.querySelectorAll('.decide-pick:checked').length;
    return count ? t('decide.recordAndClose', { count }) : t('decide.record');
  }

  function start(text, container, { onSearch } = {}) {
    container.hidden = false;
    container.classList.remove('hidden');
    container.innerHTML = `<p class="text-sm text-on-surface-variant" role="status">${escapeHtml(t('decide.looking'))}</p>`;
    post('/api/decide/preview', { text })
      .then(preview => {
        if (!preview.is_decision && onSearch) return onSearch(text);
        show(preview, text, container, onSearch);
      })
      .catch(error => {
        container.innerHTML = `<p class="text-sm text-error" role="alert">${escapeHtml(error.message)}</p>`;
      });
  }

  function show(preview, text, container, onSearch) {
    container.innerHTML = card(preview);
    const root = container.querySelector('.decide-card');
    root.querySelector('.decide-text').value = preview.decision || text;
    const confirm = root.querySelector('.decide-confirm');
    const refresh = () => { confirm.textContent = confirmLabel(root); };
    refresh();
    root.addEventListener('change', event => { if (event.target.classList.contains('decide-pick')) refresh(); });
    root.querySelector('.decide-search').addEventListener('click', () => { if (onSearch) onSearch(text); });
    root.querySelector('.decide-cancel').addEventListener('click', () => { container.innerHTML = ''; container.hidden = true; });
    confirm.addEventListener('click', async () => {
      const error = root.querySelector('.decide-error');
      const decisionText = root.querySelector('.decide-text').value.trim();
      if (!decisionText) {
        error.textContent = t('decide.writeIt');
        error.classList.remove('hidden');
        return;
      }
      const picked = new Set([...root.querySelectorAll('.decide-pick:checked')].map(box => box.dataset.key));
      const close = (preview.items || []).filter(item => picked.has(key(item))).map(item => ({ kind: item.kind, id: item.id, relation: item.relation }));
      confirm.disabled = true;
      confirm.textContent = t('decide.saving');
      error.classList.add('hidden');
      try {
        const data = await post('/api/decide', { text: decisionText, rationale: root.querySelector('.decide-why').value, close });
        done(data, container);
      } catch (failure) {
        error.textContent = failure.message;
        error.classList.remove('hidden');
        confirm.disabled = false;
        refresh();
      }
    });
  }

  function done(data, container) {
    const closed = (data.closed || []).length;
    container.innerHTML = `
      <div class="flex flex-wrap items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4" role="status">
        <span class="material-symbols-outlined text-success" aria-hidden="true">check_circle</span>
        <p class="text-sm text-on-surface flex-1 min-w-0"><strong>${escapeHtml(t('decide.recorded'))}</strong>${closed ? ` · ${escapeHtml(t('decide.closedCount', { count: closed }))}` : ''}
          <span class="block text-on-surface-variant break-words">${escapeHtml(data.decision.text)}</span></p>
        ${typeof window.openDecision === 'function' ? `<button type="button" class="decide-open text-sm font-semibold text-on-surface underline">${escapeHtml(t('decide.open'))}</button>` : ''}
        <button type="button" class="decide-undo text-sm font-semibold text-on-surface underline">${escapeHtml(t('common.undo'))}</button>
      </div>`;
    const open = container.querySelector('.decide-open');
    if (open) open.addEventListener('click', () => window.openDecision(data.decision));
    container.querySelector('.decide-undo').addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const result = await post(`/api/decide/${encodeURIComponent(data.decision.id)}/undo`);
        container.innerHTML = `<p class="text-sm text-on-surface-variant" role="status">${escapeHtml(t('decide.undone', { count: result.reopened || 0 }))}</p>`;
      } catch (failure) {
        button.disabled = false;
        button.insertAdjacentHTML('afterend', `<span class="text-sm text-error" role="alert">${escapeHtml(failure.message)}</span>`);
      }
    });
  }

  window.CortezaDecide = { looksLikeDecision: words.looksLikeDecision, start };
})();
