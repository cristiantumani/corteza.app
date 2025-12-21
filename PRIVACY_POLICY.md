# Privacy Policy for Corteza.app

**Last Updated:** December 13, 2024

**Effective Date:** December 13, 2024

---

## 1. Introduction

This Privacy Policy describes how Corteza.app ("we," "our," or "the Service") collects, uses, stores, and protects your information when you use our Slack application.

**Your privacy is important to us.** We are committed to protecting your personal data and being transparent about what information we collect and how we use it.

**Contact Information:**
- **Service Provider:** Cristian Tumani
- **Email:** cristiantumani@gmail.com
- **Service Name:** corteza.app

---

## 2. Information We Collect

### 2.1 Information from Slack

When you install and use Corteza.app in your Slack workspace, we automatically collect:

- **Workspace Information:** Workspace ID, workspace name, team domain
- **User Information:** User ID, username, display name, email address (if made available by your workspace settings)
- **Channel Information:** Channel IDs and names where the bot is used
- **Message Content:** Text of decisions you log, meeting transcripts you upload, and any comments or alternatives you provide
- **Interaction Data:** Commands you execute, buttons you click, modals you submit

### 2.2 Information You Provide

You directly provide us with:

- **Decision Content:** The text of decisions you log via Slack commands
- **Meeting Transcripts:** Files you upload for AI-powered decision extraction
- **Jira Integration Data:** Epic keys, ticket information when you connect decisions to Jira
- **Tags and Metadata:** Tags, decision types (product/UX/technical), additional comments
- **Feedback:** Reactions to AI suggestions (approve/reject/edit)

### 2.3 Automatically Collected Information

We automatically collect:

- **Timestamps:** When decisions are created, edited, or deleted
- **Usage Data:** Which features are used, frequency of commands
- **Technical Data:** Request logs, error logs, API response times

### 2.4 Information from Third-Party Services

When you use optional integrations:

- **Jira:** Epic summaries, ticket status, ticket types, Jira issue URLs (only when you provide a Jira epic key)
- **Anthropic Claude API:** We send meeting transcripts to Anthropic's Claude API for AI-powered decision extraction. Anthropic may process this data according to their own privacy policy.

---

## 3. How We Use Your Information

We use the collected information for the following purposes:

### 3.1 Core Service Functionality
- **Store and organize decisions** you log through Slack
- **Process meeting transcripts** with AI to extract decisions
- **Fetch Jira ticket information** when you link decisions to epics
- **Display decisions** in the web dashboard filtered by your workspace
- **Enable search and filtering** of your team's decisions

### 3.2 Service Improvement
- **Improve AI accuracy** by analyzing which suggestions are approved or rejected
- **Debug issues** using error logs and usage patterns
- **Optimize performance** based on usage data

### 3.3 Communication
- **Send notifications** within Slack about decision confirmations, AI suggestions, and errors
- **Respond to support requests** if you contact us

### 3.4 Legal Compliance
- **Comply with legal obligations** under GDPR, CCPA, and other applicable laws
- **Enforce our Terms of Service**
- **Protect our rights** and prevent abuse

---

## 4. Data Storage and Security

### 4.1 Where We Store Data

Your data is stored using the following services:

- **Database:** MongoDB Atlas (cloud-hosted MongoDB)
- **Application Hosting:** Railway (cloud hosting platform)
- **Geography:** Data may be stored in data centers located in the United States and Europe

### 4.2 How We Protect Data

We implement security measures including:

- **Encryption in Transit:** All data transmitted between your browser/Slack and our servers uses TLS 1.2+ encryption
- **Encryption at Rest:** Database stored with encryption enabled
- **Access Controls:** Workspace-based multi-tenancy ensures teams can only access their own data
- **Authentication:** Slack OAuth for user authentication
- **Secure Infrastructure:** Hosted on enterprise-grade cloud platforms (Railway, MongoDB Atlas)
- **Regular Backups:** Automated database backups to prevent data loss

### 4.3 Data Retention

We retain your data as follows:

- **Active Data:** Decisions, transcripts, and suggestions are retained as long as your workspace uses the service
- **Deleted Data:** When you delete a decision, it is permanently removed from our database
- **Workspace Deletion:** If you uninstall the app, you can request complete data deletion (see Section 6)
- **Logs:** Error logs and usage logs are retained for 90 days

**Note:** We plan to implement configurable data retention policies in the future, allowing workspace admins to automatically delete decisions older than a specified period.

---

## 5. Data Sharing and Third Parties

### 5.1 Third-Party Services

We share your data with the following third-party services to provide our functionality:

| Service | Purpose | Data Shared | Privacy Policy |
|---------|---------|-------------|----------------|
| **Slack** | Core platform integration | User IDs, workspace IDs, messages posted by the bot | [Slack Privacy Policy](https://slack.com/privacy-policy) |
| **Anthropic (Claude API)** | AI-powered transcript analysis | Meeting transcript text only (when you upload files) | [Anthropic Privacy Policy](https://www.anthropic.com/privacy) |
| **MongoDB Atlas** | Database storage | All collected data | [MongoDB Privacy Policy](https://www.mongodb.com/legal/privacy-policy) |
| **Railway** | Application hosting | All data processed by the app | [Railway Privacy Policy](https://railway.app/legal/privacy) |
| **Jira (Atlassian)** | Optional integration to fetch ticket data | Epic keys you provide | [Atlassian Privacy Policy](https://www.atlassian.com/legal/privacy-policy) |

### 5.2 We Do NOT Sell Your Data

**We do not sell, rent, or trade your personal information to third parties for marketing purposes.**

### 5.3 Legal Disclosures

We may disclose your information if required by law, such as:

- In response to a valid court order or subpoena
- To comply with legal processes
- To protect the rights, property, or safety of our users or others
- In connection with a business transfer (merger, acquisition, sale of assets)

---

## 6. Your Rights and Choices

Under privacy laws including GDPR (European Union) and CCPA (California), you have the following rights:

### 6.1 Right to Access

You can access your data at any time through:

- **Slack commands:** `/decisions recent`, `/decisions search [keyword]`
- **Web dashboard:** View all decisions at `https://[app-url]/dashboard?workspace_id=[your-workspace-id]`

### 6.2 Right to Data Portability (Export)

You can request a complete export of all your workspace's data in machine-readable format (JSON or CSV).

**How to request:** Email us at [YOUR EMAIL ADDRESS] with your workspace ID

**Response time:** We will provide the export within 30 days

### 6.3 Right to Deletion ("Right to be Forgotten")

You can request deletion of:

- **Individual decisions:** Use the delete button in the dashboard or ask us to delete specific decision IDs
- **All workspace data:** Request complete deletion of all data associated with your workspace

**How to request:** Email us at [YOUR EMAIL ADDRESS] with your workspace ID

**Response time:** We will delete your data within 30 days

**Note:** Some data may be retained in backups for up to 90 days after deletion

### 6.4 Right to Rectification (Correction)

You can edit decisions directly through:

- **Dashboard:** Click "Edit" on any decision
- **Request:** Email us to correct any inaccurate data

### 6.5 Right to Restrict Processing

You can request that we stop processing your data while maintaining storage (e.g., during a dispute).

### 6.6 Right to Object

You can object to processing of your data for specific purposes (e.g., analytics).

### 6.7 Right to Withdraw Consent

You can uninstall the Corteza.app from your Slack workspace at any time, which will stop all data collection.

### 6.8 How to Exercise Your Rights

To exercise any of these rights, contact us at:

- **Email:** [YOUR EMAIL ADDRESS]
- **Subject Line:** "Privacy Request - [Your Workspace ID]"
- **Include:** Your workspace ID (find it using `/decisions workspace` in Slack)

We will respond to your request within 30 days.

---

## 7. International Data Transfers

If you are located outside the United States, please be aware that your data may be transferred to, stored, and processed in the United States and other countries where our service providers operate.

By using Corteza.app, you consent to the transfer of your data to countries that may have different data protection laws than your country of residence.

**For EU Users:** We rely on Standard Contractual Clauses and adequacy decisions to ensure appropriate safeguards for data transfers.

---

## 8. Children's Privacy

Corteza.app is not intended for use by individuals under the age of 16. We do not knowingly collect personal information from children under 16.

If you believe we have collected information from a child under 16, please contact us immediately at [YOUR EMAIL ADDRESS] and we will delete the information.

---

## 9. Cookies and Tracking Technologies

Our web dashboard uses minimal tracking:

- **Session Storage:** To maintain your filter selections (search terms, date ranges) during your browsing session
- **URL Parameters:** Workspace ID is passed as a URL parameter for filtering
- **No Cookies:** We do not currently use cookies for tracking or analytics

**Note:** Slack may use its own cookies and tracking when you interact with the bot through their platform.

---

## 10. AI and Automated Decision-Making

We use Anthropic's Claude AI to analyze meeting transcripts and suggest decisions. This process:

- **Is optional:** You choose whether to upload transcripts
- **Requires review:** AI suggestions are presented to you for approval; they are not automatically saved
- **Learns from feedback:** We may use your approval/rejection patterns to improve AI accuracy
- **No automated decisions:** The AI assists you but does not make decisions without human review

---

## 11. Data Breach Notification

In the event of a data breach that affects your personal information, we will:

1. **Notify affected users** via Slack message or email within 72 hours of discovering the breach
2. **Describe the breach** including what data was compromised
3. **Explain the steps** we are taking to address the breach
4. **Provide recommendations** for protecting your information

We will also notify relevant data protection authorities as required by law.

---

## 12. Changes to This Privacy Policy

We may update this Privacy Policy from time to time to reflect:

- Changes in our practices
- Changes in applicable laws
- New features or functionality

When we make changes:

- We will update the "Last Updated" date at the top
- For material changes, we will notify you via Slack message in your workspace
- Continued use of the service after changes constitutes acceptance of the new policy

You can always find the latest version of this policy at: [URL TO THIS DOCUMENT]

---

## 13. California Privacy Rights (CCPA)

If you are a California resident, you have additional rights under the California Consumer Privacy Act (CCPA):

### Categories of Personal Information Collected

- Identifiers (Slack user ID, email, workspace ID)
- Internet activity (commands, interactions with the bot)
- User-generated content (decision text, transcripts)

### Business Purpose

We use this information solely to provide the Decision Logger service. We do not sell your personal information.

### Your CCPA Rights

- **Right to Know:** Request disclosure of what personal information we collect, use, and share
- **Right to Delete:** Request deletion of your personal information
- **Right to Opt-Out:** Opt-out of the "sale" of personal information (though we do not sell data)
- **Right to Non-Discrimination:** We will not discriminate against you for exercising your CCPA rights

To exercise your CCPA rights, contact us at [YOUR EMAIL ADDRESS].

---

## 14. European Privacy Rights (GDPR)

If you are located in the European Economic Area (EEA), United Kingdom, or Switzerland, you have rights under the General Data Protection Regulation (GDPR):

### Legal Basis for Processing

We process your data based on:

- **Consent:** You install and use the app voluntarily
- **Contract:** To provide the service you requested
- **Legitimate Interest:** To improve the service and prevent abuse

### Your GDPR Rights

All rights listed in Section 6 apply, including:

- Right of access
- Right to rectification
- Right to erasure
- Right to restrict processing
- Right to data portability
- Right to object
- Right to withdraw consent
- Right to lodge a complaint with a supervisory authority

### Data Protection Officer

For GDPR-related inquiries, contact: cristiantumani@gmail.com

---

## 15. Contact Us

If you have any questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us:

**Service Provider:** Cristian Tumani
**Email:** cristiantumani@gmail.com
**Response Time:** We aim to respond within 48 hours for general inquiries and 30 days for formal data requests.

---

## 16. Supervisory Authority

If you are located in the EEA, UK, or Switzerland and believe we have not addressed your concerns, you have the right to lodge a complaint with your local data protection supervisory authority.

---

**By using Corteza.app, you acknowledge that you have read and understood this Privacy Policy and agree to the collection, use, and sharing of your information as described herein.**
