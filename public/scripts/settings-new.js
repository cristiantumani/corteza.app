(function() {
  'use strict';
  const t = window.t || (key => key); // public/scripts/i18n.js
  const locale = (window.CortezaI18n && window.CortezaI18n.locale) || undefined;

  let allSpaces = [];
  let currentSpaceId = null;

  // Initialize on page load
  document.addEventListener('DOMContentLoaded', async () => {
    const user = await checkAuth();
    await loadSpaces();
    // Deleting everyone's data and inviting people are a workspace admin's; the API refuses others
    const admin = !!(user && user.is_admin);
    document.querySelectorAll('[data-admin-only]').forEach(el => el.classList.toggle('hidden', !admin));
    if (admin) await loadInvites();
  });

  async function checkAuth() {
    try {
      const response = await fetch('/auth/me');
      if (!response.ok) {
        window.location.href = '/auth/login';
        return;
      }

      const data = await response.json();
      const user = data.user;

      // Update UI with user info
      const displayName = user.user_name || user.email || '';
      document.getElementById('user-display-name').textContent = displayName;

      // Update avatar
      const initials = getInitials(displayName);
      document.getElementById('user-avatar').textContent = initials;
      return user;

    } catch (error) {
      console.error('Auth check failed:', error);
      window.location.href = '/auth/login';
    }
  }

  function getInitials(name) {
    if (!name) return 'U';
    const parts = name.split(' ').filter(p => p.length > 0);
    if (parts.length === 0) return 'U';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return parts.slice(0, 2).map(n => n[0]).join('').toUpperCase();
  }

  // ========================================
  // SPACES
  // ========================================

  async function loadSpaces() {
    try {
      const response = await fetch(`/api/spaces?workspace_id=${WORKSPACE_ID}`);
      const data = await response.json();

      allSpaces = data.spaces || [];
      // With a single space (your personal one) Manage Spaces and the space pickers stay hidden
      document.body.classList.toggle('single-space', allSpaces.length <= 1);

      const tbody = document.getElementById('spaces-table');
      tbody.innerHTML = '';

      if (allSpaces.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="4" class="py-8 text-center text-on-surface-variant">
              No spaces yet. Create your first space to get started.
            </td>
          </tr>
        `;
        return;
      }

      allSpaces.forEach(space => {
        const row = createSpaceRow(space);
        tbody.appendChild(row);
      });

      // Populate invite space selector
      const inviteSelect = document.getElementById('invite-space-select');
      if (inviteSelect) {
        inviteSelect.innerHTML = allSpaces.map(space =>
          `<option value="${escapeHtml(space.space_id)}">${escapeHtml(space.settings?.icon || '📁')} ${escapeHtml(space.name)}</option>`
        ).join('');
      }

    } catch (error) {
      console.error('Error loading spaces:', error);
    }
  }

  function createSpaceRow(space) {
    const row = document.createElement('tr');
    row.className = 'group hover:bg-surface-container-low transition-colors';

    const icon = space.settings?.icon || '📁';
    const memberCount = space.member_count || 0;
    const lastActivity = formatLastActivity(space.last_activity);

    row.innerHTML = `
      <td class="py-4">
        <div class="flex items-center gap-4">
          <div class="w-10 h-10 rounded bg-primary/10 flex items-center justify-center text-primary text-xl">
            ${escapeHtml(icon)}
          </div>
          <span class="text-sm font-medium text-on-surface">${escapeHtml(space.name)}</span>
        </div>
      </td>
      <td class="py-4 text-sm text-on-surface-variant">${escapeHtml(t('settings.spaces.memberCount', { count: memberCount }))}</td>
      <td class="py-4 text-sm text-on-surface-variant">${lastActivity}</td>
      <td class="py-4 text-right">
        <div class="flex items-center justify-end gap-2">
          <button onclick="openMembersModal(${jsArg(space.space_id)}, ${jsArg(space.name)})" class="text-xs font-bold text-primary px-3 py-2 rounded-lg hover:bg-primary/10 transition-colors">
            ${escapeHtml(t('settings.spaces.manageMembers'))}
          </button>
          <button onclick="editSpace(${jsArg(space.space_id)})" class="p-1 rounded-lg hover:bg-surface-container-highest transition-colors">
            <span class="material-symbols-outlined text-lg text-on-surface-variant">edit</span>
          </button>
          <button onclick="deleteSpace(${jsArg(space.space_id)}, ${jsArg(space.name)})" class="p-1 rounded-lg hover:bg-surface-container-highest transition-colors">
            <span class="material-symbols-outlined text-lg text-error">delete</span>
          </button>
        </div>
      </td>
    `;

    return row;
  }

  function formatLastActivity(timestamp) {
    if (!timestamp) return t('time.never');
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffHours < 1) return t('time.justNow');
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return t('time.yesterday');
    if (diffDays < 7) return t('time.daysAgo', { count: diffDays });
    return date.toLocaleDateString();
  }

  window.openCreateSpaceModal = function() {
    document.getElementById('create-space-modal').classList.add('active');
  };

  window.closeCreateSpaceModal = function() {
    document.getElementById('create-space-modal').classList.remove('active');
    document.getElementById('space-name').value = '';
    document.getElementById('space-icon').value = '';
    document.getElementById('space-description').value = '';
  };

  window.createSpace = async function() {
    const name = document.getElementById('space-name').value.trim();
    const icon = document.getElementById('space-icon').value.trim() || '📁';
    const description = document.getElementById('space-description').value.trim();

    if (!name) {
      alert(t('settings.spaces.nameRequired'));
      return;
    }

    try {
      const response = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: WORKSPACE_ID,
          name,
          settings: { icon, description }
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t('settings.spaces.createFailed'));
      }

      showNotification(t('settings.spaces.created', { name }));
      closeCreateSpaceModal();
      await loadSpaces();

    } catch (error) {
      console.error('Error creating space:', error);
      alert(`${t('settings.spaces.createFailed')}: ${error.message}`);
    }
  };

  window.editSpace = async function(spaceId) {
    // TODO: Implement edit space functionality
    alert(t('settings.spaces.editSoon'));
  };

  window.deleteSpace = async function(spaceId, spaceName) {
    if (!confirm(t('settings.spaces.confirmDelete', { name: spaceName }))) {
      return;
    }

    try {
      const response = await fetch(`/api/spaces/${spaceId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: WORKSPACE_ID })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t('settings.spaces.deleteFailed'));
      }

      showNotification(t('settings.spaces.deleted', { name: spaceName }));
      await loadSpaces();

    } catch (error) {
      console.error('Error deleting space:', error);
      alert(`${t('settings.spaces.deleteFailed')}: ${error.message}`);
    }
  };

  window.openMembersModal = async function(spaceId, spaceName) {
    currentSpaceId = spaceId;
    document.getElementById('members-space-name').textContent = spaceName;
    document.getElementById('manage-members-modal').classList.add('active');
    await loadSpaceMembers(spaceId);
  };

  window.closeMembersModal = function() {
    document.getElementById('manage-members-modal').classList.remove('active');
    currentSpaceId = null;
  };

  async function loadSpaceMembers(spaceId) {
    try {
      const response = await fetch(`/api/spaces/${spaceId}/members?workspace_id=${WORKSPACE_ID}`);
      const data = await response.json();

      const membersList = document.getElementById('members-list');
      membersList.innerHTML = '';

      if (!data.members || data.members.length === 0) {
        membersList.innerHTML = `
          <div class="p-6 bg-surface-container-low rounded-lg text-center">
            <p class="text-sm text-on-surface-variant">${escapeHtml(t('settings.spaces.noMembers'))}</p>
          </div>
        `;
        return;
      }

      data.members.forEach(member => {
        const memberCard = createMemberCard(member);
        membersList.appendChild(memberCard);
      });

    } catch (error) {
      console.error('Error loading members:', error);
    }
  }

  function createMemberCard(member) {
    const card = document.createElement('div');
    card.className = 'flex items-center justify-between p-3 bg-surface-container-low rounded-lg border border-outline-variant';

    const initials = getInitials(member.user_name);
    const roleColor = member.role === 'owner' ? 'bg-primary/10 text-primary' :
                      member.role === 'editor' ? 'bg-secondary/10 text-secondary' :
                      'bg-surface-container-highest text-on-surface-variant';

    card.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center font-bold text-xs">
          ${escapeHtml(initials)}
        </div>
        <div>
          <div class="text-sm font-medium text-on-surface">${escapeHtml(member.user_name)}</div>
          <div class="text-xs text-on-surface-variant">${escapeHtml(member.user_email)}</div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="px-2 py-1 ${roleColor} rounded-full text-[10px] font-bold uppercase">${escapeHtml(member.role)}</span>
        ${member.role !== 'owner' ? `
          <button onclick="removeMember(${jsArg(member.user_id)}, ${jsArg(member.user_name)})" class="material-symbols-outlined text-error text-lg hover:scale-110 transition-transform">
            person_remove
          </button>
        ` : ''}
      </div>
    `;

    return card;
  }

  window.removeMember = async function(userId, userName) {
    if (!confirm(t('settings.spaces.confirmRemove', { name: userName }))) {
      return;
    }

    try {
      const response = await fetch(`/api/spaces/${currentSpaceId}/members/${userId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: WORKSPACE_ID })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t('settings.spaces.removeFailed'));
      }

      showNotification(t('settings.spaces.removed', { name: userName }));
      await loadSpaceMembers(currentSpaceId);

    } catch (error) {
      console.error('Error removing member:', error);
      alert(`${t('settings.spaces.removeFailed')}: ${error.message}`);
    }
  };

  // ========================================
  // TEAM INVITATIONS
  // ========================================

  async function loadInvites() {
    try {
      const response = await fetch(`/api/invites?workspace_id=${WORKSPACE_ID}`);
      const data = await response.json();

      const container = document.getElementById('active-invites-list');

      if (!data.invites || data.invites.length === 0) {
        container.innerHTML = '';
        return;
      }

      container.innerHTML = `
        <div class="border-t border-outline-variant pt-4">
          <p class="text-xs font-bold text-on-surface-variant uppercase mb-2">${escapeHtml(t('settings.invites.active'))}</p>
          ${data.invites.map(invite => `
            <div class="flex items-center justify-between p-2 bg-surface-container-low rounded mb-2">
              <div class="flex-1">
                <p class="text-xs font-medium">${escapeHtml(invite.space_name)}</p>
                <p class="text-[10px] text-on-surface-variant">${escapeHtml(t('settings.invites.expires', { date: new Date(invite.expires_at).toLocaleDateString(locale) }))}</p>
              </div>
              <button onclick="revokeInvite(${jsArg(invite.invite_id)})" class="material-symbols-outlined text-error text-sm">delete</button>
            </div>
          `).join('')}
        </div>
      `;

    } catch (error) {
      console.error('Error loading invites:', error);
    }
  }

  window.openCreateInviteModal = function() {
    document.getElementById('create-invite-modal').classList.add('active');
  };

  window.closeCreateInviteModal = function() {
    document.getElementById('create-invite-modal').classList.remove('active');
  };

  window.createInvite = async function() {
    const spaceId = document.getElementById('invite-space-select').value;

    if (!spaceId) {
      alert(t('settings.invites.pickSpace'));
      return;
    }

    try {
      const response = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: WORKSPACE_ID,
          space_id: spaceId,
          role: 'viewer',
          expires_in_days: 7,
          max_uses: null
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t('settings.invites.createFailed'));
      }

      const inviteUrl = `${window.location.origin}/invite/${data.invite_id}`;

      closeCreateInviteModal();

      // Copy to clipboard
      await navigator.clipboard.writeText(inviteUrl);
      showNotification(t('settings.invites.copied'));

      await loadInvites();

    } catch (error) {
      console.error('Error creating invite:', error);
      alert(`${t('settings.invites.createFailed')}: ${error.message}`);
    }
  };

  window.revokeInvite = async function(inviteId) {
    if (!confirm(t('settings.invites.confirmRevoke'))) {
      return;
    }

    try {
      const response = await fetch(`/api/invites/${inviteId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: WORKSPACE_ID })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t('settings.invites.revokeFailed'));
      }

      showNotification(t('settings.invites.revoked'));
      await loadInvites();

    } catch (error) {
      console.error('Error revoking invite:', error);
      alert(`${t('settings.invites.revokeFailed')}: ${error.message}`);
    }
  };

  // ========================================
  // DATA PRIVACY
  // ========================================

  window.exportData = function() {
    window.location.href = `/api/gdpr/export?workspace_id=${WORKSPACE_ID}&format=json`;
  };

  window.openDeleteDataModal = function() {
    document.getElementById('delete-data-modal').classList.add('active');
  };

  window.closeDeleteDataModal = function() {
    document.getElementById('delete-data-modal').classList.remove('active');
    document.getElementById('delete-confirmation').value = '';
    showDeleteError('');
  };

  function showDeleteError(message) {
    const error = document.getElementById('delete-data-error');
    error.textContent = message;
    error.classList.toggle('hidden', !message);
  }

  window.deleteAllData = async function() {
    const confirmation = document.getElementById('delete-confirmation').value.trim();
    if (confirmation !== 'DELETE') {
      showDeleteError(t('settings.data.typeDelete'));
      return;
    }

    const button = document.getElementById('delete-data-button');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = t('settings.data.deleting');
    showDeleteError('');

    try {
      // confirm=DELETE_ALL_DATA is the server's own check that this was meant (routes/gdpr.js)
      const response = await fetch(`/api/gdpr/delete-all?workspace_id=${encodeURIComponent(WORKSPACE_ID)}&confirm=DELETE_ALL_DATA`, {
        method: 'DELETE'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('settings.data.deleteFailed'));

      button.textContent = t('settings.data.deleted');
      setTimeout(() => { window.location.href = '/auth/logout'; }, 1500);
    } catch (error) {
      console.error('Error deleting data:', error.message);
      showDeleteError(error.message === 'Failed to fetch' ? t('common.offline') : error.message);
      button.disabled = false;
      button.textContent = label;
    }
  };

  // ========================================
  // UTILITY FUNCTIONS
  // ========================================

  window.copyToClipboard = async function(text) {
    try {
      await navigator.clipboard.writeText(text);
      showNotification(t('common.copied'));
    } catch (error) {
      console.error('Failed to copy:', error);
      alert(t('common.copyFailed'));
    }
  };

  function showNotification(message) {
    console.log(`📢 ${message}`);

    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 24px;
      right: 24px;
      background: #333;
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      font-size: 14px;
      font-weight: 500;
      animation: slideIn 0.3s ease-out;
    `;
    toast.textContent = message;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(400px); opacity: 0; }
      }
    `;
    if (!document.querySelector('style[data-toast-styles]')) {
      style.setAttribute('data-toast-styles', 'true');
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Escapes quotes too, so it's safe in attribute values
  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // A value passed to a function in an inline handler: onclick="fn(${jsArg(name)})"
  function jsArg(value) {
    return escapeHtml(JSON.stringify(value === undefined ? null : value));
  }

  // Micro-interactions
  document.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (button) {
      button.classList.add('scale-95');
      setTimeout(() => button.classList.remove('scale-95'), 150);
    }
  });

})();
