// Popup logic for Corteza Team Memory extension

let currentUser = null;
let workspaceId = null;

// Initialize popup on load
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuthentication();
  setupEventListeners();
});

// Check if user is authenticated
async function checkAuthentication() {
  try {
    // Request auth status from background script
    const response = await chrome.runtime.sendMessage({ action: 'checkAuth' });

    if (response.authenticated) {
      currentUser = response.user;
      workspaceId = response.workspace_id;
      showAuthenticatedUI();
    } else {
      showUnauthenticatedUI();
    }
  } catch (error) {
    console.error('Auth check error:', error);
    showUnauthenticatedUI();
  }
}

// Show UI for authenticated users
function showAuthenticatedUI() {
  document.getElementById('login-required').style.display = 'none';
  document.getElementById('memory-form').style.display = 'block';

  const authStatus = document.getElementById('auth-status');
  authStatus.textContent = '✓ Logged in';
  authStatus.classList.remove('logged-out');
}

// Show UI for unauthenticated users
function showUnauthenticatedUI() {
  document.getElementById('login-required').style.display = 'block';
  document.getElementById('memory-form').style.display = 'none';

  const authStatus = document.getElementById('auth-status');
  authStatus.textContent = '✗ Not logged in';
  authStatus.classList.add('logged-out');
}

// Setup event listeners
function setupEventListeners() {
  // Form submission
  const form = document.getElementById('memory-form');
  form.addEventListener('submit', handleSubmit);

  // Character count for textarea
  const textarea = document.getElementById('text');
  textarea.addEventListener('input', updateCharCount);

  // Login link
  const loginLink = document.getElementById('login-link');
  loginLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ action: 'openDashboard' });
  });
}

// Update character count
function updateCharCount() {
  const textarea = document.getElementById('text');
  const charCount = document.querySelector('.char-count');
  const length = textarea.value.length;
  charCount.textContent = `${length} / 5000`;

  if (length > 5000) {
    charCount.style.color = '#dc3545';
  } else {
    charCount.style.color = '#616061';
  }
}

// Handle form submission
async function handleSubmit(e) {
  e.preventDefault();

  // Clear previous messages
  hideMessage('success');
  hideMessage('error');

  // Get form values
  const text = document.getElementById('text').value.trim();
  const type = document.getElementById('type').value;
  const category = document.getElementById('category').value || null;
  const tags = document.getElementById('tags').value.trim() || null;
  const epic_key = document.getElementById('epic_key').value.trim() || null;
  const alternatives = document.getElementById('alternatives').value.trim() || null;

  // Validate
  const validation = validateForm(text, type);
  if (!validation.valid) {
    showMessage('error', validation.error);
    return;
  }

  // Disable submit button
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';

  try {
    // Send to background script for API call
    const response = await chrome.runtime.sendMessage({
      action: 'createMemory',
      data: {
        text,
        type,
        category,
        tags,
        epic_key,
        alternatives,
        source: 'browser-extension'
      }
    });

    if (response.success) {
      showMessage('success', `✅ Memory #${response.memory.id} saved successfully!`);
      clearForm();
    } else {
      showMessage('error', response.error || 'Failed to save memory');
    }
  } catch (error) {
    console.error('Submit error:', error);
    showMessage('error', 'Network error. Please try again.');
  } finally {
    // Re-enable submit button
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Memory';
  }
}

// Validate form
function validateForm(text, type) {
  if (!text || text.length < 10) {
    return {
      valid: false,
      error: 'Memory text must be at least 10 characters'
    };
  }

  if (text.length > 5000) {
    return {
      valid: false,
      error: 'Memory text must be less than 5000 characters'
    };
  }

  if (!type) {
    return {
      valid: false,
      error: 'Please select a memory type'
    };
  }

  const validTypes = ['decision', 'explanation', 'context', 'learning', 'risk', 'assumption'];
  if (!validTypes.includes(type)) {
    return {
      valid: false,
      error: 'Invalid memory type'
    };
  }

  return { valid: true };
}

// Show message
function showMessage(type, text) {
  const messageEl = document.getElementById(`${type}-message`);
  messageEl.textContent = text;
  messageEl.style.display = 'block';

  // Auto-hide success messages after 3 seconds
  if (type === 'success') {
    setTimeout(() => {
      hideMessage('success');
    }, 3000);
  }
}

// Hide message
function hideMessage(type) {
  const messageEl = document.getElementById(`${type}-message`);
  messageEl.style.display = 'none';
}

// Clear form
function clearForm() {
  document.getElementById('text').value = '';
  document.getElementById('type').value = 'decision';
  document.getElementById('category').value = '';
  document.getElementById('tags').value = '';
  document.getElementById('epic_key').value = '';
  document.getElementById('alternatives').value = '';
  updateCharCount();
}
