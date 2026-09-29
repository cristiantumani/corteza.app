/**
 * Settings → Context for the AI (company context edited by admins, personal context by each person).
 * Talks to /api/ai-context* (src/http/ai-context.js).
 */
(function() {
  'use strict';

  const $ = id => document.getElementById(id);
  let state = null;

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('ai-context')) return;
    $('ctx-company-save').addEventListener('click', saveCompany);
    $('ctx-personal-save').addEventListener('click', savePersonal);
    $('ctx-upload').addEventListener('change', uploadDocument);
    load();
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  function setStatus(id, text, isError = false) {
    const el = $(id);
    el.textContent = text;
    el.className = `text-xs ${isError ? 'text-error' : 'text-on-surface-variant'}`;
  }

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: 'include', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  async function load() {
    try {
      state = await request('/api/ai-context');
      render();
    } catch (error) {
      setStatus('ctx-company-status', `Could not load the context: ${error.message}`, true);
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
    $('ctx-company-note').textContent = canEdit
      ? 'Shared by everyone in your workspace. Only admins can edit it.'
      : 'Shared by everyone in your workspace. Only an admin can edit it.';
    if (company.updated_at) {
      setStatus('ctx-company-status', `Last updated ${new Date(company.updated_at).toLocaleDateString()}${company.updated_by ? ` by ${company.updated_by}` : ''}`);
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
      list.innerHTML = '<li class="text-xs text-on-surface-variant">No documents yet.</li>';
      return;
    }
    list.innerHTML = documents.map(doc => `
      <li class="flex items-center justify-between gap-3 bg-surface-container-low rounded-lg px-3 py-2">
        <span class="min-w-0">
          <span class="font-semibold text-on-surface truncate block" title="${escapeHtml(doc.preview)}">${escapeHtml(doc.name)}</span>
          <span class="text-xs text-on-surface-variant">${Number(doc.chars).toLocaleString()} characters${doc.truncated ? ' (shortened)' : ''}</span>
        </span>
        ${canEdit ? `<button data-doc="${escapeHtml(doc.doc_id)}" class="ctx-remove text-xs font-bold text-error hover:underline">Remove</button>` : ''}
      </li>`).join('');
    list.querySelectorAll('.ctx-remove').forEach(button => button.addEventListener('click', () => removeDocument(button.dataset.doc)));
  }

  async function saveCompany() {
    setStatus('ctx-company-status', 'Saving…');
    try {
      const data = await request('/api/ai-context/company', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: $('ctx-company-description').value, glossary: $('ctx-company-glossary').value })
      });
      state.company = data.company;
      render();
      setStatus('ctx-company-status', 'Saved. It applies to the next meetings Corteza reads.');
    } catch (error) {
      setStatus('ctx-company-status', error.message, true);
    }
  }

  async function savePersonal() {
    setStatus('ctx-personal-status', 'Saving…');
    try {
      const data = await request('/api/ai-context/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: $('ctx-personal-role').value, focus: $('ctx-personal-focus').value, glossary: $('ctx-personal-glossary').value })
      });
      state.personal = data.personal;
      setStatus('ctx-personal-status', 'Saved. It applies to your next meetings.');
    } catch (error) {
      setStatus('ctx-personal-status', error.message, true);
    }
  }

  async function uploadDocument(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    setStatus('ctx-company-status', `Reading ${file.name}…`);
    const form = new FormData();
    form.append('file', file);
    try {
      const data = await request('/api/ai-context/company/documents', { method: 'POST', body: form });
      state.company = data.company;
      render();
      setStatus('ctx-company-status', `${file.name} added.`);
    } catch (error) {
      setStatus('ctx-company-status', error.message, true);
    } finally {
      event.target.value = '';
    }
  }

  async function removeDocument(docId) {
    if (!window.confirm('Remove this document from the company context?')) return;
    try {
      const data = await request(`/api/ai-context/company/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' });
      state.company = data.company;
      render();
      setStatus('ctx-company-status', 'Document removed.');
    } catch (error) {
      setStatus('ctx-company-status', error.message, true);
    }
  }
})();
