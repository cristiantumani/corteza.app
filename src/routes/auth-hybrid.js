const express = require('express');
const { getWorkspaceMembersCollection } = require('../config/database');
const { generateLoginToken } = require('./dashboard-auth');
const crypto = require('crypto');

const router = express.Router();
router.use(express.json());

/**
 * POST /auth/check-email
 * Check what workspaces a user belongs to
 * Body: { email }
 * Returns: { success, workspaces: [{workspace_id, workspace_name, role}] }
 */
router.post('/auth/check-email', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find all workspaces this user belongs to
    const membersCollection = getWorkspaceMembersCollection();
    const memberships = await membersCollection.find({
      email: normalizedEmail,
      removed_at: null
    }).toArray();

    // Extract unique workspaces
    const workspaces = memberships.map(m => ({
      workspace_id: m.workspace_id,
      workspace_name: m.workspace_name || m.workspace_id,
      role: m.role
    }));

    res.json({
      success: true,
      workspaces: workspaces
    });

  } catch (error) {
    console.error('Error checking email:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check email'
    });
  }
});

/**
 * POST /auth/forgot-password
 * Send password reset magic link
 * Body: { email }
 * Returns: { success, message }
 */
router.post('/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find user's workspaces
    const membersCollection = getWorkspaceMembersCollection();
    const memberships = await membersCollection.find({
      email: normalizedEmail,
      removed_at: null
    }).toArray();

    if (memberships.length === 0) {
      // Don't reveal that email doesn't exist (security)
      return res.json({
        success: true,
        message: 'If an account exists with this email, a password reset link has been sent.'
      });
    }

    // Use first membership for token generation
    const member = memberships[0];

    // Generate one-time token for password reset
    const token = generateLoginToken(
      member.user_id,
      member.user_name,
      member.workspace_id,
      member.workspace_name,
      member.email
    );

    // Build reset link
    const baseUrl = process.env.BASE_URL || 'https://app.corteza.app';
    const resetLink = `${baseUrl}/auth/reset-password?token=${token}`;

    // Send email (using same system as magic links)
    const { sendMagicLinkEmail } = require('../utils/n8n-client');
    await sendMagicLinkEmail({
      email: normalizedEmail,
      user_name: member.user_name,
      workspace_name: member.workspace_name,
      workspace_id: member.workspace_id,
      magic_link: resetLink,
      expires_in_minutes: 15,
      is_password_reset: true
    });

    console.log(`✅ Password reset link sent to ${normalizedEmail}`);

    res.json({
      success: true,
      message: 'Password reset link has been sent to your email. It will expire in 15 minutes.'
    });

  } catch (error) {
    console.error('Error sending password reset:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send password reset link'
    });
  }
});

/**
 * POST /auth/reset-password
 * Reset password using one-time token
 * Body: { token, password }
 * Returns: { success, message }
 */
router.post('/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        error: 'Token and password are required'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters'
      });
    }

    // Validate and consume token
    const { consumeToken } = require('./dashboard-auth');
    const userData = consumeToken(token);

    if (!userData) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired reset token. Please request a new password reset link.'
      });
    }

    // Hash new password
    const bcrypt = require('bcrypt');
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Update password in database
    const membersCollection = getWorkspaceMembersCollection();
    const result = await membersCollection.updateOne(
      {
        user_id: userData.user_id,
        workspace_id: userData.workspace_id,
        email: userData.email,
        removed_at: null
      },
      {
        $set: {
          password_hash: passwordHash,
          password_set_at: new Date().toISOString()
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    console.log(`✅ Password reset for user ${userData.email}`);

    res.json({
      success: true,
      message: 'Password reset successfully. You can now login with your new password.'
    });

  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset password'
    });
  }
});

/**
 * GET /auth/reset-password
 * Show password reset page
 */
router.get('/auth/reset-password', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../views', 'reset-password.html'));
});

module.exports = router;
