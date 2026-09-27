/**
 * Settings → Google Meet integration (automatic decision capture).
 * Talks to /api/integrations/google* (src/integrations/google/routes.js).
 */
(function() {
  'use strict';

  const body = () => document.getElementById('google-meet-body');

  const SKIP_REASONS = {
    one_on_one: '1:1 meeting (skipped)',
    excluded_title: 'Excluded by title',
    no_transcript: 'No transcript or notes',
    too_short: 'Too short'
  };

  document.addEventListener('DOMContentLoaded', () => {
    showRedirectMessage();
    loadGoogleIntegration();
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  function formatTime(value) {
    if (!value) return 'never';
    return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  /** Shows the result of the connect flow (?google=connected / ?google_error=…) */
  function showRedirectMessage() {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('google_error');
    if (!params.get('google') && !error) return;

    const banner = document.createElement('div');
    banner.className = `mb-4 p-3 rounded-lg text-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-primary/10 text-primary'}`;
    banner.textContent = error || 'Google Meet connected. Corteza will check your meetings every few minutes.';
    const section = document.getElementById('integrations');
    section.insertBefore(banner, section.children[1]);
    section.scrollIntoView({ behavior: 'smooth' });
    window.history.replaceState({}, '', window.location.pathname);
  }

  async function loadGoogleIntegration() {
    try {
      const response = await fetch('/api/integrations/google');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load');

      if (!data.configured) {
        body().innerHTML = '<p>Google is not configured on this server yet.</p>';
      } else if (!data.connected) {
        renderDisconnected();
      } else {
        await renderConnected(data);
      }
    } catch (error) {
      console.error('Google integration error:', error);
      body().innerHTML = '<p>Could not load the Google Meet integration. Refresh to try again.</p>';
    }
  }

  function renderDisconnected() {
    body().innerHTML = `
      <ul class="list-disc pl-5 space-y-1 mb-6">
        <li>Works with meetings where <strong>transcription</strong> or <strong>Gemini "Take notes for me"</strong> is on.</li>
        <li>Decisions are saved automatically and marked <em>AI-captured</em>. You can edit or delete them.</li>
        <li>1:1 meetings are skipped by default. You can exclude meetings by title.</li>
      </ul>
      <a href="/integrations/google/connect" class="inline-flex items-center gap-2 bg-primary text-on-primary font-bold py-3 px-6 rounded-lg hover:opacity-90 transition-all">
        <span class="material-symbols-outlined text-xl">link</span>
        Connect Google Meet
      </a>
    `;
  }

  async function renderConnected(data) {
    const spaces = await loadWritableSpaces();
    const settings = data.settings || {};
    const needsReconnect = data.status !== 'active';

    const spaceOptions = [`<option value="">Default space</option>`]
      .concat(spaces.map(s => `<option value="${escapeHtml(s.space_id)}" ${s.space_id === settings.space_id ? 'selected' : ''}>${escapeHtml((s.settings && s.settings.icon) || '📁')} ${escapeHtml(s.name)}</option>`))
      .join('');

    const recent = (data.recent_meetings || []).map(m => {
      const status = m.status === 'completed'
        ? `${m.decisions_created} decision${m.decisions_created === 1 ? '' : 's'}`
        : m.status === 'skipped' ? (SKIP_REASONS[m.skip_reason] || 'Skipped')
          : m.status === 'failed' ? 'Failed (will retry)' : 'Processing';
      return `<li class="flex justify-between gap-4 py-2 border-b border-outline-variant/50"><span class="text-on-surface">${escapeHtml(m.title || 'Meeting')}</span><span class="whitespace-nowrap">${escapeHtml(status)}</span></li>`;
    }).join('');

    body().innerHTML = `
      ${needsReconnect ? `
        <div class="mb-4 p-3 rounded-lg bg-error-container text-on-error-container">
          ${escapeHtml(data.last_error || 'Google access stopped working.')}
          <a href="/integrations/google/connect" class="font-bold underline ml-1">Reconnect</a>
        </div>` : ''}
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2 mb-6">
        <span class="flex items-center gap-2 text-on-surface font-semibold">
          <span class="w-2 h-2 rounded-full ${needsReconnect ? 'bg-error' : 'bg-tertiary'}"></span>
          ${needsReconnect ? 'Needs reconnecting' : 'Connected'} as ${escapeHtml(data.google_email)}
        </span>
        <span>Last checked: ${escapeHtml(formatTime(data.last_polled_at))}</span>
        <span>${data.decisions_captured} decisions from ${data.meetings_processed} meetings</span>
      </div>
      ${!needsReconnect && data.last_error ? `<p class="mb-4 text-error">Last check failed: ${escapeHtml(data.last_error)}</p>` : ''}

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <label class="block">
          <span class="block text-xs mb-1">Save decisions to</span>
          <select id="gm-space" class="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3">${spaceOptions}</select>
        </label>
        <label class="block">
          <span class="block text-xs mb-1">Skip meetings whose title contains (comma separated)</span>
          <input id="gm-exclude" class="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3" placeholder="e.g. 1:1, interview, personal" value="${escapeHtml((settings.exclude_keywords || []).join(', '))}">
        </label>
        <label class="flex items-center gap-3 mt-5">
          <input id="gm-skip-1on1" type="checkbox" ${settings.skip_one_on_one !== false ? 'checked' : ''}>
          <span>Skip 1:1 meetings (2 people or fewer)</span>
        </label>
      </div>

      <div class="flex flex-wrap gap-3 mb-6">
        <button id="gm-save" class="bg-primary text-on-primary font-bold py-3 px-6 rounded-lg hover:opacity-90 transition-all">Save settings</button>
        <button id="gm-sync" class="border border-outline-variant text-on-surface font-bold py-3 px-6 rounded-lg hover:bg-surface-container-low transition-all" ${needsReconnect ? 'disabled' : ''}>Check for new meetings now</button>
        <button id="gm-disconnect" class="text-error font-bold py-3 px-6 rounded-lg hover:bg-error/10 transition-all">Disconnect</button>
      </div>

      ${recent ? `<h4 class="text-sm font-bold text-on-surface mb-2">Recent meetings</h4><ul>${recent}</ul>` : '<p>No meetings processed yet. After your next Google Meet with transcription or Gemini notes on, decisions show up here within a few minutes.</p>'}
    `;

    document.getElementById('gm-save').addEventListener('click', saveSettings);
    document.getElementById('gm-sync').addEventListener('click', syncNow);
    document.getElementById('gm-disconnect').addEventListener('click', disconnect);
  }

  async function loadWritableSpaces() {
    try {
      const response = await fetch(`/api/spaces?workspace_id=${encodeURIComponent(WORKSPACE_ID)}&writable=true`);
      const data = await response.json();
      return data.spaces || [];
    } catch (error) {
      return [];
    }
  }

  async function saveSettings() {
    const payload = {
      space_id: document.getElementById('gm-space').value || null,
      skip_one_on_one: document.getElementById('gm-skip-1on1').checked,
      exclude_keywords: document.getElementById('gm-exclude').value
    };
    const response = await fetch('/api/integrations/google/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    alert(response.ok ? 'Google Meet settings saved' : (data.error || 'Failed to save settings'));
  }

  async function syncNow(event) {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Checking…';
    try {
      const response = await fetch('/api/integrations/google/sync', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Check failed');
      const waiting = (data.results || []).filter(r => r.status === 'waiting').length;
      alert(`Captured ${data.decisions_captured} decision(s) from ${data.meetings_processed} meeting(s).` +
        (waiting ? ` ${waiting} meeting(s) are still waiting for Google to finish the transcript.` : ''));
    } catch (error) {
      alert(error.message);
    }
    loadGoogleIntegration();
  }

  async function disconnect() {
    if (!confirm('Disconnect Google Meet? Corteza will stop capturing decisions from your meetings. Decisions already captured stay.')) return;
    const response = await fetch('/api/integrations/google/disconnect', { method: 'POST' });
    if (!response.ok) alert('Failed to disconnect');
    loadGoogleIntegration();
  }
})();
