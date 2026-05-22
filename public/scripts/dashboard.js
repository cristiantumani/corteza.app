    // Authentication check - must be logged in to access dashboard
    let currentUser = null;
    // WORKSPACE_ID is defined in the HTML file before this script loads
    let isCurrentUserAdmin = false;

    // Spaces state
    let currentSpaceId = null;
    let allSpaces = [];
    let currentUserSpaces = [];

    // Check authentication status on page load
    async function checkAuth() {
      try {
        const response = await fetch('/auth/me');
        const data = await response.json();

        if (!data.authenticated) {
          // Not authenticated - redirect to login
          window.location.href = '/auth/login?return=' + encodeURIComponent(window.location.pathname);
          return false;
        }

        // Authenticated - store user info
        currentUser = data.user;
        WORKSPACE_ID = data.user.workspace_id;

        // Check if user is admin
        await checkIfAdmin();

        // Update header with user info
        updateHeader();

        return true;
      } catch (err) {
        console.error('Auth check failed:', err);
        // Redirect to login on error
        window.location.href = '/auth/login';
        return false;
      }
    }

    // Check if current user is admin
    async function checkIfAdmin() {
      try {
        const response = await fetch(`/api/permissions/check?workspace_id=${WORKSPACE_ID}`);
        const data = await response.json();
        isCurrentUserAdmin = data.is_admin === true;
        console.log('Admin status:', isCurrentUserAdmin);
      } catch (error) {
        console.error('Failed to check admin status:', error);
        isCurrentUserAdmin = false;
      }
    }

    // Update header with user info and logout button
    function updateHeader() {
      const header = document.querySelector('header .container');
      const h1 = header.querySelector('h1');

      // Update AI analytics link with workspace_id
      const analyticsLink = document.querySelector('a[href*="ai-analytics"]');
      if (analyticsLink) {
        analyticsLink.href = `/ai-analytics?workspace_id=${WORKSPACE_ID}`;
      }

      // Update context bar
      const contextWorkspace = document.getElementById('context-workspace');
      if (contextWorkspace) {
        contextWorkspace.textContent = currentUser.workspace_name || WORKSPACE_ID;
      }

      const contextUser = document.getElementById('context-user');
      if (contextUser) {
        // Always prefer email over username
        contextUser.textContent = currentUser.email || currentUser.user_name || 'Unknown user';
        console.log('Context bar user:', { email: currentUser.email, user_name: currentUser.user_name });
      }

      // Update chat workspace info
      const chatWorkspaceInfo = document.getElementById('chat-workspace-info');
      if (chatWorkspaceInfo) {
        chatWorkspaceInfo.textContent = `Workspace: ${currentUser.workspace_name} (${WORKSPACE_ID})`;
      }

      // Update hero workspace name
      const heroWorkspaceName = document.getElementById('hero-workspace-name');
      if (heroWorkspaceName) {
        heroWorkspaceName.textContent = currentUser.workspace_name;
      }

      // Add user info next to title
      h1.innerHTML += `
        <span style="font-size: 14px; font-weight: 400; margin-left: 20px; color: #718096;">
          ${currentUser.workspace_name} • ${currentUser.user_name}
        </span>
        <a href="/auth/logout" style="font-size: 14px; font-weight: 400; margin-left: 15px; color: #667eea; text-decoration: none;">
          Logout →
        </a>
      `;
    }

    let allDecisions = [];
    let deleteTargetId = null;
    let currentDecisionIndex = null;

    // View state management
    let currentView = 'classic'; // 'chat' or 'classic'
    const VIEW_STORAGE_KEY = 'corteza_dashboard_view_preference';
    let chatMessagesHistory = [];
    let isChatLoading = false;

    async function fetchStats() {
      try {
        const r = await fetch(`/api/stats?workspace_id=${WORKSPACE_ID}`);
        const d = await r.json();

        // Update Classic View stats (8 cards)
        document.getElementById('total-count').textContent = d.total;
        document.getElementById('decision-count').textContent = d.byType.decision || 0;
        document.getElementById('explanation-count').textContent = d.byType.explanation || 0;
        document.getElementById('context-count').textContent = d.byType.context || 0;
        document.getElementById('product-count').textContent = d.byCategory?.product || 0;
        document.getElementById('ux-count').textContent = d.byCategory?.ux || 0;
        document.getElementById('technical-count').textContent = d.byCategory?.technical || 0;
        document.getElementById('week-count').textContent = d.lastWeek;

        // Update Chat View condensed stats (3 chips)
        document.getElementById('total-count-chat').textContent = d.total;
        document.getElementById('decision-count-chat').textContent = d.byType.decision || 0;
        document.getElementById('week-count-chat').textContent = d.lastWeek;

        // Update hero section
        document.getElementById('hero-total').textContent = d.total;
      } catch (e) {}
    }

    // ========================================
    // View Management Functions
    // ========================================

    function toggleView(targetView) {
      // If no target specified, toggle between views
      if (!targetView) {
        targetView = currentView === 'chat' ? 'classic' : 'chat';
      }

      // Update current view
      currentView = targetView;

      // Get containers
      const chatContainer = document.getElementById('chat-view-container');
      const classicContainer = document.getElementById('classic-view-container');
      const toggleBtn = document.getElementById('view-toggle-btn');
      const toggleText = document.getElementById('toggle-text');
      const toggleIconChat = document.getElementById('toggle-icon-chat');
      const toggleIconClassic = document.getElementById('toggle-icon-classic');

      // Get stats containers
      const statsClassic = document.getElementById('stats-classic');
      const statsChat = document.getElementById('stats-chat');

      // Get chat widget
      const chatWidget = document.getElementById('chat-widget');

      // Get hero banner
      const heroBanner = document.querySelector('.hero-banner');

      if (currentView === 'chat') {
        // Show Chat View
        chatContainer.style.display = 'block';
        classicContainer.style.display = 'none';
        statsClassic.style.display = 'none';
        statsChat.style.display = 'flex';

        // Hide hero banner in Chat View (makes chat input more prominent)
        if (heroBanner) heroBanner.style.display = 'none';

        // Hide chat widget in Chat View
        if (chatWidget) chatWidget.style.display = 'none';

        // Update toggle button
        toggleBtn.classList.add('chat-active');
        toggleText.textContent = 'Chat View';
        toggleIconChat.style.display = 'inline';
        toggleIconClassic.style.display = 'none';

        // Focus chat input
        setTimeout(() => {
          const chatInput = document.getElementById('chat-input-main');
          if (chatInput) chatInput.focus();
        }, 100);

      } else {
        // Show Classic View
        chatContainer.style.display = 'none';
        classicContainer.style.display = 'block';
        statsClassic.style.display = 'grid';
        statsChat.style.display = 'none';

        // Show hero banner in Classic View
        if (heroBanner) heroBanner.style.display = 'block';

        // Show chat widget in Classic View
        if (chatWidget) chatWidget.style.display = 'block';

        // Update toggle button
        toggleBtn.classList.remove('chat-active');
        toggleText.textContent = 'Classic View';
        toggleIconChat.style.display = 'none';
        toggleIconClassic.style.display = 'inline';
      }

      // Save preference to localStorage
      localStorage.setItem(VIEW_STORAGE_KEY, currentView);

      console.log('Switched to:', currentView, 'view');
    }

    function loadViewPreference() {
      // Load saved view preference or default to 'chat'
      const savedView = localStorage.getItem(VIEW_STORAGE_KEY);
      const initialView = savedView || 'chat';

      console.log('Loading view preference:', initialView);

      // Apply view after a short delay to ensure DOM is ready
      setTimeout(() => {
        toggleView(initialView);

        // Check if messages exist and apply has-messages class
        if (initialView === 'chat') {
          const messagesArea = document.getElementById('chat-messages-main');
          const wrapper = document.getElementById('chat-view-wrapper');
          const hasMessages = messagesArea && messagesArea.children.length > 0;

          if (hasMessages && wrapper) {
            wrapper.classList.add('has-messages');
          }
        }
      }, 100);
    }

    // ========================================
    // Chat Interface Functions (Main Chat View)
    // ========================================

    async function sendChatMessage() {
      const chatInput = document.getElementById('chat-input-main');
      const query = chatInput.value.trim();

      if (!query || isChatLoading) return;

      // Set loading state
      isChatLoading = true;
      chatInput.value = '';

      // Switch to messages layout
      const wrapper = document.getElementById('chat-view-wrapper');
      if (wrapper) {
        wrapper.classList.add('has-messages');
      }

      // Add user message to UI
      addChatMessageMain(query, 'user');

      // Show typing indicator
      showChatTypingMain();

      try {
        console.log(`🔍 Sending search query: "${query}"`);
        console.log(`   Workspace ID: ${WORKSPACE_ID}`);

        // Call semantic search API
        const response = await fetch('/api/semantic-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            workspace_id: WORKSPACE_ID,
            conversational: true,
            conversationHistory: chatMessagesHistory,
            limit: 10
          })
        });

        removeChatTypingMain();

        if (!response.ok) {
          throw new Error(`Search failed: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.success) {
          // Add bot response with decision cards
          addChatMessageMain(data.response, 'bot', data.decisions);

          // Store in conversation history
          chatMessagesHistory.push({
            role: 'user',
            content: query
          });
          chatMessagesHistory.push({
            role: 'assistant',
            content: data.response
          });

          // Limit history to last 10 messages (5 turns)
          if (chatMessagesHistory.length > 10) {
            chatMessagesHistory = chatMessagesHistory.slice(-10);
          }
        } else {
          addChatErrorMain(data.error || 'Search failed');
        }

      } catch (error) {
        removeChatTypingMain();
        console.error('Chat error:', error);
        addChatErrorMain(error.message || 'Failed to search. Please try again.');
      } finally {
        isChatLoading = false;
      }
    }

    function addChatMessageMain(text, type, decisions) {
      const messagesArea = document.getElementById('chat-messages-main');

      // Create message container
      const messageDiv = document.createElement('div');
      messageDiv.className = `chat-message-main ${type}`;

      // Create message bubble
      const bubbleDiv = document.createElement('div');
      bubbleDiv.className = 'chat-message-bubble';

      // Format markdown (simple: bold, italic, code)
      let formattedText = text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');

      bubbleDiv.innerHTML = formattedText;
      messageDiv.appendChild(bubbleDiv);

      // Add decision cards if present (collapsed by default)
      if (decisions && decisions.length > 0) {
        // Create toggle button
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'chat-decisions-toggle';
        toggleBtn.innerHTML = `
          <span class="toggle-icon">📚</span>
          <span class="toggle-text">See all decisions (${decisions.length})</span>
          <span class="toggle-arrow">▼</span>
        `;

        // Create cards container (hidden by default)
        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'chat-decision-cards-main collapsed';

        decisions.forEach(decision => {
          const card = document.createElement('div');
          card.className = 'chat-decision-card-main';
          card.onclick = () => openDetailModalFromChat(decision.id);

          card.innerHTML = `
            <div class="card-header">
              <span class="card-id">#${decision.id}</span>
              <span class="card-badge">${decision.type || 'decision'}</span>
            </div>
            <div class="card-text">${decision.text.substring(0, 150)}${decision.text.length > 150 ? '...' : ''}</div>
            <div class="card-meta">${decision.user_name || 'Unknown'} • ${new Date(decision.timestamp).toLocaleDateString()}</div>
          `;

          cardsContainer.appendChild(card);
        });

        // Toggle collapse/expand
        toggleBtn.onclick = () => {
          const isCollapsed = cardsContainer.classList.contains('collapsed');
          if (isCollapsed) {
            cardsContainer.classList.remove('collapsed');
            toggleBtn.querySelector('.toggle-text').textContent = `Hide decisions (${decisions.length})`;
            toggleBtn.querySelector('.toggle-arrow').textContent = '▲';
          } else {
            cardsContainer.classList.add('collapsed');
            toggleBtn.querySelector('.toggle-text').textContent = `See all decisions (${decisions.length})`;
            toggleBtn.querySelector('.toggle-arrow').textContent = '▼';
          }
        };

        messageDiv.appendChild(toggleBtn);
        messageDiv.appendChild(cardsContainer);
      }

      messagesArea.appendChild(messageDiv);

      // Scroll to show the message bubble (text answer), not the decision cards
      // Use smooth scroll and align to start of viewport
      setTimeout(() => {
        bubbleDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }

    function showChatTypingMain() {
      const messagesArea = document.getElementById('chat-messages-main');

      const typingDiv = document.createElement('div');
      typingDiv.id = 'chat-typing-indicator-main';
      typingDiv.className = 'chat-message-main bot';

      const typingBubble = document.createElement('div');
      typingBubble.className = 'chat-typing-main';
      typingBubble.innerHTML = '<span></span><span></span><span></span>';

      typingDiv.appendChild(typingBubble);
      messagesArea.appendChild(typingDiv);

      scrollChatToBottom();
    }

    function removeChatTypingMain() {
      const typingIndicator = document.getElementById('chat-typing-indicator-main');
      if (typingIndicator) {
        typingIndicator.remove();
      }
    }

    function scrollChatToBottom() {
      const messagesArea = document.getElementById('chat-messages-main');
      messagesArea.scrollTop = messagesArea.scrollHeight;
    }

    function addChatErrorMain(errorMessage) {
      const messagesArea = document.getElementById('chat-messages-main');

      const errorDiv = document.createElement('div');
      errorDiv.className = 'chat-error-main';
      errorDiv.textContent = errorMessage;

      messagesArea.appendChild(errorDiv);
      scrollChatToBottom();
    }

    function openDetailModalFromChat(decisionId) {
      // Find decision in allDecisions array
      const index = allDecisions.findIndex(d => d.id === decisionId);

      if (index >= 0) {
        // Use existing modal function
        openDetailModal(index);
      } else {
        // Decision not in current table, fetch it
        fetchAndOpenDecision(decisionId);
      }
    }

    async function fetchAndOpenDecision(decisionId) {
      // Decision not found in current table view
      // User needs to search or adjust filters to see it
      alert(`Decision #${decisionId} is not currently loaded in your view. Please use the search or filters in Classic View to find this decision, or ask about it in the chat.`);
    }

    async function fetchDecisions() {
      try {
        const s = document.getElementById('search').value;
        const t = document.getElementById('type-filter').value;
        const c = document.getElementById('category-filter').value;
        const e = document.getElementById('epic-filter').value;
        const dateFrom = document.getElementById('date-from').value;
        const dateTo = document.getElementById('date-to').value;

        const p = new URLSearchParams();
        p.append('workspace_id', WORKSPACE_ID);  // ADD workspace_id
        if (currentSpaceId) p.append('space_id', currentSpaceId);  // ADD space filter
        if (s) p.append('search', s);
        if (t) p.append('type', t);
        if (c) p.append('category', c);
        if (e) p.append('epic', e);
        if (dateFrom) p.append('date_from', dateFrom);
        if (dateTo) p.append('date_to', dateTo);
        p.append('limit', '100');

        const r = await fetch(`/api/decisions?${p}`);
        const d = await r.json();
        allDecisions = d.decisions;
        renderDecisions(d.decisions);
      } catch (err) {
        document.getElementById('decisions-body').innerHTML = '<tr><td colspan="8">Error</td></tr>';
      }
    }

    function renderDecisions(decisions) {
      const tbody = document.getElementById('decisions-body');
      if (decisions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8">No memories found</td></tr>';
        return;
      }
      tbody.innerHTML = decisions.map((d, index) => {
        let epicCell = '-';
        if (d.epic_key) {
          if (d.jira_data && d.jira_data.url) {
            epicCell = `<a href="${d.jira_data.url}" target="_blank" class="jira-link">${d.epic_key}</a>`;
          } else {
            epicCell = d.epic_key;
          }
        }
        // Truncate decision text if too long
        const maxLength = 80;
        const truncatedText = d.text.length > maxLength ? d.text.substring(0, maxLength) + '...' : d.text;

        // Add space badge
        const spaceBadge = d.space_name ?
          `<span class="space-badge-small" style="font-size: 11px; background: #f3f4f6; padding: 2px 6px; border-radius: 4px; color: #6b7280; margin-left: 8px;">📁 ${d.space_name}</span>` :
          '';

        // Backward compatibility: if type has old values, treat as category
        let actualType = d.type;
        let actualCategory = d.category;
        if (['product', 'ux', 'technical'].includes(d.type)) {
          actualCategory = d.type;
          actualType = null;
        }

        const typeBadge = actualType ? `<span class="badge badge-${actualType}">${actualType}</span>` : '-';
        const categoryBadge = actualCategory ? `<span class="badge badge-${actualCategory}">${actualCategory}</span>` : '-';

        // Check if user can edit/delete this decision
        const isOwnDecision = d.user_id === currentUser.user_id;
        const canModify = isCurrentUserAdmin || isOwnDecision;

        // Build action buttons based on permissions
        let actionsHtml;
        if (canModify) {
          actionsHtml = `
            <button class="view-btn" onclick="openDetailModal(${index})">👁️ View</button>
            <button class="delete-btn" onclick="openDeleteModal(${d.id})">🗑️</button>
          `;
        } else {
          actionsHtml = `
            <button class="view-btn" onclick="openDetailModal(${index})">👁️ View</button>
            <span style="color: #9ca3af; font-size: 12px; margin-left: 8px;">Read-only</span>
          `;
        }

        return `<tr>
          <td><strong>#${d.id}</strong></td>
          <td class="decision-text" title="${d.text}">${truncatedText}${spaceBadge}</td>
          <td>${typeBadge}</td>
          <td>${categoryBadge}</td>
          <td>${epicCell}</td>
          <td>${d.creator}</td>
          <td>${new Date(d.timestamp).toLocaleDateString()}</td>
          <td>${actionsHtml}</td>
        </tr>`;
      }).join('');
    }

    function openDeleteModal(id) {
      deleteTargetId = id;
      document.getElementById('delete-decision-id').textContent = '#' + id;
      document.getElementById('delete-modal').classList.add('active');
    }

    function closeDeleteModal() {
      deleteTargetId = null;
      document.getElementById('delete-modal').classList.remove('active');

      // Reset delete button state in case modal was closed during deletion
      const deleteBtn = document.querySelector('.modal-btn-delete');
      if (deleteBtn) {
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Delete';
      }
    }

    function openDetailModal(index) {
      currentDecisionIndex = index;
      const decision = allDecisions[index];

      // Set title
      document.getElementById('detail-title').textContent = `Decision #${decision.id}`;

      // Set decision text
      document.getElementById('detail-decision-text').textContent = decision.text;

      // Set type with badge
      document.getElementById('detail-type').innerHTML = `<span class="badge badge-${decision.type}">${decision.type}</span>`;

      // Set creator and date
      document.getElementById('detail-creator').textContent = decision.creator;
      document.getElementById('detail-date').textContent = new Date(decision.timestamp).toLocaleString();

      // Check if user can edit this decision
      const isOwnDecision = decision.user_id === currentUser.user_id;
      const canModify = isCurrentUserAdmin || isOwnDecision;

      // Show/hide edit button based on permissions
      const editBtn = document.querySelector('#detail-modal .edit-btn');
      if (editBtn) {
        editBtn.style.display = canModify ? 'inline-block' : 'none';
      }

      // Handle meeting context / alternatives
      if (decision.alternatives) {
        document.getElementById('detail-meeting-section').style.display = 'block';
        // Security: Escape HTML before inserting, then convert newlines to <br>
        const escapedAlternatives = escapeHtml(decision.alternatives).replace(/\n/g, '<br>');
        document.getElementById('detail-meeting-info').innerHTML = escapedAlternatives;
      } else {
        document.getElementById('detail-meeting-section').style.display = 'none';
      }

      // Handle Jira epic
      if (decision.epic_key) {
        document.getElementById('detail-epic-section').style.display = 'block';
        let epicHtml = '';
        if (decision.jira_data && decision.jira_data.url) {
          // Security: Escape all user data before inserting
          epicHtml = `
            <strong><a href="${escapeHtml(decision.jira_data.url)}" target="_blank" class="jira-link">${escapeHtml(decision.epic_key)}</a></strong><br>
            <div style="margin-top: 8px;">${escapeHtml(decision.jira_data.summary || '')}</div>
            <div style="margin-top: 5px; font-size: 13px; color: #616061;">
              ${escapeHtml(decision.jira_data.type || '')} • ${escapeHtml(decision.jira_data.status || '')}
            </div>
          `;
        } else {
          epicHtml = escapeHtml(decision.epic_key);
        }
        document.getElementById('detail-epic-info').innerHTML = epicHtml;
      } else {
        document.getElementById('detail-epic-section').style.display = 'none';
      }

      // Handle tags
      if (decision.tags && decision.tags.length > 0) {
        document.getElementById('detail-tags-section').style.display = 'block';
        // Security: Escape HTML in tags to prevent XSS
        document.getElementById('detail-tags').innerHTML = decision.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ');
      } else {
        document.getElementById('detail-tags-section').style.display = 'none';
      }

      // Show modal
      document.getElementById('detail-modal').classList.add('active');
    }

    function closeDetailModal() {
      document.getElementById('detail-modal').classList.remove('active');
    }

    // Log Memory Modal Functions
    function openLogMemoryModal() {
      // Clear form
      document.getElementById('log-memory-text').value = '';
      document.getElementById('log-memory-type').value = 'decision';
      document.getElementById('log-memory-category').value = '';
      document.getElementById('log-memory-tags').value = '';
      document.getElementById('log-memory-epic').value = '';
      document.getElementById('log-memory-alternatives').value = '';

      // Show modal
      document.getElementById('log-memory-modal').classList.add('active');
    }

    function closeLogMemoryModal() {
      document.getElementById('log-memory-modal').classList.remove('active');
    }

    async function submitLogMemory() {
      const text = document.getElementById('log-memory-text').value.trim();
      const type = document.getElementById('log-memory-type').value;
      const spaceId = document.getElementById('log-memory-space').value;
      const category = document.getElementById('log-memory-category').value.trim();
      const tags = document.getElementById('log-memory-tags').value.trim();
      const epicKey = document.getElementById('log-memory-epic').value.trim();
      const alternatives = document.getElementById('log-memory-alternatives').value.trim();

      // Validation
      if (!text) {
        alert('Please enter a description');
        return;
      }

      if (!spaceId) {
        alert('Please select a space');
        return;
      }

      try {
        const response = await fetch('/api/memory/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            type,
            space_id: spaceId,
            category: category || null,
            tags: tags || null,
            epic_key: epicKey || null,
            alternatives: alternatives || null,
            workspace_id: WORKSPACE_ID,
            source: 'dashboard'
          })
        });

        const data = await response.json();

        if (response.ok && data.success) {
          // Close modal
          closeLogMemoryModal();

          // Show success message
          alert('✅ Memory saved successfully!');

          // Refresh the dashboard
          fetchStats();
          fetchDecisions();
        } else {
          alert(`❌ Failed to save memory: ${data.error || 'Unknown error'}`);
        }
      } catch (error) {
        console.error('Error saving memory:', error);
        alert('❌ Failed to save memory. Please try again.');
      }
    }

    function openEditModal() {
      if (currentDecisionIndex === null) return;

      const decision = allDecisions[currentDecisionIndex];

      // Pre-fill the form with current values
      document.getElementById('edit-decision-id').value = decision.id;
      document.getElementById('edit-decision-text').value = decision.text;
      document.getElementById('edit-decision-type').value = decision.type;
      document.getElementById('edit-decision-space').value = decision.space_id || '';
      document.getElementById('edit-decision-category').value = decision.category || '';
      document.getElementById('edit-epic-key').value = decision.epic_key || '';
      document.getElementById('edit-tags').value = decision.tags ? decision.tags.join(', ') : '';
      document.getElementById('edit-alternatives').value = decision.alternatives || '';

      // Close detail modal and open edit modal
      closeDetailModal();
      document.getElementById('edit-modal').classList.add('active');
    }

    function closeEditModal() {
      document.getElementById('edit-modal').classList.remove('active');
      // Optionally reopen the detail modal
      if (currentDecisionIndex !== null) {
        openDetailModal(currentDecisionIndex);
      }
    }

    async function saveEdit(event) {
      event.preventDefault();

      const decisionId = document.getElementById('edit-decision-id').value;
      const text = document.getElementById('edit-decision-text').value.trim();
      const type = document.getElementById('edit-decision-type').value;
      const spaceId = document.getElementById('edit-decision-space').value;
      const category = document.getElementById('edit-decision-category').value || null;
      const epicKey = document.getElementById('edit-epic-key').value.trim();
      const tagsString = document.getElementById('edit-tags').value.trim();
      const alternatives = document.getElementById('edit-alternatives').value.trim();

      // Parse tags
      const tags = tagsString ? tagsString.split(',').map(t => t.trim()).filter(t => t.length > 0) : [];

      // Build update payload
      const updates = {
        text,
        type,
        space_id: spaceId,
        category,
        epic_key: epicKey || null,
        tags,
        alternatives: alternatives || null
      };

      try {
        const response = await fetch(`/api/decisions/${decisionId}?workspace_id=${WORKSPACE_ID}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(updates)
        });

        if (response.ok) {
          closeEditModal();
          currentDecisionIndex = null;
          await fetchStats();
          await fetchDecisions();
          alert('Decision updated successfully!');
        } else {
          const error = await response.json();
          alert('Failed to update decision: ' + (error.error || 'Unknown error'));
        }
      } catch (err) {
        console.error('Error updating decision:', err);
        alert('Error updating decision. Please try again.');
      }
    }

    async function confirmDelete() {
      if (!deleteTargetId) return;

      // Disable delete button to prevent double-clicks
      const deleteBtn = document.querySelector('.modal-btn-delete');
      const originalText = deleteBtn.textContent;
      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting...';

      try {
        const response = await fetch(`/api/decisions/${deleteTargetId}?workspace_id=${WORKSPACE_ID}`, {
          method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok) {
          console.log(`✅ Deleted decision #${deleteTargetId}`);

          // Show success message
          const successMsg = document.createElement('div');
          successMsg.className = 'success-toast';
          successMsg.textContent = `✅ Memory #${deleteTargetId} deleted successfully`;
          document.body.appendChild(successMsg);

          // Remove success message after 3 seconds
          setTimeout(() => {
            successMsg.remove();
          }, 3000);

          // Close modal and refresh data
          closeDeleteModal();
          fetchStats();
          fetchDecisions();
        } else {
          // Show specific error from backend
          const errorMessage = data.message || data.error || 'Failed to delete memory';
          console.error('Delete failed:', errorMessage);
          alert(`❌ ${errorMessage}`);

          // Re-enable button
          deleteBtn.disabled = false;
          deleteBtn.textContent = originalText;
        }
      } catch (err) {
        console.error('Delete error:', err);
        alert('❌ Network error. Please check your connection and try again.');

        // Re-enable button
        deleteBtn.disabled = false;
        deleteBtn.textContent = originalText;
      }
    }

    function exportToCSV() {
      const csv = [
        ['ID', 'Decision', 'Type', 'Category', 'Epic', 'Summary', 'Tags', 'Creator', 'Date'],
        ...allDecisions.map(d => [
          d.id,
          d.text,
          d.type || '',
          d.category || '',
          d.epic_key || '',
          (d.jira_data && d.jira_data.summary) || '',
          d.tags.join(','),
          d.creator,
          new Date(d.timestamp).toLocaleDateString()
        ])
      ].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'decisions.csv';
      a.click();
    }

    function setDatePreset(preset) {
      const today = new Date();
      const dateFrom = document.getElementById('date-from');
      const dateTo = document.getElementById('date-to');

      // Clear active state from all preset buttons
      document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
      event.target.classList.add('active');

      switch(preset) {
        case 'today':
          dateFrom.value = formatDate(today);
          dateTo.value = formatDate(today);
          break;
        case 'last7':
          const last7 = new Date(today);
          last7.setDate(today.getDate() - 7);
          dateFrom.value = formatDate(last7);
          dateTo.value = formatDate(today);
          break;
        case 'last30':
          const last30 = new Date(today);
          last30.setDate(today.getDate() - 30);
          dateFrom.value = formatDate(last30);
          dateTo.value = formatDate(today);
          break;
        case 'thisMonth':
          const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
          dateFrom.value = formatDate(firstDay);
          dateTo.value = formatDate(today);
          break;
        case 'lastMonth':
          const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
          const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
          dateFrom.value = formatDate(lastMonthStart);
          dateTo.value = formatDate(lastMonthEnd);
          break;
      }
      fetchDecisions();
    }

    function clearDateFilter() {
      document.getElementById('date-from').value = '';
      document.getElementById('date-to').value = '';
      document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
      fetchDecisions();
    }

    function formatDate(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    document.getElementById('search').addEventListener('input', debounce(fetchDecisions, 500));
    document.getElementById('type-filter').addEventListener('change', fetchDecisions);
    document.getElementById('category-filter').addEventListener('change', fetchDecisions);
    document.getElementById('epic-filter').addEventListener('input', debounce(fetchDecisions, 500));
    document.getElementById('date-from').addEventListener('change', fetchDecisions);
    document.getElementById('date-to').addEventListener('change', fetchDecisions);

    function debounce(func, wait) {
      let timeout;
      return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
      };
    }

    // Security: Escape HTML to prevent XSS
    function escapeHtml(unsafe) {
      if (!unsafe) return '';
      return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    // Close modals on overlay click
    document.getElementById('delete-modal').addEventListener('click', function(e) {
      if (e.target === this) closeDeleteModal();
    });
    document.getElementById('detail-modal').addEventListener('click', function(e) {
      if (e.target === this) closeDetailModal();
    });

    // Close modals on Escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeDeleteModal();
        closeDetailModal();
        closeDeleteAllModal();
        closeFeedbackModal();
      }
    });

    // Feedback Widget Functions
    function openFeedbackModal() {
      document.getElementById('feedback-modal').classList.add('active');
    }

    function closeFeedbackModal() {
      document.getElementById('feedback-modal').classList.remove('active');
      document.getElementById('feedback-form').reset();
    }

    async function submitFeedback(event) {
      event.preventDefault();

      const type = document.getElementById('feedback-type').value;
      const text = document.getElementById('feedback-text').value.trim();
      const email = document.getElementById('feedback-email').value.trim();
      const submitBtn = document.getElementById('feedback-submit-btn');

      // Disable submit button during submission
      submitBtn.disabled = true;
      submitBtn.textContent = '📤 Sending...';

      const feedbackData = {
        type,
        feedback: text,
        email: email || null,
        workspace_id: WORKSPACE_ID,
        workspace_name: currentUser?.workspace_name || 'Unknown',
        user_name: currentUser?.user_name || 'Unknown',
        user_id: currentUser?.user_id || 'Unknown',
        timestamp: new Date().toISOString(),
        source: 'dashboard'
      };

      try {
        // Send to backend API (which forwards to n8n webhook)
        const response = await fetch('/api/feedback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(feedbackData)
        });

        const result = await response.json();

        if (response.ok && result.success) {
          // Success
          alert('✅ Thank you for your feedback! We\'ve received it and will review it soon.');
          closeFeedbackModal();
        } else {
          throw new Error(result.error || 'Failed to submit feedback');
        }
      } catch (error) {
        console.error('Feedback submission error:', error);
        alert('⚠️ There was an issue submitting your feedback. Please try again or email us directly at cristiantumani@gmail.com');
      } finally {
        // Re-enable submit button
        submitBtn.disabled = false;
        submitBtn.textContent = '📤 Send Feedback';
      }
    }

    // Initialize feedback widget after DOM is loaded
    function initFeedbackWidget() {
      const feedbackToggle = document.getElementById('feedback-toggle');
      const feedbackModal = document.getElementById('feedback-modal');

      if (feedbackToggle) {
        feedbackToggle.addEventListener('click', openFeedbackModal);
      }

      if (feedbackModal) {
        feedbackModal.addEventListener('click', function(e) {
          if (e.target === this) closeFeedbackModal();
        });
      }
    }

    // ========== SPACES FUNCTIONALITY ==========

    // Show message when user has no accessible spaces
    async function showNoSpacesMessage() {
      // Hide loading indicator
      const loadingIndicator = document.getElementById('loading-indicator');
      if (loadingIndicator) loadingIndicator.style.display = 'none';

      // Hide all decision-related UI elements
      const statsChat = document.getElementById('stats-chat');
      const statsClassic = document.getElementById('stats-classic');
      const classicView = document.getElementById('classic-view-container');
      const chatView = document.getElementById('chat-view-container');
      const heroSection = document.querySelector('.hero-banner');

      // Hide decision-related sections (stats, classic view, hero)
      if (statsChat) statsChat.style.display = 'none';
      if (statsClassic) statsClassic.style.display = 'none';
      if (classicView) classicView.style.display = 'none';
      if (heroSection) heroSection.style.display = 'none';

      // Show the chat view with empty state message
      if (chatView) {
        chatView.style.display = 'block'; // Make sure chat view is visible
        const chatWrapper = chatView.querySelector('.chat-view-wrapper');
        if (chatWrapper) {
          // Get workspace admin info
          let adminEmailHtml = '<p style="color: #616061; font-size: 14px; margin-top: 20px;">Contact your workspace administrator to be added to a space.</p>';

          try {
            const response = await fetch(`/api/workspace-admins?workspace_id=${WORKSPACE_ID}`);
            const data = await response.json();

            if (response.ok && data.admins && data.admins.length > 0) {
              const adminEmails = data.admins
                .filter(a => a.email)
                .map(a => `<a href="mailto:${a.email}" style="color: #667eea; text-decoration: none; font-weight: 600;">${a.email}</a>`)
                .join(', ');

              if (adminEmails) {
                adminEmailHtml = `
                  <div style="background: #F8F9FA; border-radius: 8px; padding: 20px; margin-top: 24px;">
                    <p style="color: #616061; font-size: 14px; margin: 0 0 8px 0;">
                      <strong>👤 Workspace Administrator${data.admins.length > 1 ? 's' : ''}:</strong>
                    </p>
                    <p style="color: #667eea; font-size: 14px; margin: 0;">
                      ${adminEmails}
                    </p>
                  </div>
                `;
              }
            }
          } catch (error) {
            console.error('Failed to fetch workspace admins:', error);
          }

          // Show appropriate message based on admin status
          if (isCurrentUserAdmin) {
            // Admin sees inline space creation form
            chatWrapper.innerHTML = `
              <div style="display: flex; align-items: center; justify-content: center; height: 100%; padding: 40px;">
                <div style="max-width: 600px; width: 100%;">
                  <div style="text-align: center; margin-bottom: 32px;">
                    <div style="font-size: 64px; margin-bottom: 20px;">📁</div>
                    <h2 style="color: #1d1c1d; margin-bottom: 12px; font-size: 28px;">Create Your First Space</h2>
                    <p style="color: #616061; font-size: 16px; line-height: 1.6;">
                      Spaces help organize team decisions by department, project, or privacy level.
                    </p>
                  </div>

                  <!-- Inline Space Creation Form -->
                  <div style="background: white; border: 1px solid #E1E4E8; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
                    <form id="quick-create-space-form" onsubmit="handleQuickCreateSpace(event)">
                      <div style="margin-bottom: 20px;">
                        <label style="display: block; font-weight: 600; margin-bottom: 8px; color: #1d1c1d; font-size: 14px;">
                          Space Name *
                        </label>
                        <input
                          type="text"
                          id="quick-space-name"
                          required
                          placeholder="e.g., Product Team, Engineering, Marketing"
                          style="width: 100%; padding: 12px; border: 1px solid #E1E4E8; border-radius: 8px; font-size: 15px;"
                        />
                      </div>

                      <div style="margin-bottom: 20px;">
                        <label style="display: block; font-weight: 600; margin-bottom: 8px; color: #1d1c1d; font-size: 14px;">
                          Description
                        </label>
                        <textarea
                          id="quick-space-description"
                          placeholder="What's this space for?"
                          rows="2"
                          style="width: 100%; padding: 12px; border: 1px solid #E1E4E8; border-radius: 8px; font-size: 15px; resize: vertical;"
                        ></textarea>
                      </div>

                      <div style="margin-bottom: 24px;">
                        <label style="display: block; font-weight: 600; margin-bottom: 8px; color: #1d1c1d; font-size: 14px;">
                          Visibility *
                        </label>
                        <select
                          id="quick-space-visibility"
                          required
                          style="width: 100%; padding: 12px; border: 1px solid #E1E4E8; border-radius: 8px; font-size: 15px;"
                        >
                          <option value="public">🌐 Public - All workspace members can access</option>
                          <option value="shared">👥 Shared - Only invited members (you must add yourself)</option>
                          <option value="private">🔒 Private - Only invited members (you must add yourself)</option>
                        </select>
                        <small style="color: #616061; font-size: 13px; margin-top: 6px; display: block;">
                          You can change this later in Settings
                        </small>
                      </div>

                      <button
                        type="submit"
                        id="quick-create-btn"
                        style="width: 100%; padding: 14px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 8px; font-weight: 600; font-size: 16px; cursor: pointer;"
                      >
                        ➕ Create Space
                      </button>
                    </form>

                    <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid #E1E4E8; text-align: center;">
                      <a href="/settings" style="color: #667eea; text-decoration: none; font-size: 14px; font-weight: 600;">
                        Advanced Settings →
                      </a>
                    </div>
                  </div>

                  <div style="background: #F8F9FA; border-radius: 8px; padding: 20px; margin-top: 24px; text-align: left;">
                    <p style="color: #616061; font-size: 14px; margin: 0 0 12px 0;">
                      <strong>💡 Next Steps:</strong>
                    </p>
                    <ul style="color: #616061; font-size: 14px; margin: 0; padding-left: 20px;">
                      <li style="margin-bottom: 8px;">Create your first space</li>
                      <li style="margin-bottom: 8px;">Invite team members to your workspace</li>
                      <li>Add members to specific spaces in Settings</li>
                    </ul>
                  </div>
                </div>
              </div>
            `;
          } else {
            // Regular member sees message to contact admin
            chatWrapper.innerHTML = `
              <div style="display: flex; align-items: center; justify-content: center; height: 100%; padding: 40px;">
                <div style="max-width: 600px; text-align: center;">
                  <div style="font-size: 64px; margin-bottom: 20px;">🔒</div>
                  <h2 style="color: #1d1c1d; margin-bottom: 12px; font-size: 28px;">No Spaces Available</h2>
                  <p style="color: #616061; font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
                    You're in the <strong>${currentUser.workspace_name || WORKSPACE_ID}</strong> workspace, but you haven't been added to any spaces yet.
                  </p>
                  <p style="color: #616061; font-size: 16px; line-height: 1.6;">
                    Spaces are where teams organize and share decisions. Please contact your workspace administrator to be added to a space.
                  </p>
                  ${adminEmailHtml}
                </div>
              </div>
            `;
          }
        }
      }
    }

    // Load all accessible spaces for the current user
    // Handle quick space creation from empty state
    async function handleQuickCreateSpace(event) {
      event.preventDefault();

      const submitBtn = document.getElementById('quick-create-btn');
      const originalBtnText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Creating...';

      try {
        const name = document.getElementById('quick-space-name').value.trim();
        const description = document.getElementById('quick-space-description').value.trim();
        const visibility = document.getElementById('quick-space-visibility').value;

        const response = await fetch('/api/spaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace_id: WORKSPACE_ID,
            name: name,
            description: description || '',
            visibility: visibility
          })
        });

        const data = await response.json();

        if (response.ok) {
          console.log('✅ Space created successfully:', data);

          // Reload the page to show the new space
          window.location.reload();
        } else {
          alert(`Failed to create space: ${data.error || 'Unknown error'}`);
          submitBtn.disabled = false;
          submitBtn.textContent = originalBtnText;
        }
      } catch (error) {
        console.error('❌ Failed to create space:', error);
        alert('Failed to create space. Please try again.');
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
      }
    }

    async function loadSpaces() {
      try {
        console.log('🔍 Loading spaces for workspace:', WORKSPACE_ID);
        const response = await fetch(`/api/spaces?workspace_id=${WORKSPACE_ID}`);
        const data = await response.json();

        console.log('🔍 Spaces API response:', { status: response.status, ok: response.ok, data });

        if (response.ok && data.spaces) {
          console.log('✅ Loaded', data.spaces.length, 'spaces');
          allSpaces = data.spaces;
          currentUserSpaces = data.spaces;
          populateSpaceSelectors();

          // Restore last selected space from localStorage
          const lastSpaceId = localStorage.getItem('corteza_last_space_id');
          if (lastSpaceId && allSpaces.find(s => s.space_id === lastSpaceId)) {
            currentSpaceId = lastSpaceId;
            updateSpaceSelectors(lastSpaceId);
          }
        } else {
          console.warn('⚠️  Failed to load spaces:', data);
        }
      } catch (error) {
        console.error('❌ Failed to load spaces:', error);
      }
    }

    // Populate all space selector dropdowns
    function populateSpaceSelectors() {
      console.log('🔍 Populating space selectors with', currentUserSpaces.length, 'spaces');

      // Populate hero space filter
      const heroFilter = document.getElementById('space-filter-hero');
      if (heroFilter) {
        heroFilter.innerHTML = '<option value="" disabled selected>Select a space...</option>';
        currentUserSpaces.forEach(space => {
          console.log('  Adding space:', space.name, space.space_id);
          const option = document.createElement('option');
          option.value = space.space_id;
          option.textContent = `${space.settings.icon} ${space.name}`;
          if (space.visibility === 'private') {
            option.textContent += ' 🔒';
          }
          heroFilter.appendChild(option);
        });
      } else {
        console.warn('⚠️  space-filter-hero element not found');
      }

      // Populate classic view space filter
      const classicFilter = document.getElementById('space-filter');
      if (classicFilter) {
        classicFilter.innerHTML = '<option value="" disabled selected>Select a space...</option>';
        currentUserSpaces.forEach(space => {
          const option = document.createElement('option');
          option.value = space.space_id;
          option.textContent = `${space.settings.icon} ${space.name}`;
          if (space.visibility === 'private') {
            option.textContent += ' 🔒';
          }
          classicFilter.appendChild(option);
        });
      }

      // Populate chat view space filter
      const chatFilter = document.getElementById('space-filter-chat');
      if (chatFilter) {
        chatFilter.innerHTML = '<option value="" disabled selected>Select a space...</option>';
        currentUserSpaces.forEach(space => {
          const option = document.createElement('option');
          option.value = space.space_id;
          option.textContent = `${space.settings.icon} ${space.name}`;
          if (space.visibility === 'private') {
            option.textContent += ' 🔒';
          }
          chatFilter.appendChild(option);
        });
      }

      // Auto-select first space across all filters if no space is selected
      if (!currentSpaceId && currentUserSpaces.length > 0) {
        currentSpaceId = currentUserSpaces[0].space_id;
        updateSpaceSelectors(currentSpaceId);
      }

      // Populate Log Memory modal space selector
      const logMemorySpace = document.getElementById('log-memory-space');
      if (logMemorySpace) {
        logMemorySpace.innerHTML = '';

        // Only show spaces where user can create
        const creatableSpaces = currentUserSpaces.filter(s =>
          s.visibility === 'public' ||
          s.is_owner ||
          s.user_role === 'admin' ||
          s.user_role === 'member'
        );

        creatableSpaces.forEach(space => {
          const option = document.createElement('option');
          option.value = space.space_id;
          option.textContent = `${space.settings.icon} ${space.name}`;
          if (space.is_default) {
            option.selected = true;
          }
          logMemorySpace.appendChild(option);
        });
      }

      // Populate Edit Decision modal space selector
      const editSpace = document.getElementById('edit-decision-space');
      if (editSpace) {
        editSpace.innerHTML = '';

        const creatableSpaces = currentUserSpaces.filter(s =>
          s.visibility === 'public' ||
          s.is_owner ||
          s.user_role === 'admin' ||
          s.user_role === 'member'
        );

        creatableSpaces.forEach(space => {
          const option = document.createElement('option');
          option.value = space.space_id;
          option.textContent = `${space.settings.icon} ${space.name}`;
          editSpace.appendChild(option);
        });
      }
    }

    // Update space selectors to show current selection
    function updateSpaceSelectors(spaceId) {
      const heroFilter = document.getElementById('space-filter-hero');
      const classicFilter = document.getElementById('space-filter');
      const chatFilter = document.getElementById('space-filter-chat');

      if (heroFilter) heroFilter.value = spaceId || '';
      if (classicFilter) classicFilter.value = spaceId || '';
      if (chatFilter) chatFilter.value = spaceId || '';
    }

    // Handle space filter change
    async function handleSpaceChange() {
      const heroFilter = document.getElementById('space-filter-hero');
      const classicFilter = document.getElementById('space-filter');
      const chatFilter = document.getElementById('space-filter-chat');

      // Get value from whichever filter triggered the change
      currentSpaceId = (heroFilter?.value || classicFilter?.value || chatFilter?.value) || null;

      // Sync both filters
      updateSpaceSelectors(currentSpaceId);

      // Update context bar with current space name
      updateContextBarSpace();

      // Save to localStorage
      if (currentSpaceId) {
        localStorage.setItem('corteza_last_space_id', currentSpaceId);
      } else {
        localStorage.removeItem('corteza_last_space_id');
      }

      // Reload decisions with new space filter
      await fetchDecisions();
    }

    // Update the context bar with current space name
    function updateContextBarSpace() {
      const contextSpace = document.getElementById('context-space');
      if (!contextSpace) return;

      if (!currentSpaceId) {
        contextSpace.textContent = 'No space selected';
        return;
      }

      // Find the current space in allSpaces
      const currentSpace = allSpaces.find(s => s.space_id === currentSpaceId);
      if (currentSpace) {
        const icon = currentSpace.settings?.icon || '📁';
        const name = currentSpace.name;
        const visibility = currentSpace.visibility === 'private' ? ' 🔒' : '';
        contextSpace.textContent = `${icon} ${name}${visibility}`;
      } else {
        contextSpace.textContent = 'Unknown space';
      }
    }

    // ========== SPACE MANAGEMENT MOVED TO SETTINGS ==========
    // Space management UI (create, edit, delete, members) is now in Settings page
    // Dashboard only handles space selection/filtering

    // Space management functions removed - now handled in Settings page
    // Users should go to Settings > Spaces to manage spaces

    // ========== END SPACES FUNCTIONALITY ==========

    // Load spaces list in manager
    async function loadSpacesList() {
      const container = document.getElementById('spaces-list');
      if (!container) return;

      container.innerHTML = '<div class="loading">Loading spaces...</div>';

      try {
        const response = await fetch(`/api/spaces?workspace_id=${WORKSPACE_ID}`);
        const data = await response.json();

        if (response.ok && data.spaces) {
          container.innerHTML = '';

          if (data.spaces.length === 0) {
            container.innerHTML = '<div class="empty-state">No spaces yet. Create your first space!</div>';
            return;
          }

          data.spaces.forEach(space => {
            const spaceCard = createSpaceCard(space);
            container.appendChild(spaceCard);
          });
        } else {
          container.innerHTML = '<div class="error">Failed to load spaces</div>';
        }
      } catch (error) {
        console.error('Failed to load spaces:', error);
        container.innerHTML = '<div class="error">Failed to load spaces</div>';
      }
    }

    // Create space card element
    function createSpaceCard(space) {
      const card = document.createElement('div');
      card.className = 'space-card';
      card.style.borderLeft = `4px solid ${space.settings.color}`;

      const visibilityIcon = space.visibility === 'private' ? '🔒' :
                           space.visibility === 'shared' ? '👥' : '🌐';

      card.innerHTML = `
        <div class="space-header">
          <span class="space-icon-large">${space.settings.icon}</span>
          <div class="space-info">
            <h4>${space.name}</h4>
            <p class="space-description">${space.description || 'No description'}</p>
            <div class="space-meta">
              <span class="space-visibility">${visibilityIcon} ${space.visibility}</span>
              <span>${space.decision_count || 0} memories</span>
              ${space.is_default ? '<span class="badge-default">Default</span>' : ''}
            </div>
          </div>
        </div>
        <div class="space-actions">
          ${space.can_modify ? `
            <button onclick="editSpace('${space.space_id}')" class="btn-icon" title="Edit">
              ⚙️
            </button>
          ` : ''}
          ${space.visibility === 'shared' && space.can_modify ? `
            <button onclick="manageMembers('${space.space_id}', '${space.name}')" class="btn-icon" title="Members">
              👥
            </button>
          ` : ''}
          ${!space.is_default && space.is_owner ? `
            <button onclick="deleteSpace('${space.space_id}', '${space.name}')" class="btn-icon danger" title="Delete">
              🗑️
            </button>
          ` : ''}
        </div>
      `;

      return card;
    }

    // Create new space
    async function createSpace(event) {
      event.preventDefault();

      const name = document.getElementById('space-name').value.trim();
      const description = document.getElementById('space-description').value.trim();
      const visibility = document.getElementById('space-visibility').value;
      const icon = document.getElementById('space-icon').value || '📁';
      const color = document.getElementById('space-color').value;

      try {
        const response = await fetch('/api/spaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace_id: WORKSPACE_ID,
            name: name,
            description: description,
            visibility: visibility,
            settings: {
              icon: icon,
              color: color
            }
          })
        });

        const data = await response.json();

        if (response.ok) {
          alert('✅ Space created successfully!');
          resetCreateSpaceForm();
          await loadSpaces();
          await loadSpacesList();
          showSpaceTab('my-spaces');
        } else {
          alert('❌ Failed to create space: ' + (data.error || 'Unknown error'));
        }
      } catch (error) {
        console.error('Failed to create space:', error);
        alert('❌ Failed to create space');
      }
    }

    // Reset create space form
    function resetCreateSpaceForm() {
      document.getElementById('create-space-form').reset();
      document.getElementById('space-icon').value = '📁';
      document.getElementById('space-color').value = '#667eea';
      // Note: visibility defaults to 'private' in HTML
    }

    // Edit space
    function editSpace(spaceId) {
      const space = allSpaces.find(s => s.space_id === spaceId);
      if (!space) return;

      document.getElementById('edit-space-id').value = space.space_id;
      document.getElementById('edit-space-name').value = space.name;
      document.getElementById('edit-space-description').value = space.description || '';
      document.getElementById('edit-space-visibility').value = space.visibility;
      document.getElementById('edit-space-icon').value = space.settings.icon;
      document.getElementById('edit-space-color').value = space.settings.color;

      const modal = document.getElementById('edit-space-modal');
      if (modal) {
        modal.style.display = 'flex';
      }
    }

    // Close edit space modal
    function closeEditSpaceModal() {
      const modal = document.getElementById('edit-space-modal');
      if (modal) {
        modal.style.display = 'none';
      }
    }

    // Save space edits
    async function saveSpaceEdit(event) {
      event.preventDefault();

      const spaceId = document.getElementById('edit-space-id').value;
      const name = document.getElementById('edit-space-name').value.trim();
      const description = document.getElementById('edit-space-description').value.trim();
      const visibility = document.getElementById('edit-space-visibility').value;
      const icon = document.getElementById('edit-space-icon').value;
      const color = document.getElementById('edit-space-color').value;

      try {
        const response = await fetch(`/api/spaces/${spaceId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace_id: WORKSPACE_ID,
            name: name,
            description: description,
            visibility: visibility,
            settings: {
              icon: icon,
              color: color
            }
          })
        });

        if (response.ok) {
          alert('✅ Space updated successfully!');
          closeEditSpaceModal();
          await loadSpaces();
          await loadSpacesList();
        } else {
          const data = await response.json();
          alert('❌ Failed to update space: ' + (data.error || 'Unknown error'));
        }
      } catch (error) {
        console.error('Failed to update space:', error);
        alert('❌ Failed to update space');
      }
    }

    // Delete space
    async function deleteSpace(spaceId, spaceName) {
      if (!confirm(`Are you sure you want to delete the space "${spaceName}"? This action cannot be undone.`)) {
        return;
      }

      try {
        const response = await fetch(`/api/spaces/${spaceId}?workspace_id=${WORKSPACE_ID}`, {
          method: 'DELETE'
        });

        if (response.ok) {
          alert('✅ Space deleted successfully!');
          await loadSpaces();
          await loadSpacesList();

          // Clear space filter if deleted space was selected
          if (currentSpaceId === spaceId) {
            currentSpaceId = null;
            localStorage.removeItem('corteza_last_space_id');
            updateSpaceSelectors(null);
            await fetchDecisions();
          }
        } else {
          const data = await response.json();
          alert('❌ Failed to delete space: ' + (data.error || 'Unknown error'));
        }
      } catch (error) {
        console.error('Failed to delete space:', error);
        alert('❌ Failed to delete space');
      }
    }

    // Manage space members
    function manageMembers(spaceId, spaceName) {
      document.getElementById('members-space-name').textContent = spaceName;
      document.getElementById('add-member-form').dataset.spaceId = spaceId;

      const modal = document.getElementById('space-members-modal');
      if (modal) {
        modal.style.display = 'flex';
        loadSpaceMembers(spaceId);
      }
    }

    // Close space members modal
    function closeSpaceMembersModal() {
      const modal = document.getElementById('space-members-modal');
      if (modal) {
        modal.style.display = 'none';
      }
    }

    // Load space members
    async function loadSpaceMembers(spaceId) {
      const container = document.getElementById('current-members');
      if (!container) return;

      container.innerHTML = '<div class="loading">Loading members...</div>';

      try {
        const response = await fetch(`/api/spaces/${spaceId}/members?workspace_id=${WORKSPACE_ID}`);
        const data = await response.json();

        if (response.ok && data.members) {
          container.innerHTML = '';

          if (data.members.length === 0) {
            container.innerHTML = '<div class="empty-state">No members yet. Add members below!</div>';
            return;
          }

          data.members.forEach(member => {
            const memberCard = document.createElement('div');
            memberCard.className = 'member-card';
            memberCard.innerHTML = `
              <div class="member-info">
                <strong>${member.user_name}</strong>
                <span class="member-role">${member.role}</span>
              </div>
              <button onclick="removeSpaceMemberConfirm('${spaceId}', '${member.user_id}', '${member.user_name}')" class="btn-icon danger" title="Remove">
                ✕
              </button>
            `;
            container.appendChild(memberCard);
          });
        }
      } catch (error) {
        console.error('Failed to load members:', error);
        container.innerHTML = '<div class="error">Failed to load members</div>';
      }
    }

    // Add space member
    async function addSpaceMember(event) {
      event.preventDefault();

      const form = event.target;
      const spaceId = form.dataset.spaceId;
      const userId = document.getElementById('member-user-id').value.trim();
      const userName = document.getElementById('member-user-name').value.trim() || userId;
      const role = document.getElementById('member-role').value;

      try {
        const response = await fetch(`/api/spaces/${spaceId}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace_id: WORKSPACE_ID,
            user_id: userId,
            user_name: userName,
            role: role
          })
        });

        if (response.ok) {
          alert('✅ Member added successfully!');
          form.reset();
          await loadSpaceMembers(spaceId);
        } else {
          const data = await response.json();
          alert('❌ Failed to add member: ' + (data.error || 'Unknown error'));
        }
      } catch (error) {
        console.error('Failed to add member:', error);
        alert('❌ Failed to add member');
      }
    }

    // Remove space member with confirmation
    async function removeSpaceMemberConfirm(spaceId, userId, userName) {
      if (!confirm(`Remove ${userName} from this space?`)) {
        return;
      }

      try {
        const response = await fetch(`/api/spaces/${spaceId}/members/${userId}?workspace_id=${WORKSPACE_ID}`, {
          method: 'DELETE'
        });

        if (response.ok) {
          alert('✅ Member removed successfully!');
          await loadSpaceMembers(spaceId);
        } else {
          const data = await response.json();
          alert('❌ Failed to remove member: ' + (data.error || 'Unknown error'));
        }
      } catch (error) {
        console.error('Failed to remove member:', error);
        alert('❌ Failed to remove member');
      }
    }

    // ========== END SPACES FUNCTIONALITY ==========

    // Initialize dashboard - check auth first, then load data
    (async function init() {
      const authenticated = await checkAuth();
      if (authenticated) {
        await loadSpaces();  // Load spaces first

        // Check if user has no accessible spaces
        if (currentUserSpaces.length === 0) {
          await showNoSpacesMessage();
          return; // Don't load decisions/stats if no spaces
        }

        // User has spaces - load data first, then show UI
        // Update context bar with current space
        updateContextBarSpace();

        // Load initial data before showing UI (prevents flash)
        await Promise.all([fetchStats(), fetchDecisions()]);

        // Now hide loading indicator and show UI
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) loadingIndicator.style.display = 'none';

        // Ensure hero banner stays hidden (we're in chat view by default)
        const heroSection = document.querySelector('.hero-banner');
        if (heroSection) heroSection.style.display = 'none';

        const statsChat = document.getElementById('stats-chat');
        if (statsChat) statsChat.style.display = 'flex';

        const chatView = document.getElementById('chat-view-container');
        if (chatView) chatView.style.display = 'block';

        // Set up auto-refresh
        setInterval(() => { fetchStats(); fetchDecisions(); }, 30000);

        // Initialize view toggle button
        const viewToggleBtn = document.getElementById('view-toggle-btn');
        if (viewToggleBtn) {
          viewToggleBtn.addEventListener('click', () => toggleView());
        }

        // Initialize chat interface (main Chat View)
        const chatSendMain = document.getElementById('chat-send-main');
        const chatInputMain = document.getElementById('chat-input-main');

        if (chatSendMain) {
          chatSendMain.addEventListener('click', sendChatMessage);
        }

        if (chatInputMain) {
          chatInputMain.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendChatMessage();
            }
          });
        }

        // Load saved view preference (default to Chat View)
        loadViewPreference();
      }
      // Initialize feedback widget
      initFeedbackWidget();
    })();
    // Suggestion chip handler (global scope)
    function useSuggestion(text) {
      const chatInput = document.getElementById('chat-input');
      chatInput.value = text;
      chatInput.focus();
    }

    // Chat Widget Functionality
    (function() {
      const chatToggle = document.getElementById('chat-toggle');
      const chatContainer = document.getElementById('chat-container');
      const chatClose = document.getElementById('chat-close');
      const chatInput = document.getElementById('chat-input');
      const chatSend = document.getElementById('chat-send');
      const chatMessages = document.getElementById('chat-messages');

      let isOpen = false;

      // Toggle chat
      chatToggle.addEventListener('click', () => {
        isOpen = !isOpen;
        chatContainer.style.display = isOpen ? 'flex' : 'none';
        if (isOpen) {
          chatInput.focus();
          // Show welcome message if empty
          if (chatMessages.children.length === 0) {
            addBotMessage('Hi! I can help you find decisions using natural language. Try asking me something like "show me all AEM decisions" or "what did we decide about performance?"');
          }
        }
      });

      chatClose.addEventListener('click', () => {
        isOpen = false;
        chatContainer.style.display = 'none';
      });

      // Send message
      async function sendMessage() {
        const query = chatInput.value.trim();
        if (!query) return;

        // Add user message
        addUserMessage(query);
        chatInput.value = '';

        // Show typing indicator
        const typingId = showTyping();

        try {
          // Call semantic search API
          const response = await fetch('/api/semantic-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query,
              workspace_id: WORKSPACE_ID,
              conversational: true,
              limit: 10
            })
          });

          removeTyping(typingId);

          if (!response.ok) {
            throw new Error(`Search failed: ${response.statusText}`);
          }

          const data = await response.json();

          if (data.success) {
            // Add conversational response
            addBotMessage(data.response, data.decisions);
          } else {
            addErrorMessage(data.error || 'Search failed');
          }

        } catch (error) {
          removeTyping(typingId);
          console.error('Chat error:', error);
          addErrorMessage(error.message || 'Failed to search. Please try again.');
        }
      }

      chatSend.addEventListener('click', sendMessage);
      chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          sendMessage();
        }
      });

      function addUserMessage(text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message user';
        messageDiv.innerHTML = `<div class="chat-message-content">${escapeHtml(text)}</div>`;
        chatMessages.appendChild(messageDiv);
        scrollToBottom();
      }

      function addBotMessage(text, decisions = []) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message bot';

        // Convert markdown-like formatting to HTML
        let html = text
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/`(.*?)`/g, '<code>$1</code>')
          .split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

        messageDiv.innerHTML = `<div class="chat-message-content">${html}</div>`;
        chatMessages.appendChild(messageDiv);
        scrollToBottom();
      }

      function addErrorMessage(text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message bot';
        messageDiv.innerHTML = `<div class="chat-message-content"><div class="chat-error">❌ ${escapeHtml(text)}</div></div>`;
        chatMessages.appendChild(messageDiv);
        scrollToBottom();
      }

      function showTyping() {
        const typingDiv = document.createElement('div');
        const id = 'typing-' + Date.now();
        typingDiv.id = id;
        typingDiv.className = 'chat-message bot';
        typingDiv.innerHTML = `
          <div class="chat-message-content">
            <div class="chat-typing">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        `;
        chatMessages.appendChild(typingDiv);
        scrollToBottom();
        return id;
      }

      function removeTyping(id) {
        const typingDiv = document.getElementById(id);
        if (typingDiv) {
          typingDiv.remove();
        }
      }

      function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }

      function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }
    })();

    // ========== UPLOAD MEETING NOTES FUNCTIONALITY ==========

    let currentSuggestions = [];
    let approvedSuggestions = new Set();

    function openUploadNotesModal() {
      const modal = document.getElementById('upload-notes-modal');
      if (modal) {
        modal.style.display = 'flex';

        // Populate space selector
        const spaceSelect = document.getElementById('upload-notes-space');
        if (spaceSelect) {
          spaceSelect.innerHTML = '<option value="">Select a space...</option>';
          currentUserSpaces.forEach(space => {
            const option = document.createElement('option');
            option.value = space.space_id;
            option.textContent = `${space.settings.icon} ${space.name}`;
            spaceSelect.appendChild(option);
          });

          // Pre-select current space if available
          if (currentSpaceId) {
            spaceSelect.value = currentSpaceId;
          }
        }

        // Reset form
        document.getElementById('notes-text-input').value = '';
        clearFileSelection();
        showUploadSection();
      }
    }

    function closeUploadNotesModal() {
      const modal = document.getElementById('upload-notes-modal');
      if (modal) {
        modal.style.display = 'none';
        currentSuggestions = [];
        approvedSuggestions.clear();
      }
    }

    function switchUploadTab(tab) {
      const pasteTab = document.getElementById('paste-tab');
      const uploadTab = document.getElementById('upload-tab');
      const pasteOption = document.getElementById('paste-option');
      const uploadOption = document.getElementById('upload-option');

      if (tab === 'paste') {
        pasteTab.style.borderBottom = '3px solid #667eea';
        pasteTab.style.color = '#667eea';
        uploadTab.style.borderBottom = '3px solid transparent';
        uploadTab.style.color = '#616061';
        pasteOption.style.display = 'block';
        uploadOption.style.display = 'none';
      } else {
        pasteTab.style.borderBottom = '3px solid transparent';
        pasteTab.style.color = '#616061';
        uploadTab.style.borderBottom = '3px solid #667eea';
        uploadTab.style.color = '#667eea';
        pasteOption.style.display = 'none';
        uploadOption.style.display = 'block';
      }
    }

    function handleFileSelect(event) {
      const file = event.target.files[0];
      if (file) {
        document.getElementById('file-drop-zone').style.display = 'none';
        document.getElementById('file-selected').style.display = 'block';
        document.getElementById('file-name').textContent = file.name;
      }
    }

    function clearFileSelection() {
      document.getElementById('notes-file-input').value = '';
      document.getElementById('file-drop-zone').style.display = 'block';
      document.getElementById('file-selected').style.display = 'none';
    }

    async function analyzeNotes() {
      const spaceId = document.getElementById('upload-notes-space').value;
      if (!spaceId) {
        alert('Please select a space');
        return;
      }

      const textInput = document.getElementById('notes-text-input').value;
      const fileInput = document.getElementById('notes-file-input');
      const file = fileInput.files[0];

      if (!textInput && !file) {
        alert('Please enter text or upload a file');
        return;
      }

      const analyzeBtn = document.getElementById('analyze-btn');
      analyzeBtn.disabled = true;
      analyzeBtn.textContent = '⏳ Analyzing...';

      try {
        const formData = new FormData();
        formData.append('workspace_id', WORKSPACE_ID);
        formData.append('space_id', spaceId);

        if (file) {
          formData.append('file', file);
        } else {
          formData.append('text', textInput);
        }

        const response = await fetch('/api/ai/extract-from-text', {
          method: 'POST',
          body: formData
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to analyze notes');
        }

        if (data.success) {
          currentSuggestions = data.suggestions || [];
          approvedSuggestions.clear();
          displaySuggestions(data);
          showSuggestionsSection();
        } else {
          throw new Error(data.error || 'Analysis failed');
        }

      } catch (error) {
        console.error('Analysis error:', error);
        alert(`Error: ${error.message}`);
      } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = '🤖 Analyze with AI';
      }
    }

    function displaySuggestions(data) {
      const summaryEl = document.getElementById('suggestions-summary');
      const listEl = document.getElementById('suggestions-list');

      if (!summaryEl || !listEl) return;

      summaryEl.textContent = data.message || `Found ${data.suggestions.length} suggestions`;

      listEl.innerHTML = '';

      if (data.suggestions.length === 0) {
        listEl.innerHTML = `
          <div style="text-align: center; padding: 40px; color: #616061;">
            <div style="font-size: 48px; margin-bottom: 12px;">🤔</div>
            <p>No clear decisions found in this content.</p>
            <p style="font-size: 13px;">Try uploading a different document or adding more context.</p>
          </div>
        `;
        return;
      }

      data.suggestions.forEach((suggestion, index) => {
        const confidence = suggestion.confidence_score || 0;
        const confidencePercent = Math.round(confidence * 100);
        const confidenceColor = confidence >= 0.8 ? '#10B981' : confidence >= 0.6 ? '#F59E0B' : '#EF4444';
        const typeEmoji = { decision: '✅', explanation: '💡', context: '📌' };

        const card = document.createElement('div');
        card.id = `suggestion-${suggestion.suggestion_id}`;
        card.style.cssText = 'border: 2px solid #E1E4E8; border-radius: 8px; padding: 16px; margin-bottom: 16px; background: white;';

        card.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
            <div style="flex: 1;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <span style="font-size: 20px;">${typeEmoji[suggestion.decision_type]}</span>
                <span style="font-weight: 600; font-size: 14px; color: #1d1c1d;">Suggestion ${index + 1}</span>
                <span style="background: ${confidenceColor}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">
                  ${confidencePercent}% confidence
                </span>
                <span style="background: #F0F7FF; color: #667eea; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">
                  ${suggestion.decision_type}
                </span>
              </div>
              <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.5;">${escapeHtml(suggestion.decision_text)}</p>
              ${suggestion.context ? `<p style="margin: 0; font-size: 13px; color: #616061; font-style: italic;">"${escapeHtml(suggestion.context.substring(0, 150))}${suggestion.context.length > 150 ? '...' : ''}"</p>` : ''}
              ${suggestion.tags && suggestion.tags.length > 0 ? `<div style="margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap;">${suggestion.tags.map(tag => `<span style="background: #F8F9FA; padding: 4px 8px; border-radius: 6px; font-size: 12px; color: #616061;">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
            </div>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 12px;">
            <button onclick="approveSuggestion('${suggestion.suggestion_id}')" class="suggestion-approve-btn" style="flex: 1; padding: 8px 16px; background: #10B981; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px;">
              ✅ Approve
            </button>
            <button onclick="editSuggestion('${suggestion.suggestion_id}')" style="flex: 1; padding: 8px 16px; background: #667eea; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px;">
              ✏️ Edit
            </button>
            <button onclick="rejectSuggestion('${suggestion.suggestion_id}')" style="padding: 8px 16px; background: #E1E4E8; color: #616061; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px;">
              ❌ Reject
            </button>
          </div>
        `;

        listEl.appendChild(card);
      });
    }

    function approveSuggestion(suggestionId) {
      approvedSuggestions.add(suggestionId);
      updateSuggestionCard(suggestionId, 'approved');
      updateApprovedCount();
    }

    function rejectSuggestion(suggestionId) {
      approvedSuggestions.delete(suggestionId);
      updateSuggestionCard(suggestionId, 'rejected');
      updateApprovedCount();
    }

    function editSuggestion(suggestionId) {
      // For now, just approve - full edit modal can be added later
      alert('Edit functionality coming soon! For now, approve and edit from the dashboard.');
      approveSuggestion(suggestionId);
    }

    function updateSuggestionCard(suggestionId, status) {
      const card = document.getElementById(`suggestion-${suggestionId}`);
      if (!card) return;

      if (status === 'approved') {
        card.style.borderColor = '#10B981';
        card.style.background = '#F0FDF4';
        const approveBtn = card.querySelector('.suggestion-approve-btn');
        if (approveBtn) {
          approveBtn.textContent = '✅ Approved';
          approveBtn.style.background = '#059669';
        }
      } else if (status === 'rejected') {
        card.style.borderColor = '#E1E4E8';
        card.style.background = '#F8F9FA';
        card.style.opacity = '0.6';
        const approveBtn = card.querySelector('.suggestion-approve-btn');
        if (approveBtn) {
          approveBtn.textContent = 'Approve';
          approveBtn.style.background = '#10B981';
        }
      }
    }

    function updateApprovedCount() {
      const countEl = document.getElementById('approved-count');
      if (countEl) {
        countEl.textContent = approvedSuggestions.size;
      }
    }

    async function saveApprovedSuggestions() {
      if (approvedSuggestions.size === 0) {
        alert('Please approve at least one suggestion');
        return;
      }

      const spaceId = document.getElementById('upload-notes-space').value;
      const currentSpace = allSpaces.find(s => s.space_id === spaceId);
      const spaceName = currentSpace ? currentSpace.name : null;

      const saveBtn = document.getElementById('save-suggestions-btn');
      saveBtn.disabled = true;
      saveBtn.innerHTML = '⏳ Saving...';

      try {
        let savedCount = 0;
        const errors = [];

        for (const suggestionId of approvedSuggestions) {
          try {
            const response = await fetch('/api/ai/approve-suggestion', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                suggestion_id: suggestionId,
                workspace_id: WORKSPACE_ID,
                space_id: spaceId,
                space_name: spaceName
              })
            });

            const data = await response.json();
            if (data.success) {
              savedCount++;
            } else {
              errors.push(data.error);
            }
          } catch (err) {
            errors.push(err.message);
          }
        }

        if (savedCount > 0) {
          alert(`✅ Successfully saved ${savedCount} decision${savedCount > 1 ? 's' : ''}!${errors.length > 0 ? `\n\n⚠️ ${errors.length} failed` : ''}`);
          closeUploadNotesModal();
          await fetchDecisions(); // Refresh dashboard
        } else {
          throw new Error('Failed to save any decisions');
        }

      } catch (error) {
        console.error('Save error:', error);
        alert(`Error: ${error.message}`);
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '💾 Save Approved (<span id="approved-count">' + approvedSuggestions.size + '</span>)';
      }
    }

    function showUploadSection() {
      document.getElementById('upload-section').style.display = 'block';
      document.getElementById('suggestions-section').style.display = 'none';
    }

    function showSuggestionsSection() {
      document.getElementById('upload-section').style.display = 'none';
      document.getElementById('suggestions-section').style.display = 'block';
    }

    function backToUpload() {
      showUploadSection();
      currentSuggestions = [];
      approvedSuggestions.clear();
    }
