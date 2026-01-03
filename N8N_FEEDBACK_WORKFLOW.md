# n8n Feedback Workflow Setup

This guide explains how to set up the n8n workflow to receive and process feedback from the In-App Feedback Widget.

## Webhook URL

The feedback widget sends data to:
```
https://cristiantumani.app.n8n.cloud/webhook/feedback
```

## Webhook Configuration

1. **Create new workflow** in n8n
2. **Add Webhook node** (trigger)
   - HTTP Method: `POST`
   - Path: `feedback`
   - Authentication: None
   - Response Mode: "Immediately"
   - Response Code: 200
   - Response Body: `{"message": "Feedback received"}`

## Data Structure

The webhook receives the following JSON payload:

```json
{
  "type": "bug|feature|general",
  "feedback": "User's feedback text",
  "email": "user@example.com" (or null),
  "workspace_id": "T01234567",
  "workspace_name": "Company Name",
  "user_name": "John Doe",
  "user_id": "U01234567",
  "timestamp": "2026-01-03T10:30:00.000Z",
  "source": "dashboard"
}
```

## Recommended Workflow

### Node 1: Webhook (Trigger)
- Receives the feedback data as configured above

### Node 2: Code - Parse & Enrich Data (Optional)
Parse and format the data for better readability:

```javascript
const body = $json.body;

// Format type with emoji
const typeEmojis = {
  'bug': '🐛 Bug Report',
  'feature': '✨ Feature Request',
  'general': '💬 General Feedback'
};

return {
  type: typeEmojis[body.type] || body.type,
  feedback: body.feedback,
  email: body.email || 'Not provided',
  workspace: `${body.workspace_name} (${body.workspace_id})`,
  user: `${body.user_name} (${body.user_id})`,
  timestamp: new Date(body.timestamp).toLocaleString(),
  source: body.source
};
```

### Node 3: Choose Storage Option

#### Option A: Send to Notion Database
1. Add **Notion** node
2. Operation: "Create Database Page"
3. Database ID: Your feedback database
4. Map fields:
   - Title → `{{$json.type}}`
   - Feedback → `{{$json.feedback}}`
   - Email → `{{$json.email}}`
   - Workspace → `{{$json.workspace}}`
   - User → `{{$json.user}}`
   - Timestamp → `{{$json.timestamp}}`
   - Source → `{{$json.source}}`

#### Option B: Send to Airtable
1. Add **Airtable** node
2. Operation: "Create"
3. Base ID: Your feedback base
4. Table: "Feedback"
5. Map fields similar to Notion

#### Option C: Send to Google Sheets
1. Add **Google Sheets** node
2. Operation: "Append Row"
3. Document ID: Your feedback spreadsheet
4. Sheet: "Feedback"
5. Map columns

#### Option D: Send Email Notification
1. Add **Gmail** or **Send Email** node
2. To: `cristiantumani@gmail.com`
3. Subject: `New Feedback: {{$json.type}}`
4. Body:
```
New feedback received from Corteza dashboard!

Type: {{$json.type}}
Workspace: {{$json.workspace}}
User: {{$json.user}}
Email: {{$json.email}}
Timestamp: {{$json.timestamp}}

Feedback:
{{$json.feedback}}
```

### Node 4 (Optional): Slack Notification
1. Add **Slack** node
2. Channel: #feedback or your preferred channel
3. Message:
```
🎯 *New Feedback Received*

*Type:* {{$json.type}}
*From:* {{$json.user}} at {{$json.workspace}}
*Email:* {{$json.email}}

*Feedback:*
{{$json.feedback}}

_Submitted: {{$json.timestamp}}_
```

## Testing

### Test from Dashboard
1. Open your dashboard: `https://app.corteza.app/dashboard`
2. Click "💡 Share Idea" button (bottom left)
3. Fill out the form:
   - Select a type
   - Enter feedback text
   - (Optional) Enter email
4. Click "📤 Send Feedback"
5. Check n8n execution history

### Test with curl
```bash
curl -X POST https://cristiantumani.app.n8n.cloud/webhook/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "type": "feature",
    "feedback": "Test feedback from curl",
    "email": "test@example.com",
    "workspace_id": "T12345",
    "workspace_name": "Test Workspace",
    "user_name": "Test User",
    "user_id": "U12345",
    "timestamp": "2026-01-03T10:30:00.000Z",
    "source": "dashboard"
  }'
```

Expected response:
```json
{"message": "Feedback received"}
```

## Recommended Storage: Notion

I recommend using Notion for feedback storage because:
1. **Organized views**: Filter by type (bug/feature/general)
2. **Status tracking**: Add "To Review", "In Progress", "Done" columns
3. **Comments**: Reply directly to users in Notion
4. **Voting**: Add upvotes/priority fields
5. **Linking**: Link feedback to roadmap items
6. **Collaboration**: Share with team members

### Notion Database Template

Create a database with these properties:
- **Title** (Title) - Auto-populated with type emoji
- **Feedback** (Text) - The actual feedback content
- **Type** (Select) - Bug, Feature, General
- **Status** (Select) - To Review, In Progress, Done, Won't Do
- **Email** (Email) - User's email
- **Workspace** (Text) - Workspace name + ID
- **User** (Text) - User name + ID
- **Source** (Text) - Always "dashboard"
- **Priority** (Select) - Low, Medium, High
- **Submitted** (Date) - Timestamp
- **Assignee** (Person) - Team member responsible
- **Notes** (Text) - Internal notes

## Troubleshooting

### Webhook not receiving data
1. Check n8n webhook is active (green dot)
2. Verify URL is exactly: `https://cristiantumani.app.n8n.cloud/webhook/feedback`
3. Check n8n execution history for errors
4. Test with curl command above

### CORS errors in browser
- Should not happen since we're using POST with JSON
- If it does, ensure n8n webhook has CORS enabled (default: enabled)

### Data not appearing in storage
1. Check n8n execution was successful (green checkmark)
2. Verify storage node credentials are valid
3. Check field mappings in storage node

## Future Enhancements

- Auto-assign bugs to engineering team
- Send auto-reply email to user (if email provided)
- Create Jira tickets automatically for bugs
- Track feedback trends over time
- Send weekly digest of all feedback
