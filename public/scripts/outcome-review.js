/**
 * Confirm / dismiss AI-captured outcomes on Home (API: src/http/decision-review.js).
 *
 * - Cards of AI-captured outcomes nobody reviewed show "Needs review" with ✓ Confirm and ✗ Dismiss.
 * - Dismissing removes the card and shows a toast with Undo and "Why?" chips (optional; they
 *   teach the extraction what not to capture).
 * - "N to review" next to the list title filters the list to outcomes waiting for review.
 * - The detail modal shows the same two buttons.
 *
 * dashboard.js calls onFetched() after loading the list and renderDetail() when the modal opens;
 * dashboard-new.js asks cardControls() / statusPill() while building cards.
 */
(function() {
  'use strict';

  const t = window.t || (key => key); // public/scripts/i18n.js
  const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const REASONS = ['not_relevant', 'not_an_outcome', 'inaccurate', 'duplicate', 'about_a_person']
    .map(key => [key, t(`review.reasons.${key}`)]);

  const style = document.createElement('style');
  style.textContent = `
    .cz-rv-pill { display: inline-flex; align-items: center; gap: .35rem; font-size: .75rem; font-weight: 700; white-space: nowrap; }
    .cz-rv-pill i { width: .5rem; height: .5rem; border-radius: 999px; display: inline-block; }
    .cz-rv-pending { color: #8a5300; } .cz-rv-pending i { background: #e8a33d; }
    .cz-rv-confirmed { color: #0b6b43; } .cz-rv-confirmed i { background: #1f9d63; }
    .cz-rv-bar { display: flex; gap: .5rem; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(196,197,213,.5); }
    .cz-rv-btn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: .3rem; padding: .45rem .75rem;
      border-radius: .6rem; font-size: .8125rem; font-weight: 700; cursor: pointer; border: 1px solid #e4e1e8; background: #fff; color: #1b1b1d; }
    .cz-rv-btn:hover { background: #f6f3f5; }
    .cz-rv-btn.confirm { border-color: #b7e2cb; color: #0b6b43; } .cz-rv-btn.confirm:hover { background: #eaf7f0; }
    .cz-rv-btn.dismiss { color: #93000a; } .cz-rv-btn.dismiss:hover { background: #fdeceb; }
    .cz-rv-btn[disabled] { opacity: .5; cursor: default; }
    .cz-rv-chip { display: inline-flex; align-items: center; gap: .35rem; padding: .3rem .7rem; border-radius: 999px;
      font-size: .8125rem; font-weight: 700; cursor: pointer; border: 1px solid #f0c98a; background: #fff6e8; color: #8a5300; vertical-align: middle; }
    .cz-rv-chip.active { background: #8a5300; border-color: #8a5300; color: #fff; }
    .cz-rv-chip[hidden] { display: none; }
    .cz-rv-toast { position: fixed; left: 50%; bottom: 1.5rem; transform: translateX(-50%); z-index: 70; max-width: calc(100vw - 2rem);
      background: #1b1b1d; color: #fff; border-radius: .9rem; padding: .85rem 1rem; box-shadow: 0 16px 40px -12px rgba(0,0,0,.45);
      font: 500 .875rem/1.4 'Inter', sans-serif; }
    .cz-rv-toast .row { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
    .cz-rv-toast button { background: none; border: 0; color: #b8c4ff; font-weight: 700; cursor: pointer; padding: .2rem .3rem; font-size: .875rem; }
    .cz-rv-toast .why { margin-top: .6rem; display: flex; gap: .4rem; flex-wrap: wrap; align-items: center; color: #c4c5d5; font-size: .8rem; }
    .cz-rv-toast .why button { border: 1px solid #45464f; border-radius: 999px; color: #fff; font-weight: 600; font-size: .8rem; padding: .25rem .65rem; }
    .cz-rv-toast .why button:hover { border-color: #b8c4ff; }
    .cz-rv-detail { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; margin: 0 0 1rem; padding: .75rem 1rem;
      border-radius: .75rem; background: #fff6e8; border: 1px solid #f0c98a; font-size: .875rem; color: #5c3a00; }
    .cz-rv-detail .cz-rv-btn { flex: 0 0 auto; }
  `;
  document.head.appendChild(style);

  // ?review=pending (link in the capture email) opens the list filtered to outcomes to review
  let onlyPending = new URLSearchParams(window.location.search).get('review') === 'pending';
  let pendingCount = 0;
  let toastTimer = null;

  function needsReview(decision) {
    return !!decision && decision.capture === 'ai' && !decision.review_status;
  }

  function canModify(decision) {
    const me = window.currentUser && window.currentUser.user_id;
    return !!decision && (window.isCurrentUserAdmin || decision.user_id === me);
  }

  /** Status shown on a card: only AI-captured outcomes have one */
  function statusPill(decision) {
    if (decision.capture !== 'ai') return '';
    if (decision.review_status === 'confirmed') return `<span class="cz-rv-pill cz-rv-confirmed"><i></i>${esc(t('review.confirmed'))}</span>`;
    return `<span class="cz-rv-pill cz-rv-pending" title="${esc(t('review.pendingTitle'))}"><i></i>${esc(t('review.needsReview'))}</span>`;
  }

  /** ✓ / ✗ under a card that needs review */
  function cardControls(decision) {
    if (!needsReview(decision) || !canModify(decision)) return '';
    return `<div class="cz-rv-bar">
      <button type="button" class="cz-rv-btn confirm" data-review="confirm" data-id="${decision.id}" title="${esc(t('review.confirmTitle'))}">✓ ${esc(t('review.confirm'))}</button>
      <button type="button" class="cz-rv-btn dismiss" data-review="dismiss" data-id="${decision.id}" title="${esc(t('review.dismissTitle'))}">✕ ${esc(t('review.dismiss'))}</button>
    </div>`;
  }

  function decisions() {
    return window.allDecisions || [];
  }

  /** Replaces the loaded list and redraws it (dashboard.js keeps card indexes in sync) */
  function setList(list) {
    if (typeof window.setDecisions === 'function') window.setDecisions(list);
    renderChip();
  }

  async function post(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  async function confirm(id) {
    await post(`/api/decisions/${id}/review`, { action: 'confirm' });
    const decision = decisions().find(d => d.id === id);
    if (decision) decision.review_status = 'confirmed';
    pendingCount = Math.max(0, pendingCount - 1);
    setList(onlyPending ? decisions().filter(d => d.id !== id) : decisions());
  }

  async function dismiss(id) {
    const decision = decisions().find(d => d.id === id);
    await post(`/api/decisions/${id}/review`, { action: 'dismiss' });
    if (needsReview(decision)) pendingCount = Math.max(0, pendingCount - 1);
    setList(decisions().filter(d => d.id !== id));
    showDismissedToast(id);
  }

  function closeToast() {
    clearTimeout(toastTimer);
    const toast = document.getElementById('cz-rv-toast');
    if (toast) toast.remove();
  }

  function showDismissedToast(id) {
    closeToast();
    const toast = document.createElement('div');
    toast.id = 'cz-rv-toast';
    toast.className = 'cz-rv-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
      <div class="row"><span>${esc(t('review.dismissed'))}</span><button type="button" data-undo>${esc(t('common.undo'))}</button></div>
      <div class="why"><span>${esc(t('review.whyOptional'))}</span>${REASONS.map(([key, label]) => `<button type="button" data-reason="${key}">${esc(label)}</button>`).join('')}</div>`;
    document.body.appendChild(toast);
    toastTimer = setTimeout(closeToast, 10000);

    toast.querySelector('[data-undo]').addEventListener('click', async () => {
      closeToast();
      try {
        await post(`/api/decisions/${id}/restore`);
        if (typeof window.fetchDecisions === 'function') window.fetchDecisions();
      } catch (error) {
        notify(t('review.undoFailed'));
      }
    });
    toast.querySelectorAll('[data-reason]').forEach(button => button.addEventListener('click', async () => {
      const why = toast.querySelector('.why');
      try {
        await post(`/api/decisions/${id}/dismiss-reason`, { reason: button.dataset.reason });
        why.innerHTML = `<span>${esc(t('review.thanks'))}</span>`;
      } catch (error) {
        why.innerHTML = `<span>${esc(t('review.reasonFailed'))}</span>`;
      }
      clearTimeout(toastTimer);
      toastTimer = setTimeout(closeToast, 4000);
    }));
  }

  function notify(message) {
    if (typeof window.showNotification === 'function') window.showNotification(message);
    else alert(message);
  }

  async function run(action, id, button) {
    if (button) button.disabled = true;
    try {
      if (action === 'confirm') await confirm(id);
      else await dismiss(id);
      return true;
    } catch (error) {
      if (button) button.disabled = false;
      notify(t(action === 'confirm' ? 'review.confirmFailed' : 'review.dismissFailed'));
      return false;
    }
  }

  // Card buttons (cards are re-rendered, so listen on the document)
  document.addEventListener('click', event => {
    const button = event.target.closest('#decisions-cards [data-review]');
    if (!button) return;
    event.stopPropagation();
    run(button.dataset.review, Number(button.dataset.id), button);
  }, true);

  /** "N to review" next to the list title; click to see only those */
  function renderChip() {
    let chip = document.getElementById('cz-rv-chip');
    const title = document.getElementById('outcomes-title');
    if (!chip && title) {
      chip = document.createElement('button');
      chip.type = 'button';
      chip.id = 'cz-rv-chip';
      chip.className = 'cz-rv-chip';
      chip.addEventListener('click', () => {
        onlyPending = !onlyPending;
        if (typeof window.fetchDecisions === 'function') window.fetchDecisions();
      });
      // Next to the list controls (the title's text is rewritten on every render)
      const controls = title.nextElementSibling;
      if (controls) controls.prepend(chip);
      else title.insertAdjacentElement('afterend', chip);
    }
    if (!chip) return;
    chip.hidden = pendingCount === 0 && !onlyPending;
    chip.classList.toggle('active', onlyPending);
    chip.textContent = onlyPending ? t('review.chipShowing', { count: pendingCount }) : t('review.chip', { count: pendingCount });
    chip.title = t(onlyPending ? 'review.chipShowAllTitle' : 'review.chipTitle');
  }

  /** Called by dashboard.js with each list response */
  function onFetched(count) {
    pendingCount = Number.isInteger(count) ? count : 0;
    if (onlyPending && pendingCount === 0) onlyPending = false;
    renderChip();
  }

  /** Review banner in the detail modal (Home) */
  function renderDetail(decision) {
    const modal = document.querySelector('#detail-modal .detail-modal');
    if (!modal) return;
    let box = document.getElementById('cz-rv-detail');
    if (!box) {
      box = document.createElement('div');
      box.id = 'cz-rv-detail';
      box.className = 'cz-rv-detail';
      const header = modal.querySelector('.detail-header');
      if (header) header.insertAdjacentElement('afterend', box);
      else modal.prepend(box);
    }
    if (!needsReview(decision) || !canModify(decision)) {
      box.style.display = 'none';
      return;
    }
    box.style.display = 'flex';
    box.innerHTML = `<span style="flex:1 1 12rem">${esc(t('review.isItRight'))}</span>
      <button type="button" class="cz-rv-btn confirm" data-detail-review="confirm">✓ ${esc(t('review.confirm'))}</button>
      <button type="button" class="cz-rv-btn dismiss" data-detail-review="dismiss">✕ ${esc(t('review.dismiss'))}</button>`;
    box.querySelectorAll('[data-detail-review]').forEach(button => button.addEventListener('click', async () => {
      const ok = await run(button.dataset.detailReview, decision.id, button);
      if (!ok) return;
      if (button.dataset.detailReview === 'confirm') {
        box.innerHTML = `<span>✓ ${esc(t('review.confirmed'))}</span>`;
      } else if (typeof window.closeDetailModal === 'function') {
        window.closeDetailModal();
      }
    }));
  }

  window.CortezaReview = {
    statusPill,
    cardControls,
    onFetched,
    renderDetail,
    get onlyPending() { return onlyPending; }
  };
})();
