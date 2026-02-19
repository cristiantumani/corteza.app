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

// Get or create a persistent install_id for this extension installation
async function getOrCreateInstallId() {
  const stored = await chrome.storage.local.get('install_id');
  if (stored.install_id) return stored.install_id;

  const install_id = crypto.randomUUID();
  await chrome.storage.local.set({ install_id });
  return install_id;
}

// Record install event in backend (fire and forget)
async function recordInstall() {
  try {
    const install_id = await getOrCreateInstallId();
    const manifest = chrome.runtime.getManifest();

    await fetch(`${API_BASE_URL}/api/extension/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ install_id, version: manifest.version })
    });
  } catch (e) {
    // Non-fatal
  }
}

// Record activation when user is authenticated (called once per install)
async function recordActivationIfNeeded() {
  try {
    const stored = await chrome.storage.local.get(['install_id', 'activation_recorded']);
    if (!stored.install_id || stored.activation_recorded) return;

    const response = await fetch(`${currentApiUrl}/api/extension/activate`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ install_id: stored.install_id })
    });

    if (response.ok) {
      await chrome.storage.local.set({ activation_recorded: true });
    }
  } catch (e) {
    // Non-fatal
  }
}

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

  if (request.action === 'getInstallId') {
    getOrCreateInstallId().then(install_id => sendResponse({ install_id }));
    return true; // Keep channel open for async response
  }
});

// Check authentication status
async function checkAuthentication() {
  // Only fall back to the next endpoint on network errors (server unreachable).
  // A 401 means the server is healthy but the user isn't logged in — stop there.
  const endpoints = [API_BASE_URL, RAILWAY_API_URL, LOCAL_API_URL];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}/auth/me`, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });

      // Server responded — this is the right endpoint to use
      currentApiUrl = endpoint;

      if (response.ok) {
        const data = await response.json();

        if (data.authenticated && data.user) {
          updateBadge(true);
          // Link this install to the authenticated user (fires only once per install)
          recordActivationIfNeeded();
          return {
            authenticated: true,
            user: data.user,
            workspace_id: data.user.workspace_id
          };
        }
      }

      // Server responded but user is not authenticated — stop trying fallbacks
      updateBadge(false);
      return { authenticated: false };

    } catch (error) {
      // Network error — server unreachable, try next endpoint
      console.log(`${endpoint} unreachable, trying next...`);
    }
  }

  // All endpoints unreachable
  updateBadge(false);
  return { authenticated: false, error: 'All API endpoints unreachable' };
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

// Open dashboard for login — always use production URL
function openDashboard() {
  chrome.tabs.create({ url: `${API_BASE_URL}/dashboard` });
}

// Check auth on extension install/startup
chrome.runtime.onInstalled.addListener(() => {
  console.log('Corteza Team Memory extension installed');
  recordInstall();
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
