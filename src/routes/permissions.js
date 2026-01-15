const { isAdmin, promoteToAdmin, demoteFromAdmin, listAdmins } = require('../services/permissions');

/**
 * Slash command handlers for /permissions
 * Allows workspace admins to manage admin roles
 *
 * Usage:
 *   /permissions                  - Show help
 *   /permissions list             - List all admins
 *   /permissions grant @user      - Promote user to admin
 *   /permissions revoke @user     - Demote user from admin
 */

/**
 * Handle /permissions slash command
 */
async function handlePermissionsCommand({ command, ack, client, respond }) {
  await ack();

  const workspaceId = command.team_id;
  const userId = command.user_id;
  const args = command.text.trim().split(/\s+/);
  const subcommand = args[0]?.toLowerCase() || '';

  // Check if user is admin
  const userIsAdmin = await isAdmin(client, workspaceId, userId);

  if (!userIsAdmin) {
    await respond({
      response_type: 'ephemeral',
      text: '⛔ *Only workspace admins can manage permissions.*\n\nWorkspace Admins and Owners are automatically granted admin access.\n\nIf you believe this is an error, please contact your workspace administrator.'
    });
    return;
  }

  // Handle subcommands
  if (!subcommand || subcommand === 'help') {
    await handleHelp(respond);
  } else if (subcommand === 'list') {
    await handleListAdmins(client, workspaceId, respond);
  } else if (subcommand === 'grant') {
    const targetUser = args[1];
    if (!targetUser) {
      await respond({
        response_type: 'ephemeral',
        text: '❌ Please specify a user: `/permissions grant @username`'
      });
      return;
    }
    await handleGrantAdmin(client, workspaceId, userId, targetUser, respond);
  } else if (subcommand === 'revoke') {
    const targetUser = args[1];
    if (!targetUser) {
      await respond({
        response_type: 'ephemeral',
        text: '❌ Please specify a user: `/permissions revoke @username`'
      });
      return;
    }
    await handleRevokeAdmin(client, workspaceId, userId, targetUser, respond);
  } else {
    await respond({
      response_type: 'ephemeral',
      text: `❌ Unknown command: \`${subcommand}\`\n\nUse \`/permissions help\` to see available commands.`
    });
  }
}

/**
 * Show help message
 */
async function handleHelp(respond) {
  await respond({
    response_type: 'ephemeral',
    text: `
*🔐 Permission Management*

*Available Commands:*
• \`/permissions list\` - View all admins
• \`/permissions grant @user\` - Promote user to admin
• \`/permissions revoke @user\` - Remove admin access

*Roles:*
• *Admin* - Full access (configure settings, manage all decisions, grant permissions)
• *Non-Admin* - Can create and edit own decisions only

*Note:* Workspace Admins/Owners are automatically Admins.
    `.trim()
  });
}

/**
 * List all admins
 */
async function handleListAdmins(client, workspaceId, respond) {
  try {
    const admins = await listAdmins(workspaceId);

    if (admins.length === 0) {
      await respond({
        response_type: 'ephemeral',
        text: '📋 *No admins found*\n\nWorkspace Admins will be auto-promoted when they interact with the app.'
      });
      return;
    }

    const adminList = admins.map(admin => {
      const source = admin.source === 'slack_admin' ? '(Workspace Admin)' : `(Assigned by ${admin.assigned_by_name})`;
      return `• <@${admin.user_id}> ${source}`;
    }).join('\n');

    await respond({
      response_type: 'ephemeral',
      text: `*👥 Workspace Admins (${admins.length})*\n\n${adminList}`
    });

  } catch (error) {
    console.error('Error listing admins:', error);
    await respond({
      response_type: 'ephemeral',
      text: '❌ Failed to list admins. Please try again.'
    });
  }
}

/**
 * Grant admin access to user
 */
async function handleGrantAdmin(client, workspaceId, granterId, targetUserId, respond) {
  try {
    // Parse user mention (<@U123456> -> U123456)
    const userIdMatch = targetUserId.match(/<@(U[A-Z0-9]+)>/);
    const targetId = userIdMatch ? userIdMatch[1] : targetUserId;

    // Prevent granting to self
    if (targetId === granterId) {
      await respond({
        response_type: 'ephemeral',
        text: '❌ You already have admin access.'
      });
      return;
    }

    // Check if user exists
    try {
      await client.users.info({ user: targetId });
    } catch (error) {
      await respond({
        response_type: 'ephemeral',
        text: '❌ User not found. Please mention a valid user: `/permissions grant @username`'
      });
      return;
    }

    // Check if already admin
    if (await isAdmin(client, workspaceId, targetId)) {
      await respond({
        response_type: 'ephemeral',
        text: '⚠️ <@' + targetId + '> is already an admin.'
      });
      return;
    }

    // Grant admin access
    await promoteToAdmin(workspaceId, targetId, 'assigned', granterId);

    await respond({
      response_type: 'ephemeral',
      text: `✅ *Admin access granted*\n\n<@${targetId}> is now a workspace admin.`
    });

    // Notify the user
    try {
      await client.chat.postMessage({
        channel: targetId,
        text: `🎉 You've been granted *admin access* to the Decision Logger by <@${granterId}>!\n\nYou can now:\n• Configure Jira settings\n• Edit/delete any decision\n• Grant admin access to others\n\nUse \`/permissions\` to manage permissions.`
      });
    } catch (error) {
      console.log('Could not send DM to user (may have DMs disabled):', error.message);
    }

  } catch (error) {
    console.error('Error granting admin:', error);
    await respond({
      response_type: 'ephemeral',
      text: '❌ Failed to grant admin access. Please try again.'
    });
  }
}

/**
 * Revoke admin access from user
 */
async function handleRevokeAdmin(client, workspaceId, revokerId, targetUserId, respond) {
  try {
    // Parse user mention (<@U123456> -> U123456)
    const userIdMatch = targetUserId.match(/<@(U[A-Z0-9]+)>/);
    const targetId = userIdMatch ? userIdMatch[1] : targetUserId;

    // Prevent revoking from self
    if (targetId === revokerId) {
      await respond({
        response_type: 'ephemeral',
        text: '❌ You cannot revoke your own admin access.'
      });
      return;
    }

    // Check if user is admin
    if (!await isAdmin(client, workspaceId, targetId)) {
      await respond({
        response_type: 'ephemeral',
        text: '⚠️ <@' + targetId + '> is not an admin.'
      });
      return;
    }

    // Revoke admin access
    await demoteFromAdmin(workspaceId, targetId);

    await respond({
      response_type: 'ephemeral',
      text: `✅ *Admin access revoked*\n\n<@${targetId}> is no longer a workspace admin.`
    });

    // Notify the user
    try {
      await client.chat.postMessage({
        channel: targetId,
        text: `⚠️ Your *admin access* to the Decision Logger has been revoked by <@${revokerId}>.\n\nYou can still:\n• View all decisions\n• Create new decisions\n• Edit/delete your own decisions`
      });
    } catch (error) {
      console.log('Could not send DM to user (may have DMs disabled):', error.message);
    }

  } catch (error) {
    console.error('Error revoking admin:', error);
    await respond({
      response_type: 'ephemeral',
      text: '❌ Failed to revoke admin access. Please try again.'
    });
  }
}

module.exports = {
  handlePermissionsCommand
};
