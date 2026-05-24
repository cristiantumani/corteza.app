// AI Search View Logic
// Handles semantic search and renders intelligence breakdown

(function() {
  'use strict';

  console.log('🔍 AI Search UI loaded');

  let currentSearchResults = null;
  let conversationHistory = [];

  // Auto-resize textarea
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 200) + 'px';
    });

    // Auto-focus on load
    searchInput.focus();
  }

  // Handle Enter key in search input
  window.handleSearchKeydown = function(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      performSearchFromInput();
    }
  };

  // Perform search from input field
  window.performSearchFromInput = async function() {
    const input = document.getElementById('search-input');
    const query = input.value.trim();

    if (!query) return;

    await performSearch(query);
    input.value = '';
    input.style.height = 'auto';
  };

  // Main search function
  window.performSearch = async function(query) {
    console.log(`🔍 Performing search: "${query}"`);

    // Show loading state
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('search-results').classList.add('hidden');
    document.getElementById('search-loading').classList.remove('hidden');

    try {
      // Get current user from session
      const userResponse = await fetch('/auth/me');
      if (!userResponse.ok) {
        throw new Error('Not authenticated');
      }
      const userData = await userResponse.json();
      const workspaceId = userData.workspace_id;

      // Perform semantic search
      const response = await fetch('/api/semantic-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: query,
          workspace_id: workspaceId,
          conversational: true,
          conversationHistory: conversationHistory,
          limit: 20
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Search failed');
      }

      const data = await response.json();
      console.log('✅ Search results:', data);

      // Store results
      currentSearchResults = data;

      // Add to conversation history
      conversationHistory.push({
        role: 'user',
        content: query
      });
      conversationHistory.push({
        role: 'assistant',
        content: data.response
      });

      // Render results
      renderSearchResults(data, query);

    } catch (error) {
      console.error('❌ Search error:', error);

      // Show error state
      document.getElementById('search-loading').classList.add('hidden');
      document.getElementById('empty-state').classList.remove('hidden');

      alert('Search failed: ' + error.message);
    }
  };

  // Render search results
  function renderSearchResults(data, query) {
    // Hide loading, show results
    document.getElementById('search-loading').classList.add('hidden');
    document.getElementById('search-results').classList.remove('hidden');

    // Display query
    document.getElementById('search-query-display').textContent = `"${query}"`;

    // Display synthesized response
    document.getElementById('synthesized-response').textContent = data.response || 'No insights generated';

    // Display metadata
    const resultsCount = document.getElementById('results-count');
    resultsCount.textContent = `${data.resultsCount || 0} source${data.resultsCount !== 1 ? 's' : ''} analyzed`;

    const timestamp = document.getElementById('search-timestamp');
    const now = new Date();
    timestamp.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    // Render intelligence breakdown
    renderIntelligenceBreakdown(data);

    // Render evidence sources
    renderEvidenceSources(data.decisions || []);

    // Render related topics
    renderRelatedTopics(data.decisions || []);

    // Scroll to top smoothly
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Render intelligence breakdown (categorized insights)
  function renderIntelligenceBreakdown(data) {
    const container = document.getElementById('intelligence-breakdown');
    container.innerHTML = '';

    const categorized = data.categorized || {};
    const highlyRelevant = categorized.highlyRelevant || [];
    const relevant = categorized.relevant || [];
    const somewhatRelevant = categorized.somewhatRelevant || [];

    // Highly Relevant Section
    if (highlyRelevant.length > 0) {
      const section = createBreakdownSection(
        'Highly Relevant',
        'Key decisions that directly address your query',
        highlyRelevant,
        'tertiary',
        'check_circle'
      );
      container.appendChild(section);
    }

    // Relevant Section
    if (relevant.length > 0) {
      const section = createBreakdownSection(
        'Relevant',
        'Related decisions worth considering',
        relevant,
        'primary',
        'circle'
      );
      container.appendChild(section);
    }

    // Somewhat Relevant Section
    if (somewhatRelevant.length > 0) {
      const section = createBreakdownSection(
        'Context',
        'Additional background information',
        somewhatRelevant,
        'secondary',
        'radio_button_unchecked'
      );
      container.appendChild(section);
    }

    // No results
    if (highlyRelevant.length === 0 && relevant.length === 0 && somewhatRelevant.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 text-on-surface-variant">
          <span class="material-symbols-outlined text-6xl mb-4 opacity-30">search_off</span>
          <p class="text-lg">No relevant decisions found for this query</p>
        </div>
      `;
    }
  }

  function createBreakdownSection(title, description, decisions, colorClass, iconName) {
    const section = document.createElement('div');
    section.className = 'bg-surface-container-lowest border border-outline-variant rounded-xl p-6 mb-4';

    const colorMap = {
      'tertiary': 'text-tertiary',
      'primary': 'text-primary',
      'secondary': 'text-secondary'
    };

    const bgMap = {
      'tertiary': 'bg-tertiary-container/20',
      'primary': 'bg-primary-container/20',
      'secondary': 'bg-secondary-container/20'
    };

    section.innerHTML = `
      <div class="flex items-start gap-4 mb-4">
        <div class="w-10 h-10 ${bgMap[colorClass]} rounded-lg flex items-center justify-center ${colorMap[colorClass]} flex-shrink-0">
          <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">${iconName}</span>
        </div>
        <div>
          <h4 class="text-lg font-bold mb-1">${title}</h4>
          <p class="text-sm text-on-surface-variant">${description}</p>
        </div>
        <span class="ml-auto text-sm font-semibold ${colorMap[colorClass]} px-3 py-1 ${bgMap[colorClass]} rounded-full">${decisions.length}</span>
      </div>

      <div class="space-y-3 ml-14">
        ${decisions.slice(0, 5).map((decision, index) => createBreakdownItem(decision, index)).join('')}
        ${decisions.length > 5 ? `<p class="text-sm text-on-surface-variant italic">+${decisions.length - 5} more in evidence sources</p>` : ''}
      </div>
    `;

    return section;
  }

  function createBreakdownItem(decision, index) {
    const title = decision.text.split('\n')[0];
    const preview = getTruncatedText(decision.text, 120);
    const score = decision.score ? `${Math.round(decision.score * 100)}% relevance` : '';
    const date = new Date(decision.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    return `
      <div class="p-4 bg-surface-container rounded-lg hover:bg-surface-container-low transition-colors cursor-pointer" onclick="openDecisionDetail(${decision.id})">
        <div class="flex items-start justify-between gap-3 mb-2">
          <h5 class="font-semibold text-sm line-clamp-1">${escapeHtml(title)}</h5>
          <span class="text-xs text-on-surface-variant whitespace-nowrap">${score}</span>
        </div>
        <p class="text-sm text-on-surface-variant line-clamp-2 mb-2">${escapeHtml(preview)}</p>
        <div class="flex items-center gap-3 text-xs text-on-surface-variant">
          <span>${escapeHtml(decision.creator)}</span>
          <span>•</span>
          <span>${date}</span>
          ${decision.space_name ? `<span>•</span><span>${escapeHtml(decision.space_name)}</span>` : ''}
        </div>
      </div>
    `;
  }

  // Render evidence sources (right column cards)
  function renderEvidenceSources(decisions) {
    const container = document.getElementById('evidence-sources');
    container.innerHTML = '';

    if (decisions.length === 0) {
      container.innerHTML = `
        <div class="text-center py-8 text-on-surface-variant">
          <p>No evidence sources available</p>
        </div>
      `;
      return;
    }

    decisions.forEach(decision => {
      const card = createEvidenceCard(decision);
      container.appendChild(card);
    });
  }

  function createEvidenceCard(decision) {
    const card = document.createElement('div');
    card.className = 'evidence-card border border-outline-variant rounded-xl p-5 cursor-pointer';
    card.onclick = () => openDecisionDetail(decision.id);

    const title = decision.text.split('\n')[0];
    const preview = getTruncatedText(decision.text, 150);
    const date = new Date(decision.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const score = decision.score ? Math.round(decision.score * 100) : 0;

    // Score color
    let scoreColor = 'text-on-surface-variant';
    if (score >= 80) scoreColor = 'text-tertiary';
    else if (score >= 60) scoreColor = 'text-primary';

    card.innerHTML = `
      <div class="flex items-start justify-between mb-3">
        <div class="flex gap-2 flex-wrap">
          ${decision.space_name ? `<span class="px-2 py-1 rounded-md bg-secondary-container/20 text-xs font-semibold">${escapeHtml(decision.space_name)}</span>` : ''}
          <span class="px-2 py-1 rounded-md bg-primary-container/10 text-xs font-semibold text-primary">${escapeHtml(decision.type)}</span>
        </div>
        <span class="text-xs font-bold ${scoreColor}">${score}%</span>
      </div>

      <h5 class="font-bold text-base mb-2 line-clamp-2">${escapeHtml(title)}</h5>
      <p class="text-sm text-on-surface-variant line-clamp-3 mb-3">${escapeHtml(preview)}</p>

      <div class="flex items-center justify-between pt-3 border-t border-outline-variant/50">
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 bg-surface-container text-primary rounded-full flex items-center justify-center font-bold text-xs">
            ${getInitials(decision.creator)}
          </div>
          <span class="text-xs font-medium">${escapeHtml(decision.creator.split(' ')[0])}</span>
        </div>
        <span class="text-xs text-on-surface-variant">${date}</span>
      </div>
    `;

    return card;
  }

  // Render related topics (tags)
  function renderRelatedTopics(decisions) {
    const container = document.getElementById('related-topics');
    container.innerHTML = '';

    // Extract all unique tags
    const allTags = new Set();
    decisions.forEach(decision => {
      if (decision.tags && Array.isArray(decision.tags)) {
        decision.tags.forEach(tag => allTags.add(tag));
      }
    });

    if (allTags.size === 0) {
      container.innerHTML = '<p class="text-sm text-on-surface-variant">No related topics found</p>';
      return;
    }

    // Show first 10 tags
    const tagsArray = Array.from(allTags).slice(0, 10);
    tagsArray.forEach(tag => {
      const badge = document.createElement('button');
      badge.className = 'px-4 py-2 bg-surface-container-lowest border border-outline-variant rounded-full text-sm font-medium hover:border-primary hover:bg-primary-container/10 transition-all';
      badge.textContent = tag;
      badge.onclick = () => performSearch(`decisions about ${tag}`);
      container.appendChild(badge);
    });
  }

  // Clear search and return to empty state
  window.clearSearch = function() {
    document.getElementById('search-results').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
    currentSearchResults = null;
    conversationHistory = [];

    const searchInput = document.getElementById('search-input');
    searchInput.value = '';
    searchInput.style.height = 'auto';
    searchInput.focus();
  };

  // Open decision detail modal (uses existing dashboard.js function)
  window.openDecisionDetail = function(decisionId) {
    // Find decision in current results
    if (currentSearchResults && currentSearchResults.decisions) {
      const index = currentSearchResults.decisions.findIndex(d => d.id === decisionId);
      if (index !== -1 && typeof window.openDetailModal === 'function') {
        // Store decisions in global variable for modal access
        window.allDecisions = currentSearchResults.decisions;
        window.openDetailModal(index);
      }
    }
  };

  // Utility functions
  function getTruncatedText(text, maxLength = 150) {
    const lines = text.split('\n');
    const preview = lines.slice(1).join(' ').trim() || lines[0];
    return preview.substring(0, maxLength) + (preview.length > maxLength ? '...' : '');
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

  // Check if there's a query in the URL (deep linking)
  const urlParams = new URLSearchParams(window.location.search);
  const queryParam = urlParams.get('q');
  if (queryParam) {
    performSearch(queryParam);
  }

  console.log('✅ AI Search initialized');
})();
