/**
 * Settings → AI assistants: the URL to add Corteza as a connector in Claude, ChatGPT and others (MCP),
 * the assistants this person connected (what each can do, Disconnect), their recent changes through
 * assistants (Undo for 24 hours), and for admins the workspace switches (allow; allow changes).
 * Talks to /api/ai-assistants (src/http/mcp-settings.js); specs docs/specs/2026-10-mcp-connector.md
 * and docs/specs/2026-10-mcp-v2-write.md.
 */
(function() {
  'use strict';
  const t = window.t || (key => key); // public/scripts/i18n.js
  const $ = id => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  const formatDate = value => (value ? new Date(value).toLocaleDateString(document.documentElement.lang || undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null);

  async function api(path, options = {}) {
    const response = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.error || t('common.couldNotSave'));
    return data;
  }

  function render(data) {
    const body = $('assistants-body');
    const switchHtml = data.is_admin ? `
      <label class="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" id="assistants-enabled" class="mt-1 w-5 h-5" ${data.enabled ? 'checked' : ''}>
        <span class="text-sm"><span class="font-semibold text-on-surface">${escapeHtml(t('settings.assistants.allow'))}</span>
          <span class="block text-on-surface-variant">${escapeHtml(t('settings.assistants.allowHelp'))}</span></span>
      </label>
      ${data.enabled ? `<label class="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" id="assistants-write" class="mt-1 w-5 h-5" ${data.write_enabled ? 'checked' : ''}>
        <span class="text-sm"><span class="font-semibold text-on-surface">${escapeHtml(t('settings.assistants.allowWrite'))}</span>
          <span class="block text-on-surface-variant">${escapeHtml(t('settings.assistants.allowWriteHelp'))}</span></span>
      </label>` : ''}` : '';
    if (!data.enabled) {
      body.innerHTML = `${switchHtml}<p class="text-sm text-on-surface-variant">${escapeHtml(t(data.is_admin ? 'settings.assistants.offAdmin' : 'settings.assistants.off'))}</p><span id="assistants-status" class="text-xs text-on-surface-variant" role="status"></span>`;
      bindSwitch();
      return;
    }
    const list = data.assistants.length
      ? `<ul class="flex flex-col divide-y divide-outline-variant border border-outline-variant rounded-lg">${data.assistants.map(assistant => `
          <li class="flex flex-wrap items-center justify-between gap-2 p-3">
            <span class="text-sm"><span class="font-semibold text-on-surface">${escapeHtml(assistant.client_name)}</span>
              <span class="block text-on-surface-variant">${escapeHtml(t('settings.assistants.connectedOn', { date: formatDate(assistant.connected_at) }))}${assistant.last_used_at ? ` · ${escapeHtml(t('settings.assistants.lastUsed', { date: formatDate(assistant.last_used_at) }))}` : ''}
              · ${escapeHtml(t(assistant.can_write ? 'settings.assistants.canWrite' : 'settings.assistants.canRead'))}</span></span>
            <button type="button" class="assistant-disconnect text-sm font-semibold text-error hover:underline" data-grant="${escapeHtml(assistant.grant_id)}">${escapeHtml(t('settings.assistants.disconnect'))}</button>
          </li>`).join('')}</ul>`
      : `<p class="text-sm text-on-surface-variant">${escapeHtml(t('settings.assistants.none'))}</p>`;
    body.innerHTML = `
      <div class="flex flex-col gap-2">
        <span class="text-sm font-semibold text-on-surface">${escapeHtml(t('settings.assistants.howTo'))}</span>
        <div class="flex flex-wrap items-center gap-2">
          <code id="assistants-url" class="flex-1 min-w-0 break-all bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm">${escapeHtml(data.mcp_url)}</code>
          <button type="button" id="assistants-copy" class="border border-outline-variant rounded-lg py-2 px-3 text-sm font-semibold text-on-surface hover:bg-surface-container-low">${escapeHtml(t('settings.assistants.copy'))}</button>
        </div>
        <span class="text-xs text-on-surface-variant">${escapeHtml(t('settings.assistants.howToHelp'))}</span>
      </div>
      <div class="flex flex-col gap-2">
        <span class="text-sm font-semibold text-on-surface">${escapeHtml(t('settings.assistants.connected'))}</span>
        ${list}
      </div>
      <div id="assistants-changes" class="flex flex-col gap-2 hidden"></div>
      ${switchHtml}
      <span id="assistants-status" class="text-xs text-on-surface-variant" role="status"></span>`;

    $('assistants-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(data.mcp_url);
        $('assistants-status').textContent = t('settings.assistants.copied');
      } catch (error) {
        $('assistants-status').textContent = data.mcp_url;
      }
    });
    body.querySelectorAll('.assistant-disconnect').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await api(`/api/ai-assistants/${encodeURIComponent(button.dataset.grant)}`, { method: 'DELETE' });
        await load();
      } catch (error) {
        button.disabled = false;
        $('assistants-status').textContent = t('common.tryAgain', { error: error.message });
      }
    }));
    bindSwitch();
    loadChanges();
  }

  /** Changes this person made through assistants, newest first, with Undo while it lasts */
  async function loadChanges() {
    const box = $('assistants-changes');
    if (!box) return;
    let data;
    try {
      data = await api('/api/ai-assistants/changes');
    } catch (error) {
      return; // the rest of the section still works
    }
    if (!data.changes.length) return;
    box.classList.remove('hidden');
    box.innerHTML = `
      <span class="text-sm font-semibold text-on-surface">${escapeHtml(t('settings.assistants.recent'))}</span>
      <span class="text-xs text-on-surface-variant">${escapeHtml(t('settings.assistants.recentHelp'))}</span>
      <ul class="flex flex-col divide-y divide-outline-variant border border-outline-variant rounded-lg">${data.changes.map(change => `
        <li class="flex flex-wrap items-center justify-between gap-2 p-3">
          <span class="text-sm min-w-0"><span class="font-semibold text-on-surface">${escapeHtml(t(`settings.assistants.kind.${change.kind}`))}</span>
            <span class="block text-on-surface-variant break-words">${escapeHtml(change.summary)}</span>
            <span class="block text-xs text-on-surface-variant">${escapeHtml(t('mcp.via', { client: change.client_name }))} · ${escapeHtml(formatDate(change.applied_at))}</span></span>
          ${change.can_undo
            ? `<button type="button" class="assistant-undo text-sm font-semibold text-primary hover:underline" data-change="${escapeHtml(change.change_id)}">${escapeHtml(t('settings.assistants.undo'))}</button>`
            : change.status === 'undone' ? `<span class="text-xs text-on-surface-variant">${escapeHtml(t('settings.assistants.undone'))}</span>` : ''}
        </li>`).join('')}</ul>`;
    box.querySelectorAll('.assistant-undo').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await api(`/api/ai-assistants/changes/${encodeURIComponent(button.dataset.change)}/undo`, { method: 'POST' });
        await loadChanges();
      } catch (error) {
        button.disabled = false;
        $('assistants-status').textContent = t('common.tryAgain', { error: error.message });
      }
    }));
  }

  function bindSwitch() {
    const write = $('assistants-write');
    if (write) {
      write.addEventListener('change', async () => {
        write.disabled = true;
        $('assistants-status').textContent = t('common.saving');
        try {
          await api('/api/ai-assistants/settings', { method: 'PUT', body: JSON.stringify({ write_enabled: write.checked }) });
          await load();
        } catch (error) {
          write.disabled = false;
          write.checked = !write.checked;
          $('assistants-status').textContent = t('common.tryAgain', { error: error.message });
        }
      });
    }
    const box = $('assistants-enabled');
    if (!box) return;
    box.addEventListener('change', async () => {
      // Turning it off disconnects everyone's assistants: say so first
      if (!box.checked && !window.confirm(t('settings.assistants.confirmOff'))) {
        box.checked = true;
        return;
      }
      box.disabled = true;
      $('assistants-status').textContent = t('common.saving');
      try {
        await api('/api/ai-assistants/settings', { method: 'PUT', body: JSON.stringify({ enabled: box.checked }) });
        await load();
      } catch (error) {
        box.disabled = false;
        box.checked = !box.checked;
        $('assistants-status').textContent = t('common.tryAgain', { error: error.message });
      }
    });
  }

  async function load() {
    try {
      render(await api('/api/ai-assistants'));
    } catch (error) {
      $('assistants-body').innerHTML = `<p class="text-sm text-error" role="alert">${escapeHtml(t('common.tryAgain', { error: error.message }))}</p>`;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if ($('assistants-body')) load();
  });
})();
