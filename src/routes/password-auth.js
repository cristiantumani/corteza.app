const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { getWorkspaceMembersCollection } = require('../config/database');
const { generateLoginToken } = require('./dashboard-auth');

const router = express.Router();

// Apply JSON body parser
router.use(express.json());

/**
 * POST /auth/login-with-password
 * Authenticate with email + password
 *
 * Body: { email, workspace, password }
 * Returns: { success, redirect_url } or { success: false, error }
 */
router.post('/auth/login-with-password', async (req, res) => {
  try {
    const { email, workspace, password } = req.body;

    if (!email || !workspace || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email, workspace, and password are required'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedWorkspace = workspace.toLowerCase().trim();

    // Find user in workspace_members
    const membersCollection = getWorkspaceMembersCollection();
    const member = await membersCollection.findOne({
      email: normalizedEmail,
      workspace_id: normalizedWorkspace,
      removed_at: null
    });

    if (!member) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email, workspace, or password'
      });
    }

    // Check if user has password set
    if (!member.password_hash) {
      return res.status(401).json({
        success: false,
        error: 'No password set for this account. Please use magic link to login and set a password.',
        needs_password_setup: true
      });
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, member.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email, workspace, or password'
      });
    }

    // Generate login token
    const token = generateLoginToken(
      member.user_id,
      member.user_name,
      member.workspace_id,
      member.workspace_name || normalizedWorkspace,
      member.email
    );

    // Return redirect URL with token
    const redirectUrl = `/auth/token?token=${token}`;

    res.json({
      success: true,
      redirect_url: redirectUrl,
      message: 'Login successful'
    });

  } catch (error) {
    console.error('Password login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed. Please try again.'
    });
  }
});

/**
 * POST /auth/set-password
 * Set or update password for authenticated user
 *
 * Body: { password, confirm_password }
 * Returns: { success, message }
 */
router.post('/auth/set-password', async (req, res) => {
  try {
    // Verify user is authenticated
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const { password, confirm_password } = req.body;

    if (!password || !confirm_password) {
      return res.status(400).json({
        success: false,
        error: 'Password and confirmation are required'
      });
    }

    if (password !== confirm_password) {
      return res.status(400).json({
        success: false,
        error: 'Passwords do not match'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters'
      });
    }

    const userId = req.session.user.user_id;
    const workspaceId = req.session.user.workspace_id;
    const email = req.session.user.email;

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Update workspace_members record
    const membersCollection = getWorkspaceMembersCollection();
    const result = await membersCollection.updateOne(
      {
        user_id: userId,
        workspace_id: workspaceId,
        email: email,
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

    console.log(`✅ Password set for user ${email} in workspace ${workspaceId}`);

    res.json({
      success: true,
      message: 'Password set successfully. You can now use email + password to login.'
    });

  } catch (error) {
    console.error('Set password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to set password. Please try again.'
    });
  }
});

/**
 * POST /auth/check-password-status
 * Check if user has password set (for login page)
 *
 * Body: { email, workspace }
 * Returns: { has_password: boolean }
 */
router.post('/auth/check-password-status', async (req, res) => {
  try {
    const { email, workspace } = req.body;

    if (!email || !workspace) {
      return res.json({ has_password: false });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedWorkspace = workspace.toLowerCase().trim();

    const membersCollection = getWorkspaceMembersCollection();
    const member = await membersCollection.findOne({
      email: normalizedEmail,
      workspace_id: normalizedWorkspace,
      removed_at: null
    });

    res.json({
      has_password: !!(member && member.password_hash),
      user_exists: !!member
    });

  } catch (error) {
    console.error('Check password status error:', error);
    res.json({ has_password: false });
  }
});

/**
 * POST /auth/complete-onboarding
 * Complete onboarding flow (set password, profile info, use case)
 *
 * Body: { password, full_name, role, company_size, use_case, heard_about, early_access }
 * Returns: { success, message }
 */
router.post('/auth/complete-onboarding', async (req, res) => {
  try {
    // Verify user is authenticated
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const {
      password,
      full_name,
      role,
      company_size,
      use_case,
      heard_about,
      early_access
    } = req.body;

    // Validate required fields
    if (!full_name || !role || !company_size || !use_case || !heard_about) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    const userId = req.session.user.user_id;
    const workspaceId = req.session.user.workspace_id;
    const email = req.session.user.email;

    // Prepare update object
    const updateData = {
      full_name: full_name,
      role: role,
      company_size: company_size,
      use_case: use_case,
      heard_about: heard_about,
      early_access: early_access === true,
      onboarding_completed: true,
      onboarding_completed_at: new Date().toISOString()
    };

    // Hash password if provided
    if (password && password.length >= 8) {
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(password, saltRounds);
      updateData.password_hash = passwordHash;
      updateData.password_set_at = new Date().toISOString();
    }

    // Update workspace_members record
    const membersCollection = getWorkspaceMembersCollection();
    const result = await membersCollection.updateOne(
      {
        user_id: userId,
        workspace_id: workspaceId,
        email: email,
        removed_at: null
      },
      {
        $set: updateData
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Update session with full name
    req.session.user.user_name = full_name;

    console.log(`✅ Onboarding completed for user ${email} in workspace ${workspaceId}`);

    res.json({
      success: true,
      message: 'Onboarding completed successfully'
    });

  } catch (error) {
    console.error('Complete onboarding error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete onboarding. Please try again.'
    });
  }
});

module.exports = router;
