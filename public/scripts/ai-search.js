// AI Search View Logic
// Handles semantic search: the answer, then its evidence sources

(function() {
  'use strict';

  console.log('🔍 AI Search UI loaded');

  let currentSearchResults = null;
  let conversationHistory = [];
  let currentQuery = null;
  let excludedIds = [];      // sources marked "not related" and left out of the current answer
  let pendingExclusions = []; // marked "not related" since the answer was last updated
  const feedback = new Map(); // decision id → true (related) / false (not related), for the current question

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

  /**
   * Main search function
   * @param {string} query
   * @param {{ excludeIds?: number[], replaceLastTurn?: boolean }} [options] - answer again without some sources
   */
  window.performSearch = async function(query, options = {}) {
    console.log(`🔍 Performing search: "${query}"`);
    const isUpdate = !!options.replaceLastTurn;
    if (!isUpdate) {
      excludedIds = [];
      feedback.clear();
    }
    pendingExclusions = [];

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
      console.log('👤 User data from /auth/me:', userData);
      const workspaceId = userData.user?.workspace_id;
      console.log('🏢 Workspace ID:', workspaceId);

      if (!workspaceId) {
        throw new Error('No workspace_id found in user session');
      }

      // Get current space from URL or localStorage
      const urlParams = new URLSearchParams(window.location.search);
      let currentSpaceId = urlParams.get('space') || localStorage.getItem('corteza_last_space_id');
      console.log('📁 Space ID:', currentSpaceId);

      if (!currentSpaceId) {
        throw new Error('No space selected. Please return to dashboard and select a space.');
      }

      // Perform semantic search with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const response = await fetch('/api/semantic-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: query,
          workspace_id: workspaceId,
          space_id: currentSpaceId,  // ADD THIS
          conversational: true,
          conversationHistory: isUpdate ? conversationHistory.slice(0, -2) : conversationHistory,
          exclude_ids: options.excludeIds || [],
          limit: 8
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Search failed with status ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Search results:', data);

      // Store results
      currentSearchResults = data;
      currentQuery = query;
      excludedIds = data.excluded_ids || options.excludeIds || [];

      // Add to conversation history (an updated answer replaces the previous one)
      if (isUpdate) conversationHistory = conversationHistory.slice(0, -2);
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

      // Better error message for timeout
      if (error.name === 'AbortError') {
        alert('Search request timed out after 30 seconds. The server might be processing a large query or experiencing issues. Please try again.');
      } else {
        alert('Search failed: ' + error.message);
      }
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

    // Display metadata: how many sources the answer is based on
    const resultsCount = document.getElementById('results-count');
    const usedCount = usedSources(data).length;
    const total = (data.decisions || []).length;
    const actionCount = (data.action_items || []).length;
    resultsCount.textContent = total === 0
      ? (actionCount ? `${actionCount} open action item${actionCount !== 1 ? 's' : ''}` : 'No matching sources')
      : `Based on ${usedCount} source${usedCount !== 1 ? 's' : ''}${total > usedCount ? ` (${total - usedCount} other match${total - usedCount !== 1 ? 'es' : ''})` : ''}`
        + (excludedIds.length ? ` · ${excludedIds.length} left out` : '');
    renderExcludedBanner();

    const timestamp = document.getElementById('search-timestamp');
    const now = new Date();
    timestamp.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    // Open action items the question is about, then the evidence sources
    renderActionItems(data.action_items || []);
    renderEvidenceSources(data.decisions || []);

    // Render related topics
    renderRelatedTopics(data.decisions || []);

    // Scroll to top smoothly
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Open action items the question is about ("What's pending from Ana?"), most urgent first */
  function renderActionItems(items) {
    const container = document.getElementById('search-action-items');
    if (!container) return;
    container.classList.toggle('hidden', items.length === 0);
    if (items.length === 0) {
      container.innerHTML = '';
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const rows = items.map(item => {
      const owners = (item.owners || []).map(owner => owner.name).filter(Boolean).join(', ') || 'No owner';
      const overdue = item.due_date && item.due_date < today;
      const due = item.due_date
        ? new Date(`${item.due_date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : 'No due date';
      const meeting = item.source && item.source.title ? ` · ${escapeHtml(item.source.title)}` : '';
      return `
        <li class="flex items-start justify-between gap-4 py-3">
          <div class="flex items-start gap-3 min-w-0">
            <span class="material-symbols-outlined text-on-surface-variant text-xl mt-0.5" style="font-variation-settings: 'FILL' 0;">radio_button_unchecked</span>
            <div class="min-w-0">
              <p class="text-on-surface">${escapeHtml(item.text)}</p>
              <p class="text-sm text-on-surface-variant">${escapeHtml(owners)}${meeting}</p>
            </div>
          </div>
          <span class="whitespace-nowrap text-sm font-medium ${overdue ? 'text-error' : 'text-on-surface-variant'}">${overdue ? 'Overdue · ' : ''}${escapeHtml(due)}</span>
        </li>`;
    }).join('');
    container.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-2xl font-bold flex items-center gap-3">
          <span class="material-symbols-outlined text-primary" style="font-variation-settings: 'FILL' 1;">task_alt</span>
          Open action items
        </h3>
        <a href="/actions" class="text-sm text-primary font-semibold hover:underline">Open Action items →</a>
      </div>
      <ul class="bg-surface-container-lowest border border-outline-variant rounded-xl px-5 divide-y divide-outline-variant/50">${rows}</ul>`;
  }

  /**
   * Examples: the person one names whoever has the most open action items besides you
   * (from your meetings), and is hidden when nobody else has any
   */
  async function setupExamples() {
    const examples = document.getElementById('search-examples');
    if (!examples) return;
    examples.addEventListener('click', event => {
      const button = event.target.closest('.search-example');
      if (button) performSearch(button.dataset.query);
    });

    const personExample = examples.querySelector('[data-example-person]');
    if (!personExample) return;
    try {
      const response = await fetch('/api/action-items?owner=all&status=open', { credentials: 'include' });
      const data = await response.json();
      const counts = new Map();
      for (const item of (response.ok && data.items) || []) {
        for (const owner of item.owners || []) {
          if (!owner.name || (owner.user_id && owner.user_id === data.user_id)) continue;
          const first = owner.name.trim().split(/\s+/)[0];
          counts.set(first, (counts.get(first) || 0) + 1);
        }
      }
      const top = [...counts].sort((a, b) => b[1] - a[1])[0];
      if (!top) {
        personExample.remove();
        return;
      }
      const query = `What's still pending from ${top[0]} before our next meeting?`;
      personExample.dataset.query = query;
      personExample.querySelector('.font-medium').textContent = query;
    } catch (error) {
      personExample.remove();
    }
  }

  /** Sources the answer used, in the order the AI listed them */
  function usedSources(data) {
    const decisions = data.decisions || [];
    const ids = Array.isArray(data.used_ids) ? data.used_ids : decisions.map(d => d.id);
    return ids.map(id => decisions.find(d => d.id === id)).filter(Boolean);
  }

  // Render evidence sources (right column cards): the ones the answer used, then other matches
  function renderEvidenceSources(decisions) {
    const container = document.getElementById('evidence-sources');
    container.innerHTML = '';

    if (decisions.length === 0) {
      container.innerHTML = `
        <div class="lg:col-span-2 text-center py-8 text-on-surface-variant">
          <p>No sources match this question</p>
        </div>
      `;
      return;
    }

    const used = usedSources(currentSearchResults || { decisions });
    const others = decisions.filter(d => !used.includes(d));
    used.forEach(decision => container.appendChild(createEvidenceCard(decision)));

    if (others.length) {
      const details = document.createElement('details');
      details.className = 'evidence-others lg:col-span-2';
      details.innerHTML = `<summary class="cursor-pointer text-sm font-semibold text-on-surface-variant py-2">Other matches not used in the answer (${others.length})</summary>`;
      const list = document.createElement('div');
      list.className = 'grid grid-cols-1 lg:grid-cols-2 gap-4 items-start mt-3';
      others.forEach(decision => list.appendChild(createEvidenceCard(decision)));
      details.appendChild(list);
      if (used.length === 0) details.open = true;
      container.appendChild(details);
    }
  }

  function createEvidenceCard(decision) {
    const card = document.createElement('div');
    const verdict = feedback.get(decision.id);
    card.className = `evidence-card border border-outline-variant rounded-xl p-5 cursor-pointer${verdict === false ? ' evidence-card-unrelated' : ''}`;
    card.dataset.sourceId = decision.id;
    card.onclick = () => openSource(decision);

    const title = decision.text.split('\n')[0];
    const preview = getTruncatedText(decision.text, 150);
    const date = new Date(decision.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const score = decision.score ? Math.round(decision.score * 100) : 0;

    // Get user name (try user_name first, then creator as fallback)
    const userName = decision.user_name || decision.creator || 'Unknown User';
    const displayName = userName ? userName.split(' ')[0] : 'Unknown'; // First name only

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
        ${verdict === false
          ? '<span class="text-xs font-bold text-error">Not related</span>'
          : verdict === true ? '<span class="text-xs font-bold text-tertiary">✓ Related</span>' : `<span class="text-xs font-bold ${scoreColor}">${score}%</span>`}
      </div>

      <h5 class="font-bold text-base mb-2 line-clamp-2">${escapeHtml(title)}</h5>
      <p class="text-sm text-on-surface-variant line-clamp-3 mb-3">${escapeHtml(preview)}</p>

      <div class="flex items-center justify-between pt-3 border-t border-outline-variant/50">
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 bg-surface-container text-primary rounded-full flex items-center justify-center font-bold text-xs">
            ${getInitials(userName)}
          </div>
          <span class="text-xs font-medium">${escapeHtml(displayName)}</span>
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

  // Open a source in full (the shared detail modal), with "Is this related?" on top
  function openSource(decision) {
    if (typeof window.openDecision !== 'function') return;
    window.openDecision(decision);
    renderRelevance(decision);
  }

  // Breakdown items call this with an id
  window.openDecisionDetail = function(decisionId) {
    const decision = currentSearchResults && (currentSearchResults.decisions || []).find(d => d.id === decisionId);
    if (decision) openSource(decision);
  };

  /** The "Is this related to your question?" block at the top of the source */
  function renderRelevance(decision) {
    const block = document.getElementById('detail-relevance');
    if (!block || !currentQuery) return;
    const verdict = feedback.get(decision.id);
    const waiting = pendingExclusions.length > 0;
    block.style.display = 'block';
    block.innerHTML = `
      <p class="detail-relevance-question">Is this related to <strong>“${escapeHtml(currentQuery)}”</strong>?</p>
      <div class="detail-relevance-buttons">
        <button type="button" data-relevant="yes" class="${verdict === true ? 'is-selected' : ''}">👍 Yes, related</button>
        <button type="button" data-relevant="no" class="${verdict === false ? 'is-selected' : ''}">👎 No, not related</button>
      </div>
      ${verdict === false ? `
        <div class="detail-relevance-followup">
          ${waiting
            ? 'It will be left out when the answer is updated. <button type="button" data-update>Update the answer without it</button>'
            : 'It is left out of the current answer.'}
        </div>` : ''}
      ${verdict === true ? '<div class="detail-relevance-followup">Thanks, noted.</div>' : ''}`;

    block.querySelector('[data-relevant="yes"]').onclick = () => setRelevance(decision, true);
    block.querySelector('[data-relevant="no"]').onclick = () => setRelevance(decision, false);
    const update = block.querySelector('[data-update]');
    if (update) update.onclick = () => { window.closeDetailModal(); updateAnswer(); };
  }

  async function setRelevance(decision, relevant) {
    feedback.set(decision.id, relevant);
    const isExcluded = excludedIds.includes(decision.id) || pendingExclusions.includes(decision.id);
    if (!relevant && !isExcluded) pendingExclusions.push(decision.id);
    if (relevant) pendingExclusions = pendingExclusions.filter(id => id !== decision.id);
    renderRelevance(decision);
    refreshCard(decision);
    renderExcludedBanner();

    try {
      await fetch('/api/search-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ query: currentQuery, decision_id: decision.id, relevant })
      });
    } catch (error) {
      console.warn('Could not save search feedback:', error);
    }
  }

  function refreshCard(decision) {
    document.querySelectorAll(`.evidence-card[data-source-id="${decision.id}"]`).forEach(card => card.replaceWith(createEvidenceCard(decision)));
  }

  /** Under the answer: "2 sources marked not related · Update answer" */
  function renderExcludedBanner() {
    const banner = document.getElementById('excluded-banner');
    if (!banner) return;
    if (pendingExclusions.length === 0) {
      banner.classList.add('hidden');
      return;
    }
    const n = pendingExclusions.length;
    banner.classList.remove('hidden');
    banner.innerHTML = `
      <span>${n} source${n !== 1 ? 's' : ''} marked as not related (${pendingExclusions.map(id => `#${id}`).join(', ')}).</span>
      <button type="button" class="bg-white text-primary font-semibold rounded-lg px-4 py-2" id="update-answer">Update the answer without ${n === 1 ? 'it' : 'them'}</button>`;
    document.getElementById('update-answer').onclick = updateAnswer;
  }

  /** Asks again for the same question, leaving out every source marked "not related" */
  function updateAnswer() {
    if (!currentQuery) return;
    const ids = [...new Set([...excludedIds, ...pendingExclusions])];
    performSearch(currentQuery, { excludeIds: ids, replaceLastTurn: true });
  }

  // Utility functions
  function getTruncatedText(text, maxLength = 150) {
    const lines = text.split('\n');
    const preview = lines.slice(1).join(' ').trim() || lines[0];
    return preview.substring(0, maxLength) + (preview.length > maxLength ? '...' : '');
  }

  function getInitials(name) {
    if (!name) return 'U';

    const parts = name.split(' ').filter(p => p.length > 0);
    if (parts.length === 0) return 'U';

    if (parts.length === 1) {
      // Single word - take first 2 chars
      return parts[0].substring(0, 2).toUpperCase();
    }

    // Multiple words - take first char of first 2 words
    return parts
      .slice(0, 2)
      .map(n => n[0])
      .join('')
      .toUpperCase();
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  setupExamples();

  // Check if there's a query in the URL (deep linking)
  const urlParams = new URLSearchParams(window.location.search);
  const queryParam = urlParams.get('q');
  if (queryParam) {
    performSearch(queryParam);
  }

  console.log('✅ AI Search initialized');
})();
