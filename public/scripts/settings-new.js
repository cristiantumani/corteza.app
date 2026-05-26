(function() {
  'use strict';

  let allSpaces = [];
  let currentSpaceId = null;

  // Initialize on page load
  document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    await loadApiKeys();
    await loadSpaces();
    await loadInvites();
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
      const displayName = user.user_name || user.email || 'User';
      document.getElementById('user-display-name').textContent = displayName;

      // Update avatar
      const initials = getInitials(displayName);
      document.getElementById('user-avatar').textContent = initials;

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
  // API KEYS
  // ========================================

  async function loadApiKeys() {
    try {
      const response = await fetch('/api/keys');
      const data = await response.json();

      const container = document.getElementById('api-keys-list');
      container.innerHTML = '';

      if (data.keys && data.keys.length > 0) {
        data.keys.forEach(key => {
          const keyCard = createApiKeyCard(key);
          container.appendChild(keyCard);
        });
      } else {
        container.innerHTML = `
          <div class="p-6 bg-surface-container-low rounded-lg border border-outline-variant text-center">
            <p class="text-sm text-on-surface-variant">No API keys yet. Create one to get started.</p>
          </div>
        `;
      }
    } catch (error) {
      console.error('Error loading API keys:', error);
    }
  }

  function createApiKeyCard(key) {
    const card = document.createElement('div');
    card.className = 'p-4 bg-surface-container-low rounded-lg border border-outline-variant';

    const createdDate = new Date(key.created_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    card.innerHTML = `
      <div class="flex justify-between items-center mb-2">
        <span class="text-xs font-bold text-primary px-2 py-1 bg-primary/10 rounded">${escapeHtml(key.name)}</span>
        <span class="text-xs text-on-surface-variant">Created: ${createdDate}</span>
      </div>
      <div class="flex items-center gap-3">
        <code class="text-sm font-mono flex-1 truncate bg-surface-container-high p-2 rounded">${escapeHtml(key.key_preview)}...</code>
        <button onclick="copyToClipboard('${escapeHtml(key.key_preview)}')" class="material-symbols-outlined text-on-surface-variant hover:text-primary transition-colors p-2">
          content_copy
        </button>
        <button onclick="revokeApiKey('${escapeHtml(key.key_preview)}')" class="material-symbols-outlined text-error hover:text-error/80 transition-colors p-2">
          delete
        </button>
      </div>
    `;

    return card;
  }

  window.openGenerateKeyModal = function() {
    document.getElementById('generate-key-modal').classList.add('active');
  };

  window.closeGenerateKeyModal = function() {
    document.getElementById('generate-key-modal').classList.remove('active');
    document.getElementById('api-key-name').value = '';
  };

  window.generateApiKey = async function() {
    const name = document.getElementById('api-key-name').value.trim();

    if (!name) {
      alert('Please enter a name for the API key');
      return;
    }

    try {
      const response = await fetch('/api/keys/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate API key');
      }

      closeGenerateKeyModal();

      // Show the full key once
      alert(`API Key Generated!\n\nKEY: ${data.api_key}\n\nCopy this now - you won't be able to see it again!`);

      await loadApiKeys();
    } catch (error) {
      console.error('Error generating API key:', error);
      alert('Failed to generate API key: ' + error.message);
    }
  };

  window.revokeApiKey = async function(keyPreview) {
    if (!confirm('Are you sure you want to revoke this API key? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/keys/${keyPreview}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to revoke API key');
      }

      showNotification('API key revoked successfully');
      await loadApiKeys();
    } catch (error) {
      console.error('Error revoking API key:', error);
      alert('Failed to revoke API key: ' + error.message);
    }
  };

  // ========================================
  // PASSWORD RESET
  // ========================================

  window.resetPassword = async function() {
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    if (!currentPassword || !newPassword || !confirmPassword) {
      alert('Please fill in all password fields');
      return;
    }

    if (newPassword.length < 12) {
      alert('New password must be at least 12 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      alert('New passwords do not match');
      return;
    }

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }

      showNotification('Password updated successfully!');

      // Clear fields
      document.getElementById('current-password').value = '';
      document.getElementById('new-password').value = '';
      document.getElementById('confirm-password').value = '';

    } catch (error) {
      console.error('Error resetting password:', error);
      alert('Failed to reset password: ' + error.message);
    }
  };

  // ========================================
  // SPACES
  // ========================================

  async function loadSpaces() {
    try {
      const response = await fetch(`/api/spaces?workspace_id=${WORKSPACE_ID}`);
      const data = await response.json();

      allSpaces = data.spaces || [];

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
          `<option value="${space.space_id}">${space.settings?.icon || '📁'} ${escapeHtml(space.name)}</option>`
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
            ${icon}
          </div>
          <span class="text-sm font-medium text-on-surface">${escapeHtml(space.name)}</span>
        </div>
      </td>
      <td class="py-4 text-sm text-on-surface-variant">${memberCount} Members</td>
      <td class="py-4 text-sm text-on-surface-variant">${lastActivity}</td>
      <td class="py-4 text-right">
        <div class="flex items-center justify-end gap-2">
          <button onclick="openMembersModal('${space.space_id}', '${escapeHtml(space.name)}')" class="text-xs font-bold text-primary px-3 py-2 rounded-lg hover:bg-primary/10 transition-colors">
            Manage Members
          </button>
          <button onclick="editSpace('${space.space_id}')" class="p-1 rounded-lg hover:bg-surface-container-highest transition-colors">
            <span class="material-symbols-outlined text-lg text-on-surface-variant">edit</span>
          </button>
          <button onclick="deleteSpace('${space.space_id}', '${escapeHtml(space.name)}')" class="p-1 rounded-lg hover:bg-surface-container-highest transition-colors">
            <span class="material-symbols-outlined text-lg text-error">delete</span>
          </button>
        </div>
      </td>
    `;

    return row;
  }

  function formatLastActivity(timestamp) {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
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
      alert('Please enter a space name');
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
        throw new Error(data.error || 'Failed to create space');
      }

      showNotification(`Space "${name}" created successfully!`);
      closeCreateSpaceModal();
      await loadSpaces();

    } catch (error) {
      console.error('Error creating space:', error);
      alert('Failed to create space: ' + error.message);
    }
  };

  window.editSpace = async function(spaceId) {
    // TODO: Implement edit space functionality
    alert('Edit space functionality coming soon!');
  };

  window.deleteSpace = async function(spaceId, spaceName) {
    if (!confirm(`Are you sure you want to delete the space "${spaceName}"?\n\nThis action cannot be undone.`)) {
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
        throw new Error(data.error || 'Failed to delete space');
      }

      showNotification(`Space "${spaceName}" deleted successfully`);
      await loadSpaces();

    } catch (error) {
      console.error('Error deleting space:', error);
      alert('Failed to delete space: ' + error.message);
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
            <p class="text-sm text-on-surface-variant">No members in this space yet.</p>
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
          ${initials}
        </div>
        <div>
          <div class="text-sm font-medium text-on-surface">${escapeHtml(member.user_name)}</div>
          <div class="text-xs text-on-surface-variant">${escapeHtml(member.user_email)}</div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="px-2 py-1 ${roleColor} rounded-full text-[10px] font-bold uppercase">${member.role}</span>
        ${member.role !== 'owner' ? `
          <button onclick="removeMember('${member.user_id}', '${escapeHtml(member.user_name)}')" class="material-symbols-outlined text-error text-lg hover:scale-110 transition-transform">
            person_remove
          </button>
        ` : ''}
      </div>
    `;

    return card;
  }

  window.removeMember = async function(userId, userName) {
    if (!confirm(`Remove ${userName} from this space?`)) {
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
        throw new Error(data.error || 'Failed to remove member');
      }

      showNotification(`${userName} removed from space`);
      await loadSpaceMembers(currentSpaceId);

    } catch (error) {
      console.error('Error removing member:', error);
      alert('Failed to remove member: ' + error.message);
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
          <p class="text-xs font-bold text-on-surface-variant uppercase mb-2">Active Invites</p>
          ${data.invites.map(invite => `
            <div class="flex items-center justify-between p-2 bg-surface-container-low rounded mb-2">
              <div class="flex-1">
                <p class="text-xs font-medium">${escapeHtml(invite.space_name)}</p>
                <p class="text-[10px] text-on-surface-variant">Expires: ${new Date(invite.expires_at).toLocaleDateString()}</p>
              </div>
              <button onclick="revokeInvite('${invite.invite_id}')" class="material-symbols-outlined text-error text-sm">delete</button>
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
      alert('Please select a space');
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
        throw new Error(data.error || 'Failed to create invite');
      }

      const inviteUrl = `${window.location.origin}/invite/${data.invite_id}`;

      closeCreateInviteModal();

      // Copy to clipboard
      await navigator.clipboard.writeText(inviteUrl);
      showNotification('Invite link copied to clipboard!');

      await loadInvites();

    } catch (error) {
      console.error('Error creating invite:', error);
      alert('Failed to create invite: ' + error.message);
    }
  };

  window.revokeInvite = async function(inviteId) {
    if (!confirm('Revoke this invite link?')) {
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
        throw new Error(data.error || 'Failed to revoke invite');
      }

      showNotification('Invite revoked');
      await loadInvites();

    } catch (error) {
      console.error('Error revoking invite:', error);
      alert('Failed to revoke invite: ' + error.message);
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
  };

  window.deleteAllData = async function() {
    const confirmation = document.getElementById('delete-confirmation').value;

    if (confirmation !== 'DELETE') {
      alert('Please type DELETE to confirm');
      return;
    }

    try {
      const response = await fetch(`/api/gdpr/delete-all?workspace_id=${WORKSPACE_ID}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete data');
      }

      alert('All workspace data deleted. You will be logged out.');
      window.location.href = '/auth/logout';

    } catch (error) {
      console.error('Error deleting data:', error);
      alert('Failed to delete data: ' + error.message);
    }
  };

  // ========================================
  // UTILITY FUNCTIONS
  // ========================================

  window.copyToClipboard = async function(text) {
    try {
      await navigator.clipboard.writeText(text);
      showNotification('Copied to clipboard!');
    } catch (error) {
      console.error('Failed to copy:', error);
      alert('Failed to copy to clipboard');
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

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
