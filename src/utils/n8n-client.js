/**
 * Sends emails via Resend REST API directly (no SDK dependency)
 */

// Use native fetch (Node 18+) or fall back to node-fetch v2
const fetch = globalThis.fetch || require('node-fetch');
const { OUTCOME_LABELS, outcomeGroup, countByType, describeOutcomes } = require('../core/decisions/types');

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
 * Tells the user which outcomes (decisions, open questions, risks, action items)
 * Corteza captured automatically from a meeting
 * @param {Object} params - { email, meeting_title, meeting_url, decisions: [{ id, text, type }],
 *   action_items?: [{ text, owners: [name], due_date }] }
 */
async function sendMeetingCaptureEmail({ email, meeting_title, meeting_url, decisions, action_items = [] }) {
  const dashboardUrl = process.env.BASE_URL || 'https://app.corteza.app';
  const summary = describeOutcomes({ ...countByType(decisions), action_item: action_items.length });
  const outcomesHtml = Object.keys(OUTCOME_LABELS).map(group => {
    const items = decisions.filter(d => outcomeGroup(d.type) === group);
    if (items.length === 0) return '';
    const heading = group === 'other' ? 'Other' : OUTCOME_LABELS[group][1].replace(/^./, c => c.toUpperCase());
    return `
        <h2 style="font-size: 16px; font-weight: 700; margin: 0 0 8px;">${heading}</h2>
        <ul style="padding-left: 20px; margin: 0 0 24px; font-size: 14px; line-height: 1.5;">
          ${items.map(d => `<li style="margin-bottom: 8px;">${escapeHtml(d.text)}${group === 'other' ? ` <span style="color: #888;">(${escapeHtml(d.type)})</span>` : ''}</li>`).join('')}
        </ul>`;
  }).join('');
  const actionsHtml = action_items.length === 0 ? '' : `
        <h2 style="font-size: 16px; font-weight: 700; margin: 0 0 8px;">Action items</h2>
        <ul style="padding-left: 20px; margin: 0 0 24px; font-size: 14px; line-height: 1.5;">
          ${action_items.map(item => `<li style="margin-bottom: 8px;">${escapeHtml(item.text)} <span style="color: #888;">(${escapeHtml(item.owners.join(', ') || 'no owner')} · ${escapeHtml(item.due_date || 'no due date')})</span></li>`).join('')}
        </ul>`;

  const result = await sendEmail({
    to: email,
    subject: `${summary} captured from "${meeting_title}"`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #111;">
        <img src="https://corteza.app/favicon-96x96.png" alt="Corteza" width="40" style="margin-bottom: 24px;" />
        <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 8px;">${escapeHtml(summary.replace(/^./, c => c.toUpperCase()))} captured</h1>
        <p style="font-size: 15px; color: #555; margin: 0 0 24px;">
          From ${meeting_url ? `<a href="${escapeHtml(meeting_url)}" style="color: #3953bd;">${escapeHtml(meeting_title)}</a>` : `<strong>${escapeHtml(meeting_title)}</strong>`}.
          They're already saved in Corteza; edit or delete any that aren't right.
        </p>
        ${outcomesHtml}
        ${actionsHtml}
        <a href="${dashboardUrl}/dashboard"
           style="display: inline-block; background: #000; color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px;">
          Review in Corteza →
        </a>
        <p style="font-size: 12px; color: #999; margin: 32px 0 0;">
          You get this because you connected Google Meet to Corteza. Manage it in Settings → Integrations.
        </p>
      </div>
    `
  });

  console.log(`✅ Meeting capture email sent to ${email}`, result.id);
  return { success: true, email_id: result.id };
}

/**
 * Asks an owner to set due dates on their action items from a meeting
 * @param {Object} params - { email, name, meetingTitle, meetingUrl, items: [{ item_id, text }] }
 */
async function sendDueDateRequestEmail({ email, name, meetingTitle, meetingUrl, items }) {
  const baseUrl = process.env.BASE_URL || 'https://app.corteza.app';
  const count = items.length;
  const firstName = String(name || '').split(' ')[0];

  const result = await sendEmail({
    to: email,
    subject: `When will ${count === 1 ? 'this be' : 'these be'} done? ${count} action item${count === 1 ? '' : 's'} from "${meetingTitle}"`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #111;">
        <img src="https://corteza.app/favicon-96x96.png" alt="Corteza" width="40" style="margin-bottom: 24px;" />
        <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 8px;">${firstName ? `${escapeHtml(firstName)}, when` : 'When'} will ${count === 1 ? 'this be' : 'these be'} done?</h1>
        <p style="font-size: 15px; color: #555; margin: 0 0 24px;">
          In ${meetingUrl ? `<a href="${escapeHtml(meetingUrl)}" style="color: #3953bd;">${escapeHtml(meetingTitle)}</a>` : `<strong>${escapeHtml(meetingTitle)}</strong>`}
          you took on ${count === 1 ? 'an action item' : 'these action items'} without a due date. Setting one helps the team follow up.
        </p>
        <ul style="padding-left: 0; list-style: none; margin: 0 0 24px; font-size: 14px; line-height: 1.5;">
          ${items.map(item => `
            <li style="margin-bottom: 12px; padding: 12px 16px; border: 1px solid #e5e5e5; border-radius: 10px;">
              ${escapeHtml(item.text)}<br>
              <a href="${baseUrl}/actions?item=${encodeURIComponent(item.item_id)}" style="color: #3953bd; font-weight: 600; font-size: 13px;">Set a due date →</a>
            </li>`).join('')}
        </ul>
        <p style="font-size: 12px; color: #999; margin: 32px 0 0;">
          Corteza captured these from the meeting's transcript or Gemini notes. If one isn't yours or won't happen, mark it cancelled in Corteza.
        </p>
      </div>
    `
  });

  console.log(`✅ Due date request sent to ${email}`, result.id);
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

module.exports = {
  sendBetaWelcomeEmail,
  sendDueDateRequestEmail,
  sendMeetingCaptureEmail,
  sendEmail,
  escapeHtml,
  sendMagicLinkEmail,
  sendReengagementEmail,
  sendInviteEmail,
  sendFeedbackNotificationEmail,
  sendWeeklyDigestEmail
};
