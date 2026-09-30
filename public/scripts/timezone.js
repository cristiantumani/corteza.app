/**
 * Reports the browser's time zone once per session, so the daily summary email arrives at
 * 8:00 in the person's local time. Loaded on every app page by the sidebar partial.
 * The server ignores it when the person picked a time zone in Settings.
 */
(function () {
  let timeZone;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (error) {
    return;
  }
  if (!timeZone) return;

  const key = 'corteza.timezone.reported';
  try {
    if (sessionStorage.getItem(key) === timeZone) return;
  } catch (error) { /* storage blocked: report anyway */ }

  fetch('/api/me/timezone', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timezone: timeZone })
  }).then(response => {
    if (!response.ok) return;
    try { sessionStorage.setItem(key, timeZone); } catch (error) { /* ignore */ }
  }).catch(() => {});
})();
