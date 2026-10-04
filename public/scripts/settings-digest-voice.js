/**
 * Settings → Morning summary → Your morning partner: Classic, The Sergeant or The Sarcastic
 * Colleague, saved as soon as one is picked. Admins also get the workspace switch.
 * Talks to /api/me/digest-voice and /api/workspace/digest-voices (src/http/digest-voice.js).
 */
(function() {
  'use strict';

  const $ = id => document.getElementById(id);
  const VOICES = {
    classic: { name: 'Classic', about: 'The plain summary: your numbers and your list.' },
    sergeant: { name: 'The Sergeant', about: 'Tough love. Short, direct, no excuses.' },
    sarcastic: { name: 'The Sarcastic Colleague', about: 'Dry irony about your to-do list. Never about you.' }
  };
  let state = null;

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('digest-voice-options')) return;
    load();
  });

  function setStatus(text, isError = false) {
    const el = $('digest-voice-status');
    el.textContent = text;
    el.className = `text-xs mt-2 block ${isError ? 'text-error' : 'text-on-surface-variant'}`;
  }

  function render() {
    const box = $('digest-voice-options');
    const disabled = !state.workspace_enabled;
    box.textContent = '';
    for (const key of state.voices) {
      const voice = VOICES[key];
      if (!voice) continue;
      const label = document.createElement('label');
      const selected = (disabled ? 'classic' : state.voice) === key;
      label.className = `flex flex-col gap-1 p-4 rounded-lg border cursor-pointer ${selected ? 'border-primary bg-primary/5' : 'border-outline-variant bg-surface-container-low'} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`;

      const top = document.createElement('span');
      top.className = 'flex items-center gap-2';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'digest-voice';
      input.value = key;
      input.checked = selected;
      input.disabled = disabled;
      input.className = 'accent-primary';
      input.addEventListener('change', () => save(key));
      const name = document.createElement('span');
      name.className = 'font-semibold text-on-surface';
      name.textContent = voice.name + (state.chosen === null && state.default_voice === key && !disabled ? ' (current)' : '');
      top.append(input, name);

      const about = document.createElement('span');
      about.className = 'text-sm text-on-surface-variant';
      about.textContent = voice.about;
      const sample = document.createElement('span');
      sample.className = 'text-sm italic text-on-surface';
      sample.textContent = `“${state.samples[key] || ''}”`;
      label.append(top, about, sample);
      box.appendChild(label);
    }
    if (disabled) setStatus('Turned off by your workspace admin. Your summary is Classic.');

    const admin = $('digest-voice-admin');
    if (state.is_admin) {
      admin.classList.remove('hidden');
      const toggle = $('digest-voices-enabled');
      toggle.checked = state.workspace_enabled;
      toggle.onchange = () => saveWorkspace(toggle.checked);
    }
  }

  async function load() {
    try {
      const response = await fetch('/api/me/digest-voice', { credentials: 'include' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Couldn’t load');
      state = data;
      render();
    } catch (error) {
      setStatus(`${error.message}. Reload the page to try again.`, true);
    }
  }

  async function save(voice) {
    setStatus('Saving…');
    try {
      const response = await fetch('/api/me/digest-voice', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ voice })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Couldn’t save');
      state = { ...state, ...data };
      render();
      setStatus(`Saved. Your next summary comes from ${VOICES[voice].name}.`);
    } catch (error) {
      render();
      setStatus(`${error.message}. Try again.`, true);
    }
  }

  async function saveWorkspace(enabled) {
    setStatus('Saving…');
    try {
      const response = await fetch('/api/workspace/digest-voices', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Couldn’t save');
      state.workspace_enabled = enabled;
      render();
      setStatus(enabled ? 'Morning partners are on for this workspace.' : 'Morning partners are off: everyone gets Classic.');
    } catch (error) {
      $('digest-voices-enabled').checked = state.workspace_enabled;
      setStatus(`${error.message}. Try again.`, true);
    }
  }
})();
