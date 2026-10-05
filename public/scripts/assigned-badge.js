/**
 * Sidebar: a count next to "Action items" when colleagues' meetings assigned the person new
 * action items they haven't seen (GET /api/action-items/from-colleagues). Opening Action
 * items clears it. Loaded on every app page by the sidebar partial.
 */
(function () {
  if (window.location.pathname === '/actions') return; // that page shows them and marks them seen

  function show(count) {
    const link = document.querySelector('.corteza-sidebar a[data-nav="actions"]');
    if (!link || link.querySelector('.sb-badge')) return;
    const badge = document.createElement('span');
    badge.className = 'sb-badge';
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.title = (window.t || (key => key))('actions.fromColleagues.badge', { count });
    badge.setAttribute('aria-label', badge.title);
    badge.style.cssText = 'margin-left:auto;min-width:20px;padding:1px 6px;border-radius:999px;background:#3953bd;color:#fff;font-size:12px;font-weight:600;text-align:center;line-height:18px;';
    link.appendChild(badge);
  }

  function check() {
    fetch('/api/action-items/from-colleagues', { credentials: 'include' })
      .then(response => (response.ok ? response.json() : null))
      .then(data => { if (data && data.count > 0) show(data.count); })
      .catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check);
  else check();
})();
