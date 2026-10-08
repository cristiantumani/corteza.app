/**
 * Sends emails via Resend REST API directly (no SDK dependency)
 */

// Native fetch (Node 18+) or node-fetch v2, looked up per call (tests replace globalThis.fetch)
/** @param {string} url @param {Object} options */
const fetch = (url, options) => (globalThis.fetch || require('node-fetch'))(url, options);
const { describeOutcomes } = require('../core/decisions/types');
const { translate } = require('../core/i18n/i18n');

/** Texts of one email in the recipient's language (public/i18n, keys email.*) */
const textsIn = lang => (key, vars) => translate(lang, key, vars);
/** Locale for dates in an email */
const localeOf = lang => (lang === 'es' ? 'es' : 'en-US');

const RESEND_API_URL = 'https://api.resend.com/emails';
/** Where beta testers can chip in for the AI costs (morning summary footer; the app sidebar links it too) */
const SUPPORT_URL = 'https://buymeacoffee.com/corteza.app';
/** Automatic emails (digests, imports, invites) */
const DEFAULT_FROM = 'Corteza <noreply@corteza.app>';

/**
 * Sender of the beta welcome email: a person, so testers can write back. Replies to
 * cristian@corteza.app are forwarded to the founder's inbox. BETA_FROM overrides it.
 * @returns {string}
 */
function betaFrom() {
  return (process.env.BETA_FROM || '').trim() || 'Cristian from Corteza <cristian@corteza.app>';
}

/**
 * Sends one email through Resend
 * @param {Object} params
 * @param {string} params.to
 * @param {string} params.subject
 * @param {string} params.html
 * @param {string} [params.from] - default DEFAULT_FROM (noreply)
 * @param {string} [params.replyTo]
 * @param {Object<string, string>} [params.headers] - e.g. List-Unsubscribe
 * @returns {Promise<{ id: string }>}
 */
async function sendEmail({ to, subject, html, from, replyTo, headers }) {
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
        from: from || DEFAULT_FROM,
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
 * Sends workspace invitation email via Resend, in the inviter's language (lang)
 */
async function sendInviteEmail({ email, inviter_name, workspace_name, role, invite_url, expires_days, lang = 'en' }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️  RESEND_API_KEY not configured — skipping invite email');
    return { success: false, reason: 'resend_not_configured' };
  }

  const t = textsIn(lang);
  const bold = text => `<strong>${escapeHtml(text)}</strong>`;

  const result = await sendEmail({
    to: email,
    subject: t('email.invite.subject', { name: inviter_name, workspace: workspace_name }),
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; color: #111;">
        <img src="https://corteza.app/favicon-96x96.png" alt="Corteza" width="40" style="margin-bottom: 24px;" />
        <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 8px;">${escapeHtml(t('email.invite.title'))} 🎉</h1>
        <p style="font-size: 15px; color: #555; margin: 0 0 24px;">
          ${escapeHtml(t(role === 'admin' ? 'email.invite.bodyAdmin' : 'email.invite.bodyMember')).replace('{name}', bold(inviter_name)).replace('{workspace}', bold(workspace_name))}
        </p>
        <a href="${escapeHtml(invite_url)}"
           style="display: inline-block; background: #000; color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px;">
          ${escapeHtml(t('email.invite.accept'))}
        </a>
        <p style="font-size: 13px; color: #999; margin: 32px 0 0;">
          ${escapeHtml(t('email.invite.expires', { count: expires_days }))}
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
 * @param {string} [params.lang] - the member's language
 */
async function sendWeeklyDigestEmail({ email, workspace_name, stats, unsubscribe_url, lang = 'en' }) {
  const t = textsIn(lang);
  const dashboardUrl = process.env.BASE_URL || 'https://app.corteza.app';
  const changeText = stats.change > 0
    ? `▲ ${t('email.weekly.vsPrevious', { count: stats.change })}`
    : stats.change < 0 ? `▼ ${t('email.weekly.vsPrevious', { count: Math.abs(stats.change) })}` : t('email.weekly.same');
  const typeName = type => (['decision', 'action_item', 'open_question', 'risk', 'explanation', 'context', 'learning', 'assumption'].includes(type) ? t(`types.${type}`) : type);

  const row = (label, value) =>
    `<tr><td style="padding: 6px 0; color: #555;">${escapeHtml(label)}</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${escapeHtml(value)}</td></tr>`;

  const section = (title, body) => body ? `
        <h2 style="font-size: 16px; font-weight: 700; margin: 28px 0 8px;">${title}</h2>
        ${body}` : '';

  const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #111;">
        <img src="https://corteza.app/favicon-96x96.png" alt="Corteza" width="40" style="margin-bottom: 24px;" />
        <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 4px;">${escapeHtml(t('email.weekly.title'))}</h1>
        <p style="font-size: 15px; color: #555; margin: 0 0 24px;">${escapeHtml(workspace_name)} · ${escapeHtml(stats.periodLabel)}</p>

        <div style="background: #f6f8fa; border-radius: 12px; padding: 20px; text-align: center;">
          <div style="font-size: 36px; font-weight: 800;">${stats.thisWeek}</div>
          <div style="font-size: 14px; color: #555;">${escapeHtml(t('email.weekly.logged', { count: stats.thisWeek }))} · ${escapeHtml(changeText)}</div>
        </div>
        ${section(escapeHtml(t('email.weekly.latest')), stats.recent.length ? `<ul style="padding-left: 20px; margin: 0; font-size: 14px; line-height: 1.5;">${stats.recent.map(d =>
          `<li style="margin-bottom: 8px;">${escapeHtml(d.text)} <span style="color: #888;">— ${escapeHtml(d.creator)}${d.space ? `, ${escapeHtml(d.space)}` : ''}</span></li>`
        ).join('')}</ul>` : '')}
        ${section(escapeHtml(t('email.weekly.byType')), stats.byType.length ? `<table style="width: 100%; font-size: 14px; border-collapse: collapse;">${stats.byType.map(([type, count]) => row(typeName(type), count)).join('')}</table>` : '')}
        ${section(escapeHtml(t('email.weekly.contributors')), stats.topContributors.length ? `<table style="width: 100%; font-size: 14px; border-collapse: collapse;">${stats.topContributors.map(([name, count]) => row(name, count)).join('')}</table>` : '')}
        ${section(escapeHtml(t('email.weekly.tags')), stats.topTags.length ? `<p style="margin: 0; font-size: 13px; line-height: 2;">${stats.topTags.map(([tag, count]) =>
          `<span style="background: #eef0ff; color: #3f3fb0; border-radius: 12px; padding: 4px 10px; margin-right: 6px; white-space: nowrap;">${escapeHtml(tag)} (${count})</span>`
        ).join('')}</p>` : '')}

        <a href="${dashboardUrl}/dashboard"
           style="display: inline-block; margin-top: 32px; background: #000; color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px;">
          ${escapeHtml(t('meet.import.openHome'))}
        </a>
        <p style="font-size: 12px; color: #999; margin: 32px 0 0;">
          ${escapeHtml(t('email.weekly.why', { workspace: workspace_name }))}
          <a href="${unsubscribe_url}" style="color: #999;">${escapeHtml(t('email.weekly.unsubscribe'))}</a>.
        </p>
      </div>
    `;

  const result = await sendEmail({
    to: email,
    subject: t('email.weekly.subject', { count: stats.thisWeek, workspace: workspace_name }),
    html,
    headers: {
      'List-Unsubscribe': `<${unsubscribe_url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    }
  });

  return { success: true, email_id: result.id };
}

/**
 * Welcomes an approved beta tester and invites them to sign in with Google. Sent from
 * Cristian's address (betaFrom), not noreply, so a reply reaches him
 * @param {Object} params
 * @param {string} params.email - the address they requested access with
 * @param {string} [params.name] - first name
 * @param {string} params.login_url
 * @param {string} [params.reply_to] - another address for replies (default: the sender)
 * @param {string} [params.lang] - 'en' | 'es'
 */
async function sendBetaWelcomeEmail({ email, name, login_url, reply_to, lang = 'en' }) {
  const t = textsIn(lang);
  const result = await sendEmail({
    to: email,
    subject: t('email.welcome.subject'),
    from: betaFrom(),
    replyTo: reply_to || undefined,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; color: #111; line-height: 1.6;">
        <img src="https://corteza.app/favicon-96x96.png" alt="Corteza" width="40" style="margin-bottom: 24px;" />
        <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 16px;">${escapeHtml(name ? t('email.welcome.titleNamed', { name }) : t('email.welcome.title'))}</h1>
        <p style="font-size: 15px; margin: 0 0 16px;">
          ${escapeHtml(t('email.welcome.body'))}
        </p>
        <p style="font-size: 15px; margin: 0 0 28px;">
          ${escapeHtml(t('email.welcome.signIn')).replace('{email}', `<strong>${escapeHtml(email)}</strong>`)}
        </p>
        <a href="${escapeHtml(login_url)}"
           style="display: inline-block; background: #000; color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px;">
          ${escapeHtml(t('email.welcome.button'))}
        </a>
        <p style="font-size: 15px; margin: 32px 0 0;">
          ${escapeHtml(t('email.welcome.reply'))}
        </p>
        <p style="font-size: 15px; margin: 16px 0 0;">${escapeHtml(t('email.welcome.team'))}</p>
      </div>
    `
  });

  console.log(`✅ Beta welcome email sent to ${email}`, result.id);
  return { success: true, email_id: result.id };
}

const IMPORT_ITEM_STATUSES = ['already_imported', 'not_ready', 'too_old', 'no_transcript', 'failed'];

/**
 * Tells someone their "Import past meetings" job finished, with what it captured
 * @param {Object} params
 * @param {string} params.email
 * @param {Object} params.job - finished meet_imports document: { total, items, outcomes_by_type, action_items_created }
 * @param {string} [params.lang] - the person's language
 */
async function sendImportSummaryEmail({ email, job, lang = 'en' }) {
  const t = textsIn(lang);
  const dashboardUrl = process.env.BASE_URL || 'https://app.corteza.app';
  const counts = { ...(job.outcomes_by_type || {}), action_item: job.action_items_created || 0 };
  const summary = describeOutcomes(counts, lang) || t('email.import.none');
  const meetings = t('capture.meetings', { count: job.total });
  const rows = (job.items || []).map(item => {
    const result = item.status === 'completed'
      ? (describeOutcomes({ ...(item.outcomes_by_type || {}), action_item: item.action_items_created || 0 }, lang) || t('email.import.none'))
      : (IMPORT_ITEM_STATUSES.includes(item.status) ? t(`email.import.status.${item.status}`) : item.status);
    return `<tr><td style="padding: 6px 12px 6px 0; vertical-align: top;">${escapeHtml(item.title || t('capture.meeting'))}</td><td style="padding: 6px 0; color: ${item.status === 'failed' ? '#b3261e' : '#666'}; white-space: nowrap; vertical-align: top;">${escapeHtml(result)}</td></tr>`;
  }).join('');

  const result = await sendEmail({
    to: email,
    subject: t('email.import.subject', { outcomes: summary, meetings }),
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #111;">
        <img src="https://corteza.app/favicon-96x96.png" alt="Corteza" width="40" style="margin-bottom: 24px;" />
        <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 8px;">${escapeHtml(t('email.import.title'))}</h1>
        <p style="font-size: 15px; color: #555; margin: 0 0 24px;">
          ${escapeHtml(t('email.import.body', { meetings })).replace('{outcomes}', `<strong>${escapeHtml(summary)}</strong>`)}
        </p>
        <table style="border-collapse: collapse; font-size: 14px; width: 100%; margin: 0 0 28px;">${rows}</table>
        <a href="${dashboardUrl}/dashboard?review=pending"
           style="display: inline-block; background: #000; color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px;">
          ${escapeHtml(t('email.import.review'))}
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
 * @param {string} [lang]
 * @returns {string} HTML, empty when there are none
 */
function assignedByHtml(assignedBy, lang = 'en') {
  if (!Array.isArray(assignedBy) || assignedBy.length === 0) return '';
  const t = textsIn(lang);
  const total = assignedBy.reduce((sum, row) => sum + row.count, 0);
  const names = assignedBy.map(row => `${escapeHtml(row.name)} (${row.count})`).join(', ');
  return `<p style="font-size: 14px; color: #1b1b1d; background: #eef1fb; border-radius: 8px; padding: 10px 14px; margin: 12px 0 0;">
              <strong>${escapeHtml(t('actions.fromColleagues.title', { count: total }))}</strong> ${escapeHtml(t('email.digest.assignedFrom')).replace('{names}', names)}
            </p>`;
}

/**
 * Subject line of the morning digest: the numbers since the last one, most important first
 * @param {Object} summary - see sendDailyDigestEmail
 * @param {string} [lang] - the recipient's language
 * @returns {string}
 */
function dailyDigestSubject(summary, lang = 'en') {
  const t = textsIn(lang);
  const today = [];
  if (summary.dueToday) today.push(t('email.digest.subject.dueToday', { count: summary.dueToday }));
  if (summary.overdue) today.push(t('email.digest.subject.overdue', { count: summary.overdue }));
  const prepCount = Array.isArray(summary.meetingPrep) ? summary.meetingPrep.filter(meeting => (meeting.items || []).length || (meeting.questions || []).length || (meeting.closed || []).length).length : 0;
  if (prepCount) today.push(t('email.digest.subject.prep', { count: prepCount }));
  const since = [];
  if (summary.meetings) since.push(t('capture.meetings', { count: summary.meetings }));
  const decisions = (summary.outcomes && summary.outcomes.decision) || 0;
  if (decisions) since.push(t('outcomeCounts.decision', { count: decisions }));
  if (summary.newActionItems) since.push(t('email.digest.subject.newActionItems', { count: summary.newActionItems }));

  const parts = [];
  if (today.length) parts.push(t('email.digest.subject.yourDay', { items: today.join(', ') }));
  if (since.length) parts.push(t('email.digest.subject.since', { since: summary.since || t('email.digest.yesterday'), items: since.join(', ') }));
  if (!parts.length) return t('email.digest.subject.plan');
  const subject = parts.join(' · ');
  return subject.charAt(0).toUpperCase() + subject.slice(1);
}

/**
 * The morning summary for one person, to plan the day. Like a task list: their own action
 * items due today or overdue, each with a button to open it in Corteza; today's meetings
 * with what is open from each one's history; then counts of what their meetings left.
 * No decisions or transcript text.
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.workspace_name
 * @param {string} params.unsubscribe_url
 * @param {Object} params.summary - { dayLabel, today ('YYYY-MM-DD'), since ('yesterday' or a weekday),
 *   meetings, outcomes: { decision, open_question, risk, … }, newActionItems, dueToday, toReview,
 *   overdue, noDueDate, planItems: [{ item_id, text, due_date, meeting, next_step_on }], assignedBy: [{ name, count }],
 *   meetingPrep: [{ time, title, people, kind, last_met, items: [{ item_id, text, due_date, mine, owner }], suggested, more, questions, closed }]
 *   (core/briefs/meeting-prep: each meeting's open items from its own history, everyone's) }
 * @param {{ voice: string, subject: string, opener: string, followUp: string }|null} [params.partner] - the
 *   morning partner's line (core/digest/voice): it becomes the subject and opens the email, and the counts
 *   move to the preheader. null for Classic
 * @param {string} [params.lang] - the recipient's language ('en' | 'es')
 */
async function sendDailyDigestEmail({ email, workspace_name, summary, unsubscribe_url, partner = null, lang = 'en' }) {
  const result = await sendEmail({
    to: email,
    subject: partner ? partner.subject : dailyDigestSubject(summary, lang),
    html: dailyDigestHtml({ workspace_name, summary, unsubscribe_url, partner, lang }),
    headers: {
      'List-Unsubscribe': `<${unsubscribe_url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    }
  });
  return { success: true, email_id: result.id };
}

/**
 * HTML of the morning summary (see sendDailyDigestEmail). Without a partner it's the Classic email.
 * @param {{ workspace_name: string, summary: Object, unsubscribe_url: string, partner?: { voice: string, opener: string, followUp: string }|null, lang?: string }} params
 * @returns {string}
 */
function dailyDigestHtml({ workspace_name, summary, unsubscribe_url, partner = null, lang = 'en' }) {
  const t = textsIn(lang);
  const appUrl = process.env.BASE_URL || 'https://app.corteza.app';
  // With a partner, links say which voice brought the click (?src=digest&voice=…); Classic links stay as they were
  const link = path => (partner
    ? `${appUrl}${path}${path.includes('?') ? '&' : '?'}src=digest&voice=${encodeURIComponent(partner.voice)}`
    : `${appUrl}${path}`);
  const baseUrl = appUrl;
  const outcomes = summary.outcomes || {};
  const decisions = outcomes.decision || 0;
  const otherOutcomes = describeOutcomes({ ...outcomes, decision: 0 }, lang);
  const shortDate = date => new Date(`${date}T12:00:00Z`).toLocaleDateString(localeOf(lang), { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

  const button = (href, label) => `
              <a href="${link(href)}" style="display: inline-block; white-space: nowrap; padding: 7px 14px; border: 1px solid #c5c6d0; border-radius: 6px; color: #1b1b1d; font-size: 14px; font-weight: 600; text-decoration: none;">${escapeHtml(label)}</a>`;
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
    const when = overdue ? t('email.digest.overdueWas', { date: shortDate(item.due_date) }) : t('due.today');
    return row({
      box: overdue ? '#C62828' : '#171717',
      title: escapeHtml(clip(String(item.text), 160)) + (item.next_step_on
        ? `<div style="font-size: 13px; color: #171717; margin-top: 2px;">${escapeHtml(t('email.digest.nextStepOn', { question: clip(String(item.next_step_on), 120) }))}</div>` : ''),
      meta: `<span style="color: ${overdue ? '#C62828' : '#171717'}; font-weight: 600;">${when}</span>${item.meeting ? ` · ${escapeHtml(clip(String(item.meeting), 60))}` : ''}`
        // The AI may have picked the wrong owner: with a partner pushing, offer the way out (owners change in Corteza)
        + (partner ? ` · <a href="${link(`/actions?item=${encodeURIComponent(item.item_id)}`)}" style="color: #6b6d78;">${escapeHtml(t('email.digest.notMine'))}</a>` : ''),
      href: `/actions?item=${encodeURIComponent(item.item_id)}`,
      label: t('email.digest.open')
    });
  });
  const dueCount = (summary.dueToday || 0) + (summary.overdue || 0);
  const allDue = summary.dueToday && summary.overdue ? '/actions' : `/actions?due=${summary.overdue ? 'overdue' : 'today'}`;
  const more = dueCount > items.length ? `
          <tr><td colspan="3" style="padding: 0 0 14px 26px;">
            <a href="${link(allDue)}" style="color: #171717; font-size: 14px; font-weight: 600; text-decoration: none;">${escapeHtml(t('email.digest.seeAll', { count: dueCount }))}</a>
          </td></tr>` : '';
  const reminders = [
    summary.toReview ? row({ box: '#c5c6d0', title: escapeHtml(t('email.digest.toReview', { count: summary.toReview })), meta: escapeHtml(t('email.digest.toReviewHelp')), href: '/dashboard?review=pending', label: t('common.review') }) : '',
    summary.noDueDate ? row({ box: '#c5c6d0', title: escapeHtml(t('email.digest.noDueDate', { count: summary.noDueDate })), meta: escapeHtml(t('email.digest.noDueDateHelp')), href: '/actions?due=none', label: t('email.digest.setDates') }) : ''
  ].filter(Boolean);

  const divider = '<tr><td colspan="3" style="border-top: 1px solid #ebe7ec; font-size: 0; line-height: 0;">&nbsp;</td></tr>';
  const plateHtml = itemRows.length || reminders.length ? `
        <h2 style="font-size: 16px; font-weight: 700; color: #1b1b1d; margin: 0 0 4px;">${escapeHtml(t('email.digest.plate'))}</h2>
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          ${[itemRows.join(divider) + more, ...reminders].filter(Boolean).join(divider)}
        </table>` : '';

  // Today's meetings, each with what's open from its own history (core/briefs/meeting-prep)
  const prep = Array.isArray(summary.meetingPrep) ? summary.meetingPrep : [];
  const muted = text => `<div style="font-size: 14px; color: #6b6d78; padding: 6px 0; border-top: 1px solid #f1eef2;">${escapeHtml(text)}</div>`;
  const prepItemRow = item => `
          <div style="font-size: 14px; line-height: 1.4; padding: 6px 0; border-top: 1px solid #f1eef2;">
            <a href="${link(`/actions?item=${encodeURIComponent(item.item_id)}`)}" style="color: #1b1b1d; text-decoration: none;">${escapeHtml(clip(String(item.text), 140))}</a>
            <div style="font-size: 12px; color: #6b6d78;">${escapeHtml(item.owner || (item.mine === false ? t('email.digest.noOwner') : t('email.digest.you')))}${!item.due_date ? '' : summary.today && item.due_date < summary.today
              ? ` · <span style="color: #C62828; font-weight: 600;">${escapeHtml(t('email.digest.overdueSince', { date: shortDate(item.due_date) }))}</span>`
              : ` · ${escapeHtml(t('email.digest.dueOn', { date: shortDate(item.due_date) }))}`}</div>
          </div>`;
  const questionRow = question => `
          <div style="font-size: 14px; line-height: 1.4; padding: 6px 0; border-top: 1px solid #f1eef2;">
            <a href="${link('/questions')}" style="color: #1b1b1d; text-decoration: none;">${escapeHtml(clip(String(question.text), 140))}</a>
            <div style="font-size: 12px; color: #6b6d78;">${escapeHtml(t(`types.short.${question.type === 'risk' ? 'risk' : 'open_question'}`))}${question.owner ? ` · ${escapeHtml(question.owner)}` : ''}</div>
          </div>`;
  const closedBlock = closed => !closed || !closed.length ? '' : `
          <div style="font-size: 12px; font-weight: 700; color: #1f7a55; padding: 10px 0 2px; border-top: 1px solid #f1eef2;">${escapeHtml(t('email.digest.closedSince'))}</div>
          ${closed.map(entry => `
          <div style="font-size: 13px; line-height: 1.4; padding: 3px 0; color: #444653;"><span style="color: #1f7a55; font-weight: 700;">✓</span> ${escapeHtml(clip(String(entry.text), 120))}${entry.owner ? ` <span style="color: #6b6d78;">· ${escapeHtml(entry.owner)}</span>` : ''}</div>`).join('')}`;
  const meetingBody = meeting => {
    const items = (meeting.items || []).map(prepItemRow).join('');
    const more = meeting.more ? `<div style="font-size: 13px; color: #6b6d78; padding-top: 6px;">${escapeHtml(t('email.digest.more', { count: meeting.more }))}</div>` : '';
    if (meeting.kind !== 'series') {
      if (!meeting.suggested) return muted(t('email.digest.noHistory'));
      return `${muted(`${t('email.digest.noHistory')} ${t('email.digest.suggested', { name: (meeting.people || [])[0] || '' })}`)}${items}${more}`;
    }
    const questions = (meeting.questions || []).map(questionRow).join('');
    const body = items + more + questions + closedBlock(meeting.closed);
    return body || muted(t('email.digest.nothingOpen'));
  };
  const prepHtml = prep.length ? `
        <h2 style="font-size: 16px; font-weight: 700; color: #1b1b1d; margin: ${plateHtml ? '28px' : '0'} 0 4px;">${escapeHtml(t('email.digest.prep'))}</h2>
        <p style="font-size: 14px; color: #6b6d78; margin: 0 0 8px;">${escapeHtml(t('email.digest.prepHelp'))}</p>
        ${prep.map(meeting => `
        <div style="border: 1px solid #ebe7ec; border-radius: 10px; padding: 14px 16px; margin-top: 10px;">
          <div style="font-size: 15px; font-weight: 700; color: #1b1b1d;">${escapeHtml(meeting.time || '')} · ${escapeHtml(clip(String(meeting.title || t('capture.meeting')), 80))}</div>
          <div style="font-size: 13px; color: #6b6d78; margin: 2px 0 8px;">${escapeHtml(t('email.digest.with', { people: clip((meeting.people || []).join(', '), 120) }))}${meeting.kind === 'series' && meeting.last_met ? ` · ${escapeHtml(t('email.digest.lastMet', { date: shortDate(meeting.last_met) }))}` : ''}</div>
          ${meetingBody(meeting)}
        </div>`).join('')}` : '';

  const tile = (value, label) => `
            <td style="width: 33%; padding: 14px 6px; text-align: center; background: #f6f3f5; border-radius: 10px;">
              <div style="font-size: 26px; font-weight: 800; color: #1b1b1d;">${value}</div>
              <div style="font-size: 13px; color: #6b6d78;">${escapeHtml(label)}</div>
            </td>`;
  const since = escapeHtml(t('email.digest.sinceHeading', { since: summary.since || t('email.digest.yesterday') }));
  // Partner: its line opens the email; the counts (Classic's subject) become the inbox preview text
  const preheader = partner ? `
        <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${escapeHtml(dailyDigestSubject(summary, lang))}</div>` : '';
  const heading = partner
    ? `<h1 style="font-size: 21px; font-weight: 700; margin: 0 0 6px;">${escapeHtml(partner.opener)}</h1>
            <p style="font-size: 16px; color: #1b1b1d; margin: 0 0 8px;">${escapeHtml(partner.followUp)}</p>`
    : `<h1 style="font-size: 21px; font-weight: 700; margin: 0 0 4px;">${escapeHtml(t('email.digest.goodMorning'))}</h1>`;

  return `
      <div style="background: #eef1fb; padding: 32px 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1b1b1d;">${preheader}
        <div style="max-width: 580px; margin: 0 auto; background: #fff; border: 1px solid #E5E7EB; border-top: 6px solid #E85D3A; border-radius: 12px; overflow: hidden;">
          <div style="padding: 20px 28px; border-bottom: 1px solid #ebe7ec;">
            <img src="https://corteza.app/favicon-96x96.png" alt="" width="24" height="24" style="vertical-align: middle; border-radius: 6px; margin-right: 10px;" />
            <span style="font-size: 17px; font-weight: 700; vertical-align: middle;">${escapeHtml(t('settings.summary.title'))}</span>
          </div>
          <div style="padding: 24px 28px 28px;">
            ${heading}
            <p style="font-size: 14px; color: #6b6d78; margin: 0 0 24px;">${escapeHtml(workspace_name)} · ${escapeHtml(summary.dayLabel)}</p>
            ${plateHtml}
            ${prepHtml}
            <h2 style="font-size: 16px; font-weight: 700; margin: 28px 0 12px;">${since}</h2>
            <table role="presentation" style="width: 100%; border-collapse: separate; border-spacing: 6px 0; margin: 0 -6px;">
              <tr>${tile(summary.meetings, t('email.digest.tile.meetings', { count: summary.meetings }))}${tile(decisions, t('email.digest.tile.decisions', { count: decisions }))}${tile(summary.newActionItems, t('email.digest.tile.newActionItems', { count: summary.newActionItems }))}</tr>
            </table>
            ${otherOutcomes ? `<p style="font-size: 14px; color: #6b6d78; margin: 12px 0 0;">${escapeHtml(t('email.digest.alsoCaptured', { outcomes: otherOutcomes }))}</p>` : ''}
            ${assignedByHtml(summary.assignedBy, lang)}
            <a href="${link('/actions')}"
               style="display: inline-block; margin-top: 28px; background: #000000; color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 13px 26px; border-radius: 8px;">
              ${escapeHtml(t('email.digest.planButton'))}
            </a>
          </div>
        </div>
        <p style="max-width: 580px; margin: 20px auto 0; font-size: 12px; color: #8a8c96; text-align: center;">
          ${escapeHtml(t('email.digest.footer.useful'))}
          <a href="${SUPPORT_URL}" style="color: #171717; font-weight: 600; text-decoration: none; white-space: nowrap;"><img src="${baseUrl}/images/bmc-cup.png" alt="" width="10" height="14" style="vertical-align: -2px; margin-right: 4px; border: 0;">${escapeHtml(t('nav.coffee'))}</a>${escapeHtml(t('email.digest.footer.helps'))}<br><br>
          ${escapeHtml(t('email.digest.footer.why', { workspace: workspace_name }))}
          ${escapeHtml(t('email.digest.footer.change'))} <a href="${unsubscribe_url}" style="color: #8a8c96;">${escapeHtml(t('email.digest.footer.unsubscribe'))}</a>.
        </p>
      </div>
    `;
}

module.exports = {
  sendImportSummaryEmail,
  sendBetaWelcomeEmail,
  betaFrom,
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
