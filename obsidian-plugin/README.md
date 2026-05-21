# Corteza for Obsidian

Send decisions and notes from Obsidian to [Corteza](https://corteza.app) — an AI-powered decision tracking system for teams.

## What is Corteza?

Corteza helps teams capture and search organizational decisions. It integrates with Slack, letting you log decisions with `/decision` and search them with `/decisions search ...`. This plugin connects your Obsidian notes to that same knowledge base.

## Features

- **Send entire notes** — AI extracts decisions, explanations, and context automatically
- **Send selections** — Select specific text to send
- **Direct save** — Save selections as specific types (Decision, Explanation, Context) without AI
- **Right-click menu** — Quick access from context menu
- **Command palette** — All commands available via Cmd/Ctrl+P

## Installation

### From Community Plugins (Recommended)

1. Open Obsidian Settings → Community plugins
2. Click "Browse" and search for "Corteza"
3. Install and enable the plugin

### Manual Installation

1. Download the latest release from [GitHub Releases](https://github.com/corteza-app/obsidian-corteza/releases)
2. Extract to: `<your-vault>/.obsidian/plugins/corteza/`
3. Restart Obsidian and enable the plugin

## Setup

1. Sign up at [corteza.app](https://corteza.app) and install the Slack app
2. Go to [corteza.app/settings](https://corteza.app/settings) and generate an API key
3. In Obsidian: Settings → Corteza → paste your API key
4. Click "Test" to verify the connection

## Usage

### Send Entire Note
- Click the **brain icon** in the left ribbon, or
- Command Palette (Cmd/Ctrl+P) → "Send entire note to Corteza"

The AI analyzes your note and extracts any decisions, explanations, or context.

### Send Selection
1. Select text in your note
2. Either:
   - Right-click → "Send to Corteza" (AI extraction)
   - Right-click → "Send as Decision" (direct save)
   - Command Palette → "Send selection to Corteza"

### Direct Save (No AI)
Use these when you know exactly what type of content you're saving:
- Command Palette → "Send selection as Decision"
- Command Palette → "Send selection as Explanation"
- Command Palette → "Send selection as Context"

## Example Workflow

1. Take meeting notes in Obsidian as usual
2. After the meeting, select key decisions
3. Right-click → "Send as Decision"
4. Decisions are now searchable in Slack: `/decisions search auth approach`

## Settings

| Setting | Description |
|---------|-------------|
| API Key | Your Corteza API key (get from corteza.app/settings) |
| Server URL | Corteza server (default: https://corteza.app) |
| Auto-extract | When ON, AI extracts and saves automatically |

## Privacy

- Your notes are sent to Corteza's servers for processing
- AI extraction uses Anthropic's Claude (data retained 30 days per their policy)
- See [Corteza's privacy policy](https://corteza.app/privacy) for details

## Support

- [Report issues](https://github.com/corteza-app/obsidian-corteza/issues)
- [Corteza documentation](https://corteza.app/docs)
- [Join our Slack community](https://corteza.app/community)

## License

MIT
