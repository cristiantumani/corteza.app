/**
 * Workspace members to pick owners from (GET /api/people), loaded once per page.
 * Used by inline-edit.js (decision owner) and decision-actions.js (action item owners).
 */
(function() {
  'use strict';

  let request = null;

  /** @returns {Promise<Array<{user_id: string, name: string, email: string|null}>>} */
  function load() {
    if (!request) {
      request = fetch('/api/people', { credentials: 'include' })
        .then(response => (response.ok ? response.json() : { people: [] }))
        .then(data => data.people || [])
        .catch(() => {
          request = null; // try again next time
          return [];
        });
    }
    return request;
  }

  window.CortezaPeople = { load };
})();
