# Corteza Coda Pack

This is the official Coda Pack integration for Corteza, allowing you to sync decisions from your Corteza workspace into Coda docs.

## Features

- **Decisions Sync Table**: Live table that syncs all your decisions with filtering options
- **Search Formula**: AI-powered semantic search across decisions
- **GetDecision Formula**: Fetch a single decision by ID

## Setup for Development

### Prerequisites

1. Install Node.js (v18 or later)
2. Install Coda Pack CLI globally:
   ```bash
   npm install -g @codahq/packs-sdk
   ```
3. Authenticate with Coda:
   ```bash
   coda register
   ```

### Installation

1. Navigate to the coda-pack directory:
   ```bash
   cd coda-pack
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Validate the pack:
   ```bash
   npm run validate
   ```

4. Build and test locally:
   ```bash
   npm run build
   ```

## Authentication

Users need to generate an API key from their Corteza dashboard:

1. Log in to https://app.corteza.app/dashboard
2. Navigate to Settings → API Keys
3. Click "Generate New API Key"
4. Copy the key (you won't be able to see it again!)
5. In Coda, when prompted, paste the API key

## Usage in Coda

### Decisions Sync Table

Add a new table and select "Corteza → Decisions":

```
= Decisions()
= Decisions("architecture")  // Filter by type
= Decisions("", "Frontend")  // Filter by category
= Decisions("", "", "auth")  // Search for "auth"
```

### Search Formula

Use natural language to search decisions:

```
= Search("How does authentication work?")
= Search("decisions about frontend", 5)  // Limit to 5 results
```

### GetDecision Formula

Fetch a specific decision:

```
= GetDecision(123)
```

## Deployment

1. Register the pack (first time only):
   ```bash
   npm run register
   ```

2. Create a new release:
   ```bash
   npm run release
   ```

3. Submit for review in Coda Pack Studio

## API Endpoints Used

- `GET /api/decisions` - Fetch decisions (for sync table)
- `POST /api/semantic-search` - AI search (for Search formula)
- `GET /api/v1/decisions/:id` - Get single decision (for GetDecision formula)

## Schema

The Decision object includes:

- **id**: Unique decision ID
- **text**: Decision description
- **type**: Decision type (architecture, process, product, strategic, technical, other)
- **category**: Decision category
- **timestamp**: When the decision was made
- **user_name**: Person who logged the decision
- **tags**: Comma-separated tags
- **epic_key**: Related Jira epic key
- **additionalContext**: Additional context or alternatives considered
- **notionUrl**: Link to Notion page
- **jiraUrl**: Link to Jira epic

## Troubleshooting

### "Invalid API key" error

- Make sure you copied the full API key including the `corteza_` prefix
- Check that the key hasn't been revoked in the dashboard
- Verify the key hasn't expired

### "Decision not found" error

- The decision ID might not exist
- You might not have access to that workspace

### Sync table not updating

- Click the "Sync now" button in Coda
- Check your API key is still valid
- Verify your internet connection

## Support

For issues or questions:
- Email: cristiantumani@gmail.com
- Website: https://corteza.app
- Documentation: https://corteza.app/docs
