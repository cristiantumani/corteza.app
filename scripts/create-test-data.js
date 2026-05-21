const { MongoClient } = require('mongodb');
const crypto = require('crypto');
require('dotenv').config();

/**
 * Test data creation script for Spaces feature
 *
 * Creates:
 * - Test workspace
 * - Multiple spaces (General, Engineering, Marketing, CEO Private)
 * - Sample decisions across different spaces
 * - Workspace admin
 * - Space members for shared spaces
 */

async function createTestData() {
  console.log('🧪 Creating test data for Spaces feature...\n');

  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const db = client.db('corteza');
    const spacesCollection = db.collection('workspace_spaces');
    const membersCollection = db.collection('space_members');
    const decisionsCollection = db.collection('decisions');
    const adminsCollection = db.collection('workspace_admins');

    // Test workspace ID
    const workspaceId = 'TEST_WORKSPACE';
    const workspaceName = 'Test Company';

    console.log(`📦 Test Workspace: ${workspaceId} (${workspaceName})\n`);

    // Test users
    const users = [
      { user_id: 'U001', name: 'Alice Admin', email: 'alice@test.com', is_admin: true },
      { user_id: 'U002', name: 'Bob Engineer', email: 'bob@test.com', is_admin: false },
      { user_id: 'U003', name: 'Carol Marketing', email: 'carol@test.com', is_admin: false },
      { user_id: 'U004', name: 'Dave CEO', email: 'dave@test.com', is_admin: false }
    ];

    // Create workspace admin
    console.log('👥 Creating workspace admin...');
    await adminsCollection.insertOne({
      workspace_id: workspaceId,
      user_id: users[0].user_id,
      user_name: users[0].name,
      email: users[0].email,
      role: 'admin',
      source: 'assigned',
      assigned_by: null,
      assigned_by_name: null,
      is_slack_admin: false,
      created_at: new Date().toISOString(),
      deactivated_at: null
    });
    console.log(`   ✅ Admin: ${users[0].name}\n`);

    // Create spaces
    console.log('📁 Creating spaces...');
    const spaces = [];

    // 1. General (default, public)
    const generalSpace = {
      space_id: `sp_${crypto.randomBytes(12).toString('hex')}`,
      workspace_id: workspaceId,
      name: 'General',
      description: 'Default space for all team memories',
      visibility: 'public',
      created_by: users[0].user_id,
      created_by_name: users[0].name,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_default: true,
      archived: false,
      archived_at: null,
      settings: {
        color: '#667eea',
        icon: '🏠'
      }
    };
    await spacesCollection.insertOne(generalSpace);
    spaces.push(generalSpace);
    console.log(`   ✅ ${generalSpace.settings.icon} ${generalSpace.name} (public, default)`);

    // 2. Engineering (shared)
    const engineeringSpace = {
      space_id: `sp_${crypto.randomBytes(12).toString('hex')}`,
      workspace_id: workspaceId,
      name: 'Engineering',
      description: 'Technical decisions and architecture',
      visibility: 'shared',
      created_by: users[1].user_id,
      created_by_name: users[1].name,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_default: false,
      archived: false,
      archived_at: null,
      settings: {
        color: '#10b981',
        icon: '⚙️'
      }
    };
    await spacesCollection.insertOne(engineeringSpace);
    spaces.push(engineeringSpace);
    console.log(`   ✅ ${engineeringSpace.settings.icon} ${engineeringSpace.name} (shared)`);

    // Add members to Engineering space
    await membersCollection.insertOne({
      membership_id: `mem_${crypto.randomBytes(12).toString('hex')}`,
      workspace_id: workspaceId,
      space_id: engineeringSpace.space_id,
      user_id: users[0].user_id,
      user_name: users[0].name,
      role: 'admin',
      added_by: users[1].user_id,
      added_by_name: users[1].name,
      added_at: new Date().toISOString(),
      removed_at: null
    });

    // 3. Marketing (public)
    const marketingSpace = {
      space_id: `sp_${crypto.randomBytes(12).toString('hex')}`,
      workspace_id: workspaceId,
      name: 'Marketing',
      description: 'Product launches and campaigns',
      visibility: 'public',
      created_by: users[2].user_id,
      created_by_name: users[2].name,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_default: false,
      archived: false,
      archived_at: null,
      settings: {
        color: '#f59e0b',
        icon: '📢'
      }
    };
    await spacesCollection.insertOne(marketingSpace);
    spaces.push(marketingSpace);
    console.log(`   ✅ ${marketingSpace.settings.icon} ${marketingSpace.name} (public)`);

    // 4. CEO Private (private)
    const ceoSpace = {
      space_id: `sp_${crypto.randomBytes(12).toString('hex')}`,
      workspace_id: workspaceId,
      name: 'CEO Private',
      description: 'Confidential strategic decisions',
      visibility: 'private',
      created_by: users[3].user_id,
      created_by_name: users[3].name,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_default: false,
      archived: false,
      archived_at: null,
      settings: {
        color: '#ef4444',
        icon: '🔒'
      }
    };
    await spacesCollection.insertOne(ceoSpace);
    spaces.push(ceoSpace);
    console.log(`   ✅ ${ceoSpace.settings.icon} ${ceoSpace.name} (private)\n`);

    // Create sample decisions
    console.log('📝 Creating sample decisions...');

    const sampleDecisions = [
      // General space
      {
        space: generalSpace,
        text: 'We will use Slack for team communication',
        type: 'decision',
        category: 'product',
        user: users[0],
        tags: ['communication', 'tools']
      },
      {
        space: generalSpace,
        text: 'Team standups will be at 10 AM daily',
        type: 'decision',
        category: 'product',
        user: users[0],
        tags: ['meetings', 'schedule']
      },
      {
        space: generalSpace,
        text: 'We use agile methodology with 2-week sprints',
        type: 'explanation',
        category: null,
        user: users[1],
        tags: ['agile', 'process']
      },

      // Engineering space
      {
        space: engineeringSpace,
        text: 'We will use React for the frontend framework',
        type: 'decision',
        category: 'technical',
        user: users[1],
        tags: ['frontend', 'react', 'framework']
      },
      {
        space: engineeringSpace,
        text: 'Database: PostgreSQL for relational data, Redis for caching',
        type: 'decision',
        category: 'technical',
        user: users[1],
        tags: ['database', 'architecture']
      },
      {
        space: engineeringSpace,
        text: 'All API endpoints must use JWT authentication',
        type: 'decision',
        category: 'technical',
        user: users[0],
        tags: ['security', 'api', 'authentication']
      },
      {
        space: engineeringSpace,
        text: 'Our microservices communicate via REST APIs with JSON payloads',
        type: 'explanation',
        category: 'technical',
        user: users[1],
        tags: ['architecture', 'microservices']
      },

      // Marketing space
      {
        space: marketingSpace,
        text: 'Q2 campaign will focus on enterprise customers',
        type: 'decision',
        category: 'product',
        user: users[2],
        tags: ['campaign', 'enterprise']
      },
      {
        space: marketingSpace,
        text: 'Launch event scheduled for March 15th',
        type: 'context',
        category: 'product',
        user: users[2],
        tags: ['launch', 'events']
      },
      {
        space: marketingSpace,
        text: 'Our target audience is B2B SaaS companies with 50-500 employees',
        type: 'context',
        category: 'product',
        user: users[2],
        tags: ['audience', 'b2b']
      },

      // CEO Private space
      {
        space: ceoSpace,
        text: 'Series A fundraising target: $5M by Q3',
        type: 'decision',
        category: 'product',
        user: users[3],
        tags: ['funding', 'strategic']
      },
      {
        space: ceoSpace,
        text: 'Consider acquisition offer from Company X',
        type: 'risk',
        category: null,
        user: users[3],
        tags: ['acquisition', 'strategic']
      }
    ];

    let decisionId = 1;
    for (const sample of sampleDecisions) {
      const decision = {
        id: decisionId++,
        workspace_id: workspaceId,
        space_id: sample.space.space_id,
        space_name: sample.space.name,
        text: sample.text,
        type: sample.type,
        category: sample.category,
        tags: sample.tags,
        epic_key: null,
        alternatives: null,
        creator: sample.user.name,
        user_id: sample.user.user_id,
        channel_id: 'C001',
        timestamp: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(), // Random within last 7 days
        source: 'test-script',
        jira_data: null,
        embedding: null
      };

      await decisionsCollection.insertOne(decision);
      console.log(`   ✅ #${decision.id}: "${decision.text.substring(0, 50)}..." in ${sample.space.name}`);
    }

    console.log('\n🎉 Test data created successfully!\n');
    console.log('📊 Summary:');
    console.log(`   • Workspace: ${workspaceId}`);
    console.log(`   • Spaces: ${spaces.length}`);
    console.log(`   • Decisions: ${sampleDecisions.length}`);
    console.log(`   • Users: ${users.length}`);
    console.log(`   • Admin: ${users[0].name}`);

    console.log('\n🔐 Test Login Credentials:');
    console.log('   You can create a session manually or use the dashboard auth.');
    console.log('   For testing, you can set workspace_id in browser localStorage:');
    console.log(`   localStorage.setItem('test_workspace_id', '${workspaceId}');`);

    console.log('\n🌐 Access the dashboard:');
    console.log('   http://localhost:3000/dashboard');
    console.log('\n   Note: You\'ll need to authenticate first. For testing,');
    console.log('   you can modify the auth check or create a test session.\n');

  } catch (error) {
    console.error('\n❌ Error creating test data:', error);
    throw error;
  } finally {
    await client.close();
    console.log('👋 Database connection closed');
  }
}

// Run if called directly
if (require.main === module) {
  createTestData()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { createTestData };
