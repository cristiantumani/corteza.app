/**
 * Settings → Morning summary: the time zone the daily summary email is sent in.
 * Talks to /api/me/timezone (src/http/timezone.js). Choosing one here is "manual": the
 * browser's automatic report (public/scripts/timezone.js) no longer changes it.
 */
(function() {
  'use strict';

  const $ = id => document.getElementById(id);

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('timezone-select')) return;
    $('timezone-select').addEventListener('change', save);
    load();
  });

  function browserTimeZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (error) { return ''; }
  }

  function allTimeZones(extra) {
    let zones = [];
    try { zones = Intl.supportedValuesOf('timeZone'); } catch (error) { /* older browsers */ }
    for (const zone of extra) if (zone && !zones.includes(zone)) zones.push(zone);
    return zones.sort();
  }

  function setStatus(text, isError = false) {
    const el = $('timezone-status');
    el.textContent = text;
    el.className = `text-xs mt-2 ${isError ? 'text-error' : 'text-on-surface-variant'}`;
  }

  async function load() {
    const select = $('timezone-select');
    let saved = { timezone: null, source: null };
    try {
      const response = await fetch('/api/me/timezone', { credentials: 'include' });
      if (response.ok) saved = await response.json();
    } catch (error) { /* show the browser's */ }

    const detected = browserTimeZone();
    const current = saved.timezone || detected || 'UTC';
    select.textContent = '';
    for (const zone of allTimeZones([current, 'UTC'])) {
      const option = document.createElement('option');
      option.value = zone;
      option.textContent = zone.replace(/_/g, ' ');
      select.appendChild(option);
    }
    select.value = current;
    setStatus(saved.source === 'manual' ? 'Set by you.' : 'Detected from your browser.');
  }

  async function save() {
    const timezone = $('timezone-select').value;
    setStatus('Saving…');
    try {
      const response = await fetch('/api/me/timezone', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone, manual: true })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.saved) throw new Error(data.error || 'Could not save');
      setStatus('Saved. Your summary arrives at 8:00 AM in this time zone.');
    } catch (error) {
      setStatus(error.message, true);
    }
  }
})();
