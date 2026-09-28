# Corteza

**Your team's decision log, captured automatically.** Corteza records the decisions your team makes: automatically from Google Meet transcripts and notes, manually from a Chrome extension or the dashboard, and from Slack.

> **Status:** Corteza is being refocused on Google Workspace. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the current system and the phased plan.

## What it does

- **Automatic capture from meetings:** connect Google Meet in Settings and Corteza saves the decisions from your meetings' transcripts and Gemini notes (see [`docs/integrations/google-meet.md`](docs/integrations/google-meet.md)). You can also upload a transcript (`.txt`, `.md`, `.vtt`, `.srt`, `.pdf`, `.docx`) or send one to the API.
- **Manual capture:** the Chrome extension (`Cmd/Ctrl+Shift+M`) and the dashboard's Log Decision form.
- **Slack input:** `/decision` and transcript uploads in Slack.
- **Sign in with Google:** your company's Google Workspace domain is your Corteza workspace, and colleagues join automatically.
- **Organize and find:** spaces (public, shared, private), semantic search, Jira linking, and a weekly digest email.

## Run locally

Requirements: Node.js 20.19+ (see `.nvmrc`) and a MongoDB database (Atlas or local).

```bash
npm install
cp .env.example .env      # fill in MONGODB_URI, SESSION_SECRET, ENCRYPTION_KEY, GOOGLE_CLIENT_ID/SECRET, Slack vars, optional AI keys
npm start                 # http://localhost:3000
```

Semantic search needs an Atlas Vector Search index; see [`docs/setup-vector-search.md`](docs/setup-vector-search.md).

## Development

```bash
npm test                                              # unit tests (integration tests skip without MongoDB)
TEST_MONGODB_URI=mongodb://localhost:27017 npm test   # everything
npm run lint
```

CI runs lint and the full test suite on every pull request.

- **[`CLAUDE.md`](CLAUDE.md):** repo map, conventions and where to change what. Start here, whether you're a person or an AI agent.
- **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md):** how the system works today and where it's going.
- **[`docs/integrations/`](docs/integrations/):** integration guides (e.g. Google Drive via n8n).
- **[`CHANGELOG.md`](CHANGELOG.md)**
- **[`docs/archive/`](docs/archive/):** older docs, kept for history. They may be out of date.

## Chrome extension

The extension lives in [`browser-extension/`](browser-extension/). It uses your Corteza login session. Load it unpacked from `chrome://extensions` for development; see its README for publishing.

## Legal

[Privacy Policy](PRIVACY_POLICY.md) · [Terms of Service](TERMS_OF_SERVICE.md) · MIT License
