/**
 * First-run onboarding on Home (markup and styles: src/views/partials/onboarding.html).
 * Opens once per person: the preload (window.__CORTEZA_BOOTSTRAP__.user.onboarding_seen) or
 * GET /api/onboarding says whether they've seen it; finishing, skipping or following a link
 * records it (POST /api/onboarding/seen). ?tour=1 (sidebar "How it works") opens it again.
 */
(function() {
  'use strict';

  const root = document.getElementById('cz-onboarding');
  if (!root) return;

  let steps = [];
  let index = 0;
  let recorded = false;

  /** @param {'finished'|'skipped'|'link'} how - for analytics: how far people get */
  function markSeen(how) {
    if (recorded) return;
    recorded = true;
    fetch('/api/onboarding/seen', {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ how, step: index + 1, steps: steps.length })
    }).catch(() => {});
  }

  function render() {
    steps.forEach((step, i) => step.classList.toggle('active', i === index));
    root.querySelector('.cz-onb-dots').innerHTML = steps.map((_, i) => `<span class="${i === index ? 'active' : ''}"></span>`).join('');
    root.querySelector('[data-onb-back]').style.visibility = index === 0 ? 'hidden' : 'visible';
    root.querySelector('[data-onb-next]').textContent = index === steps.length - 1 ? 'Get started' : 'Next';
  }

  function close(how = 'skipped') {
    markSeen(how);
    root.classList.remove('open');
    document.removeEventListener('keydown', onKey);
  }

  function onKey(event) {
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowRight' && index < steps.length - 1) { index++; render(); }
    if (event.key === 'ArrowLeft' && index > 0) { index--; render(); }
  }

  /** Shows "Google Meet connected" instead of the connect button when it already is */
  async function showMeetStatus() {
    try {
      const response = await fetch('/api/integrations/google', { credentials: 'include' });
      const data = await response.json();
      const connected = !!(data && data.connected);
      root.querySelector('[data-meet-cta]').hidden = connected;
      root.querySelector('[data-meet-connected]').hidden = !connected;
    } catch {
      // keep the connect button
    }
  }

  function open({ isAdmin }) {
    steps = Array.from(root.querySelectorAll('.cz-onb-step')).filter(step => isAdmin || !step.hasAttribute('data-admin-only'));
    root.querySelectorAll('[data-admin-only]').forEach(step => { if (!isAdmin) step.classList.remove('active'); });
    index = 0;
    render();
    root.classList.add('open');
    document.addEventListener('keydown', onKey);
    showMeetStatus();
    const next = root.querySelector('[data-onb-next]');
    if (next) next.focus();
  }

  root.querySelector('[data-onb-next]').addEventListener('click', () => {
    if (index < steps.length - 1) { index++; render(); } else { close('finished'); }
  });
  root.querySelector('[data-onb-back]').addEventListener('click', () => {
    if (index > 0) { index--; render(); }
  });
  root.querySelector('[data-onb-skip]').addEventListener('click', () => close('skipped'));
  root.addEventListener('click', event => { if (event.target === root) close('skipped'); });
  // Following a link inside a step (connect Meet, try a question…) counts as done
  root.querySelectorAll('[data-onb-finish]').forEach(link => link.addEventListener('click', () => markSeen('link')));

  async function start({ force = false } = {}) {
    const params = new URLSearchParams(window.location.search);
    const forced = force || params.get('tour') === '1';
    const boot = window.__CORTEZA_BOOTSTRAP__ && window.__CORTEZA_BOOTSTRAP__.user;
    let state = boot && typeof boot.onboarding_seen === 'boolean' ? { seen: boot.onboarding_seen, is_admin: !!boot.is_admin } : null;
    if (!state) {
      try {
        const response = await fetch('/api/onboarding', { credentials: 'include' });
        if (!response.ok) return;
        state = await response.json();
      } catch {
        return;
      }
    }
    if (forced) {
      recorded = state.seen;
      if (params.has('tour')) {
        params.delete('tour');
        history.replaceState(null, '', window.location.pathname + (params.toString() ? `?${params}` : ''));
      }
      open({ isAdmin: state.is_admin });
    } else if (!state.seen) {
      open({ isAdmin: state.is_admin });
    }
  }

  window.CortezaOnboarding = { open: () => start({ force: true }) };
  start();
})();
