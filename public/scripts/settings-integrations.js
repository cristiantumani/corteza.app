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

      ${needsReconnect ? '' : renderImportSection(spaceOptions)}
    `;

    document.getElementById('gm-save').addEventListener('click', saveSettings);
    document.getElementById('gm-sync').addEventListener('click', syncNow);
    document.getElementById('gm-disconnect').addEventListener('click', disconnect);
    if (!needsReconnect) setupImportSection();
  }

  // ---------------------------------------------------------------------------
  // Import past meetings: pick a period, list meetings, choose which to import
  // (GET /api/integrations/google/meetings, POST/GET /api/integrations/google/imports)
  // ---------------------------------------------------------------------------

  const AVAILABILITY_LABELS = {
    ready: null, // built from has_transcript / has_notes
    pending: 'Being generated by Google',
    none: 'Not recorded'
  };

  const ITEM_STATUS_LABELS = {
    completed: 'Imported',
    already_imported: 'Already imported',
    skipped: 'Skipped (too short)',
    no_transcript: 'No transcript or notes',
    not_ready: 'Transcript not ready yet',
    failed: 'Failed',
    queued: 'Waiting…'
  };

  let foundMeetings = [];
  let importTitles = {}; // meeting id → title shown in the list, for the progress view

  function isoDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function renderImportSection(spaceOptions) {
    const today = new Date();
    const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    return `
      <div class="mt-8 pt-6 border-t border-outline-variant">
        <h4 class="text-lg font-bold text-on-surface mb-1">Import past meetings</h4>
        <p class="mb-4">Pick a period, see the meetings Google has transcripts or notes for, and choose which ones to capture decisions from.</p>

        <div class="flex flex-wrap items-end gap-4 mb-4">
          <label class="block">
            <span class="block text-xs mb-1">Month</span>
            <input id="gm-import-month" type="month" max="${today.toISOString().slice(0, 7)}" class="bg-surface-container-low border border-outline-variant rounded-lg p-3">
          </label>
          <span class="pb-3">or</span>
          <label class="block">
            <span class="block text-xs mb-1">From</span>
            <input id="gm-import-from" type="date" value="${isoDate(monthAgo)}" max="${isoDate(today)}" class="bg-surface-container-low border border-outline-variant rounded-lg p-3">
          </label>
          <label class="block">
            <span class="block text-xs mb-1">To</span>
            <input id="gm-import-to" type="date" value="${isoDate(today)}" max="${isoDate(today)}" class="bg-surface-container-low border border-outline-variant rounded-lg p-3">
          </label>
          <div class="flex gap-2 pb-1">
            <button type="button" data-days="7" class="gm-preset text-xs border border-outline-variant rounded-full py-2 px-3 hover:bg-surface-container-low">Last 7 days</button>
            <button type="button" data-days="30" class="gm-preset text-xs border border-outline-variant rounded-full py-2 px-3 hover:bg-surface-container-low">Last 30 days</button>
            <button type="button" data-days="90" class="gm-preset text-xs border border-outline-variant rounded-full py-2 px-3 hover:bg-surface-container-low">Last 90 days</button>
          </div>
          <button id="gm-import-find" class="bg-primary text-on-primary font-bold py-3 px-6 rounded-lg hover:opacity-90 transition-all">Find meetings</button>
        </div>

        <div id="gm-import-results"></div>
        <div id="gm-import-actions" class="hidden flex flex-wrap items-end gap-4 mt-4">
          <label class="block">
            <span class="block text-xs mb-1">Save decisions to</span>
            <select id="gm-import-space" class="bg-surface-container-low border border-outline-variant rounded-lg p-3">${spaceOptions}</select>
          </label>
          <button id="gm-import-start" class="bg-primary text-on-primary font-bold py-3 px-6 rounded-lg hover:opacity-90 transition-all disabled:opacity-50" disabled>Import selected (0)</button>
        </div>
        <div id="gm-import-progress" class="mt-4"></div>
      </div>
    `;
  }

  function setupImportSection() {
    document.getElementById('gm-import-month').addEventListener('change', event => {
      if (!event.target.value) return;
      const [year, month] = event.target.value.split('-').map(Number);
      const first = new Date(Date.UTC(year, month - 1, 1));
      const last = new Date(Math.min(Date.UTC(year, month, 0), Date.now()));
      document.getElementById('gm-import-from').value = isoDate(first);
      document.getElementById('gm-import-to').value = isoDate(last);
    });
    document.querySelectorAll('.gm-preset').forEach(button => {
      button.addEventListener('click', () => {
        const today = new Date();
        document.getElementById('gm-import-month').value = '';
        document.getElementById('gm-import-from').value = isoDate(new Date(today.getTime() - Number(button.dataset.days) * 24 * 60 * 60 * 1000));
        document.getElementById('gm-import-to').value = isoDate(today);
      });
    });
    document.getElementById('gm-import-find').addEventListener('click', () => findMeetings());
    document.getElementById('gm-import-start').addEventListener('click', startImport);
  }

  /** @param {boolean} [keepProgress] - keep the last import's summary (refresh after an import) */
  async function findMeetings(keepProgress = false) {
    const from = document.getElementById('gm-import-from').value;
    const to = document.getElementById('gm-import-to').value;
    const results = document.getElementById('gm-import-results');
    const button = document.getElementById('gm-import-find');
    if (!keepProgress) document.getElementById('gm-import-progress').innerHTML = '';

    button.disabled = true;
    button.textContent = 'Searching…';
    results.innerHTML = '<p>Looking for meetings in Google Meet…</p>';
    try {
      const response = await fetch(`/api/integrations/google/meetings?${new URLSearchParams({ from, to })}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load meetings');
      foundMeetings = data.meetings;
      renderMeetingList(data.truncated);
    } catch (error) {
      foundMeetings = [];
      results.innerHTML = `<p class="text-error">${escapeHtml(error.message)}</p>`;
      document.getElementById('gm-import-actions').classList.add('hidden');
    } finally {
      button.disabled = false;
      button.textContent = 'Find meetings';
    }
  }

  function canImport(meeting) {
    return meeting.availability === 'ready' && meeting.status !== 'completed' && meeting.status !== 'processing';
  }

  function availabilityLabel(meeting) {
    if (meeting.availability !== 'ready') return AVAILABILITY_LABELS[meeting.availability];
    return [meeting.has_transcript ? 'Transcript' : null, meeting.has_notes ? 'Gemini notes' : null].filter(Boolean).join(' + ');
  }

  function statusLabel(meeting) {
    if (meeting.status === 'completed') return `Imported · ${meeting.decisions_created} decision${meeting.decisions_created === 1 ? '' : 's'}`;
    if (meeting.status === 'skipped') return `Skipped automatically${SKIP_REASONS[meeting.skip_reason] ? ` (${SKIP_REASONS[meeting.skip_reason].replace(' (skipped)', '')})` : ''}`;
    if (meeting.status === 'failed') return 'Failed earlier';
    if (meeting.status === 'processing') return 'Processing…';
    return 'Not imported';
  }

  function renderMeetingList(truncated) {
    const results = document.getElementById('gm-import-results');
    const actions = document.getElementById('gm-import-actions');

    if (foundMeetings.length === 0) {
      results.innerHTML = '<p>No Google Meet meetings found in this period.</p>';
      actions.classList.add('hidden');
      return;
    }

    const importable = foundMeetings.filter(canImport).length;
    const rows = foundMeetings.map((meeting, index) => {
      const date = meeting.started_at ? new Date(meeting.started_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
      const title = meeting.url && /^https:\/\//.test(meeting.url)
        ? `<a href="${escapeHtml(meeting.url).replace(/"/g, '&quot;')}" target="_blank" rel="noopener" class="text-primary hover:underline">${escapeHtml(meeting.title)}</a>`
        : escapeHtml(meeting.title);
      return `
        <tr class="border-b border-outline-variant/50 ${canImport(meeting) ? '' : 'opacity-60'}">
          <td class="py-2 pr-3"><input type="checkbox" class="gm-import-check" data-index="${index}" ${canImport(meeting) ? '' : 'disabled'}></td>
          <td class="py-2 pr-4 whitespace-nowrap">${escapeHtml(date)}</td>
          <td class="py-2 pr-4 text-on-surface">${title}</td>
          <td class="py-2 pr-4 whitespace-nowrap">${meeting.participant_count} people</td>
          <td class="py-2 pr-4 whitespace-nowrap">${escapeHtml(availabilityLabel(meeting))}</td>
          <td class="py-2 whitespace-nowrap">${escapeHtml(statusLabel(meeting))}</td>
        </tr>`;
    }).join('');

    results.innerHTML = `
      <div class="flex justify-between items-center mb-2">
        <span>${foundMeetings.length} meeting${foundMeetings.length === 1 ? '' : 's'} found, ${importable} can be imported${truncated ? ' (showing the most recent 200; pick a shorter period to see all)' : ''}</span>
        ${importable ? '<label class="flex items-center gap-2"><input id="gm-import-all" type="checkbox"> Select all available</label>' : ''}
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead><tr class="text-xs uppercase tracking-wide border-b border-outline-variant">
            <th class="py-2"></th><th class="py-2">Date</th><th class="py-2">Meeting</th><th class="py-2">Participants</th><th class="py-2">Available</th><th class="py-2">Status</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    actions.classList.toggle('hidden', importable === 0);
    document.querySelectorAll('.gm-import-check').forEach(box => box.addEventListener('change', updateSelectedCount));
    const all = document.getElementById('gm-import-all');
    if (all) {
      all.addEventListener('change', () => {
        document.querySelectorAll('.gm-import-check:not(:disabled)').forEach(box => { box.checked = all.checked; });
        updateSelectedCount();
      });
    }
    updateSelectedCount();
  }

  function selectedMeetingIds() {
    return [...document.querySelectorAll('.gm-import-check:checked')].map(box => foundMeetings[Number(box.dataset.index)].id);
  }

  function updateSelectedCount() {
    const count = selectedMeetingIds().length;
    const button = document.getElementById('gm-import-start');
    button.textContent = `Import selected (${count})`;
    button.disabled = count === 0;
  }

  async function startImport() {
    const ids = selectedMeetingIds();
    if (ids.length === 0) return;
    importTitles = Object.fromEntries(foundMeetings.map(meeting => [meeting.id, meeting.title]));
    const button = document.getElementById('gm-import-start');
    button.disabled = true;

    try {
      const response = await fetch('/api/integrations/google/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_ids: ids, space_id: document.getElementById('gm-import-space').value || null })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not start the import');
      document.getElementById('gm-import-actions').classList.add('hidden');
      trackImport(data.import_id);
    } catch (error) {
      alert(error.message);
      button.disabled = false;
    }
  }

  async function trackImport(importId) {
    const progress = document.getElementById('gm-import-progress');
    try {
      const response = await fetch(`/api/integrations/google/imports/${encodeURIComponent(importId)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load the import');
      const job = data.import;
      const percent = job.total ? Math.round((job.done / job.total) * 100) : 0;

      const items = job.items.map(item => `
        <li class="flex justify-between gap-4 py-1">
          <span class="text-on-surface">${escapeHtml(item.title || importTitles[item.meeting_id] || 'Meeting')}</span>
          <span class="whitespace-nowrap">${escapeHtml(ITEM_STATUS_LABELS[item.status] || item.status)}${item.status === 'completed' ? ` · ${item.decisions_created} decision${item.decisions_created === 1 ? '' : 's'}` : ''}${item.error ? ` (${escapeHtml(item.error)})` : ''}</span>
        </li>`).join('');

      const running = job.status === 'running';
      progress.innerHTML = `
        <div class="p-4 rounded-lg bg-surface-container-low border border-outline-variant">
          <p class="font-bold text-on-surface mb-2">
            ${running ? `Importing… ${job.done} of ${job.total} meetings` : job.status === 'failed' ? escapeHtml(job.error || 'Import failed') : `Done: ${job.decisions_created} decision${job.decisions_created === 1 ? '' : 's'} captured from ${job.total} meeting${job.total === 1 ? '' : 's'}`}
          </p>
          <div class="w-full h-2 bg-surface-container rounded-full overflow-hidden mb-3"><div class="h-full bg-primary" style="width: ${percent}%"></div></div>
          <ul>${items}</ul>
          ${running ? '' : '<a href="/dashboard" class="inline-block mt-3 text-primary font-bold">Open dashboard →</a>'}
        </div>`;

      if (running) {
        setTimeout(() => trackImport(importId), 3000);
      } else {
        findMeetings(true); // refresh statuses in the list, keep this summary
      }
    } catch (error) {
      progress.innerHTML = `<p class="text-error">${escapeHtml(error.message)}</p>`;
    }
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
