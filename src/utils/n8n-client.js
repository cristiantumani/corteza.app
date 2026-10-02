/**
 * Sends emails via Resend REST API directly (no SDK dependency)
 */

// Use native fetch (Node 18+) or fall back to node-fetch v2
const fetch = globalThis.fetch || require('node-fetch');
const { describeOutcomes } = require('../core/decisions/types');

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * Sends one email through Resend
 * @param {Object} params
 * @param {string} params.to
 * @param {string} params.subject
 * @param {string} params.html
 * @param {string} [params.replyTo]
 * @param {Object<string, string>} [params.headers] - e.g. List-Unsubscribe
 * @returns {Promise<{ id: string }>}
 */
async function sendEmail({ to, subject, html, replyTo, headers }) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error('RESEND_API_KEY not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Corteza <noreply@corteza.app>',
        to: [to],
        subject,
        html,
        ...(replyTo && { reply_to: replyTo }),
        ...(headers && { headers })
      }),
      signal: controller.signal
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Resend API error:', JSON.stringify(data));
      throw new Error(`Resend error: ${data.message || response.status}`);
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Email service timed out. Please try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Sends magic link email via Resend
 */
async function sendMagicLinkEmail({ email, user_name, workspace_name, magic_link, expires_in_minutes }) {
  const result = await sendEmail({
    to: email,
    subject: 'Your Corteza login link',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; color: #111;">
        <img src="https://corteza.app/favicon-96x96.png" alt="Corteza" width="40" style="margin-bottom: 24px;" />
        <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 8px;">Your login link</h1>
        <p style="font-size: 15px; color: #555; margin: 0 0 32px;">
          Hi ${user_name || email.split('@')[0]}, click below to log into your <strong>${workspace_name}</strong> workspace. This link expires in ${expires_in_minutes || 5} minutes.
        </p>
        <a href="${magic_link}"
           style="display: inline-block; background: #000; color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px;">
          Log in to Corteza →
        </a>
        <p style="font-size: 13px; color: #999; margin: 32px 0 0;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `
  });

  console.log(`✅ Magic link email sent to ${email}`, result.id);
  return { success: true };
}

/**
 * Sends re-engagement email via Resend
 */
async function sendReengagementEmail({ email, workspace_name, install_date }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️  RESEND_API_KEY not configured — skipping re-engagement email');
    return { success: false, reason: 'resend_not_configured' };
  }

  const dashboardUrl = process.env.BASE_URL || 'https://app.corteza.app';

  const result = await sendEmail({
    to: email,
    subject: 'Still interested in Corteza?',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; color: #111;">
        <img src="https://corteza.app/favicon-96x96.png" alt="Corteza" width="40" style="margin-bottom: 24px;" />
        <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 8px;">You installed Corteza — here's how to get started</h1>
        <p style="font-size: 15px; color: #555; margin: 0 0 24px;">
          You installed the Corteza extension a few days ago but haven't logged in yet. It only takes 2 minutes to set up — and your team will stop losing decisions from day one.
        </p>
        <a href="${dashboardUrl}/auth/login"
           style="display: inline-block; background: #000; color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px;">
          Get started →
        </a>
        <p style="font-size: 13px; color: #999; margin: 32px 0 0;">
          If you've changed your mind, just ignore this email. No hard feelings.
        </p>
      </div>
    `
  });

  console.log(`✅ Re-engagement email sent to ${email}`, result.id);
  return { success: true };
}

/**
 * Sends workspace invitation email via Resend
 */
async function sendInviteEmail({ email, inviter_name, workspace_name, role, invite_url, expires_days }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️  RESEND_API_KEY not configured — skipping invite email');
    return { success: false, reason: 'resend_not_configured' };
  }

  const roleDescription = role === 'admin' ? 'an admin' : 'a member';

  const result = await sendEmail({
    to: email,
    subject: `${inviter_name} invited you to join ${workspace_name} on Corteza`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; color: #111;">
        <img src="https://corteza.app/favicon-96x96.png" alt="Corteza" width="40" style="margin-bottom: 24px;" />
        <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 8px;">You're invited! 🎉</h1>
        <p style="font-size: 15px; color: #555; margin: 0 0 24px;">
          <strong>${inviter_name}</strong> has invited you to join <strong>${workspace_name}</strong> on Corteza as ${roleDescription}.
        </p>
        <a href="${invite_url}"
           style="display: inline-block; background: #000; color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px;">
          Accept invitation →
        </a>
        <p style="font-size: 13px; color: #999; margin: 32px 0 0;">
          This invitation expires in ${expires_days} days. If you didn't expect this, you can safely ignore this email.
        </p>
      </div>
    `
  });

  console.log(`✅ Invite email sent to ${email}`, result.id);
  return { success: true, email_id: result.id };
}

/**
 * Escapes text for safe inclusion in email HTML
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sends a notification about new user feedback to the team (FEEDBACK_EMAIL)
 */
async function sendFeedbackNotificationEmail({ to, type, feedback, user_name, user_email, workspace_name, workspace_id, source }) {
  const result = await sendEmail({
    to,
    subject: `[Corteza feedback] ${type} from ${user_name || 'a user'}`,
    replyTo: user_email || undefined,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #111;">
        <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 16px;">New feedback: ${escapeHtml(type)}</h1>
        <p style="font-size: 15px; white-space: pre-wrap; background: #f6f8fa; border-radius: 8px; padding: 16px; margin: 0 0 24px;">${escapeHtml(feedback)}</p>
        <table style="font-size: 14px; color: #555; border-collapse: collapse;">
          <tr><td style="padding: 4px 16px 4px 0;">From</td><td>${escapeHtml(user_name || 'Unknown')}${user_email ? ` &lt;${escapeHtml(user_email)}&gt;` : ''}</td></tr>
          <tr><td style="padding: 4px 16px 4px 0;">Workspace</td><td>${escapeHtml(workspace_name || workspace_id)} (${escapeHtml(workspace_id)})</td></tr>
          <tr><td style="padding: 4px 16px 4px 0;">Source</td><td>${escapeHtml(source || 'dashboard')}</td></tr>
        </table>
      </div>
    `
  });

  console.log(`✅ Feedback notification sent to ${to}`, result.id);
  return { success: true, email_id: result.id };
}

/**
 * Sends a member their workspace's weekly decision digest
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.workspace_name
 * @param {Object} params.stats - Output of buildDigestStats (jobs/weekly-digest.js)
 * @param {string} params.unsubscribe_url - Signed link that turns the digest off for this member
 */
async function sendWeeklyDigestEmail({ email, workspace_name, stats, unsubscribe_url }) {
  const dashboardUrl = process.env.BASE_URL || 'https://app.corteza.app';
  const changeText = stats.change > 0
    ? `▲ ${stats.change} vs previous week`
    : stats.change < 0 ? `▼ ${Math.abs(stats.change)} vs previous week` : 'Same as previous week';

  const row = (label, value) =>
    `<tr><td style="padding: 6px 0; color: #555;">${escapeHtml(label)}</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${escapeHtml(value)}</td></tr>`;

  const section = (title, body) => body ? `
        <h2 style="font-size: 16px; font-weight: 700; margin: 28px 0 8px;">${title}</h2>
        ${body}` : '';

  const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #111;">
        <img src="https://corteza.app/favicon-96x96.png" alt="Corteza" width="40" style="margin-bottom: 24px;" />
        <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 4px;">Your weekly decision digest</h1>
        <p style="font-size: 15px; color: #555; margin: 0 0 24px;">${escapeHtml(workspace_name)} · ${escapeHtml(stats.periodLabel)}</p>

        <div style="background: #f6f8fa; border-radius: 12px; padding: 20px; text-align: center;">
          <div style="font-size: 36px; font-weight: 800;">${stats.thisWeek}</div>
          <div style="font-size: 14px; color: #555;">decision${stats.thisWeek === 1 ? '' : 's'} logged · ${escapeHtml(changeText)}</div>
        </div>
        ${section('Latest decisions', stats.recent.length ? `<ul style="padding-left: 20px; margin: 0; font-size: 14px; line-height: 1.5;">${stats.recent.map(d =>
          `<li style="margin-bottom: 8px;">${escapeHtml(d.text)} <span style="color: #888;">— ${escapeHtml(d.creator)}${d.space ? `, ${escapeHtml(d.space)}` : ''}</span></li>`
        ).join('')}</ul>` : '')}
        ${section('By type', stats.byType.length ? `<table style="width: 100%; font-size: 14px; border-collapse: collapse;">${stats.byType.map(([type, count]) => row(type, count)).join('')}</table>` : '')}
        ${section('Top contributors', stats.topContributors.length ? `<table style="width: 100%; font-size: 14px; border-collapse: collapse;">${stats.topContributors.map(([name, count]) => row(name, count)).join('')}</table>` : '')}
        ${section('Top tags', stats.topTags.length ? `<p style="margin: 0; font-size: 13px; line-height: 2;">${stats.topTags.map(([tag, count]) =>
          `<span style="background: #eef0ff; color: #3f3fb0; border-radius: 12px; padding: 4px 10px; margin-right: 6px; white-space: nowrap;">${escapeHtml(tag)} (${count})</span>`
        ).join('')}</p>` : '')}

        <a href="${dashboardUrl}/dashboard"
           style="display: inline-block; margin-top: 32px; background: #000; color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px;">
          Open dashboard →
        </a>
        <p style="font-size: 12px; color: #999; margin: 32px 0 0;">
          You get this because you're a member of ${escapeHtml(workspace_name)} on Corteza.
          <a href="${unsubscribe_url}" style="color: #999;">Unsubscribe from weekly digests</a>.
        </p>
      </div>
    `;

  const result = await sendEmail({
    to: email,
    subject: `Weekly digest: ${stats.thisWeek} decision${stats.thisWeek === 1 ? '' : 's'} in ${workspace_name}`,
    html,
    headers: {
      'List-Unsubscribe': `<${unsubscribe_url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    }
  });

  return { success: true, email_id: result.id };
}

/**
 * Welcomes an approved beta tester and invites them to sign in with Google
 * @param {Object} params
 * @param {string} params.email - the address they requested access with
 * @param {string} [params.name] - first name
 * @param {string} params.login_url
 * @param {string} [params.reply_to] - the team's address, so replies reach a person
 */
async function sendBetaWelcomeEmail({ email, name, login_url, reply_to }) {
  const result = await sendEmail({
    to: email,
    subject: 'You’re in: welcome to the Corteza beta',
    replyTo: reply_to || undefined,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; color: #111; line-height: 1.6;">
        <img src="https://corteza.app/favicon-96x96.png" alt="Corteza" width="40" style="margin-bottom: 24px;" />
        <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 16px;">Welcome to the beta${name ? `, ${escapeHtml(name)}` : ''}!</h1>
        <p style="font-size: 15px; margin: 0 0 16px;">
          You’re one of the first teams on Corteza. From your next meeting on, decisions stick,
          commitments get followed until they’re done, and every meeting gets a little better.
        </p>
        <p style="font-size: 15px; margin: 0 0 28px;">
          Sign in with the Google account for <strong>${escapeHtml(email)}</strong> to set up your workspace.
          It takes a couple of minutes.
        </p>
        <a href="${escapeHtml(login_url)}"
           style="display: inline-block; background: #000; color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px;">
          Sign in with Google →
        </a>
        <p style="font-size: 15px; margin: 32px 0 0;">
          Questions or feedback? Just reply to this email, it reaches us directly.
        </p>
        <p style="font-size: 15px; margin: 16px 0 0;">The Corteza team</p>
      </div>
    `
  });

  console.log(`✅ Beta welcome email sent to ${email}`, result.id);
  return { success: true, email_id: result.id };
}

const IMPORT_ITEM_LABELS = {
  already_imported: 'already imported',
  not_ready: 'transcript not ready yet',
  too_old: 'too old to import',
  no_transcript: 'no transcript or notes',
  failed: 'couldn’t be imported'
};

/**
 * Tells someone their "Import past meetings" job finished, with what it captured
 * @param {Object} params
 * @param {string} params.email
 * @param {Object} params.job - finished meet_imports document: { total, items, outcomes_by_type, action_items_created }
 */
async function sendImportSummaryEmail({ email, job }) {
  const dashboardUrl = process.env.BASE_URL || 'https://app.corteza.app';
  const counts = { ...(job.outcomes_by_type || {}), action_item: job.action_items_created || 0 };
  const summary = describeOutcomes(counts) || 'no outcomes';
  const meetings = `${job.total} meeting${job.total === 1 ? '' : 's'}`;
  const rows = (job.items || []).map(item => {
    const result = item.status === 'completed'
      ? (describeOutcomes({ ...(item.outcomes_by_type || {}), action_item: item.action_items_created || 0 }) || 'no outcomes')
      : (IMPORT_ITEM_LABELS[item.status] || item.status);
    return `<tr><td style="padding: 6px 12px 6px 0; vertical-align: top;">${escapeHtml(item.title || 'Meeting')}</td><td style="padding: 6px 0; color: ${item.status === 'failed' ? '#b3261e' : '#666'}; white-space: nowrap; vertical-align: top;">${escapeHtml(result)}</td></tr>`;
  }).join('');

  const result = await sendEmail({
    to: email,
    subject: `Import done: ${summary} from ${meetings}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #111;">
        <img src="https://corteza.app/favicon-96x96.png" alt="Corteza" width="40" style="margin-bottom: 24px;" />
        <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 8px;">Your import is done</h1>
        <p style="font-size: 15px; color: #555; margin: 0 0 24px;">
          Corteza captured <strong>${escapeHtml(summary)}</strong> from ${escapeHtml(meetings)}. They're saved in your space. Confirm the ones that are right and dismiss the rest: Corteza learns from it.
        </p>
        <table style="border-collapse: collapse; font-size: 14px; width: 100%; margin: 0 0 28px;">${rows}</table>
        <a href="${dashboardUrl}/dashboard?review=pending"
           style="display: inline-block; background: #000; color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px;">
          Review in Corteza →
        </a>
      </div>
    `
  });

  console.log(`✅ Import summary email sent to ${email}`, result.id);
  return { success: true, email_id: result.id };
}

/**
 * "Assigned to you by colleagues" line of the morning digest: action items that colleagues'
 * meetings named the person as owner of (core/actions/colleague-assignments). Names only, no text.
 * @param {{ name: string, count: number }[]} [assignedBy]
 * @returns {string} HTML, empty when there are none
 */
function assignedByHtml(assignedBy) {
  if (!Array.isArray(assignedBy) || assignedBy.length === 0) return '';
  const total = assignedBy.reduce((sum, row) => sum + row.count, 0);
  const names = assignedBy.map(row => `${escapeHtml(row.name)} (${row.count})`).join(', ');
  return `<p style="font-size: 14px; color: #1b1b1d; background: #eef1fb; border-radius: 8px; padding: 10px 14px; margin: 12px 0 0;">
              <strong>${total} new action item${total === 1 ? '' : 's'} assigned to you by colleagues.</strong> They came from meetings captured by ${names}.
            </p>`;
}

/**
 * Subject line of the morning digest: the numbers since the last one, most important first
 * @param {Object} summary - see sendDailyDigestEmail
 * @returns {string}
 */
function dailyDigestSubject(summary) {
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const today = [];
  if (summary.dueToday) today.push(`${summary.dueToday} due today`);
  if (summary.overdue) today.push(`${summary.overdue} overdue`);
  const prepCount = Array.isArray(summary.meetingPrep) ? summary.meetingPrep.length : 0;
  if (prepCount) today.push(`${prepCount} meeting${prepCount === 1 ? '' : 's'} to prepare`);
  const since = [];
  if (summary.meetings) since.push(plural(summary.meetings, 'meeting'));
  const decisions = (summary.outcomes && summary.outcomes.decision) || 0;
  if (decisions) since.push(plural(decisions, 'decision'));
  if (summary.newActionItems) since.push(plural(summary.newActionItems, 'new action item'));

  const parts = [];
  if (today.length) parts.push(`Your day: ${today.join(', ')}`);
  if (since.length) parts.push(`since ${summary.since || 'yesterday'}: ${since.join(', ')}`);
  if (!parts.length) return 'Plan your day with Corteza';
  const subject = parts.join(' · ');
  return subject.charAt(0).toUpperCase() + subject.slice(1);
}

/**
 * The morning summary for one person, to plan the day. Like a task list: their own action
 * items due today or overdue, each with a button to open it in Corteza; then counts of
 * what else needs them and of what their meetings left. No decisions, colleagues' items
 * or transcript text.
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.workspace_name
 * @param {string} params.unsubscribe_url
 * @param {Object} params.summary - { dayLabel, today ('YYYY-MM-DD'), since ('yesterday' or a weekday),
 *   meetings, outcomes: { decision, open_question, risk, … }, newActionItems, dueToday, toReview,
 *   overdue, noDueDate, planItems: [{ item_id, text, due_date, meeting }], assignedBy: [{ name, count }],
 *   meetingPrep: [{ time, title, people, items: [{ item_id, text, due_date, owner }], more }] }
 */
async function sendDailyDigestEmail({ email, workspace_name, summary, unsubscribe_url }) {
  const result = await sendEmail({
    to: email,
    subject: dailyDigestSubject(summary),
    html: dailyDigestHtml({ workspace_name, summary, unsubscribe_url }),
    headers: {
      'List-Unsubscribe': `<${unsubscribe_url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    }
  });
  return { success: true, email_id: result.id };
}

/**
 * HTML of the morning summary (see sendDailyDigestEmail)
 * @param {{ workspace_name: string, summary: Object, unsubscribe_url: string }} params
 * @returns {string}
 */
function dailyDigestHtml({ workspace_name, summary, unsubscribe_url }) {
  const baseUrl = process.env.BASE_URL || 'https://app.corteza.app';
  const outcomes = summary.outcomes || {};
  const decisions = outcomes.decision || 0;
  const otherOutcomes = describeOutcomes({ ...outcomes, decision: 0 });
  const plural = (count, word) => `${word}${count === 1 ? '' : 's'}`;
  const shortDate = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

  const button = (href, label) => `
              <a href="${baseUrl}${href}" style="display: inline-block; white-space: nowrap; padding: 7px 14px; border: 1px solid #c5c6d0; border-radius: 6px; color: #1b1b1d; font-size: 14px; font-weight: 600; text-decoration: none;">${escapeHtml(label)}</a>`;
  const row = ({ box, title, meta, href, label }) => `
          <tr>
            <td style="width: 26px; padding: 14px 0; vertical-align: top;">
              <div style="width: 14px; height: 14px; margin-top: 3px; border: 2px solid ${box}; border-radius: 3px;"></div>
            </td>
            <td style="padding: 14px 12px 14px 0; vertical-align: top;">
              <div style="font-size: 15px; line-height: 1.4; color: #1b1b1d;">${title}</div>
              <div style="font-size: 13px; color: #6b6d78; margin-top: 2px;">${meta}</div>
            </td>
            <td style="padding: 14px 0; vertical-align: top; text-align: right;">${button(href, label)}</td>
          </tr>`;

  const items = Array.isArray(summary.planItems) ? summary.planItems : [];
  const itemRows = items.map(item => {
    const overdue = summary.today && item.due_date < summary.today;
    const when = overdue ? `Overdue · was due ${shortDate(item.due_date)}` : 'Due today';
    return row({
      box: overdue ? '#ba1a1a' : '#3953bd',
      title: escapeHtml(clip(String(item.text), 160)),
      meta: `<span style="color: ${overdue ? '#ba1a1a' : '#3953bd'}; font-weight: 600;">${when}</span>${item.meeting ? ` · ${escapeHtml(clip(String(item.meeting), 60))}` : ''}`,
      href: `/actions?item=${encodeURIComponent(item.item_id)}`,
      label: 'Open'
    });
  });
  const dueCount = (summary.dueToday || 0) + (summary.overdue || 0);
  const allDue = summary.dueToday && summary.overdue ? '/actions' : `/actions?due=${summary.overdue ? 'overdue' : 'today'}`;
  const more = dueCount > items.length ? `
          <tr><td colspan="3" style="padding: 0 0 14px 26px;">
            <a href="${baseUrl}${allDue}" style="color: #3953bd; font-size: 14px; font-weight: 600; text-decoration: none;">See all ${dueCount} due or overdue →</a>
          </td></tr>` : '';
  const reminders = [
    summary.toReview ? row({ box: '#c5c6d0', title: `${summary.toReview} ${plural(summary.toReview, 'outcome')} to review`, meta: 'Confirm the right ones, dismiss the rest', href: '/dashboard?review=pending', label: 'Review' }) : '',
    summary.noDueDate ? row({ box: '#c5c6d0', title: `${summary.noDueDate} action ${plural(summary.noDueDate, 'item')} without a due date`, meta: 'Set a date so they don’t slip', href: '/actions?due=none', label: 'Set dates' }) : ''
  ].filter(Boolean);

  const divider = '<tr><td colspan="3" style="border-top: 1px solid #ebe7ec; font-size: 0; line-height: 0;">&nbsp;</td></tr>';
  const plateHtml = itemRows.length || reminders.length ? `
        <h2 style="font-size: 16px; font-weight: 700; color: #1b1b1d; margin: 0 0 4px;">On your plate today</h2>
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          ${[itemRows.join(divider) + more, ...reminders].filter(Boolean).join(divider)}
        </table>` : '';

  // Today's meetings: who's in them and the open items with those people (core/briefs/meeting-prep)
  const prep = Array.isArray(summary.meetingPrep) ? summary.meetingPrep : [];
  const prepHtml = prep.length ? `
        <h2 style="font-size: 16px; font-weight: 700; color: #1b1b1d; margin: ${plateHtml ? '28px' : '0'} 0 4px;">Prepare for today's meetings</h2>
        <p style="font-size: 14px; color: #6b6d78; margin: 0 0 8px;">Open action items with the people you're meeting.</p>
        ${prep.map(meeting => `
        <div style="border: 1px solid #ebe7ec; border-radius: 10px; padding: 14px 16px; margin-top: 10px;">
          <div style="font-size: 15px; font-weight: 700; color: #1b1b1d;">${escapeHtml(meeting.time || '')} · ${escapeHtml(clip(String(meeting.title || 'Meeting'), 80))}</div>
          <div style="font-size: 13px; color: #6b6d78; margin: 2px 0 8px;">With ${escapeHtml(clip((meeting.people || []).join(', '), 120))}</div>
          ${(meeting.items || []).map(item => `
          <div style="font-size: 14px; line-height: 1.4; padding: 6px 0; border-top: 1px solid #f1eef2;">
            <a href="${baseUrl}/actions?item=${encodeURIComponent(item.item_id)}" style="color: #1b1b1d; text-decoration: none;">${escapeHtml(clip(String(item.text), 140))}</a>
            <div style="font-size: 12px; color: #6b6d78;">${item.owner ? escapeHtml(item.owner) : 'You'}${!item.due_date ? '' : summary.today && item.due_date < summary.today
              ? ` · <span style="color: #ba1a1a; font-weight: 600;">overdue since ${shortDate(item.due_date)}</span>`
              : ` · due ${shortDate(item.due_date)}`}</div>
          </div>`).join('')}
          ${meeting.more ? `<div style="font-size: 13px; color: #6b6d78; padding-top: 6px;">and ${meeting.more} more</div>` : ''}
        </div>`).join('')}` : '';

  const tile = (value, label) => `
            <td style="width: 33%; padding: 14px 6px; text-align: center; background: #f6f3f5; border-radius: 10px;">
              <div style="font-size: 26px; font-weight: 800; color: #1b1b1d;">${value}</div>
              <div style="font-size: 13px; color: #6b6d78;">${escapeHtml(label)}</div>
            </td>`;
  const since = escapeHtml(summary.since || 'yesterday');

  return `
      <div style="background: #eef1fb; padding: 32px 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1b1b1d;">
        <div style="max-width: 580px; margin: 0 auto; background: #fff; border: 1px solid #e4e1e8; border-top: 6px solid #3953bd; border-radius: 12px; overflow: hidden;">
          <div style="padding: 20px 28px; border-bottom: 1px solid #ebe7ec;">
            <img src="https://corteza.app/favicon-96x96.png" alt="" width="24" height="24" style="vertical-align: middle; border-radius: 6px; margin-right: 10px;" />
            <span style="font-size: 17px; font-weight: 700; vertical-align: middle;">Your morning summary</span>
          </div>
          <div style="padding: 24px 28px 28px;">
            <h1 style="font-size: 21px; font-weight: 700; margin: 0 0 4px;">Good morning. Here's your day.</h1>
            <p style="font-size: 14px; color: #6b6d78; margin: 0 0 24px;">${escapeHtml(workspace_name)} · ${escapeHtml(summary.dayLabel)}</p>
            ${plateHtml}
            ${prepHtml}
            <h2 style="font-size: 16px; font-weight: 700; margin: 28px 0 12px;">Since ${since}</h2>
            <table role="presentation" style="width: 100%; border-collapse: separate; border-spacing: 6px 0; margin: 0 -6px;">
              <tr>${tile(summary.meetings, plural(summary.meetings, 'meeting'))}${tile(decisions, plural(decisions, 'decision'))}${tile(summary.newActionItems, `new action ${plural(summary.newActionItems, 'item')}`)}</tr>
            </table>
            ${otherOutcomes ? `<p style="font-size: 14px; color: #6b6d78; margin: 12px 0 0;">Also captured: ${escapeHtml(otherOutcomes)}.</p>` : ''}
            ${assignedByHtml(summary.assignedBy)}
            <a href="${baseUrl}/actions"
               style="display: inline-block; margin-top: 28px; background: #3953bd; color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 13px 26px; border-radius: 8px;">
              Plan my day in Corteza →
            </a>
          </div>
        </div>
        <p style="max-width: 580px; margin: 20px auto 0; font-size: 12px; color: #8a8c96; text-align: center;">
          One email each weekday morning, only when there's something new or due. You get it because you're a member of ${escapeHtml(workspace_name)} on Corteza.
          Change the time zone in Settings, or <a href="${unsubscribe_url}" style="color: #8a8c96;">unsubscribe from morning summaries</a>.
        </p>
      </div>
    `;
}

module.exports = {
  sendImportSummaryEmail,
  sendBetaWelcomeEmail,
  sendDailyDigestEmail,
  dailyDigestHtml,
  dailyDigestSubject,
  sendEmail,
  escapeHtml,
  sendMagicLinkEmail,
  sendReengagementEmail,
  sendInviteEmail,
  sendFeedbackNotificationEmail,
  sendWeeklyDigestEmail
};
