// Background service worker for Corteza Team Memory extension

// Configuration
const API_BASE_URL = 'https://app.corteza.app';
const RAILWAY_API_URL = 'https://decision-logger-bot-production.up.railway.app';
const LOCAL_API_URL = 'http://localhost:3000';

// Determine which API to use (try production first, fallback to Railway, then local)
let currentApiUrl = API_BASE_URL;

// Cache for auth status with timestamp
let authCache = {
  data: null,
  timestamp: 0
};

const AUTH_CACHE_DURATION = 30 * 1000; // 30 seconds

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkAuth') {
    // Always check fresh auth, ignore cache for popup requests
    // This ensures users see updated status immediately after logging in
    checkAuthentication().then(sendResponse);
    return true; // Keep channel open for async response
  }

  if (request.action === 'createMemory') {
    createMemory(request.data).then(sendResponse);
    return true; // Keep channel open for async response
  }

  if (request.action === 'openDashboard') {
    openDashboard();
    sendResponse({ success: true });
    return false;
  }
});

// Check authentication status
async function checkAuthentication() {
  try {
    // Try app.corteza.app first
    let response = await fetch(`${API_BASE_URL}/auth/me`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // If app.corteza.app fails, try Railway
    if (!response.ok) {
      console.log('app.corteza.app failed, trying Railway...');
      currentApiUrl = RAILWAY_API_URL;
      response = await fetch(`${RAILWAY_API_URL}/auth/me`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      // If Railway fails, try local
      if (!response.ok) {
        console.log('Railway API failed, trying local...');
        currentApiUrl = LOCAL_API_URL;
        response = await fetch(`${LOCAL_API_URL}/auth/me`, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }
    } else {
      currentApiUrl = API_BASE_URL;
    }

    if (response.ok) {
      const data = await response.json();

      if (data.authenticated && data.user) {
        // User is authenticated
        updateBadge(true);

        return {
          authenticated: true,
          user: data.user,
          workspace_id: data.user.workspace_id
        };
      }
    }

    // Not authenticated
    updateBadge(false);
    return { authenticated: false };

  } catch (error) {
    console.error('Authentication check failed:', error);
    updateBadge(false);
    return { authenticated: false, error: error.message };
  }
}

// Create memory via API
async function createMemory(memoryData) {
  try {
    const response = await fetch(`${currentApiUrl}/api/memory/create`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(memoryData)
    });

    const data = await response.json();

    if (response.ok && data.success) {
      console.log('Memory created successfully:', data.memory.id);
      return {
        success: true,
        memory: data.memory
      };
    } else {
      console.error('Memory creation failed:', data);
      return {
        success: false,
        error: data.message || data.error || 'Failed to create memory'
      };
    }

  } catch (error) {
    console.error('Memory creation error:', error);
    return {
      success: false,
      error: 'Network error. Please check your connection.'
    };
  }
}

// Update extension badge
function updateBadge(isAuthenticated) {
  if (isAuthenticated) {
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#28a745' });
    chrome.action.setTitle({ title: 'Corteza - Logged in' });
  } else {
    chrome.action.setBadgeText({ text: '✗' });
    chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
    chrome.action.setTitle({ title: 'Corteza - Not logged in' });
  }
}

// Open dashboard for login
function openDashboard() {
  const dashboardUrl = `${currentApiUrl}/dashboard`;
  chrome.tabs.create({ url: dashboardUrl });
}

// Check auth on extension install/startup
chrome.runtime.onInstalled.addListener(() => {
  console.log('Corteza Team Memory extension installed');
  checkAuthentication();
});

// Check auth when browser starts
chrome.runtime.onStartup.addListener(() => {
  console.log('Browser started, checking auth');
  checkAuthentication();
});

// Periodically check auth (every 2 minutes for more responsive updates)
setInterval(() => {
  checkAuthentication();
}, 2 * 60 * 1000);
