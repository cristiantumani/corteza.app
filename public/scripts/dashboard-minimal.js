// Minimal Dashboard Overrides
// This file extends dashboard.js to render the minimal split view

(function() {
  'use strict';

  // Store reference to original renderDecisions
  const originalRenderDecisions = window.renderDecisions;

  // Override renderDecisions to use minimal card view
  window.renderDecisions = function(decisions) {
    // If we're in minimal mode, render cards
    if (document.body.classList.contains('minimal-mode')) {
      renderMinimalDecisions(decisions);
    } else {
      // Fall back to original table rendering
      if (originalRenderDecisions) {
        originalRenderDecisions(decisions);
      }
    }
  };

  // Render decisions as minimal cards
  function renderMinimalDecisions(decisions) {
    const cardsContainer = document.getElementById('decisions-cards');
    const countElement = document.getElementById('decisions-count');

    if (!cardsContainer || !countElement) return;

    // Update count
    const count = decisions.length;
    countElement.textContent = `${count} decision${count !== 1 ? 's' : ''}`;

    // Clear cards
    cardsContainer.innerHTML = '';

    if (decisions.length === 0) {
      cardsContainer.innerHTML = `
        <div class="minimal-empty-state">
          <div class="minimal-empty-icon">📭</div>
          <div>No decisions found</div>
          <div style="margin-top: 12px; font-size: 13px;">
            <a href="#" onclick="openLogMemoryModal(); return false;">Create your first decision</a>
          </div>
        </div>
      `;
      return;
    }

    // Render each decision as a card
    decisions.forEach((decision, index) => {
      const card = createMinimalCard(decision, index);
      cardsContainer.appendChild(card);
    });
  }

  // Create a minimal decision card
  function createMinimalCard(decision, index) {
    const card = document.createElement('div');
    card.className = 'minimal-decision-card';
    card.dataset.decisionId = decision.id;
    card.dataset.index = index;

    // Format date
    const date = new Date(decision.timestamp);
    const dateStr = formatRelativeDate(date);

    // Truncate text if too long
    const maxLength = 200;
    const text = decision.text.length > maxLength
      ? decision.text.substring(0, maxLength) + '...'
      : decision.text;

    // Check permissions
    const isOwnDecision = decision.user_id === (window.currentUser && window.currentUser.user_id);
    const canModify = window.isCurrentUserAdmin || isOwnDecision;

    // Build card HTML
    card.innerHTML = `
      <div class="minimal-decision-header">
        <span class="minimal-decision-id">#${decision.id}</span>
        <span class="minimal-decision-title">${escapeHtml(decision.text.split('\n')[0].substring(0, 100))}</span>
      </div>
      <div class="minimal-decision-meta">
        <span>${dateStr}</span>
        <span>•</span>
        <span>${escapeHtml(decision.creator)}</span>
        ${decision.space_name ? `<span>•</span><span>📁 ${escapeHtml(decision.space_name)}</span>` : ''}
      </div>
      <div class="minimal-decision-text">${escapeHtml(text)}</div>
      <div class="minimal-decision-actions">
        <button onclick="openDetailModal(${index}); event.stopPropagation();">View</button>
        ${canModify ? `<button onclick="openDeleteModal(${decision.id}); event.stopPropagation();">Delete</button>` : ''}
        <button onclick="askAboutDecision(${decision.id}); event.stopPropagation();">Ask AI</button>
      </div>
    `;

    // Click card to view details
    card.addEventListener('click', () => {
      window.openDetailModal(index);
    });

    return card;
  }

  // Helper: Format date as relative (e.g., "2 hours ago", "Jan 20")
  function formatRelativeDate(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    // Format as "Jan 20" or "Jan 20, 2025" if not current year
    const options = { month: 'short', day: 'numeric' };
    if (date.getFullYear() !== now.getFullYear()) {
      options.year = 'numeric';
    }
    return date.toLocaleDateString('en-US', options);
  }

  // Helper: Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Ask AI about a specific decision
  window.askAboutDecision = function(decisionId) {
    const chatInput = document.getElementById('chat-input-main');
    if (chatInput) {
      chatInput.value = `Tell me more about decision #${decisionId}`;
      chatInput.focus();
      // Optionally trigger send
      const sendBtn = document.getElementById('chat-send-main');
      if (sendBtn) {
        sendBtn.click();
      }
    }
  };

  // Override init to show minimal view
  const originalInit = window.onload;
  window.addEventListener('DOMContentLoaded', () => {
    // Wait a bit for dashboard.js to load
    setTimeout(() => {
      if (document.body.classList.contains('minimal-mode')) {
        // Hide loading indicator and show minimal split view
        const loadingIndicator = document.getElementById('loading-indicator');
        const minimalView = document.getElementById('minimal-split-view');

        // The original init will handle auth, spaces, and data loading
        // We just need to show the minimal view when ready
        const observer = new MutationObserver((mutations) => {
          // Check if loading is done (loading indicator hidden)
          if (loadingIndicator && loadingIndicator.style.display === 'none') {
            if (minimalView) {
              minimalView.style.display = 'flex';
            }
            observer.disconnect();
          }
        });

        if (loadingIndicator) {
          observer.observe(loadingIndicator, {
            attributes: true,
            attributeFilter: ['style']
          });
        }
      }
    }, 100);
  });

  // Apply filters (integrated with existing filter system)
  window.applyFilters = function() {
    // Get filter values
    const searchValue = document.getElementById('search')?.value.toLowerCase() || '';
    const typeFilter = document.getElementById('type-filter')?.value || '';

    // Filter decisions
    const filtered = window.allDecisions.filter(d => {
      // Search filter
      const matchesSearch = !searchValue ||
        d.text.toLowerCase().includes(searchValue) ||
        d.creator.toLowerCase().includes(searchValue) ||
        (d.space_name && d.space_name.toLowerCase().includes(searchValue));

      // Type filter
      const matchesType = !typeFilter || d.type === typeFilter;

      return matchesSearch && matchesType;
    });

    // Re-render
    window.renderDecisions(filtered);
  };

  console.log('✅ Minimal dashboard initialized');
})();
