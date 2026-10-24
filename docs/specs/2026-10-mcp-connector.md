# Corteza in your AI assistant (MCP connector, v1 read-only)

**Status:** approved and built (Oct 24, 2026). Linear COR-57. Decisions taken with Cristian on Oct 24:
remote server with Google sign-in, v1 read-only, on by default for beta workspaces, build now.

## Why

People already work inside an AI assistant (Claude, ChatGPT, Cursor). Corteza holds what their
meetings decided and left open, but today they have to open Corteza to get it, and the assistant
can't combine it with their email, documents or code.

A Corteza connector makes Corteza **the decision memory your AI uses**:

- "What did we decide about pricing this quarter, and why?"
- "Prepare my 15:00 with Buk: what's still open and who owes what."
- "Draft the follow-up email for Planificación comercial with the action items and owners."
- "What's overdue for me this week?"

The assistant does the reasoning and the writing; Corteza supplies trusted, permission-checked
facts. It's also a distribution channel (Claude's connector directory) and a clear message nobody
else in the category has: note-takers stop at the recap.

## What it is

A **remote MCP server** at `https://app.corteza.app/mcp` (Streamable HTTP transport), built with the
official MCP SDK. In Claude or ChatGPT: *Add connector* → paste the URL → sign in with Google →
allow. No install, no token to copy, works on web, desktop and mobile.

### Sign-in: OAuth with the same Google login

MCP clients authenticate with OAuth 2.1. Corteza acts as the authorization server for its own MCP
endpoint and delegates the login to the existing Google sign-in:

1. The client discovers the endpoints (`/.well-known/oauth-protected-resource`,
   `/.well-known/oauth-authorization-server`) and registers itself (dynamic client registration).
2. The person is sent to `/authorize`, which parks the request and opens Corteza's consent page
   (`/oauth/consent`): if not signed in, the normal Google sign-in first (same `hd` rules, beta gate
   included); then "**Claude** wants to connect to your Corteza. If you allow it, it will be able
   to:" followed by one line per granted scope (today only `read`: see your decisions, open
   questions, risks and action items, only what you see, never sensitive topics). Neutral on
   purpose, so the same page works when write scopes come. Allow / Cancel.
3. The client gets an access token (short-lived) and a refresh token, both tied to that person's
   membership. PKCE is required; redirect URIs must match the registration.

The token acts exactly as that person: it sees what they see in the app (their personal space, the
spaces they belong to, the action items they own), never colleagues' personal spaces. No API keys:
those were removed in September and stay removed.

Tokens are stored hashed. Settings → **Connected assistants** lists each one (client name, connected
on, last used) with **Disconnect**, which revokes it at once.

### Tools (read-only)

All tools reuse the existing services and permission checks; none writes anything.

| Tool | What it returns | Built on |
|---|---|---|
| `search_outcomes(query, type?, limit?)` | The outcomes that match, most relevant first: type, headline, why, owner, due date, status, topic, meeting and date, and a link to open it in Corteza. Sources only: the assistant writes the answer, so this costs us no Claude call (embeddings only). | `hybridSearch` / `keywordSearch` (`services/semantic-search.js`) |
| `get_thread(topic_id)` | One subject end to end: the question, its risks, decisions and next steps, grouped by meeting, with its status line ("open 12 days · next step: …"). | `buildThreadView` (`core/topics/thread-view.js`) |
| `list_action_items(owner?, due?, status?)` | Action items: mine by default, or a person's ("Ana"), filtered by overdue / today / this week / no date. Each with its meeting and the question it's a next step on. | `listActionItems` (`core/actions/action-service.js`) |
| `prepare_meeting(when?)` | Today's (or tomorrow's) meetings with what is open from each one's earlier sessions (meeting prep). Needs the calendar permission; without it, says so. | `buildToday` (`core/home/today.js`) |
| `list_meetings(before?, limit?)` and `get_meeting(id)` | The person's recent meetings with what came out of each one. | `listMeetings`, `meetingOutcomes` (`core/meetings/meetings.js`) |

Results are compact JSON with stable ids and Corteza links, capped in size (for example 20 items per
call, with a "more" cursor), in the outcomes' own language.

### Prompts (shortcuts the assistant shows)

- **Prepare my day:** today's meetings with what's open, plus my overdue items.
- **My week:** what my meetings decided and left open in the last 7 days.
- **What's overdue:** my overdue action items, oldest first, with who's waiting on them.

## Privacy and safety

- **Workspace switch:** Settings → AI assistants: "Allow AI assistants to read Corteza" (admins).
  **On** for workspaces that exist now (the beta). For new workspaces the default comes from
  `MCP_DEFAULT_ENABLED` (default `true` during the beta; we set it to `false` before selling to
  companies). Turning it off revokes every token in the workspace.
- **Sensitive topics never leave.** v1 excludes `sensitive` outcomes and action items from every
  tool, even for the person they belong to. (Opting in per item can come later.)
- **What goes where:** what the person asks their assistant for is sent to that assistant's
  provider under the person's (or their company's) own agreement with it. The privacy policy, the
  `/security` page and the security questionnaire say so, in both languages, in this PR.
- **Prompt injection:** outcome text comes from meetings and could contain instructions. v1 is
  read-only, so the worst case is a misleading answer, not an action. Tool results mark meeting
  content as data.
- **Limits:** 60 tool calls per minute per token, and the existing search limits.
- **Logs and analytics:** PostHog `mcp_tool_called` with the tool name, result count and client name
  only; logs carry ids and counts, never queries or results. Errors go to Sentry, scrubbed.
- **Encryption:** results are decrypted in memory like any page; nothing new is stored except the
  OAuth clients and hashed tokens.

## Data

- `mcp_clients`: registered clients `{ client_id, client_name, redirect_uris, created_at }`.
- `mcp_tokens`: `{ token_hash, kind: 'access'|'refresh', client_id, workspace_id, user_id, scope:
  'read', expires_at, created_at, last_used_at, revoked_at }`.
- `mcp_auth_codes`: one-time codes with PKCE challenge, expiring after 10 minutes.
- `workspaces.ai_assistants_enabled` (boolean).

New code: `src/integrations/mcp/` (server, tools, prompts), `src/auth/oauth-server.js` (the OAuth
endpoints), `src/http/mcp-settings.js` and a Settings section. Dependency:
`@modelcontextprotocol/sdk`.

## Not now (v2 and later)

- **Writes**, each confirmed by the person: mark an action item done, answer a question, record a
  decision and close what it settles (decide-and-close), add an action item.
- Opting a sensitive item in.
- Listing in Claude's connector directory (needs v1 live and stable first; submission is a separate
  task).
- A local `npx` package or personal tokens.

## Tests

- Unit: each tool's output shape and caps; sensitive items never returned; the switch off returns a
  clear error.
- Integration: the OAuth flow (registration, authorize with an existing session, PKCE, code exchange,
  refresh, revoke); a token sees only its person's data (a colleague's personal space and their
  private items never appear); Disconnect and the workspace switch revoke at once.
- End to end: connect the MCP Inspector (and Claude) to a local server with fake data and call every
  tool and prompt.

## Decisions (Oct 24)

1. Consent wording: neutral, one line per scope the assistant gets, no promise about what it can't do
   (writes will come).
2. `search_outcomes` returns sources only; the assistant writes the answer (no Claude call on our side).
3. Connector name "Corteza", description "Your team's decisions, open questions and action items from
   Google Meet".
