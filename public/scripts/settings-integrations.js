/**
 * Settings → Google Meet integration (automatic capture of meeting outcomes).
 * Talks to /api/integrations/google* (src/integrations/google/routes.js).
 */
(function() {
  'use strict';
  const t = window.t || (key => key); // public/scripts/i18n.js
  const locale = (window.CortezaI18n && window.CortezaI18n.locale) || undefined;

  const body = () => document.getElementById('google-meet-body');

  /** "3 decisions, 1 risk and 2 action items" (outcome-labels.js) */
  function countLabel(total = 0, actionItems = 0, byType = null) {
    return window.CortezaOutcomes.describe(byType, total, actionItems);
  }

  const SKIP_REASONS = {
    one_on_one: t('capture.skip.one_on_one'),
    excluded_title: t('capture.skip.excluded_title'),
    no_transcript: t('capture.skip.no_transcript'),
    too_short: t('capture.skip.too_short'),
    ai_budget: t('meet.skip.ai_budget')
  };

  document.addEventListener('DOMContentLoaded', () => {
    showRedirectMessage();
    loadGoogleIntegration();
  });

  // Escapes quotes too, so it's safe in attribute values
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function formatTime(value) {
    if (!value) return t('time.never');
    return new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  }

  /** Shows the result of the connect flow (?google=connected / ?google_error=…) */
  function showRedirectMessage() {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('google_error');
    if (!params.get('google') && !error) return;

    const banner = document.createElement('div');
    banner.className = `mb-4 p-3 rounded-lg text-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-primary/10 text-primary'}`;
    banner.textContent = error || t('meet.connectedBanner');
    const section = document.getElementById('integrations');
    section.insertBefore(banner, section.children[1]);
    section.scrollIntoView({ behavior: 'smooth' });
    window.history.replaceState({}, '', window.location.pathname);
  }

  async function loadGoogleIntegration() {
    try {
      const response = await fetch('/api/integrations/google');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('common.loadFailed'));

      if (!data.configured) {
        body().innerHTML = `<p>${escapeHtml(t('meet.notConfigured'))}</p>`;
      } else if (!data.connected) {
        renderDisconnected();
      } else {
        await renderConnected(data);
      }
    } catch (error) {
      console.error('Google integration error:', error);
      body().innerHTML = `<p>${escapeHtml(t('meet.loadFailed'))}</p>`;
    }
  }

  function renderDisconnected() {
    body().innerHTML = `
      <ul class="list-disc pl-5 space-y-1 mb-6">
        <li>${escapeHtml(t('meet.disconnected.works'))}</li>
        <li>${escapeHtml(t('meet.disconnected.saved'))}</li>
        <li>${escapeHtml(t('meet.disconnected.skip'))}</li>
      </ul>
      <a href="/integrations/google/connect" class="inline-flex items-center gap-2 bg-primary text-on-primary font-bold py-3 px-6 rounded-lg hover:opacity-90 transition-all">
        <span class="material-symbols-outlined text-xl">link</span>
        ${escapeHtml(t('capture.connect.button'))}
      </a>
    `;
  }

  async function renderConnected(data) {
    const spaces = await loadWritableSpaces();
    const settings = data.settings || {};
    const needsReconnect = data.status !== 'active';

    const spaceOptions = [`<option value="">${escapeHtml(t('meet.mySpace'))}</option>`]
      .concat(spaces.filter(s => !s.is_personal).map(s => `<option value="${escapeHtml(s.space_id)}" ${s.space_id === settings.space_id ? 'selected' : ''}>${escapeHtml((s.settings && s.settings.icon) || '📁')} ${escapeHtml(s.name)}</option>`))
      .join('');

    const recent = (data.recent_meetings || []).map(m => {
      const status = m.status === 'completed'
        ? countLabel(m.decisions_created, m.action_items_created, m.outcomes_by_type)
        : m.status === 'skipped' ? (SKIP_REASONS[m.skip_reason] || t('capture.skipped'))
          : m.status === 'failed' ? t('capture.failed') : t('upload.processing');
      return `<li class="flex flex-col sm:flex-row sm:justify-between gap-0.5 sm:gap-4 py-2 border-b border-outline-variant/50"><span class="text-on-surface">${escapeHtml(m.title || t('capture.meeting'))}</span><span class="sm:whitespace-nowrap">${escapeHtml(status)}</span></li>`;
    }).join('');

    body().innerHTML = `
      ${needsReconnect ? `
        <div class="mb-4 p-3 rounded-lg bg-error-container text-on-error-container">
          ${escapeHtml(data.last_error || t('capture.accessStopped'))}
          <a href="/integrations/google/connect" class="font-bold underline ml-1">${escapeHtml(t('capture.reconnect'))}</a>
        </div>` : ''}
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2 mb-6">
        <span class="flex items-center gap-2 text-on-surface font-semibold">
          <span class="w-2 h-2 rounded-full ${needsReconnect ? 'bg-error' : 'bg-tertiary'}"></span>
          ${escapeHtml(t(needsReconnect ? 'meet.needsReconnect' : 'meet.connectedAs', { email: data.google_email }))}
        </span>
        <span>${escapeHtml(t('meet.lastChecked', { when: formatTime(data.last_polled_at) }))}</span>
        <span>${escapeHtml(t('meet.totals', { outcomes: t('outcomeCounts.outcome', { count: data.decisions_captured }), meetings: t('capture.meetings', { count: data.meetings_processed }) }))}</span>
      </div>
      ${!needsReconnect && data.needs_reconsent ? `
        <div class="mb-4 p-3 rounded-lg bg-surface-container-low border border-outline-variant">
          ${escapeHtml(t('meet.reconsent'))}
          <a href="/integrations/google/connect" class="font-bold underline ml-1">${escapeHtml(t('capture.reconnect'))}</a>
        </div>` : ''}
      ${!needsReconnect && data.last_error ? `<p class="mb-4 text-error">${escapeHtml(t('meet.lastFailed', { error: data.last_error }))}</p>` : ''}
      ${needsReconnect ? '' : data.calendar_connected ? `
        <p class="mb-4 flex items-center gap-2"><span class="material-symbols-outlined text-base text-tertiary" aria-hidden="true">event_available</span>
          ${escapeHtml(t('meet.calendarConnected'))}</p>` : `
        <div class="mb-4 p-3 rounded-lg bg-surface-container-low border border-outline-variant">
          <strong>${escapeHtml(t('meet.calendar.title'))}</strong> ${escapeHtml(t('meet.calendar.body'))}
          <a href="/integrations/google/connect" class="font-bold underline ml-1">${escapeHtml(t('meet.calendar.button'))}</a>
        </div>`}

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <label class="block" data-multi-space>
          <span class="block text-xs mb-1">${escapeHtml(t('meet.saveTo'))}</span>
          <select id="gm-space" class="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3">${spaceOptions}</select>
        </label>
        <label class="block">
          <span class="block text-xs mb-1">${escapeHtml(t('meet.excludeLabel'))}</span>
          <input id="gm-exclude" class="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3" placeholder="${escapeHtml(t('meet.excludePlaceholder'))}" value="${escapeHtml((settings.exclude_keywords || []).join(', '))}">
        </label>
        <label class="block">
          <span class="block text-xs mb-1">${escapeHtml(t('meet.language'))}</span>
          <select id="gm-language" class="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3">
            ${[['auto', t('meet.languageAuto')], ['es', 'Español'], ['en', 'English'], ['pt', 'Português']]
              .map(([value, label]) => `<option value="${value}" ${(settings.language || 'auto') === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <label class="flex items-center gap-3 mt-5">
          <input id="gm-skip-1on1" type="checkbox" ${settings.skip_one_on_one !== false ? 'checked' : ''}>
          <span>${escapeHtml(t('meet.skip1on1'))}</span>
        </label>
      </div>

      <div class="flex flex-wrap gap-3 mb-6">
        <button id="gm-save" class="bg-primary text-on-primary font-bold py-3 px-6 rounded-lg hover:opacity-90 transition-all">${escapeHtml(t('meet.save'))}</button>
        <button id="gm-sync" class="border border-outline-variant text-on-surface font-bold py-3 px-6 rounded-lg hover:bg-surface-container-low transition-all" ${needsReconnect ? 'disabled' : ''}>${escapeHtml(t('meet.checkNow'))}</button>
        <button id="gm-disconnect" class="text-error font-bold py-3 px-6 rounded-lg hover:bg-error/10 transition-all">${escapeHtml(t('meet.disconnect'))}</button>
      </div>

      ${recent ? `<h4 class="text-sm font-bold text-on-surface mb-2">${escapeHtml(t('capture.latest'))}</h4><ul>${recent}</ul>` : `<p>${escapeHtml(t('capture.noMeetings'))}</p>`}

      ${needsReconnect ? '' : renderImportSection(spaceOptions, data.import_max_days || 7)}
    `;

    document.getElementById('gm-save').addEventListener('click', saveSettings);
    document.getElementById('gm-sync').addEventListener('click', syncNow);
    document.getElementById('gm-disconnect').addEventListener('click', disconnect);
    if (!needsReconnect) setupImportSection();

    // An import started earlier is still running on the server: show its progress again
    if (!needsReconnect && data.active_import) trackImport(data.active_import.import_id);

    // /settings#import (from Home): jump to "Import past meetings"
    if (window.location.hash === '#import') {
      const importSection = document.getElementById('gm-import-section');
      if (importSection) importSection.scrollIntoView({ behavior: 'smooth' });
    }
  }

  // ---------------------------------------------------------------------------
  // Import past meetings: pick a period, list meetings, choose which to import
  // (GET /api/integrations/google/meetings, POST/GET /api/integrations/google/imports)
  // ---------------------------------------------------------------------------

  const AVAILABILITY_LABELS = {
    ready: null, // built from has_transcript / has_notes
    pending: t('meet.import.pending'),
    none: t('meet.import.notRecorded')
  };

  const ITEM_STATUS_LABELS = {
    completed: t('meet.import.status.completed'),
    already_imported: t('meet.import.status.already_imported'),
    skipped: t('meet.import.status.skipped'),
    no_transcript: t('capture.skip.no_transcript'),
    not_ready: t('meet.import.status.not_ready'),
    too_old: t('meet.import.status.too_old'),
    extracting: t('meet.import.status.extracting'),
    failed: t('meet.import.status.failed'),
    queued: t('meet.import.status.queued')
  };

  let foundMeetings = [];
  let importTitles = {}; // meeting id → title shown in the list, for the progress view

  function isoDate(date) {
    return date.toISOString().slice(0, 10);
  }

  /**
   * @param {string} spaceOptions
   * @param {number} maxDays - how far back imports can reach (the server checks it too)
   */
  function renderImportSection(spaceOptions, maxDays) {
    const today = new Date();
    const earliest = new Date(today.getTime() - maxDays * 24 * 60 * 60 * 1000);
    return `
      <div id="gm-import-section" class="mt-8 pt-6 border-t border-outline-variant">
        <h4 class="text-lg font-bold text-on-surface mb-1">${escapeHtml(t('capture.importPast'))}</h4>
        <p class="mb-4">${escapeHtml(t('meet.import.intro', { days: Number(maxDays) }))}</p>

        <div class="flex flex-wrap items-end gap-4 mb-4">
          <label class="block">
            <span class="block text-xs mb-1">${escapeHtml(t('meet.import.from'))}</span>
            <input id="gm-import-from" type="date" value="${isoDate(earliest)}" min="${isoDate(earliest)}" max="${isoDate(today)}" class="bg-surface-container-low border border-outline-variant rounded-lg p-3">
          </label>
          <label class="block">
            <span class="block text-xs mb-1">${escapeHtml(t('meet.import.to'))}</span>
            <input id="gm-import-to" type="date" value="${isoDate(today)}" min="${isoDate(earliest)}" max="${isoDate(today)}" class="bg-surface-container-low border border-outline-variant rounded-lg p-3">
          </label>
          <button id="gm-import-find" class="bg-primary text-on-primary font-bold py-3 px-6 rounded-lg hover:opacity-90 transition-all">${escapeHtml(t('meet.import.find'))}</button>
        </div>

        <div id="gm-import-results"></div>
        <div id="gm-import-actions" class="hidden flex flex-wrap items-end gap-4 mt-4">
          <label class="block" data-multi-space>
            <span class="block text-xs mb-1">${escapeHtml(t('meet.saveTo'))}</span>
            <select id="gm-import-space" class="bg-surface-container-low border border-outline-variant rounded-lg p-3">${spaceOptions}</select>
          </label>
          <button id="gm-import-start" class="bg-primary text-on-primary font-bold py-3 px-6 rounded-lg hover:opacity-90 transition-all disabled:opacity-50" disabled>${escapeHtml(t('meet.import.selected', { count: 0 }))}</button>
        </div>
        <div id="gm-import-progress" class="mt-4"></div>
      </div>
    `;
  }

  function setupImportSection() {
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
    button.textContent = t('home.ask.searching');
    results.innerHTML = `<p>${escapeHtml(t('meet.import.looking'))}</p>`;
    try {
      const response = await fetch(`/api/integrations/google/meetings?${new URLSearchParams({ from, to })}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('meet.import.loadFailed'));
      foundMeetings = data.meetings;
      renderMeetingList(data.truncated);
    } catch (error) {
      foundMeetings = [];
      results.innerHTML = `<p class="text-error">${escapeHtml(error.message)}</p>`;
      document.getElementById('gm-import-actions').classList.add('hidden');
    } finally {
      button.disabled = false;
      button.textContent = t('meet.import.find');
    }
  }

  function canImport(meeting) {
    return meeting.availability === 'ready' && meeting.status !== 'completed' && meeting.status !== 'processing';
  }

  function availabilityLabel(meeting) {
    if (meeting.availability !== 'ready') return AVAILABILITY_LABELS[meeting.availability];
    return [meeting.has_transcript ? t('meet.import.transcript') : null, meeting.has_notes ? t('meet.import.notes') : null].filter(Boolean).join(' + ');
  }

  function statusLabel(meeting) {
    if (meeting.status === 'completed') return `${t('meet.import.status.completed')} · ${countLabel(meeting.decisions_created, 0, meeting.outcomes_by_type)}`;
    if (meeting.status === 'skipped') return `${t('meet.import.skippedAuto')}${SKIP_REASONS[meeting.skip_reason] ? ` (${SKIP_REASONS[meeting.skip_reason]})` : ''}`;
    if (meeting.status === 'failed') return t('meet.import.failedEarlier');
    if (meeting.status === 'processing') return t('upload.processing');
    return t('meet.import.notImported');
  }

  function renderMeetingList(truncated) {
    const results = document.getElementById('gm-import-results');
    const actions = document.getElementById('gm-import-actions');

    if (foundMeetings.length === 0) {
      results.innerHTML = `<p>${escapeHtml(t('meet.import.none'))}</p>`;
      actions.classList.add('hidden');
      return;
    }

    const importable = foundMeetings.filter(canImport).length;
    const rows = foundMeetings.map((meeting, index) => {
      const date = meeting.started_at ? new Date(meeting.started_at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '';
      const title = meeting.url && /^https:\/\//.test(meeting.url)
        ? `<a href="${escapeHtml(meeting.url).replace(/"/g, '&quot;')}" target="_blank" rel="noopener" class="text-primary hover:underline">${escapeHtml(meeting.title)}</a>`
        : escapeHtml(meeting.title);
      return `
        <tr class="border-b border-outline-variant/50 ${canImport(meeting) ? '' : 'opacity-60'}">
          <td class="py-2 pr-3"><input type="checkbox" class="gm-import-check" data-index="${index}" ${canImport(meeting) ? '' : 'disabled'}></td>
          <td class="py-2 pr-4 whitespace-nowrap">${escapeHtml(date)}</td>
          <td class="py-2 pr-4 text-on-surface">${title}</td>
          <td class="py-2 pr-4 whitespace-nowrap">${escapeHtml(t('meet.import.people', { count: meeting.participant_count }))}</td>
          <td class="py-2 pr-4 whitespace-nowrap">${escapeHtml(availabilityLabel(meeting))}</td>
          <td class="py-2 whitespace-nowrap">${escapeHtml(statusLabel(meeting))}</td>
        </tr>`;
    }).join('');

    results.innerHTML = `
      <div class="flex justify-between items-center mb-2">
        <span>${escapeHtml(t('meet.import.found', { count: foundMeetings.length, importable }))}${truncated ? ` ${escapeHtml(t('meet.import.truncated'))}` : ''}</span>
        ${importable ? `<label class="flex items-center gap-2"><input id="gm-import-all" type="checkbox"> ${escapeHtml(t('meet.import.selectAll'))}</label>` : ''}
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead><tr class="text-xs uppercase tracking-wide border-b border-outline-variant">
            <th class="py-2"></th><th class="py-2">${escapeHtml(t('detail.date'))}</th><th class="py-2">${escapeHtml(t('capture.meeting'))}</th><th class="py-2">${escapeHtml(t('meet.import.participants'))}</th><th class="py-2">${escapeHtml(t('meet.import.available'))}</th><th class="py-2">${escapeHtml(t('actions.statusLabel'))}</th>
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
    button.textContent = t('meet.import.selected', { count });
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
      if (!response.ok) throw new Error(data.error || t('meet.import.startFailed'));
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
      if (!response.ok) throw new Error(data.error || t('meet.import.trackFailed'));
      const job = data.import;
      const percent = job.total ? Math.round((job.done / job.total) * 100) : 0;

      const items = job.items.map(item => `
        <li class="flex flex-col sm:flex-row sm:justify-between gap-0.5 sm:gap-4 py-1">
          <span class="text-on-surface">${escapeHtml(item.title || importTitles[item.meeting_id] || t('capture.meeting'))}</span>
          <span class="sm:whitespace-nowrap">${escapeHtml(ITEM_STATUS_LABELS[item.status] || item.status)}${item.status === 'completed' ? ` · ${countLabel(item.decisions_created, item.action_items_created, item.outcomes_by_type)}` : ''}${item.error ? ` (${escapeHtml(item.error)})` : ''}</span>
        </li>`).join('');

      const running = job.status === 'running';
      progress.innerHTML = `
        <div class="p-4 rounded-lg bg-surface-container-low border border-outline-variant">
          <p class="font-bold text-on-surface mb-2">
            ${escapeHtml(running ? t('meet.import.running', { done: job.done, total: job.total }) : job.status === 'failed' ? (job.error || t('meet.import.failed')) : t('meet.import.done', { outcomes: countLabel(job.decisions_created, job.action_items_created, job.outcomes_by_type), meetings: t('capture.meetings', { count: job.total }) }))}
          </p>
          <div class="w-full h-2 bg-surface-container rounded-full overflow-hidden mb-3"><div class="h-full bg-primary" style="width: ${percent}%"></div></div>
          ${running ? `<p class="text-sm text-on-surface-variant mb-3">${escapeHtml(t('meet.import.background'))}</p>` : ''}
          <ul>${items}</ul>
          ${running ? '' : `<a href="/dashboard" class="inline-block mt-3 text-primary font-bold">${escapeHtml(t('meet.import.openHome'))}</a>`}
        </div>`;

      if (running) {
        // While the batch runs (items "extracting") results come in all at once: check less often
        const waitingOnBatch = (job.items || []).some(item => item.status === 'extracting');
        setTimeout(() => trackImport(importId), waitingOnBatch ? 30000 : 3000);
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
      exclude_keywords: document.getElementById('gm-exclude').value,
      language: document.getElementById('gm-language').value
    };
    const response = await fetch('/api/integrations/google/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    alert(response.ok ? t('meet.saved') : (data.error || t('common.couldNotSave')));
  }

  async function syncNow(event) {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = t('capture.checking');
    try {
      const response = await fetch('/api/integrations/google/sync', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('capture.checkFailed'));
      const waiting = (data.results || []).filter(r => r.status === 'waiting').length;
      alert(t('capture.captured', { outcomes: countLabel(data.decisions_captured, data.action_items_captured, data.outcomes_by_type), meetings: t('capture.meetings', { count: data.meetings_processed }) }) +
        (waiting ? ` ${t('meet.waiting', { count: waiting })}` : ''));
    } catch (error) {
      alert(error.message);
    }
    loadGoogleIntegration();
  }

  async function disconnect() {
    if (!confirm(t('meet.confirmDisconnect'))) return;
    const response = await fetch('/api/integrations/google/disconnect', { method: 'POST' });
    if (!response.ok) alert(t('meet.disconnectFailed'));
    loadGoogleIntegration();
  }
})();
