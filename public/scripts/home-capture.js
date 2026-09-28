/**
 * Home: automatic capture from Google Meet comes first.
 *
 * - #capture-panel: connect Google Meet (if not connected), or capture status,
 *   "Check now", "Import past meetings" and the latest processed meetings.
 * - #my-actions-panel: the signed-in user's open action items.
 *
 * APIs: GET /api/integrations/google, POST /api/integrations/google/sync,
 *       GET /api/action-items?owner=me&status=open
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

  function meetingOutcome(meeting) {
    if (meeting.status === 'completed') {
      const parts = [plural(meeting.decisions_created || 0, 'decision')];
      if (meeting.action_items_created) parts.push(plural(meeting.action_items_created, 'action item'));
      return parts.join(', ');
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

  function renderConnected(data) {
    const needsReconnect = data.status !== 'active';
    const recent = (data.recent_meetings || []).slice(0, 5);
    const recentHtml = recent.length
      ? `<ul class="divide-y divide-outline-variant/50">${recent.map(meeting => `
          <li class="flex items-center justify-between gap-4 py-2 text-sm">
            <span class="text-on-surface truncate">${escapeHtml(meeting.title || 'Meeting')}</span>
            <span class="whitespace-nowrap text-on-surface-variant">${escapeHtml(meetingOutcome(meeting))} · ${escapeHtml(timeAgo(meeting.updated_at))}</span>
          </li>`).join('')}</ul>`
      : '<p class="text-sm text-on-surface-variant">No meetings processed yet. After your next Google Meet with transcription or Gemini notes on, it shows up here within a few minutes. You can also import past meetings.</p>';

    panel().innerHTML = `
      <div class="rounded-xl bg-surface-container-lowest border border-outline-variant p-6 shadow-sm h-full flex flex-col gap-4">
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
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="w-2.5 h-2.5 rounded-full ${needsReconnect ? 'bg-error' : 'bg-tertiary'}"></span>
              <h3 class="text-lg font-semibold text-on-surface">${needsReconnect ? 'Automatic capture paused' : 'Capturing automatically from Google Meet'}</h3>
            </div>
            <p class="text-sm text-on-surface-variant">${escapeHtml(data.google_email || '')} · last checked ${escapeHtml(timeAgo(data.last_polled_at))} · ${plural(data.decisions_captured || 0, 'decision')} from ${plural(data.meetings_processed || 0, 'meeting')}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button id="capture-sync" type="button" class="border border-outline-variant text-on-surface font-semibold text-sm py-2 px-4 rounded-lg hover:bg-surface-container-low transition-all" ${needsReconnect ? 'disabled' : ''}>
              <span class="material-symbols-outlined align-middle text-base">refresh</span> Check now
            </button>
            <a href="/settings#import" class="bg-primary text-on-primary font-semibold text-sm py-2 px-4 rounded-lg hover:opacity-90 transition-all">
              <span class="material-symbols-outlined align-middle text-base">history</span> Import past meetings
            </a>
            <a href="/settings#integrations" class="text-on-surface-variant text-sm py-2 px-2 hover:text-primary" title="Capture settings">
              <span class="material-symbols-outlined align-middle">tune</span>
            </a>
          </div>
        </div>
        <p id="capture-sync-result" class="hidden text-sm"></p>
        <div>
          <h4 class="text-sm font-semibold text-on-surface mb-1">Latest meetings</h4>
          ${recentHtml}
        </div>
      </div>`;

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
        ? `Captured ${plural(data.decisions_captured, 'decision')} from ${plural(data.meetings_processed, 'new meeting')}.`
        : 'No new meetings with transcripts or notes yet.';
      const refreshed = document.getElementById('capture-sync-result');
      if (refreshed) {
        refreshed.textContent = message;
        refreshed.className = 'text-sm text-tertiary';
      }
      if (data.meetings_processed && typeof window.fetchDecisions === 'function') {
        window.fetchDecisions();
        if (typeof window.fetchStats === 'function') window.fetchStats();
        loadMyActions();
      }
    } catch (error) {
      result.textContent = error.message;
      result.className = 'text-sm text-error';
      button.disabled = false;
      button.textContent = 'Check now';
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
    } catch (error) {
      panel().innerHTML = `<div class="rounded-xl border border-outline-variant p-6 text-sm text-error">Couldn't load automatic capture status. ${escapeHtml(error.message)}</div>`;
    }
  }

  async function loadMyActions() {
    const container = document.getElementById('my-actions-panel');
    if (!container) return;
    try {
      const response = await fetch('/api/action-items?owner=me&status=open', { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load');
      const items = data.items || [];
      const today = new Date().toISOString().slice(0, 10);
      const overdue = items.filter(item => item.due_date && item.due_date < today).length;
      const undated = items.filter(item => !item.due_date).length;

      container.innerHTML = `
        <div class="rounded-xl bg-surface-container-lowest border border-outline-variant p-6 shadow-sm h-full flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold text-on-surface">My action items</h3>
            <a href="/actions" class="text-sm text-primary font-semibold hover:underline">View all</a>
          </div>
          <div class="flex gap-4 text-sm">
            <span><strong class="text-2xl text-on-surface">${items.length}</strong> open</span>
            ${overdue ? `<span class="text-error"><strong class="text-2xl">${overdue}</strong> overdue</span>` : ''}
            ${undated ? `<span class="text-on-surface-variant"><strong class="text-2xl">${undated}</strong> no date</span>` : ''}
          </div>
          ${items.length ? `<ul class="flex flex-col gap-2 text-sm">${items.slice(0, 4).map(item => `
            <li class="flex justify-between gap-3">
              <a href="/actions?item=${encodeURIComponent(item.item_id)}" class="text-on-surface hover:text-primary line-clamp-2">${escapeHtml(item.text)}</a>
              <span class="whitespace-nowrap ${item.due_date && item.due_date < today ? 'text-error' : 'text-on-surface-variant'}">${item.due_date ? escapeHtml(new Date(`${item.due_date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) : 'No date'}</span>
            </li>`).join('')}</ul>`
            : '<p class="text-sm text-on-surface-variant">Nothing assigned to you. Action items from your meetings will show up here.</p>'}
        </div>`;
    } catch (error) {
      container.innerHTML = `<div class="rounded-xl border border-outline-variant p-6 text-sm text-on-surface-variant">Couldn't load your action items.</div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadCapture();
    loadMyActions();
  });
})();
