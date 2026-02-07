# n8n Email Magic Link Setup Guide

This guide shows how to configure the n8n workflow to send magic link emails for Corteza authentication.

## Overview

The hybrid authentication system uses n8n to send magic link emails. When a user enters their email on the login page, Corteza calls an n8n webhook that sends the email via Gmail.

## Workflow Structure

```
Corteza API → n8n Webhook → Gmail → User's Email Inbox → Magic Link → Corteza Session
```

## Step-by-Step Setup

### 1. Open Your n8n Workflow

Your n8n workflow is at: https://cristiantumani.app.n8n.cloud/workflow/DqQjCvT5XH8LBeYN

### 2. Add Webhook Node

**Add a new node:**
1. Click the "+" button
2. Search for "Webhook"
3. Select "Webhook" trigger node
4. Configure:
   - **HTTP Method:** POST
   - **Path:** `corteza-magic-link`
   - **Authentication:** None (or set up header authentication if desired)
   - **Response Mode:** "Respond When Last Node Finishes"

**Get the Webhook URL:**
- Click "Test Workflow" to activate
- Copy the production webhook URL (will look like: `https://cristiantumani.app.n8n.cloud/webhook/corteza-magic-link`)
- Save this URL for later

### 3. Add Gmail Node

**Add Gmail node:**
1. Connect to the Webhook node
2. Search for "Gmail"
3. Select "Gmail" node
4. Configure Gmail credentials (if not already set up):
   - Click "Create New Credential"
   - Follow OAuth2 flow to connect your Gmail account
   - Grant permissions for sending emails

**Configure Email:**
- **Operation:** Send Email
- **To:** `={{ $json.email }}`
- **Subject:** `Your Corteza Login Link 🔐`
- **Email Type:** HTML
- **Message (HTML):**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: #000000; padding: 30px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">
                🧠 Corteza Team Memory
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 20px 0; color: #1d1d1f; font-size: 20px; font-weight: 600;">
                Your Login Link is Ready
              </h2>

              <p style="margin: 0 0 25px 0; color: #666; font-size: 15px; line-height: 1.6;">
                Hi {{ $json.user_name || 'there' }}! Click the button below to access your team memory dashboard.
              </p>

              <!-- Button -->
              <table cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                <tr>
                  <td align="center" style="border-radius: 8px; background-color: #000000;">
                    <a href="{{ $json.magic_link }}"
                       style="display: inline-block; padding: 14px 32px; color: #ffffff; text-decoration: none; font-weight: 500; font-size: 15px;">
                      Log In to Corteza →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Security notice -->
              <div style="margin-top: 30px; padding: 15px; background-color: #f5f5f5; border-radius: 8px; border-left: 3px solid #000000;">
                <p style="margin: 0; color: #666; font-size: 13px; line-height: 1.6;">
                  <strong>⏱️ This link expires in 5 minutes</strong> for security.<br>
                  If you didn't request this, you can safely ignore this email.
                </p>
              </div>

              <!-- Workspace info -->
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e1e4e8;">
                <p style="margin: 0; color: #999; font-size: 12px; line-height: 1.6;">
                  <strong>Workspace:</strong> {{ $json.workspace_name }}<br>
                  <strong>Team Memory ID:</strong> {{ $json.workspace_id }}
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px; background-color: #f9f9f9; text-align: center; border-top: 1px solid #e1e4e8;">
              <p style="margin: 0; color: #999; font-size: 12px;">
                Corteza Team Memory - Your searchable knowledge base powered by AI
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

### 4. Test the Workflow

**Test in n8n:**
1. Click "Execute Workflow" button
2. In the Webhook node, click "Listen for Test Event"
3. Use a tool like Postman or curl to test:

```bash
curl -X POST https://cristiantumani.app.n8n.cloud/webhook/corteza-magic-link \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your-email@gmail.com",
    "user_name": "Test User",
    "workspace_name": "test-workspace",
    "workspace_id": "WTEST",
    "magic_link": "https://app.corteza.app/auth/token?token=test123",
    "expires_in_minutes": 5
  }'
```

4. Check your email inbox - you should receive the magic link email
5. If successful, save and activate the workflow

### 5. Add Webhook URL to Corteza

**Update Railway environment variables:**

1. Go to Railway dashboard: https://railway.app
2. Select your Corteza project
3. Go to Variables tab
4. Add new variable:
   - **Name:** `N8N_WEBHOOK_URL`
   - **Value:** `https://cristiantumani.app.n8n.cloud/webhook/corteza-magic-link`
5. Add optional security variable:
   - **Name:** `N8N_WEBHOOK_SECRET`
   - **Value:** `your-secret-key-here` (generate a random string)
6. Add base URL if not already set:
   - **Name:** `BASE_URL`
   - **Value:** `https://app.corteza.app`
7. Click "Deploy" to restart with new variables

**For local development (.env file):**

```bash
N8N_WEBHOOK_URL=https://cristiantumani.app.n8n.cloud/webhook/corteza-magic-link
N8N_WEBHOOK_SECRET=your-secret-key-here
BASE_URL=http://localhost:3000
```

### 6. Optional: Add Webhook Authentication

If you want to secure the webhook, add authentication:

**In n8n Webhook node:**
1. Set **Authentication:** Header Auth
2. Set **Header Name:** `X-Webhook-Secret`
3. Set **Header Value:** `your-secret-key-here`

**In Corteza .env:**
Add the same secret to `N8N_WEBHOOK_SECRET`

The n8n-client.js will automatically include the secret in the header if it's set.

## Testing End-to-End

### Test 1: Email Magic Link Flow

1. Open https://app.corteza.app/auth/login (or http://localhost:3000/auth/login)
2. Enter your email address
3. Enter a workspace name (e.g., "test-team")
4. Click "Send Magic Link"
5. Check your email inbox
6. Click the magic link in the email
7. Should redirect to dashboard with active session
8. Open browser extension - should show "✓ Logged in"

### Test 2: Rate Limiting

1. Send 3 magic links to the same email
2. Try sending a 4th request immediately
3. Should get error: "Too many requests. Please try again in 15 minutes."

### Test 3: Expired Token

1. Request a magic link
2. Wait 6 minutes
3. Try clicking the link
4. Should show "Invalid or Expired Token" error

## Webhook Payload Reference

Corteza sends this JSON payload to your n8n webhook:

```json
{
  "email": "user@example.com",
  "user_name": "John Doe",
  "workspace_name": "acme-team",
  "workspace_id": "WACME-TEAM",
  "magic_link": "https://app.corteza.app/auth/token?token=abc123def456...",
  "expires_in_minutes": 5
}
```

**Field Descriptions:**
- `email` - User's email address (normalized, lowercase)
- `user_name` - Display name (derived from email if not provided)
- `workspace_name` - Team workspace name (sanitized, lowercase, hyphens)
- `workspace_id` - Generated workspace ID (format: W + uppercase workspace name)
- `magic_link` - Complete login URL with one-time token
- `expires_in_minutes` - Token expiry time (always 5)

## Troubleshooting

### Webhook Not Receiving Requests

**Check:**
1. n8n workflow is activated (not just saved)
2. Webhook URL is correct in Railway environment variables
3. Railway app has restarted after adding variables
4. Check Corteza logs for error messages

**Debug:**
```bash
# Check Railway logs
railway logs

# Should see:
# ✅ Magic link sent to user@example.com for workspace test-team
```

### Emails Not Sending

**Check:**
1. Gmail credentials are properly connected in n8n
2. Gmail node is properly connected to Webhook node
3. Check n8n execution log for errors
4. Verify Gmail hasn't hit daily sending limits (Gmail free: 500/day)

**Test Gmail directly in n8n:**
- Execute workflow manually with test data
- Check execution history for errors

### Magic Links Not Working

**Check:**
1. BASE_URL matches where Corteza is deployed
2. Token hasn't expired (5 minutes)
3. Check browser console for errors
4. Verify session middleware is working

**Debug:**
```bash
# Test /auth/me endpoint
curl https://app.corteza.app/auth/me

# Should return:
# {"authenticated": false, "error": "Not authenticated"}
```

### Rate Limit Not Working

**Symptoms:** Can send unlimited magic links

**Check:**
1. Rate limiter is properly imported in email-auth.js
2. Check server logs - should see rate limit hit messages
3. In-memory rate limiter resets on server restart

## Email Customization

### Change Email Sender Name

In Gmail node, you can set a custom "From Name":
- Click "Add Field"
- Select "From Name"
- Enter: `Corteza Team Memory`

### Add Custom Logo

Replace the 🧠 emoji with an HTML image:
```html
<img src="https://app.corteza.app/logo.png"
     alt="Corteza"
     style="height: 40px;">
```

### Change Email Design

Edit the HTML in the Gmail node's Message field. The current design uses:
- Black header (#000000)
- White content area
- Gray footer (#f9f9f9)
- Responsive table layout (works on mobile)

## Monitoring

### Check n8n Execution History

1. Go to n8n workflow
2. Click "Executions" tab
3. See all webhook calls and email sends
4. Debug failed executions

### Check Corteza Logs

```bash
# Railway
railway logs

# Local
npm start
```

Look for:
- ✅ Magic link sent to {email} for workspace {workspace}
- ❌ Failed to send magic link email: {error}

## Production Checklist

Before going live:
- [ ] n8n workflow is activated
- [ ] Gmail credentials are properly set up
- [ ] N8N_WEBHOOK_URL is set in Railway
- [ ] BASE_URL is set to production URL
- [ ] Tested end-to-end flow
- [ ] Rate limiting works
- [ ] Expired tokens are rejected
- [ ] Email design looks good on mobile
- [ ] Spam folder checked (whitelist sender if needed)

## Next Steps

Once email authentication is working:
1. Test browser extension with email login
2. Update browser extension README
3. Announce to team that non-Slack users can now sign up
4. Monitor n8n execution logs for issues

## Support

If you encounter issues:
1. Check n8n execution logs
2. Check Corteza Railway logs
3. Verify environment variables are set
4. Test webhook URL directly with curl
5. Check Gmail sending limits

---

**Your n8n workflow:** https://cristiantumani.app.n8n.cloud/workflow/DqQjCvT5XH8LBeYN
