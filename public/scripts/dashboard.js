    // Authentication check - must be logged in to access dashboard
    let currentUser = null;
    let WORKSPACE_ID = null;
    let isCurrentUserAdmin = false;

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

    async function fetchStats() {
      try {
        const r = await fetch(`/api/stats?workspace_id=${WORKSPACE_ID}`);
        const d = await r.json();
        document.getElementById('total-count').textContent = d.total;
        document.getElementById('decision-count').textContent = d.byType.decision || 0;
        document.getElementById('explanation-count').textContent = d.byType.explanation || 0;
        document.getElementById('context-count').textContent = d.byType.context || 0;
        document.getElementById('product-count').textContent = d.byCategory?.product || 0;
        document.getElementById('ux-count').textContent = d.byCategory?.ux || 0;
        document.getElementById('technical-count').textContent = d.byCategory?.technical || 0;
        document.getElementById('week-count').textContent = d.lastWeek;

        // Update hero section
        document.getElementById('hero-total').textContent = d.total;
      } catch (e) {}
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
          <td class="decision-text" title="${d.text}">${truncatedText}</td>
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
      const category = document.getElementById('log-memory-category').value.trim();
      const tags = document.getElementById('log-memory-tags').value.trim();
      const epicKey = document.getElementById('log-memory-epic').value.trim();
      const alternatives = document.getElementById('log-memory-alternatives').value.trim();

      // Validation
      if (!text) {
        alert('Please enter a description');
        return;
      }

      try {
        const response = await fetch('/api/memory/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            type,
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
      try {
        const response = await fetch(`/api/decisions/${deleteTargetId}?workspace_id=${WORKSPACE_ID}`, {
          method: 'DELETE'
        });
        if (response.ok) {
          closeDeleteModal();
          fetchStats();
          fetchDecisions();
        } else {
          alert('Failed to delete decision');
        }
      } catch (err) {
        alert('Error deleting decision');
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

    // Initialize dashboard - check auth first, then load data
    (async function init() {
      const authenticated = await checkAuth();
      if (authenticated) {
        fetchStats();
        fetchDecisions();
        setInterval(() => { fetchStats(); fetchDecisions(); }, 30000);
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
