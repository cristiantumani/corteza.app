/**
 * Settings → Context for the AI (company context edited by admins, personal context by each person).
 * Talks to /api/ai-context* (src/http/ai-context.js).
 */
(function() {
  'use strict';
  const t = window.t || (key => key); // public/scripts/i18n.js
  const locale = (window.CortezaI18n && window.CortezaI18n.locale) || undefined;

  const $ = id => document.getElementById(id);
  let state = null;

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('ai-context')) return;
    $('ctx-company-save').addEventListener('click', saveCompany);
    $('ctx-personal-save').addEventListener('click', savePersonal);
    $('ctx-upload').addEventListener('change', uploadDocument);
    $('ctx-drive').addEventListener('click', addFromDrive);
    load();
  });

  // Escapes quotes too, so it's safe in attribute values
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function setStatus(id, text, isError = false) {
    const el = $(id);
    el.textContent = text;
    el.className = `text-xs ${isError ? 'text-error' : 'text-on-surface-variant'}`;
  }

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: 'include', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      const error = new Error(data.error || t('context.requestFailed', { status: response.status }));
      error.code = data.code;
      throw error;
    }
    return data;
  }

  async function load() {
    try {
      state = await request('/api/ai-context');
      render();
    } catch (error) {
      setStatus('ctx-company-status', t('context.loadFailed', { error: error.message }), true);
    }
  }

  function render() {
    const { company, personal, can_edit_company: canEdit, limits } = state;
    $('ctx-company-description').value = company.description || '';
    $('ctx-company-glossary').value = company.glossary || '';
    $('ctx-company-description').maxLength = limits.description;
    $('ctx-company-glossary').maxLength = limits.glossary;
    ['ctx-company-description', 'ctx-company-glossary'].forEach(id => {
      $(id).readOnly = !canEdit;
      $(id).classList.toggle('opacity-70', !canEdit);
      $(id).classList.toggle('cursor-not-allowed', !canEdit);
    });
    $('ctx-company-save').classList.toggle('hidden', !canEdit);
    $('ctx-upload-label').classList.toggle('hidden', !canEdit);
    // Add from Google Drive: admins, when the server has the Picker configured (settings-drive.js)
    const drive = canEdit && state.drive && window.CortezaDrive;
    $('ctx-drive').classList.toggle('hidden', !drive);
    if (drive) window.CortezaDrive.setup(state.drive);
    $('ctx-company-note').textContent = canEdit
      ? t('context.sharedAdmins')
      : t('context.sharedAdmin');
    if (company.updated_at) {
      setStatus('ctx-company-status', company.updated_by
        ? t('context.updatedBy', { date: new Date(company.updated_at).toLocaleDateString(locale), name: company.updated_by })
        : t('context.updated', { date: new Date(company.updated_at).toLocaleDateString(locale) }));
    }
    renderDocuments(company.documents || [], canEdit);

    $('ctx-personal-role').value = personal.role || '';
    $('ctx-personal-focus').value = personal.focus || '';
    $('ctx-personal-glossary').value = personal.glossary || '';
    $('ctx-personal-role').maxLength = limits.role;
    $('ctx-personal-focus').maxLength = limits.focus;
    $('ctx-personal-glossary').maxLength = limits.glossary;
  }

  function renderDocuments(documents, canEdit) {
    const list = $('ctx-documents');
    if (documents.length === 0) {
      list.innerHTML = `<li class="text-xs text-on-surface-variant">${escapeHtml(t('context.noDocuments'))}</li>`;
      return;
    }
    list.innerHTML = documents.map(doc => `
      <li class="flex items-center justify-between gap-3 bg-surface-container-low rounded-lg px-3 py-2">
        <span class="min-w-0">
          <span class="font-semibold text-on-surface truncate flex items-center gap-1" title="${escapeHtml(doc.preview)}">${doc.from_drive ? `<span class="material-symbols-outlined text-base text-on-surface-variant" aria-label="${escapeHtml(t('context.fromDrive'))}" title="${escapeHtml(t('context.fromDrive'))}">add_to_drive</span>` : ''}<span class="truncate">${escapeHtml(doc.name)}</span></span>
          <span class="text-xs text-on-surface-variant">${escapeHtml(t('context.chars', { chars: Number(doc.chars).toLocaleString(locale) }))}${doc.truncated ? ` ${escapeHtml(t('context.shortened'))}` : ''}</span>
        </span>
        ${canEdit ? `<span class="flex items-center gap-3 shrink-0">
          ${doc.from_drive && state.drive ? `<button data-doc="${escapeHtml(doc.doc_id)}" class="ctx-refresh text-xs font-bold text-primary hover:underline" title="${escapeHtml(t('context.updateFromDrive'))}" aria-label="${escapeHtml(t('context.updateFromDrive'))}: ${escapeHtml(doc.name)}">${escapeHtml(t('context.update'))}</button>` : ''}
          <button data-doc="${escapeHtml(doc.doc_id)}" class="ctx-remove text-xs font-bold text-error hover:underline">${escapeHtml(t('common.remove'))}</button>
        </span>` : ''}
      </li>`).join('');
    list.querySelectorAll('.ctx-remove').forEach(button => button.addEventListener('click', () => removeDocument(button.dataset.doc)));
    list.querySelectorAll('.ctx-refresh').forEach(button => button.addEventListener('click', () => refreshFromDrive(button.dataset.doc)));
  }

  async function saveCompany() {
    setStatus('ctx-company-status', t('common.saving'));
    try {
      const data = await request('/api/ai-context/company', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: $('ctx-company-description').value, glossary: $('ctx-company-glossary').value })
      });
      state.company = data.company;
      render();
      setStatus('ctx-company-status', t('context.savedCompany'));
    } catch (error) {
      setStatus('ctx-company-status', error.message, true);
    }
  }

  async function savePersonal() {
    setStatus('ctx-personal-status', t('common.saving'));
    try {
      const data = await request('/api/ai-context/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: $('ctx-personal-role').value, focus: $('ctx-personal-focus').value, glossary: $('ctx-personal-glossary').value })
      });
      state.personal = data.personal;
      setStatus('ctx-personal-status', t('context.savedPersonal'));
    } catch (error) {
      setStatus('ctx-personal-status', error.message, true);
    }
  }

  async function uploadDocument(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    setStatus('ctx-company-status', t('context.reading', { name: file.name }));
    const form = new FormData();
    form.append('file', file);
    try {
      const data = await request('/api/ai-context/company/documents', { method: 'POST', body: form });
      state.company = data.company;
      render();
      setStatus('ctx-company-status', t('context.added', { name: file.name }));
    } catch (error) {
      setStatus('ctx-company-status', error.message, true);
    } finally {
      event.target.value = '';
    }
  }

  /** The message for a Drive error: translated when the server sent a known code */
  function driveMessage(error) {
    const codes = { expired: 'context.drive.expired', cant_open: 'context.drive.cantOpen', drive_down: 'context.drive.down', too_large: 'context.drive.tooLarge', unsupported: 'context.drive.unsupported' };
    return codes[error.code] ? t(codes[error.code]) : error.message;
  }

  /** A Drive token (popup on first use); null after a status message when Google said no */
  async function driveToken() {
    const status = window.CortezaDrive.status();
    if (status !== 'ready') {
      setStatus('ctx-company-status', t(status === 'failed' ? 'context.drive.blocked' : 'context.drive.loading'), true);
      return null;
    }
    try {
      return await window.CortezaDrive.getToken();
    } catch (error) {
      setStatus('ctx-company-status', t('context.drive.denied'), true);
      return null;
    }
  }

  async function addFromDrive() {
    const token = await driveToken();
    if (!token) return;
    const fileId = await window.CortezaDrive.pick(token, { title: t('context.drive.pickerTitle'), locale: window.CortezaI18n && window.CortezaI18n.lang });
    if (!fileId) return;
    setStatus('ctx-company-status', t('context.drive.reading'));
    try {
      const data = await request('/api/ai-context/company/documents/drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileId, access_token: token })
      });
      state.company = data.company;
      render();
      const added = (data.company.documents || []).find(doc => doc.doc_id === data.doc_id);
      setStatus('ctx-company-status', t('context.added', { name: added ? added.name : '' }));
    } catch (error) {
      if (error.code === 'expired') window.CortezaDrive.forgetToken();
      setStatus('ctx-company-status', driveMessage(error), true);
    }
  }

  async function refreshFromDrive(docId) {
    const token = await driveToken();
    if (!token) return;
    setStatus('ctx-company-status', t('context.drive.reading'));
    try {
      const data = await request(`/api/ai-context/company/documents/${encodeURIComponent(docId)}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: token })
      });
      state.company = data.company;
      render();
      setStatus('ctx-company-status', t('context.drive.updated'));
    } catch (error) {
      if (error.code === 'expired') window.CortezaDrive.forgetToken();
      setStatus('ctx-company-status', driveMessage(error), true);
    }
  }

  async function removeDocument(docId) {
    if (!window.confirm(t('context.confirmRemove'))) return;
    try {
      const data = await request(`/api/ai-context/company/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' });
      state.company = data.company;
      render();
      setStatus('ctx-company-status', t('context.removed'));
    } catch (error) {
      setStatus('ctx-company-status', error.message, true);
    }
  }
})();
