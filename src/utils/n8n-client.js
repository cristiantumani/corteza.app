/**
 * Sends emails via Resend REST API directly (no SDK dependency)
 */

// Use native fetch (Node 18+) or fall back to node-fetch v2
const fetch = globalThis.fetch || require('node-fetch');
const { describeOutcomes } = require('../core/decisions/types');

const RESEND_API_URL = 'https://api.resend.com/emails';

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
 * Subject line of the daily digest: the day's numbers, most important first
 * @param {Object} summary - see sendDailyDigestEmail
 * @returns {string}
 */
function dailyDigestSubject(summary) {
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const parts = [];
  if (summary.meetings) parts.push(plural(summary.meetings, 'meeting'));
  const decisions = (summary.outcomes && summary.outcomes.decision) || 0;
  if (decisions) parts.push(plural(decisions, 'decision'));
  if (summary.newActionItems) parts.push(`${plural(summary.newActionItems, 'new action item')}`);
  if (summary.overdue) parts.push(`${summary.overdue} overdue`);
  return parts.length ? `Your day in Corteza: ${parts.join(', ')}` : 'Your day in Corteza';
}

/**
 * The end-of-day summary for one person: counts only, no meeting content, and links
 * to where they can act in Corteza. Replaces the per-meeting capture and due date emails.
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.workspace_name
 * @param {string} params.unsubscribe_url
 * @param {Object} params.summary - { dayLabel, meetings, outcomes: { decision, open_question, risk, … },
 *   newActionItems, toReview, overdue, noDueDate }
 */
async function sendDailyDigestEmail({ email, workspace_name, summary, unsubscribe_url }) {
  const baseUrl = process.env.BASE_URL || 'https://app.corteza.app';
  const outcomes = summary.outcomes || {};
  const decisions = outcomes.decision || 0;
  const otherOutcomes = describeOutcomes({ ...outcomes, decision: 0 });

  const tile = (value, label) => `
          <td style="width: 33%; padding: 16px 8px; text-align: center; background: #f6f8fa; border-radius: 12px;">
            <div style="font-size: 30px; font-weight: 800;">${value}</div>
            <div style="font-size: 13px; color: #555;">${escapeHtml(label)}</div>
          </td>`;
  const plural = (count, word) => `${word}${count === 1 ? '' : 's'}`;

  const attention = [
    summary.toReview ? { text: `${summary.toReview} ${plural(summary.toReview, 'outcome')} to review`, hint: 'Confirm the right ones, dismiss the rest', href: '/dashboard?review=pending' } : null,
    summary.overdue ? { text: `${summary.overdue} overdue action ${plural(summary.overdue, 'item')}`, hint: 'Mark them done or set a new date', href: '/actions?due=overdue' } : null,
    summary.noDueDate ? { text: `${summary.noDueDate} action ${plural(summary.noDueDate, 'item')} without a due date`, hint: 'Set a date so they don’t slip', href: '/actions?due=none' } : null
  ].filter(Boolean);

  const attentionHtml = attention.length ? `
        <h2 style="font-size: 16px; font-weight: 700; margin: 28px 0 8px;">Needs your attention</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          ${attention.map(row => `
          <tr><td style="padding: 10px 0; border-top: 1px solid #eee;">
            <a href="${baseUrl}${row.href}" style="color: #111; font-weight: 600; text-decoration: none;">${escapeHtml(row.text)} →</a>
            <div style="color: #777; font-size: 13px;">${escapeHtml(row.hint)}</div>
          </td></tr>`).join('')}
        </table>` : '';

  const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #111;">
        <img src="https://corteza.app/favicon-96x96.png" alt="Corteza" width="40" style="margin-bottom: 24px;" />
        <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 4px;">What happened today</h1>
        <p style="font-size: 15px; color: #555; margin: 0 0 24px;">${escapeHtml(workspace_name)} · ${escapeHtml(summary.dayLabel)}</p>
        <table style="width: 100%; border-collapse: separate; border-spacing: 8px 0; margin: 0 -8px;">
          <tr>${tile(summary.meetings, plural(summary.meetings, 'meeting'))}${tile(decisions, plural(decisions, 'decision'))}${tile(summary.newActionItems, `new action ${plural(summary.newActionItems, 'item')}`)}</tr>
        </table>
        ${otherOutcomes ? `<p style="font-size: 14px; color: #555; margin: 12px 0 0;">Also captured: ${escapeHtml(otherOutcomes)}.</p>` : ''}
        ${attentionHtml}
        <a href="${baseUrl}/dashboard"
           style="display: inline-block; margin-top: 28px; background: #000; color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px;">
          Open Corteza →
        </a>
        <p style="font-size: 12px; color: #999; margin: 32px 0 0;">
          One email a day, only on days with something new. You get it because you're a member of ${escapeHtml(workspace_name)} on Corteza.
          <a href="${unsubscribe_url}" style="color: #999;">Unsubscribe from daily summaries</a>.
        </p>
      </div>
    `;

  const result = await sendEmail({
    to: email,
    subject: dailyDigestSubject(summary),
    html,
    headers: {
      'List-Unsubscribe': `<${unsubscribe_url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    }
  });
  return { success: true, email_id: result.id };
}

module.exports = {
  sendImportSummaryEmail,
  sendBetaWelcomeEmail,
  sendDailyDigestEmail,
  dailyDigestSubject,
  sendEmail,
  escapeHtml,
  sendMagicLinkEmail,
  sendReengagementEmail,
  sendInviteEmail,
  sendFeedbackNotificationEmail,
  sendWeeklyDigestEmail
};
