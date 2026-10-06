// "This may close": earlier items on the same subject that an outcome may resolve
// (cross-meeting links, docs/specs/2026-10-cross-meeting-links.md). Shown on Home's review
// card and in the detail modal; checked by default; Confirm (or Close selected) closes the
// checked ones, and the toast offers Undo.
//
// APIs: GET /api/decisions/:id/links, POST /api/decisions/:id/links/close, POST /api/decisions/:id/links/reopen
(function() {
  'use strict';
  const t = window.t || (key => key); // public/scripts/i18n.js
  const locale = (window.CortezaI18n && window.CortezaI18n.locale) || undefined;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const typeLabel = type => (['decision', 'open_question', 'risk', 'action_item'].includes(type) ? t(`types.short.${type}`) : '');
  const shortDate = value => {
    const date = new Date(String(value).length === 10 ? `${value}T12:00:00` : value);
    return isNaN(date.getTime()) ? '' : date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  };

  /**
   * The list, as HTML
   * @param {Object[]} items - may_close entries
   * @param {{ inModal?: boolean }} [options] - in the detail modal: a section heading like the others, no box
   * @returns {string}
   */
  function render(items, { inModal = false } = {}) {
    if (!Array.isArray(items) || items.length === 0) return '';
    const rows = items.map(item => {
      const meta = [
        item.meeting ? `${t('detail.googleMeet')}: ${item.meeting}` : null,
        item.date ? shortDate(item.date) : null,
        item.owners && item.owners.length ? item.owners.join(', ') : null,
        item.due_date ? t('due.on', { date: shortDate(item.due_date) }) : null
      ].filter(Boolean).join(' · ');
      return `
        <li>
          <label class="flex items-start gap-3 cursor-pointer py-2">
            <input type="checkbox" checked data-link-kind="${esc(item.kind)}" data-link-id="${esc(item.id)}" class="mt-1 h-4 w-4 shrink-0" style="accent-color: #3f51b5">
            <span class="flex flex-col gap-0.5 min-w-0">
              <span class="flex flex-wrap items-center gap-2 text-xs">
                <span class="px-2 py-0.5 rounded-full font-semibold bg-primary/10 text-primary">${esc(t(`links.relation.${item.relation}`))}</span>
                <span class="text-on-surface-variant font-semibold">${esc(typeLabel(item.type))}</span>
              </span>
              <span class="text-sm text-on-surface">${esc(item.text)}</span>
              ${meta ? `<span class="text-xs text-on-surface-variant">${esc(meta)}</span>` : ''}
              ${item.reason ? `<span class="text-xs italic text-on-surface-variant">${esc(item.reason)}</span>` : ''}
            </span>
          </label>
        </li>`;
    }).join('');
    const hint = `<div class="text-xs text-on-surface-variant">${esc(t('links.mayCloseHint'))}</div>`;
    const list = `<ul class="flex flex-col divide-y divide-outline-variant/60">${rows}</ul>`;
    if (inModal) return `<h3>${esc(t('links.mayClose').replace(/:$/, ''))}</h3><div class="content flex flex-col gap-1">${hint}${list}</div>`;
    return `
      <div class="flex flex-col gap-1 rounded-lg border border-outline-variant p-3">
        <div class="text-sm font-semibold text-on-surface">${esc(t('links.mayClose'))}</div>
        ${hint}
        ${list}
      </div>`;
  }

  /**
   * The checked items inside a container
   * @param {Element|null} container
   * @param {number} [decisionId] - when given, only if the container shows that outcome
   * @returns {{ kind: string, id: number|string }[]}
   */
  function checked(container, decisionId) {
    if (!container) return [];
    if (decisionId !== undefined && String(container.dataset.decisionId || '') !== String(decisionId)) return [];
    return [...container.querySelectorAll('input[data-link-kind]:checked')].map(box => ({
      kind: box.dataset.linkKind,
      id: box.dataset.linkKind === 'decision' ? Number(box.dataset.linkId) : box.dataset.linkId
    }));
  }

  async function post(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.error || t('common.somethingWrong'));
    return data;
  }

  const refreshHome = () => document.dispatchEvent(new CustomEvent('corteza:home-refresh'));

  let toastTimer = null;
  /** "N earlier items closed · Undo" */
  function showClosed(decisionId, closed, key) {
    if (!closed || closed.length === 0) return;
    clearTimeout(toastTimer);
    const old = document.getElementById('cz-links-toast');
    if (old) old.remove();
    const box = document.createElement('div');
    box.id = 'cz-links-toast';
    box.setAttribute('role', 'status');
    box.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[2000] flex items-center gap-4 rounded-lg bg-inverse-surface text-inverse-on-surface px-4 py-3 text-sm shadow-lg';
    box.innerHTML = `<span>${esc(t(key || 'links.closed', { count: closed.length }))}</span><button type="button" class="font-semibold text-inverse-primary hover:underline">${esc(t('common.undo'))}</button>`;
    box.querySelector('button').addEventListener('click', async () => {
      box.remove();
      try {
        await post(`/api/decisions/${encodeURIComponent(decisionId)}/links/reopen`, { items: closed });
      } catch (error) {
        console.warn('Undo failed:', error.message);
      }
      refreshHome();
    });
    document.body.appendChild(box);
    toastTimer = setTimeout(() => box.remove(), 8000);
  }

  /**
   * Detail modal: loads and shows what this outcome may close
   * @param {Object} decision
   * @param {{ pendingReview: boolean }} options - pending: the review banner's Confirm closes them; otherwise a Close selected button
   */
  async function loadDetail(decision, { pendingReview }) {
    const container = document.getElementById('detail-may-close');
    if (!container) return;
    container.dataset.decisionId = String(decision.id);
    container.innerHTML = '';
    container.style.display = 'none';
    if (decision.type !== 'decision') return;
    let data;
    try {
      const response = await fetch(`/api/decisions/${encodeURIComponent(decision.id)}/links`, { credentials: 'include' });
      data = await response.json();
    } catch (error) {
      return;
    }
    // The modal may show another outcome by now
    if (container.dataset.decisionId !== String(decision.id) || !data || !data.success || !Array.isArray(data.may_close) || !data.may_close.length) return;
    const canCloseNow = data.can_close && !pendingReview;
    container.innerHTML = render(data.may_close, { inModal: true }) + (canCloseNow
      ? `<div class="flex items-center gap-3 mt-2"><button type="button" data-close-links class="border border-outline-variant rounded-lg py-1.5 px-3 text-sm font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-50">${esc(t('links.closeSelected'))}</button><span data-close-error class="text-sm text-error" role="alert"></span></div>`
      : '');
    container.style.display = 'block';
    const button = container.querySelector('[data-close-links]');
    if (button) {
      button.addEventListener('click', async () => {
        const close = checked(container);
        if (!close.length) return;
        button.disabled = true;
        try {
          const result = await post(`/api/decisions/${encodeURIComponent(decision.id)}/links/close`, { close });
          showClosed(decision.id, result.closed, 'links.closed');
          refreshHome();
          loadDetail(decision, { pendingReview });
        } catch (error) {
          button.disabled = false;
          container.querySelector('[data-close-error]').textContent = t('links.closeFailed');
        }
      });
    }
  }

  window.CortezaMayClose = { render, checked, showClosed, loadDetail };
})();
