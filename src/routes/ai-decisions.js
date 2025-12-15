const {
  getAISuggestionsCollection,
  getMeetingTranscriptsCollection,
  getAIFeedbackCollection,
  getDecisionsCollection
} = require('../config/database');
const { extractDecisionsFromTranscript, isClaudeConfigured } = require('../services/claude');
const { fetchJiraIssue, addJiraComment } = require('../services/jira');
const { extractTextFromFile } = require('../utils/text-extractors');
const {
  validateUploadedFile,
  validateTranscriptContent
} = require('../middleware/ai-validation');

/**
 * Handles file upload events from Slack
 * Posts an ephemeral message asking if user wants to extract decisions
 */
async function handleFileUpload({ event, client, say, context }) {
  try {
    // Extract workspace_id from context (Slack Bolt provides team_id in context)
    const workspace_id = context.teamId;
    console.log('📎 File upload detected:', event.file_id, 'Workspace:', workspace_id);

    // Check if Claude is configured
    if (!isClaudeConfigured()) {
      console.log('⚠️  Claude not configured, skipping file upload prompt');
      return; // Silently ignore if AI not configured
    }

    // Get file info from Slack
    const fileInfo = await client.files.info({ file: event.file_id });
    const file = fileInfo.file;

    // Validate file type and size
    const validation = validateUploadedFile(file);
    if (!validation.valid) {
      // Silently skip if not a supported file type (user probably just sharing a file)
      console.log(`⏭️  Skipping file "${file.name}": ${validation.error}`);
      return;
    }

    // Post ephemeral message asking if user wants to extract decisions
    await client.chat.postEphemeral({
      channel: event.channel_id,
      user: event.user_id,
      text: `📄 I detected "${file.name}". Would you like me to extract decisions?`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `📄 *${file.name}* uploaded\n\nI can analyze this ${file.filetype.toUpperCase()} file for decisions.`
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '🔍 Extract Decisions' },
              action_id: 'extract_decisions_from_file',
              style: 'primary',
              value: JSON.stringify({
                file_id: file.id,
                file_name: file.name,
                workspace_id: workspace_id
              })
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Ignore' },
              action_id: 'ignore_file_upload'
            }
          ]
        }
      ]
    });

    console.log(`✅ Posted extraction prompt for file "${file.name}" to user ${event.user_id}`);

  } catch (error) {
    console.error('❌ Error handling file upload:', error);
    // Don't post error to channel - file uploads happen frequently
  }
}

/**
 * Handles the "Extract Decisions" button click
 * Processes the file and extracts decisions
 */
async function handleExtractDecisionsButton({ ack, body, client, say }) {
  try {
    await ack(); // Acknowledge button click

    // Parse the value from the button
    const buttonValue = JSON.parse(body.actions[0].value);
    const { file_id, file_name, workspace_id } = buttonValue;
    const user_id = body.user.id;
    const channel_id = body.channel.id;

    console.log(`🔍 User ${user_id} requested extraction for file: ${file_name}`);

    // Post processing message
    await say(`🤖 Analyzing "${file_name}" with AI... This may take a moment.`);

    // Get file details from Slack
    const fileInfo = await client.files.info({ file: file_id });
    const file = fileInfo.file;

    // Fetch file content
    const fileContent = await fetchSlackFileContent(file_id, client);
    if (!fileContent.success) {
      await say(`❌ ${fileContent.error}`);
      return;
    }

    // Extract text from file based on type
    const extraction = await extractTextFromFile(
      fileContent.buffer,
      file.name,
      file.mimetype
    );

    if (!extraction.success) {
      await say(`❌ ${extraction.error}`);
      return;
    }

    // Validate extracted content
    const contentValidation = validateTranscriptContent(extraction.text);
    if (!contentValidation.valid) {
      await say(`❌ ${contentValidation.error}`);
      return;
    }

    // Get user info
    const userInfo = await client.users.info({ user: user_id });
    const userName = userInfo.user.real_name || userInfo.user.name;

    // Process the transcript
    const result = await processTranscript(extraction.text, {
      workspace_id: workspace_id,
      file_name: file.name,
      file_type: file.filetype,
      file_size: file.size,
      slack_file_id: file.id,
      user_id: user_id,
      user_name: userName,
      channel_id: channel_id
    });

    if (!result.success) {
      await say(`❌ ${result.error}`);
      return;
    }

    // Post suggestions to Slack
    if (result.suggestions.length === 0) {
      await say('🤔 AI didn\'t find any clear decisions in this transcript. The file has been saved for future reference.');
    } else {
      await postSuggestionsToSlack(client, result.suggestions, channel_id);
    }

  } catch (error) {
    console.error('❌ Error processing file extraction:', error);
    await say('⚠️  An error occurred while processing your file. Please try again.');
  }
}

/**
 * Handles the "Ignore" button click
 * Simply acknowledges and dismisses the message
 */
async function handleIgnoreFileButton({ ack }) {
  try {
    await ack(); // Just acknowledge - message will disappear
    console.log('✅ User chose to ignore file upload');
  } catch (error) {
    console.error('❌ Error handling ignore button:', error);
  }
}

/**
 * Fetches file content from Slack as a Buffer
 * @param {string} fileId - Slack file ID
 * @param {Object} client - Slack Web API client
 * @returns {Promise<Object>} { success: boolean, buffer: Buffer, error: string }
 */
async function fetchSlackFileContent(fileId, client) {
  try {
    const response = await fetch(
      `https://slack.com/api/files.info?file=${fileId}`,
      {
        headers: {
          'Authorization': `Bearer ${client.token}`
        }
      }
    );

    const data = await response.json();
    if (!data.ok) {
      return {
        success: false,
        buffer: null,
        error: `Failed to get file info: ${data.error}`
      };
    }

    const fileUrl = data.file.url_private_download;

    // Download file content
    const fileResponse = await fetch(fileUrl, {
      headers: {
        'Authorization': `Bearer ${client.token}`
      }
    });

    if (!fileResponse.ok) {
      return {
        success: false,
        buffer: null,
        error: 'Failed to download file content'
      };
    }

    const arrayBuffer = await fileResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return {
      success: true,
      buffer: buffer,
      error: null
    };
  } catch (error) {
    return {
      success: false,
      buffer: null,
      error: `Error fetching file: ${error.message}`
    };
  }
}

/**
 * Processes transcript: saves to DB, calls Claude, saves suggestions
 * @param {string} transcriptContent - The extracted text
 * @param {Object} metadata - File and user metadata
 * @returns {Promise<Object>} { success: boolean, suggestions: Array, error: string }
 */
async function processTranscript(transcriptContent, metadata) {
  try {
    const transcriptsCollection = getMeetingTranscriptsCollection();
    const suggestionsCollection = getAISuggestionsCollection();

    // Save transcript to database
    const transcriptId = `transcript_${Date.now()}`;
    const wordCount = transcriptContent.split(/\s+/).filter(w => w.length > 0).length;

    const transcript = {
      workspace_id: metadata.workspace_id,
      transcript_id: transcriptId,
      file_name: metadata.file_name,
      file_type: metadata.file_type,
      file_size: metadata.file_size,
      slack_file_id: metadata.slack_file_id,
      content: transcriptContent,
      content_preview: transcriptContent.substring(0, 500),
      word_count: wordCount,
      uploaded_by: metadata.user_id,
      uploaded_by_name: metadata.user_name,
      channel_id: metadata.channel_id,
      uploaded_at: new Date().toISOString(),
      processed_at: null,
      ai_model: null,
      decisions_found: 0,
      processing_time_ms: 0,
      meeting_metadata: null
    };

    const insertResult = await transcriptsCollection.insertOne(transcript);
    console.log(`✅ Saved transcript: ${transcriptId}`);

    // Call Claude API to extract decisions
    const aiResult = await extractDecisionsFromTranscript(transcriptContent);

    // Update transcript with processing results
    await transcriptsCollection.updateOne(
      { _id: insertResult.insertedId },
      {
        $set: {
          processed_at: new Date().toISOString(),
          ai_model: aiResult.model,
          decisions_found: aiResult.decisions.length,
          processing_time_ms: aiResult.processingTime
        }
      }
    );

    if (aiResult.decisions.length === 0) {
      return {
        success: true,
        suggestions: [],
        error: null
      };
    }

    // Save suggestions to database
    const suggestions = aiResult.decisions.map((decision, index) => ({
      workspace_id: metadata.workspace_id,
      suggestion_id: `ai_sugg_${Date.now()}_${index}`,
      meeting_transcript_id: transcriptId,
      status: 'pending',
      decision_text: decision.decision_text,
      decision_type: decision.decision_type,
      epic_key: decision.epic_key || null,
      tags: decision.tags || [],
      confidence_score: decision.confidence,
      context: decision.context || '',
      created_at: new Date().toISOString(),
      user_id: metadata.user_id,
      channel_id: metadata.channel_id,
      reviewed_at: null,
      reviewer_id: null,
      edits: null,
      final_decision_id: null
    }));

    await suggestionsCollection.insertMany(suggestions);
    console.log(`✅ Saved ${suggestions.length} AI suggestions`);

    return {
      success: true,
      suggestions: suggestions,
      error: null
    };
  } catch (error) {
    console.error('❌ Error processing transcript:', error);
    return {
      success: false,
      suggestions: [],
      error: `Processing failed: ${error.message}`
    };
  }
}

/**
 * Posts AI suggestions to Slack with interactive buttons
 * @param {Object} client - Slack Web API client
 * @param {Array} suggestions - Array of AI suggestion objects
 * @param {string} channelId - Slack channel ID
 */
async function postSuggestionsToSlack(client, suggestions, channelId) {
  const typeEmoji = { product: '📦', ux: '🎨', technical: '⚙️' };

  // Build message blocks
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🤖 *AI found ${suggestions.length} decision${suggestions.length > 1 ? 's' : ''} in the transcript*\n\nReview each suggestion below:`
      }
    },
    { type: 'divider' }
  ];

  suggestions.forEach((suggestion, index) => {
    const confidence = suggestion.confidence_score;
    const confidenceEmoji = confidence >= 0.8 ? '🟢' : confidence >= 0.6 ? '🟡' : '🔴';
    const confidencePercent = Math.round(confidence * 100);

    let decisionBlock = `*Decision ${index + 1}* ${confidenceEmoji} (${confidencePercent}% confidence)\n\n`;
    decisionBlock += `${typeEmoji[suggestion.decision_type]} *Type:* ${suggestion.decision_type}\n`;
    decisionBlock += `*Decision:* ${suggestion.decision_text}\n`;

    if (suggestion.epic_key) {
      decisionBlock += `*Epic:* ${suggestion.epic_key}\n`;
    }

    if (suggestion.tags.length > 0) {
      decisionBlock += `*Tags:* ${suggestion.tags.map(t => `\`${t}\``).join(', ')}\n`;
    }

    if (suggestion.context) {
      const contextPreview = suggestion.context.length > 150
        ? suggestion.context.substring(0, 150) + '...'
        : suggestion.context;
      decisionBlock += `\n_Context:_ "${contextPreview}"`;
    }

    blocks.push(
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: decisionBlock
        }
      },
      {
        type: 'actions',
        block_id: `actions_${suggestion.suggestion_id}`,
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Approve' },
            style: 'primary',
            value: suggestion.suggestion_id,
            action_id: 'approve_suggestion'
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '✏️ Edit & Approve' },
            value: suggestion.suggestion_id,
            action_id: 'edit_suggestion'
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '🔗 Connect to Jira' },
            value: suggestion.suggestion_id,
            action_id: 'connect_jira_suggestion'
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❌ Reject' },
            style: 'danger',
            value: suggestion.suggestion_id,
            action_id: 'reject_suggestion'
          }
        ]
      },
      { type: 'divider' }
    );
  });

  await client.chat.postMessage({
    channel: channelId,
    blocks,
    text: `AI found ${suggestions.length} decisions`
  });
}

/**
 * Handles approve button click
 */
async function handleApproveAction({ ack, body, client }) {
  await ack();

  try {
    const workspace_id = body.team.id;
    const suggestionId = body.actions[0].value;

    // Fetch suggestion from DB
    const suggestionsCollection = getAISuggestionsCollection();
    const suggestion = await suggestionsCollection.findOne({
      workspace_id: workspace_id,
      suggestion_id: suggestionId
    });

    if (!suggestion) {
      await client.chat.postEphemeral({
        channel: body.channel.id,
        user: body.user.id,
        text: '⚠️  Suggestion not found.'
      });
      return;
    }

    if (suggestion.status !== 'pending') {
      await client.chat.postEphemeral({
        channel: body.channel.id,
        user: body.user.id,
        text: '⚠️  This suggestion has already been processed.'
      });
      return;
    }

    // Get user info
    const userInfo = await client.users.info({ user: body.user.id });
    const userName = userInfo.user.real_name || userInfo.user.name;

    // Fetch meeting transcript to get meeting title
    const transcriptsCollection = getMeetingTranscriptsCollection();
    const transcript = await transcriptsCollection.findOne({
      workspace_id: workspace_id,
      transcript_id: suggestion.meeting_transcript_id
    });
    const meetingTitle = transcript ? transcript.file_name : 'Unknown meeting';

    // Fetch Jira data if epic_key present
    let jiraData = null;
    if (suggestion.epic_key) {
      jiraData = await fetchJiraIssue(suggestion.epic_key);
    }

    // Create decision in decisions collection (scoped by workspace)
    const decisionsCollection = getDecisionsCollection();
    const lastDecision = await decisionsCollection.findOne(
      { workspace_id: workspace_id },
      { sort: { id: -1 } }
    );
    const nextId = lastDecision ? lastDecision.id + 1 : 1;

    const decision = {
      workspace_id: workspace_id,
      id: nextId,
      text: suggestion.decision_text,
      type: suggestion.decision_type,
      epic_key: suggestion.epic_key,
      jira_data: jiraData,
      tags: suggestion.tags,
      alternatives: `This decision was taken during "${meetingTitle}"\n\nAI-extracted with ${Math.round(suggestion.confidence_score * 100)}% confidence`,
      creator: userName,
      user_id: body.user.id,
      channel_id: body.channel.id,
      timestamp: new Date().toISOString()
    };

    await decisionsCollection.insertOne(decision);

    // Update suggestion status
    await suggestionsCollection.updateOne(
      { workspace_id: workspace_id, suggestion_id: suggestionId },
      {
        $set: {
          status: 'approved',
          reviewed_at: new Date().toISOString(),
          reviewer_id: body.user.id,
          final_decision_id: nextId
        }
      }
    );

    // Save feedback
    await saveFeedback(suggestion, 'approved', null, body.user.id, workspace_id);

    // Update the message to show approved
    await updateMessageButtons(client, body, `✅ Approved by ${userName} - Saved as Decision #${nextId}`);

    // Post confirmation
    await client.chat.postMessage({
      channel: body.channel.id,
      text: `✅ Decision #${nextId} approved and saved by ${userName}`
    });

  } catch (error) {
    console.error('❌ Error approving suggestion:', error);
    await client.chat.postEphemeral({
      channel: body.channel.id,
      user: body.user.id,
      text: '⚠️  An error occurred while approving. Please try again.'
    });
  }
}

/**
 * Handles reject button click
 */
async function handleRejectAction({ ack, body, client }) {
  await ack();

  try {
    const workspace_id = body.team.id;
    const suggestionId = body.actions[0].value;

    // Fetch suggestion
    const suggestionsCollection = getAISuggestionsCollection();
    const suggestion = await suggestionsCollection.findOne({ workspace_id: workspace_id, suggestion_id: suggestionId });

    if (!suggestion || suggestion.status !== 'pending') {
      await client.chat.postEphemeral({
        channel: body.channel.id,
        user: body.user.id,
        text: '⚠️  This suggestion has already been processed.'
      });
      return;
    }

    // Get user info
    const userInfo = await client.users.info({ user: body.user.id });
    const userName = userInfo.user.real_name || userInfo.user.name;

    // Update status
    await suggestionsCollection.updateOne(
      { workspace_id: workspace_id, suggestion_id: suggestionId },
      {
        $set: {
          status: 'rejected',
          reviewed_at: new Date().toISOString(),
          reviewer_id: body.user.id
        }
      }
    );

    // Save feedback
    await saveFeedback(suggestion, 'rejected', null, body.user.id);

    // Update the message
    await updateMessageButtons(client, body, `❌ Rejected by ${userName}`);

    // Ephemeral confirmation
    await client.chat.postEphemeral({
      channel: body.channel.id,
      user: body.user.id,
      text: '✅ Suggestion rejected and feedback saved for AI learning.'
    });

  } catch (error) {
    console.error('❌ Error rejecting suggestion:', error);
    await client.chat.postEphemeral({
      channel: body.channel.id,
      user: body.user.id,
      text: '⚠️  An error occurred. Please try again.'
    });
  }
}

/**
 * Handles edit button click - opens modal
 */
async function handleEditAction({ ack, body, client }) {
  await ack();

  try {
    const workspace_id = body.team.id;
    const suggestionId = body.actions[0].value;

    // Fetch suggestion
    const suggestionsCollection = getAISuggestionsCollection();
    const suggestion = await suggestionsCollection.findOne({ workspace_id: workspace_id, suggestion_id: suggestionId });

    if (!suggestion || suggestion.status !== 'pending') {
      await client.chat.postEphemeral({
        channel: body.channel.id,
        user: body.user.id,
        text: '⚠️  This suggestion has already been processed.'
      });
      return;
    }

    // Open modal with pre-filled values
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'edit_suggestion_modal',
        private_metadata: JSON.stringify({
          suggestion_id: suggestionId,
          channel_id: body.channel.id,
          message_ts: body.message.ts,
          user_id: body.user.id
        }),
        title: { type: 'plain_text', text: '✏️ Edit Decision' },
        submit: { type: 'plain_text', text: 'Approve' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'input',
            block_id: 'decision_text_block',
            element: {
              type: 'plain_text_input',
              action_id: 'decision_text_input',
              initial_value: suggestion.decision_text,
              multiline: true
            },
            label: { type: 'plain_text', text: 'Decision Text' }
          },
          {
            type: 'input',
            block_id: 'type_block',
            element: {
              type: 'static_select',
              action_id: 'type_select',
              initial_option: {
                text: { type: 'plain_text', text: suggestion.decision_type },
                value: suggestion.decision_type
              },
              options: [
                { text: { type: 'plain_text', text: 'product' }, value: 'product' },
                { text: { type: 'plain_text', text: 'ux' }, value: 'ux' },
                { text: { type: 'plain_text', text: 'technical' }, value: 'technical' }
              ]
            },
            label: { type: 'plain_text', text: 'Decision Type' }
          },
          {
            type: 'input',
            block_id: 'epic_block',
            optional: true,
            element: {
              type: 'plain_text_input',
              action_id: 'epic_input',
              initial_value: suggestion.epic_key || ''
            },
            label: { type: 'plain_text', text: 'Epic Key (optional)' }
          },
          {
            type: 'input',
            block_id: 'tags_block',
            optional: true,
            element: {
              type: 'plain_text_input',
              action_id: 'tags_input',
              initial_value: suggestion.tags.join(', ')
            },
            label: { type: 'plain_text', text: 'Tags (comma-separated, optional)' }
          },
          {
            type: 'input',
            block_id: 'alternatives_block',
            optional: true,
            element: {
              type: 'plain_text_input',
              action_id: 'alternatives_input',
              multiline: true
            },
            label: { type: 'plain_text', text: 'Additional Comments (optional)' }
          },
          {
            type: 'input',
            block_id: 'jira_comment_block',
            optional: true,
            element: {
              type: 'checkboxes',
              action_id: 'jira_comment_checkbox',
              options: [{
                text: { type: 'plain_text', text: 'Add this decision as a comment in Jira' },
                value: 'yes'
              }]
            },
            label: { type: 'plain_text', text: 'Jira Integration' }
          }
        ]
      }
    });

  } catch (error) {
    console.error('❌ Error opening edit modal:', error);
  }
}

/**
 * Handles edit modal submission
 */
async function handleEditModalSubmit({ ack, view, body, client }) {
  await ack();

  try {
    console.log('>>> Edit modal submit started');
    const metadata = JSON.parse(view.private_metadata);
    const values = view.state.values;
    console.log('>>> Metadata:', metadata);

    const editedData = {
      decision_text: values.decision_text_block.decision_text_input.value,
      decision_type: values.type_block.type_select.selected_option.value,
      epic_key: values.epic_block.epic_input.value || null,
      tags: (values.tags_block.tags_input.value || '')
        .split(',')
        .map(t => t.trim())
        .filter(t => t),
      alternatives: values.alternatives_block.alternatives_input.value || null
    };
    console.log('>>> Edited data:', editedData);

    // Check if user wants to add Jira comment
    const addComment = (values.jira_comment_block.jira_comment_checkbox.selected_options || []).length > 0;
    console.log('>>> Add Jira comment:', addComment);

    // Fetch original suggestion
    const suggestionsCollection = getAISuggestionsCollection();
    const suggestion = await suggestionsCollection.findOne({
      suggestion_id: metadata.suggestion_id
    });
    console.log('>>> Suggestion found:', !!suggestion);

    if (!suggestion || suggestion.status !== 'pending') {
      console.log('>>> Suggestion not found or already processed');
      await client.chat.postEphemeral({
        channel: metadata.channel_id,
        user: metadata.user_id,
        text: '⚠️  This suggestion has already been processed or not found.'
      });
      return;
    }

    // Get user info
    const userInfo = await client.users.info({ user: metadata.user_id });
    const userName = userInfo.user.real_name || userInfo.user.name;
    console.log('>>> User:', userName);

    // Fetch meeting transcript to get meeting title
    const transcriptsCollection = getMeetingTranscriptsCollection();
    const transcript = await transcriptsCollection.findOne({
      transcript_id: suggestion.meeting_transcript_id
    });
    const meetingTitle = transcript ? transcript.file_name : 'Unknown meeting';
    console.log('>>> Meeting title:', meetingTitle);

    // Fetch Jira data if epic_key present
    let jiraData = null;
    if (editedData.epic_key) {
      console.log('>>> Fetching Jira data for:', editedData.epic_key);
      jiraData = await fetchJiraIssue(editedData.epic_key);
      console.log('>>> Jira data fetched:', !!jiraData);
    }

    // Create decision
    const decisionsCollection = getDecisionsCollection();
    const lastDecision = await decisionsCollection.findOne({ workspace_id: workspace_id }, { sort: { id: -1 } });
    const nextId = lastDecision ? lastDecision.id + 1 : 1;
    console.log('>>> Next decision ID:', nextId);

    // Build alternatives field
    let alternativesText = `This decision was taken during "${meetingTitle}"\n\n`;
    if (editedData.alternatives) {
      alternativesText += `${editedData.alternatives}\n\n`;
    }
    alternativesText += `AI-extracted and edited by ${userName}`;

    const decision = {
      workspace_id: workspace_id,
      id: nextId,
      text: editedData.decision_text,
      type: editedData.decision_type,
      epic_key: editedData.epic_key,
      jira_data: jiraData,
      tags: editedData.tags,
      alternatives: alternativesText,
      creator: userName,
      user_id: metadata.user_id,
      channel_id: metadata.channel_id,
      timestamp: new Date().toISOString()
    };

    console.log('>>> Inserting decision...');
    await decisionsCollection.insertOne(decision);
    console.log('✅ Decision inserted:', nextId);

    // Add Jira comment if requested
    if (addComment && editedData.epic_key && jiraData) {
      console.log('>>> Adding Jira comment...');
      const comment = `📝 Decision #${decision.id} logged by ${userName}\n\nType: ${editedData.decision_type}\nDecision: ${decision.text}\n\n${decision.alternatives}\n\nLogged via Decision Logger`;
      if (await addJiraComment(editedData.epic_key, comment)) {
        console.log(`✅ Jira comment added to ${editedData.epic_key}`);
      }
    }

    // Update suggestion
    console.log('>>> Updating suggestion status...');
    await suggestionsCollection.updateOne(
      { suggestion_id: metadata.suggestion_id },
      {
        $set: {
          status: 'edited_approved',
          reviewed_at: new Date().toISOString(),
          reviewer_id: metadata.user_id,
          edits: editedData,
          final_decision_id: nextId
        }
      }
    );
    console.log('✅ Suggestion updated');

    // Save feedback with edits
    console.log('>>> Saving feedback...');
    await saveFeedback(suggestion, 'edited_approved', editedData, metadata.user_id);
    console.log('✅ Feedback saved');

    // Update the original message to remove buttons
    console.log('>>> Updating original message...');
    await updateMessageFromModal(
      client,
      metadata.channel_id,
      metadata.message_ts,
      metadata.suggestion_id,
      `✅ Edited and approved by ${userName} - Saved as Decision #${nextId}`
    );
    console.log('✅ Message updated');

    // Post confirmation
    console.log('>>> Posting confirmation message...');
    await client.chat.postMessage({
      channel: metadata.channel_id,
      text: `✅ Decision #${nextId} edited and approved by ${userName}${addComment && editedData.epic_key ? ' (Jira comment added)' : ''}`
    });
    console.log('✅ Edit modal submit completed successfully');

  } catch (error) {
    console.error('❌ Error in edit modal submit:', error);
    console.error('Error stack:', error.stack);

    // Try to notify user
    try {
      const metadata = JSON.parse(view.private_metadata);
      await client.chat.postEphemeral({
        channel: metadata.channel_id,
        user: metadata.user_id,
        text: `❌ Error approving decision: ${error.message}`
      });
    } catch (notifyError) {
      console.error('❌ Could not notify user of error:', notifyError);
    }
  }
}

/**
 * Saves feedback to ai_feedback collection
 */
async function saveFeedback(suggestion, action, finalVersion, userId, workspace_id) {
  try {
    const feedbackCollection = getAIFeedbackCollection();

    const feedback = {
      workspace_id: workspace_id,
      feedback_id: `feedback_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      suggestion_id: suggestion.suggestion_id,
      transcript_id: suggestion.meeting_transcript_id.toString(),
      action: action,
      original_suggestion: {
        decision_text: suggestion.decision_text,
        decision_type: suggestion.decision_type,
        epic_key: suggestion.epic_key,
        tags: suggestion.tags,
        confidence_score: suggestion.confidence_score
      },
      final_version: finalVersion,
      transcript_context: suggestion.context,
      created_at: new Date().toISOString(),
      user_id: userId
    };

    await feedbackCollection.insertOne(feedback);
    console.log(`✅ Feedback saved: ${action}`);
  } catch (error) {
    console.error('❌ Error saving feedback:', error);
  }
}

/**
 * Updates message to remove buttons and show status
 */
async function updateMessageButtons(client, body, statusText) {
  try {
    // Find the action block and replace with text
    const originalBlocks = body.message.blocks;
    const actionBlockId = body.actions[0].block_id;

    const updatedBlocks = originalBlocks.map(block => {
      if (block.block_id === actionBlockId) {
        return {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `_${statusText}_`
          }
        };
      }
      return block;
    });

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: updatedBlocks,
      text: body.message.text
    });
  } catch (error) {
    console.error('❌ Error updating message:', error);
  }
}

/**
 * Updates message from modal submission (uses suggestion_id to find the right action block)
 */
async function updateMessageFromModal(client, channelId, messageTs, suggestionId, statusText) {
  try {
    // Fetch the original message
    const result = await client.conversations.history({
      channel: channelId,
      latest: messageTs,
      limit: 1,
      inclusive: true
    });

    if (!result.messages || result.messages.length === 0) {
      console.error('❌ Could not fetch original message');
      return;
    }

    const originalBlocks = result.messages[0].blocks;
    const actionBlockId = `actions_${suggestionId}`;

    const updatedBlocks = originalBlocks.map(block => {
      if (block.block_id === actionBlockId) {
        return {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `_${statusText}_`
          }
        };
      }
      return block;
    });

    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      blocks: updatedBlocks,
      text: result.messages[0].text
    });
  } catch (error) {
    console.error('❌ Error updating message from modal:', error);
  }
}

/**
 * Handles "Connect to Jira" button click - opens modal to select epic
 */
async function handleConnectJiraAction({ ack, body, client }) {
  await ack();

  try {
    const workspace_id = body.team.id;
    const suggestionId = body.actions[0].value;

    // Fetch suggestion
    const suggestionsCollection = getAISuggestionsCollection();
    const suggestion = await suggestionsCollection.findOne({ workspace_id: workspace_id, suggestion_id: suggestionId });

    if (!suggestion || suggestion.status !== 'pending') {
      await client.chat.postEphemeral({
        channel: body.channel.id,
        user: body.user.id,
        text: '⚠️  This suggestion has already been processed.'
      });
      return;
    }

    // Open modal to select Jira epic
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'connect_jira_modal',
        private_metadata: JSON.stringify({
          suggestion_id: suggestionId,
          channel_id: body.channel.id,
          message_ts: body.message.ts,
          user_id: body.user.id
        }),
        title: { type: 'plain_text', text: '🔗 Connect to Jira' },
        submit: { type: 'plain_text', text: 'Approve & Connect' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `This will approve the decision and add it as a comment to the Jira epic/story.`
            }
          },
          {
            type: 'input',
            block_id: 'epic_block',
            element: {
              type: 'plain_text_input',
              action_id: 'epic_input',
              initial_value: suggestion.epic_key || '',
              placeholder: { type: 'plain_text', text: 'LOK-123' }
            },
            label: { type: 'plain_text', text: 'Epic/Story Key' },
            hint: { type: 'plain_text', text: 'Will auto-fetch from Jira and add decision as comment' }
          }
        ]
      }
    });

  } catch (error) {
    console.error('❌ Error opening connect Jira modal:', error);
  }
}

/**
 * Handles connect to Jira modal submission
 */
async function handleConnectJiraModalSubmit({ ack, view, body, client }) {
  await ack();

  try {
    console.log('>>> Connect to Jira modal submit started');
    const metadata = JSON.parse(view.private_metadata);
    const values = view.state.values;
    console.log('>>> Metadata:', metadata);

    const epicKey = values.epic_block.epic_input.value?.trim() || null;
    console.log('>>> Epic key:', epicKey);

    if (!epicKey) {
      console.error('No epic key provided');
      await client.chat.postEphemeral({
        channel: metadata.channel_id,
        user: metadata.user_id,
        text: '⚠️  No epic key provided.'
      });
      return;
    }

    // Fetch original suggestion
    const suggestionsCollection = getAISuggestionsCollection();
    const suggestion = await suggestionsCollection.findOne({
      suggestion_id: metadata.suggestion_id
    });
    console.log('>>> Suggestion found:', !!suggestion);

    if (!suggestion || suggestion.status !== 'pending') {
      console.log('>>> Suggestion not found or already processed');
      await client.chat.postEphemeral({
        channel: metadata.channel_id,
        user: metadata.user_id,
        text: '⚠️  This suggestion has already been processed or not found.'
      });
      return;
    }

    // Get user info
    const userInfo = await client.users.info({ user: metadata.user_id });
    const userName = userInfo.user.real_name || userInfo.user.name;
    console.log('>>> User:', userName);

    // Fetch meeting transcript to get meeting title
    const transcriptsCollection = getMeetingTranscriptsCollection();
    const transcript = await transcriptsCollection.findOne({
      transcript_id: suggestion.meeting_transcript_id
    });
    const meetingTitle = transcript ? transcript.file_name : 'Unknown meeting';
    console.log('>>> Meeting title:', meetingTitle);

    // Fetch Jira data
    console.log('>>> Fetching Jira data for:', epicKey);
    const jiraData = await fetchJiraIssue(epicKey);
    console.log('>>> Jira data fetched:', !!jiraData);

    // Create decision
    const decisionsCollection = getDecisionsCollection();
    const lastDecision = await decisionsCollection.findOne({ workspace_id: workspace_id }, { sort: { id: -1 } });
    const nextId = lastDecision ? lastDecision.id + 1 : 1;
    console.log('>>> Next decision ID:', nextId);

    const decision = {
      workspace_id: workspace_id,
      id: nextId,
      text: suggestion.decision_text,
      type: suggestion.decision_type,
      epic_key: epicKey,
      jira_data: jiraData,
      tags: suggestion.tags,
      alternatives: `This decision was taken during "${meetingTitle}"\n\nAI-extracted and connected to Jira by ${userName}`,
      creator: userName,
      user_id: metadata.user_id,
      channel_id: metadata.channel_id,
      timestamp: new Date().toISOString()
    };

    console.log('>>> Inserting decision...');
    await decisionsCollection.insertOne(decision);
    console.log(`✅ Decision #${nextId} created`);

    // Add Jira comment (only if Jira data was fetched successfully)
    let jiraCommentSuccess = false;
    if (jiraData) {
      console.log('>>> Adding Jira comment...');
      const comment = `📝 Decision #${decision.id} logged by ${userName}\n\nType: ${decision.type}\nDecision: ${decision.text}\n\n${decision.alternatives}\n\nLogged via Decision Logger`;
      jiraCommentSuccess = await addJiraComment(epicKey, comment);

      if (jiraCommentSuccess) {
        console.log(`✅ Jira comment added to ${epicKey}`);
      }
    } else {
      console.log(`⚠️  Could not fetch Jira issue ${epicKey}, decision saved without Jira data`);
    }

    // Update suggestion
    console.log('>>> Updating suggestion status...');
    await suggestionsCollection.updateOne(
      { suggestion_id: metadata.suggestion_id },
      {
        $set: {
          status: 'approved',
          reviewed_at: new Date().toISOString(),
          reviewer_id: metadata.user_id,
          final_decision_id: nextId
        }
      }
    );
    console.log('✅ Suggestion updated');

    // Save feedback
    console.log('>>> Saving feedback...');
    await saveFeedback(suggestion, 'approved', null, metadata.user_id);
    console.log('✅ Feedback saved');

    // Update the original message to remove buttons
    console.log('>>> Updating original message...');
    let messageStatus;
    if (jiraData && jiraCommentSuccess) {
      messageStatus = `✅ Approved by ${userName} and connected to ${epicKey} - Saved as Decision #${nextId}`;
    } else if (jiraData) {
      messageStatus = `✅ Approved by ${userName} and connected to ${epicKey} - Saved as Decision #${nextId} (Jira comment failed)`;
    } else {
      messageStatus = `✅ Approved by ${userName} - Saved as Decision #${nextId} (Jira fetch failed)`;
    }
    await updateMessageFromModal(
      client,
      metadata.channel_id,
      metadata.message_ts,
      metadata.suggestion_id,
      messageStatus
    );
    console.log('✅ Message updated');

    // Post confirmation with appropriate message
    let confirmationText;
    if (jiraData && jiraCommentSuccess) {
      confirmationText = `✅ Decision #${nextId} approved by ${userName} and connected to ${epicKey} (Jira comment added)`;
    } else if (jiraData) {
      confirmationText = `✅ Decision #${nextId} approved by ${userName} and connected to ${epicKey} (Jira comment failed)`;
    } else {
      confirmationText = `✅ Decision #${nextId} approved by ${userName}. ⚠️ Could not fetch ${epicKey} from Jira - decision saved without Jira link.`;
    }

    console.log('>>> Posting confirmation message...');
    await client.chat.postMessage({
      channel: metadata.channel_id,
      text: confirmationText
    });
    console.log('✅ Connect to Jira modal submit completed successfully');

  } catch (error) {
    console.error('❌ Error in connect Jira modal submit:', error);
    console.error('Error stack:', error.stack);

    // Try to notify user
    try {
      const metadata = JSON.parse(view.private_metadata);
      await client.chat.postEphemeral({
        channel: metadata.channel_id,
        user: metadata.user_id,
        text: `❌ Error approving and connecting decision: ${error.message}`
      });
    } catch (notifyError) {
      console.error('❌ Could not notify user of error:', notifyError);
    }
  }
}

module.exports = {
  handleFileUpload,
  handleExtractDecisionsButton,
  handleIgnoreFileButton,
  handleApproveAction,
  handleRejectAction,
  handleEditAction,
  handleEditModalSubmit,
  handleConnectJiraAction,
  handleConnectJiraModalSubmit
};
