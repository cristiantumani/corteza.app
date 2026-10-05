/**
 * Home: automatic capture from Google Meet comes first.
 *
 * - #capture-panel: connect Google Meet (if not connected), or the capture status in one
 *   line with "Check now", "Import past meetings" and the latest processed meetings folded
 *   away. While an import runs on the server it shows its progress (refreshed every 10 s)
 *   and, when it finishes, refreshes the overview and the outcomes list.
 *   (What I owe and what's open live in the overview: public/scripts/home-overview.js.)
 *
 * APIs: GET /api/integrations/google, POST /api/integrations/google/sync
 * Counts use the "outcomes" wording from outcome-labels.js.
 * Manual capture (Log manually / Upload) stays available as secondary actions.
 */
(function() {
  'use strict';
  const t = window.t || (key => key); // public/scripts/i18n.js
  const locale = (window.CortezaI18n && window.CortezaI18n.locale) || undefined;

  const SKIP_REASONS = {
    one_on_one: t('capture.skip.one_on_one'),
    excluded_title: t('capture.skip.excluded_title'),
    no_transcript: t('capture.skip.no_transcript'),
    too_short: t('capture.skip.too_short')
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function timeAgo(value) {
    if (!value) return t('time.never');
    const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
    if (minutes < 1) return t('time.justNow');
    if (minutes < 60) return t('time.minutesAgo', { count: minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 24) return t('time.hoursAgo', { count: hours });
    return new Date(value).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  }


  const describe = (byType, total, actionItems) => window.CortezaOutcomes.describe(byType, total, actionItems);

  function meetingOutcome(meeting) {
    if (meeting.status === 'completed') {
      return describe(meeting.outcomes_by_type || null, meeting.decisions_created || 0, meeting.action_items_created || 0);
    }
    if (meeting.status === 'skipped') return SKIP_REASONS[meeting.skip_reason] || t('capture.skipped');
    if (meeting.status === 'failed') return t('capture.failed');
    return t('upload.processing');
  }

  const panel = () => document.getElementById('capture-panel');

  function renderNotConnected() {
    panel().innerHTML = `
      <div class="rounded-xl bg-gradient-to-br from-[#667EEA] to-[#764BA2] p-8 text-white shadow-xl h-full">
        <div class="flex items-center gap-3 mb-3">
          <span class="material-symbols-outlined text-4xl" style="font-variation-settings: 'FILL' 1;">auto_awesome</span>
          <h3 class="text-2xl font-semibold">${escapeHtml(t('capture.connect.title'))}</h3>
        </div>
        <p class="text-base opacity-90 max-w-xl mb-6">${escapeHtml(t('capture.connect.body'))}</p>
        <ol class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6 text-sm">
          <li class="bg-white/10 rounded-lg p-3"><strong>1.</strong> ${escapeHtml(t('capture.connect.step1'))}</li>
          <li class="bg-white/10 rounded-lg p-3"><strong>2.</strong> ${escapeHtml(t('capture.connect.step2'))}</li>
          <li class="bg-white/10 rounded-lg p-3"><strong>3.</strong> ${escapeHtml(t('capture.connect.step3'))}</li>
        </ol>
        <a href="/integrations/google/connect" class="inline-flex items-center gap-2 bg-white text-[#3953bd] font-bold py-3 px-6 rounded-lg hover:opacity-90 transition-all">
          <span class="material-symbols-outlined">link</span> ${escapeHtml(t('capture.connect.button'))}
        </a>
      </div>`;
  }

  /** "43 outcomes" for the whole connection; per type when the connection has counted them since the start */
  function capturedTotals(data) {
    const total = data.decisions_captured || 0;
    const byType = data.outcomes_by_type;
    const countedByType = byType ? Object.values(byType).reduce((sum, count) => sum + count, 0) : 0;
    if (byType && countedByType === total && total > 0) return describe(byType, total, 0);
    return window.CortezaOutcomes.plural(total, 'outcome');
  }

  /** Progress of an "Import past meetings" job still running on the server */
  function importProgressHtml(job) {
    if (!job) return '';
    const percent = job.total ? Math.round((job.done / job.total) * 100) : 0;
    const soFar = job.decisions_created || job.action_items_created
      ? ` · ${t('capture.import.soFar', { outcomes: describe(job.outcomes_by_type || null, job.decisions_created || 0, job.action_items_created || 0) })}`
      : '';
    return `
      <div class="p-3 rounded-lg bg-primary/5 border border-primary/20">
        <div class="flex items-center justify-between gap-4 text-sm mb-2">
          <span class="font-semibold text-on-surface">${escapeHtml(t('capture.import.progress', { done: job.done, total: job.total }))}${escapeHtml(soFar)}</span>
          <a href="/settings#import" class="text-primary font-semibold whitespace-nowrap hover:underline">${escapeHtml(t('capture.import.details'))}</a>
        </div>
        <div class="w-full h-1.5 bg-surface-container rounded-full overflow-hidden"><div class="h-full bg-primary" style="width: ${percent}%"></div></div>
        <p class="text-xs text-on-surface-variant mt-2">${escapeHtml(t('capture.import.background'))}</p>
      </div>`;
  }

  const refreshOverview = () => document.dispatchEvent(new CustomEvent('corteza:home-refresh'));

  let importPoll = null;
  let importRunning = false;

  /** Keeps the import progress fresh; when the import ends, reloads what it captured */
  function followImport(data) {
    const running = !!(data && data.active_import);
    if (importRunning && !running) {
      if (typeof window.fetchDecisions === 'function') window.fetchDecisions();
      if (typeof window.fetchStats === 'function') window.fetchStats();
      refreshOverview();
      const result = document.getElementById('capture-sync-result');
      if (result) {
        result.textContent = t('capture.import.finished');
        result.className = 'text-sm text-tertiary';
      }
    }
    importRunning = running;
    clearTimeout(importPoll);
    if (running) importPoll = setTimeout(loadCapture, 10000);
  }

  function renderConnected(data) {
    const needsReconnect = data.status !== 'active';
    const recent = (data.recent_meetings || []).slice(0, 5);
    const recentHtml = recent.length
      ? `<ul class="divide-y divide-outline-variant/50">${recent.map(meeting => `
          <li class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-4 py-2 text-sm">
            <span class="text-on-surface truncate">${escapeHtml(meeting.title || t('capture.meeting'))}</span>
            <span class="sm:whitespace-nowrap text-on-surface-variant">${escapeHtml(meetingOutcome(meeting))} · ${escapeHtml(timeAgo(meeting.updated_at))}</span>
          </li>`).join('')}</ul>`
      : `<p class="text-sm text-on-surface-variant">${escapeHtml(t('capture.noMeetings'))}</p>`;

    panel().innerHTML = `
      <div class="rounded-xl bg-surface-container-lowest border border-outline-variant px-4 py-3 flex flex-col gap-3">
        ${needsReconnect ? `
          <div class="p-3 rounded-lg bg-error-container text-on-error-container text-sm">
            ${escapeHtml(data.last_error || t('capture.accessStopped'))}
            <a href="/integrations/google/connect" class="font-bold underline ml-1">${escapeHtml(t('capture.reconnect'))}</a>
          </div>` : ''}
        ${!needsReconnect && data.needs_reconsent ? `
          <div class="p-3 rounded-lg bg-primary/10 text-primary text-sm">
            Reconnect once to let Corteza read Gemini notes too.
            <a href="/integrations/google/connect" class="font-bold underline ml-1">${escapeHtml(t('capture.reconnect'))}</a>
          </div>` : ''}
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span class="w-2.5 h-2.5 rounded-full shrink-0 ${needsReconnect ? 'bg-error' : 'bg-tertiary'}" aria-hidden="true"></span>
          <span class="font-semibold text-on-surface">${escapeHtml(t(needsReconnect ? 'capture.paused' : 'capture.capturing'))}</span>
          <span class="text-on-surface-variant">${escapeHtml(t('capture.status', { when: timeAgo(data.last_polled_at), outcomes: capturedTotals(data), meetings: t('capture.meetings', { count: data.meetings_processed || 0 }) }))}</span>
          <span class="flex flex-wrap items-center gap-x-4 gap-y-1 sm:ml-auto">
            <button id="capture-sync" type="button" class="font-semibold text-primary hover:underline disabled:opacity-50" ${needsReconnect ? 'disabled' : ''}>${escapeHtml(t('capture.checkNow'))}</button>
            <a href="/settings#import" class="font-semibold text-primary hover:underline">${escapeHtml(t('capture.importPast'))}</a>
            <button id="capture-meetings-toggle" type="button" aria-expanded="false" aria-controls="capture-meetings" class="font-semibold text-on-surface-variant hover:text-primary">${escapeHtml(t('capture.latest'))}</button>
          </span>
        </div>
        ${importProgressHtml(data.active_import)}
        <p id="capture-sync-result" class="hidden text-sm"></p>
        <div id="capture-meetings" hidden>${recentHtml}</div>
      </div>`;

    const toggle = document.getElementById('capture-meetings-toggle');
    toggle.addEventListener('click', () => {
      const list = document.getElementById('capture-meetings');
      list.hidden = !list.hidden;
      toggle.setAttribute('aria-expanded', String(!list.hidden));
    });

    const syncButton = document.getElementById('capture-sync');
    if (syncButton) syncButton.addEventListener('click', checkNow);
  }

  async function checkNow() {
    const button = document.getElementById('capture-sync');
    const result = document.getElementById('capture-sync-result');
    button.disabled = true;
    button.textContent = t('capture.checking');
    try {
      const response = await fetch('/api/integrations/google/sync', { method: 'POST', credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('capture.checkFailed'));
      await loadCapture();
      const message = data.meetings_processed
        ? t('capture.captured', { outcomes: describe(data.outcomes_by_type || null, data.decisions_captured, data.action_items_captured || 0), meetings: t('capture.newMeetings', { count: data.meetings_processed }) })
        : t('capture.noNew');
      const refreshed = document.getElementById('capture-sync-result');
      if (refreshed) {
        refreshed.textContent = message;
        refreshed.className = 'text-sm text-tertiary';
      }
      if (data.meetings_processed && typeof window.fetchDecisions === 'function') {
        window.fetchDecisions();
        if (typeof window.fetchStats === 'function') window.fetchStats();
        refreshOverview();
      }
    } catch (error) {
      result.textContent = error.message;
      result.className = 'text-sm text-error';
      button.disabled = false;
      button.textContent = t('capture.checkNow');
      result.classList.remove('hidden');
    }
  }

  async function loadCapture() {
    try {
      const response = await fetch('/api/integrations/google', { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('common.loadFailed'));
      if (!data.configured) {
        panel().classList.add('hidden');
        return;
      }
      if (data.connected) renderConnected(data);
      else renderNotConnected();
      followImport(data);
    } catch (error) {
      panel().innerHTML = `<div class="rounded-xl border border-outline-variant p-6 text-sm text-error">${escapeHtml(t('capture.loadFailed', { error: error.message }))}</div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', loadCapture);
})();
