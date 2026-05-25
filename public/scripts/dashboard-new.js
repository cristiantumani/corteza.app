// Dashboard rendering for new Tailwind design
// This extends dashboard.js with new UI rendering

(function() {
  'use strict';

  console.log('📱 New dashboard UI loaded');

  // Store decisions for rendering
  let allDecisionsForRender = [];

  // Override renderDecisions to use new card design
  // Wait a tick to ensure dashboard.js has exposed window.renderDecisions
  setTimeout(() => {
    console.log('🔄 Overriding renderDecisions with new card design');
    const originalRenderDecisions = window.renderDecisions;
    window.renderDecisions = function(decisions) {
      console.log('📋 Rendering decisions in new card format:', decisions ? decisions.length : 0);
      allDecisionsForRender = decisions || [];

      // Call original if it exists and table exists (for compatibility)
      if (originalRenderDecisions && document.getElementById('decisions-body')) {
        originalRenderDecisions(decisions);
      }

      // Render new card design
      renderNewDesignCards(allDecisionsForRender);
    };

    // Trigger initial render if decisions already loaded
    if (window.allDecisions && window.allDecisions.length > 0) {
      console.log('📋 Found existing decisions, rendering now');
      window.renderDecisions(window.allDecisions);
    }
  }, 100);

  function renderNewDesignCards(decisions) {
    const container = document.getElementById('decisions-cards');
    const countElement = document.getElementById('decisions-count');
    const emptyState = document.getElementById('empty-state');

    if (!container) return;

    // Update count
    const count = decisions.length;
    if (countElement) {
      countElement.textContent = `${count} decision${count !== 1 ? 's' : ''}`;
    }

    // Clear container
    container.innerHTML = '';

    // Show/hide empty state
    if (decisions.length === 0) {
      if (emptyState) emptyState.classList.remove('hidden');
      container.classList.add('hidden');
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');
    container.classList.remove('hidden');

    // Render each decision as a card
    decisions.forEach((decision, index) => {
      const card = createDecisionCard(decision, index);
      container.appendChild(card);
    });
  }

  function createDecisionCard(decision, index) {
    const card = document.createElement('div');
    card.className = 'bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm hover:shadow-md transition-all group cursor-pointer';
    card.dataset.decisionId = decision.id;
    card.dataset.index = index;

    // Format date
    const date = new Date(decision.timestamp);
    const dateStr = formatDate(date);

    // Get status
    const status = getStatusInfo(decision);

    // Check permissions
    const isOwnDecision = decision.user_id === (window.currentUser && window.currentUser.user_id);
    const canModify = window.isCurrentUserAdmin || isOwnDecision;

    // Build card HTML
    card.innerHTML = `
      <div class="flex items-start justify-between mb-4">
        <div class="flex gap-1 flex-wrap">
          ${decision.space_name ? `<span class="px-3 py-1 rounded-full bg-secondary-container/20 text-on-secondary-container text-xs font-semibold">${escapeHtml(decision.space_name)}</span>` : ''}
          <span class="px-3 py-1 rounded-full bg-primary-container/10 text-primary text-xs font-semibold">${escapeHtml(decision.type)}</span>
        </div>
        <span class="flex items-center gap-1 ${status.color} font-bold text-xs">
          <span class="w-2 h-2 rounded-full ${status.dotColor}"></span>
          ${status.text}
        </span>
      </div>

      <h5 class="text-lg font-bold text-on-surface group-hover:text-primary transition-colors mb-2 line-clamp-2">${escapeHtml(decision.text.split('\n')[0])}</h5>

      <p class="text-sm text-on-surface-variant mb-6 line-clamp-2">${escapeHtml(getTruncatedText(decision.text))}</p>

      <div class="flex items-center justify-between pt-4 border-t border-outline-variant/50">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 bg-surface-container text-primary rounded-full flex items-center justify-center font-bold text-xs">
            ${getInitials(decision.creator)}
          </div>
          <span class="text-xs font-medium">${escapeHtml(decision.creator)}</span>
        </div>
        <span class="text-xs text-on-surface-variant">${dateStr}</span>
      </div>

      ${canModify ? `
      <div class="mt-4 pt-4 border-t border-outline-variant/50 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button data-action="view" data-index="${index}" class="flex-1 text-sm text-primary hover:bg-primary-container/10 py-2 px-3 rounded-lg transition-colors">
          View
        </button>
        <button data-action="delete" data-id="${decision.id}" class="text-sm text-error hover:bg-error/10 py-2 px-3 rounded-lg transition-colors">
          Delete
        </button>
      </div>
      ` : ''}
    `;

    // Add event listeners
    card.addEventListener('click', (e) => {
      // Don't trigger if clicking on action buttons
      if (e.target.closest('[data-action]')) return;

      if (typeof window.openDetailModal === 'function') {
        window.openDetailModal(index);
      }
    });

    // Action button listeners
    const actionButtons = card.querySelectorAll('[data-action]');
    actionButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;

        if (action === 'view') {
          const idx = parseInt(btn.dataset.index);
          if (typeof window.openDetailModal === 'function') {
            window.openDetailModal(idx);
          }
        } else if (action === 'delete') {
          const id = parseInt(btn.dataset.id);
          if (typeof window.openDeleteModal === 'function') {
            window.openDeleteModal(id);
          }
        }
      });
    });

    return card;
  }

  function getStatusInfo(decision) {
    // You can customize this based on your decision status logic
    const hasJira = decision.epic_key || decision.jira_url;
    if (hasJira) {
      return {
        text: 'Finalized',
        color: 'text-tertiary',
        dotColor: 'bg-tertiary'
      };
    }
    return {
      text: 'Review',
      color: 'text-on-surface-variant',
      dotColor: 'bg-on-surface-variant'
    };
  }

  function formatDate(date) {
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays < 7) {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function getTruncatedText(text) {
    // Remove first line (title) and get preview
    const lines = text.split('\n');
    const preview = lines.slice(1).join(' ').trim();
    return preview.substring(0, 150) + (preview.length > 150 ? '...' : '');
  }

  function getInitials(name) {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Update header with user info
  window.updateHeader = function() {
    // Call original updateHeader logic if needed for classic dashboard elements
    const header = document.querySelector('header .container');
    if (header) {
      const h1 = header.querySelector('h1');
      if (h1 && window.currentUser) {
        h1.innerHTML += `
          <span style="font-size: 14px; font-weight: 400; margin-left: 20px; color: #718096;">
            ${window.currentUser.workspace_name} • ${window.currentUser.user_name}
          </span>
          <a href="/auth/logout" style="font-size: 14px; font-weight: 400; margin-left: 15px; color: #667eea; text-decoration: none;">
            Logout →
          </a>
        `;
      }
    }

    // Update new dashboard header elements
    if (window.currentUser) {
      const headerUser = document.getElementById('header-user');
      const headerWorkspace = document.getElementById('header-workspace');

      if (headerUser) {
        headerUser.textContent = window.currentUser.email || window.currentUser.user_name || 'User';
      }
      if (headerWorkspace) {
        headerWorkspace.textContent = window.currentUser.workspace_name || window.WORKSPACE_ID;
      }
    }
  };

  // Add filter functions for new dashboard
  window.applyFilters = function() {
    // Trigger fetchDecisions if it exists
    if (typeof window.fetchDecisions === 'function') {
      window.fetchDecisions();
    }
  };

  window.handleSpaceChange = function() {
    const spaceFilter = document.getElementById('space-filter');
    if (spaceFilter && typeof window.fetchDecisions === 'function') {
      window.currentSpaceId = spaceFilter.value || null;
      window.fetchDecisions();
    }
  };

  console.log('✅ New dashboard UI initialized');
})();
