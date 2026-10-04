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

  const SKIP_REASONS = {
    one_on_one: '1:1 meeting, skipped',
    excluded_title: 'Excluded by title',
    no_transcript: 'No transcript or notes',
    too_short: 'Too short'
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function timeAgo(value) {
    if (!value) return 'never';
    const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
  }

  const describe = (byType, total, actionItems) => window.CortezaOutcomes.describe(byType, total, actionItems);

  function meetingOutcome(meeting) {
    if (meeting.status === 'completed') {
      return describe(meeting.outcomes_by_type || null, meeting.decisions_created || 0, meeting.action_items_created || 0);
    }
    if (meeting.status === 'skipped') return SKIP_REASONS[meeting.skip_reason] || 'Skipped';
    if (meeting.status === 'failed') return 'Failed, will retry';
    return 'Processing…';
  }

  const panel = () => document.getElementById('capture-panel');

  function renderNotConnected() {
    panel().innerHTML = `
      <div class="rounded-xl bg-gradient-to-br from-[#667EEA] to-[#764BA2] p-8 text-white shadow-xl h-full">
        <div class="flex items-center gap-3 mb-3">
          <span class="material-symbols-outlined text-4xl" style="font-variation-settings: 'FILL' 1;">auto_awesome</span>
          <h3 class="text-2xl font-semibold">Capture decisions automatically</h3>
        </div>
        <p class="text-base opacity-90 max-w-xl mb-6">Connect Google Meet and Corteza reads each meeting's transcript or Gemini notes, then saves the decisions and action items for you. Nobody has to write anything down.</p>
        <ol class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6 text-sm">
          <li class="bg-white/10 rounded-lg p-3"><strong>1.</strong> Connect your Google account</li>
          <li class="bg-white/10 rounded-lg p-3"><strong>2.</strong> Turn on transcription or Gemini “Take notes for me” in your meetings</li>
          <li class="bg-white/10 rounded-lg p-3"><strong>3.</strong> Decisions show up here a few minutes after each meeting</li>
        </ol>
        <a href="/integrations/google/connect" class="inline-flex items-center gap-2 bg-white text-[#3953bd] font-bold py-3 px-6 rounded-lg hover:opacity-90 transition-all">
          <span class="material-symbols-outlined">link</span> Connect Google Meet
        </a>
      </div>`;
  }

  /** "43 outcomes" for the whole connection; per type when the connection has counted them since the start */
  function capturedTotals(data) {
    const total = data.decisions_captured || 0;
    const byType = data.outcomes_by_type;
    const countedByType = byType ? Object.values(byType).reduce((sum, count) => sum + count, 0) : 0;
    if (byType && countedByType === total && total > 0) return describe(byType, total, 0);
    return plural(total, 'outcome');
  }

  /** Progress of an "Import past meetings" job still running on the server */
  function importProgressHtml(job) {
    if (!job) return '';
    const percent = job.total ? Math.round((job.done / job.total) * 100) : 0;
    const soFar = job.decisions_created || job.action_items_created
      ? ` · ${describe(job.outcomes_by_type || null, job.decisions_created || 0, job.action_items_created || 0)} so far`
      : '';
    return `
      <div class="p-3 rounded-lg bg-primary/5 border border-primary/20">
        <div class="flex items-center justify-between gap-4 text-sm mb-2">
          <span class="font-semibold text-on-surface">Importing past meetings: ${job.done} of ${job.total}${escapeHtml(soFar)}</span>
          <a href="/settings#import" class="text-primary font-semibold whitespace-nowrap hover:underline">Details</a>
        </div>
        <div class="w-full h-1.5 bg-surface-container rounded-full overflow-hidden"><div class="h-full bg-primary" style="width: ${percent}%"></div></div>
        <p class="text-xs text-on-surface-variant mt-2">It keeps going in the background. We'll email you a summary when it's done.</p>
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
        result.textContent = 'Import finished. Your overview is up to date.';
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
            <span class="text-on-surface truncate">${escapeHtml(meeting.title || 'Meeting')}</span>
            <span class="sm:whitespace-nowrap text-on-surface-variant">${escapeHtml(meetingOutcome(meeting))} · ${escapeHtml(timeAgo(meeting.updated_at))}</span>
          </li>`).join('')}</ul>`
      : '<p class="text-sm text-on-surface-variant">No meetings processed yet. After your next Google Meet with transcription or Gemini notes on, it shows up here within a few minutes. You can also import past meetings.</p>';

    panel().innerHTML = `
      <div class="rounded-xl bg-surface-container-lowest border border-outline-variant px-4 py-3 flex flex-col gap-3">
        ${needsReconnect ? `
          <div class="p-3 rounded-lg bg-error-container text-on-error-container text-sm">
            ${escapeHtml(data.last_error || 'Google access stopped working, so meetings are not being captured.')}
            <a href="/integrations/google/connect" class="font-bold underline ml-1">Reconnect</a>
          </div>` : ''}
        ${!needsReconnect && data.needs_reconsent ? `
          <div class="p-3 rounded-lg bg-primary/10 text-primary text-sm">
            Reconnect once to let Corteza read Gemini notes too.
            <a href="/integrations/google/connect" class="font-bold underline ml-1">Reconnect</a>
          </div>` : ''}
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span class="w-2.5 h-2.5 rounded-full shrink-0 ${needsReconnect ? 'bg-error' : 'bg-tertiary'}" aria-hidden="true"></span>
          <span class="font-semibold text-on-surface">${needsReconnect ? 'Automatic capture paused' : 'Capturing from Google Meet'}</span>
          <span class="text-on-surface-variant">checked ${escapeHtml(timeAgo(data.last_polled_at))} · ${escapeHtml(capturedTotals(data))} from ${plural(data.meetings_processed || 0, 'meeting')}</span>
          <span class="flex flex-wrap items-center gap-x-4 gap-y-1 sm:ml-auto">
            <button id="capture-sync" type="button" class="font-semibold text-primary hover:underline disabled:opacity-50" ${needsReconnect ? 'disabled' : ''}>Check now</button>
            <a href="/settings#import" class="font-semibold text-primary hover:underline">Import past meetings</a>
            <button id="capture-meetings-toggle" type="button" aria-expanded="false" aria-controls="capture-meetings" class="font-semibold text-on-surface-variant hover:text-primary">Latest meetings</button>
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
    button.textContent = 'Checking…';
    try {
      const response = await fetch('/api/integrations/google/sync', { method: 'POST', credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Checking Google Meet failed');
      await loadCapture();
      const message = data.meetings_processed
        ? `Captured ${describe(data.outcomes_by_type || null, data.decisions_captured, data.action_items_captured || 0)} from ${plural(data.meetings_processed, 'new meeting')}.`
        : 'No new meetings with transcripts or notes yet.';
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
      button.textContent = 'Check now';
      result.classList.remove('hidden');
    }
  }

  async function loadCapture() {
    try {
      const response = await fetch('/api/integrations/google', { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load');
      if (!data.configured) {
        panel().classList.add('hidden');
        return;
      }
      if (data.connected) renderConnected(data);
      else renderNotConnected();
      followImport(data);
    } catch (error) {
      panel().innerHTML = `<div class="rounded-xl border border-outline-variant p-6 text-sm text-error">Couldn't load automatic capture status. ${escapeHtml(error.message)}</div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', loadCapture);
})();
