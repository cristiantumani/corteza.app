# Corteza Plugin for Obsidian

Send decisions and notes from Obsidian to Corteza for AI-powered knowledge management.

## Features

- **Send entire notes** - AI extracts decisions, explanations, and context automatically
- **Send selections** - Select specific text to send
- **Direct save** - Save selections as specific types (Decision, Explanation, Context) without AI extraction
- **Right-click menu** - Quick access from context menu
- **Command palette** - All commands available via Cmd/Ctrl+P

## Installation

### Manual Installation (Recommended for now)

1. Download the latest release (or build from source)
2. Create folder: `<your-vault>/.obsidian/plugins/corteza/`
3. Copy `main.js`, `manifest.json`, and `styles.css` (if present) into the folder
4. Restart Obsidian
5. Enable the plugin in Settings → Community Plugins

### Build from Source

```bash
cd obsidian-plugin
npm install
npm run build
```

This creates `main.js` which you copy to your vault's plugins folder.

## Setup

1. Open Obsidian Settings → Corteza
2. Enter your **API Key** (generate one from Corteza dashboard → Settings → API Keys)
3. Click "Test" to verify connection
4. Done!

## Usage

### Send Entire Note
- Click the **brain icon** in the left ribbon, or
- Open Command Palette (Cmd/Ctrl+P) → "Send entire note to Corteza"

The AI will analyze your note and extract any decisions, explanations, or context it finds.

### Send Selection
1. Select text in your note
2. Either:
   - Right-click → "Send to Corteza" (AI extracts decisions)
   - Right-click → "Send as Decision" (saves directly as a decision)
   - Command Palette → "Send selection to Corteza"

### Direct Save (No AI)
Use these when you know exactly what type of content you're saving:

- Command Palette → "Send selection as Decision"
- Command Palette → "Send selection as Explanation"
- Command Palette → "Send selection as Context"

## Settings

| Setting | Description |
|---------|-------------|
| API Key | Your Corteza API key |
| Server URL | Corteza server (default: https://corteza.app) |
| Auto-extract | When ON, AI extracts and saves automatically. When OFF, shows extracted decisions for confirmation. |

## Example Workflow

1. Take meeting notes in Obsidian as usual
2. After the meeting, select key decisions and right-click → "Send to Corteza"
3. Or send the entire note and let AI extract decisions automatically
4. Decisions are now searchable in Slack via `/decisions search ...`

## Troubleshooting

**"Please configure your Corteza API key"**
- Go to Settings → Corteza and enter your API key

**"Failed to connect to Corteza"**
- Check your internet connection
- Verify the Server URL is correct
- Try the "Test" button in settings

**"No decisions found in the note"**
- The AI didn't find any clear decisions in the text
- Try selecting specific text and using "Send as Decision"

## Support

- Issues: https://github.com/your-org/corteza/issues
- Documentation: https://corteza.app/docs
