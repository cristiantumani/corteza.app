const { MongoClient } = require('mongodb');
const crypto = require('crypto');
require('dotenv').config();

/**
 * Migration script to add Spaces feature
 *
 * This script:
 * 1. Creates workspace_spaces and space_members collections
 * 2. Creates a default "General" space for each workspace
 * 3. Assigns all existing decisions to the default space
 * 4. Creates necessary indexes
 */

async function migrateToSpaces() {
  console.log('🚀 Starting Spaces migration...\n');

  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    // Use decision-logger database (production) or corteza (test)
    const dbName = process.env.DB_NAME || 'decision-logger';
    const db = client.db(dbName);
    console.log(`📂 Using database: ${dbName}\n`);
    const decisionsCollection = db.collection('decisions');
    const spacesCollection = db.collection('workspace_spaces');
    const membersCollection = db.collection('space_members');

    // Step 1: Get all unique workspaces
    console.log('📊 Finding unique workspaces...');
    const workspaces = await decisionsCollection.distinct('workspace_id');
    console.log(`   Found ${workspaces.length} workspaces\n`);

    if (workspaces.length === 0) {
      console.log('⚠️  No workspaces found. Nothing to migrate.');
      return;
    }

    // Step 2: Create default space for each workspace
    console.log('📁 Creating default spaces...');
    let spacesCreated = 0;
    let decisionsUpdated = 0;

    for (const workspaceId of workspaces) {
      console.log(`\n   Processing workspace: ${workspaceId}`);

      // Check if default space already exists
      const existingSpace = await spacesCollection.findOne({
        workspace_id: workspaceId,
        is_default: true
      });

      if (existingSpace) {
        console.log(`   ⏭️  Default space already exists: ${existingSpace.space_id}`);
        continue;
      }

      // Find the first decision to get creator info
      const firstDecision = await decisionsCollection.findOne(
        { workspace_id: workspaceId },
        { sort: { timestamp: 1 } }
      );

      // Generate space ID
      const spaceId = `sp_${crypto.randomBytes(12).toString('hex')}`;

      // Create default space
      const defaultSpace = {
        space_id: spaceId,
        workspace_id: workspaceId,
        name: 'General',
        description: 'Default space for all team memories',
        visibility: 'public',
        created_by: firstDecision?.user_id || 'system',
        created_by_name: firstDecision?.creator || 'System',
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

      await spacesCollection.insertOne(defaultSpace);
      spacesCreated++;
      console.log(`   ✅ Created default space: ${spaceId}`);

      // Step 3: Assign all existing decisions to default space
      const updateResult = await decisionsCollection.updateMany(
        {
          workspace_id: workspaceId,
          $or: [
            { space_id: null },
            { space_id: { $exists: false } }
          ]
        },
        {
          $set: {
            space_id: spaceId,
            space_name: 'General'
          }
        }
      );

      decisionsUpdated += updateResult.modifiedCount;
      console.log(`   📝 Updated ${updateResult.modifiedCount} decisions`);
    }

    console.log(`\n✅ Created ${spacesCreated} default spaces`);
    console.log(`✅ Updated ${decisionsUpdated} decisions\n`);

    // Step 4: Create indexes
    console.log('🔧 Creating indexes...');

    // workspace_spaces indexes
    await spacesCollection.createIndex(
      { workspace_id: 1, space_id: 1 },
      { unique: true }
    );
    console.log('   ✅ workspace_spaces: { workspace_id: 1, space_id: 1 } (unique)');

    await spacesCollection.createIndex(
      { workspace_id: 1, archived: 1, name: 1 }
    );
    console.log('   ✅ workspace_spaces: { workspace_id: 1, archived: 1, name: 1 }');

    await spacesCollection.createIndex(
      { workspace_id: 1, is_default: 1 }
    );
    console.log('   ✅ workspace_spaces: { workspace_id: 1, is_default: 1 }');

    await spacesCollection.createIndex(
      { workspace_id: 1, visibility: 1 }
    );
    console.log('   ✅ workspace_spaces: { workspace_id: 1, visibility: 1 }');

    // space_members indexes
    await membersCollection.createIndex(
      { space_id: 1, user_id: 1, removed_at: 1 },
      {
        unique: true,
        partialFilterExpression: { removed_at: null }
      }
    );
    console.log('   ✅ space_members: { space_id: 1, user_id: 1, removed_at: 1 } (unique, partial)');

    await membersCollection.createIndex(
      { workspace_id: 1, user_id: 1, removed_at: 1 }
    );
    console.log('   ✅ space_members: { workspace_id: 1, user_id: 1, removed_at: 1 }');

    await membersCollection.createIndex(
      { space_id: 1, role: 1, removed_at: 1 }
    );
    console.log('   ✅ space_members: { space_id: 1, role: 1, removed_at: 1 }');

    await membersCollection.createIndex(
      { workspace_id: 1, space_id: 1 }
    );
    console.log('   ✅ space_members: { workspace_id: 1, space_id: 1 }');

    // decisions indexes (new space-related indexes)
    await decisionsCollection.createIndex(
      { workspace_id: 1, space_id: 1, timestamp: -1 }
    );
    console.log('   ✅ decisions: { workspace_id: 1, space_id: 1, timestamp: -1 }');

    await decisionsCollection.createIndex(
      { workspace_id: 1, space_id: 1, type: 1 }
    );
    console.log('   ✅ decisions: { workspace_id: 1, space_id: 1, type: 1 }');

    await decisionsCollection.createIndex(
      { workspace_id: 1, space_id: 1, id: 1 }
    );
    console.log('   ✅ decisions: { workspace_id: 1, space_id: 1, id: 1 }');

    await decisionsCollection.createIndex(
      { space_id: 1, timestamp: -1 }
    );
    console.log('   ✅ decisions: { space_id: 1, timestamp: -1 }');

    // Step 5: Verification
    console.log('\n🔍 Running verification checks...');

    const totalSpaces = await spacesCollection.countDocuments({});
    console.log(`   Total spaces created: ${totalSpaces}`);

    const decisionsWithoutSpace = await decisionsCollection.countDocuments({
      $or: [
        { space_id: null },
        { space_id: { $exists: false } }
      ]
    });
    console.log(`   Decisions without space_id: ${decisionsWithoutSpace}`);

    if (decisionsWithoutSpace > 0) {
      console.log('   ⚠️  WARNING: Some decisions still lack space_id');
    } else {
      console.log('   ✅ All decisions have space_id assigned');
    }

    const defaultSpaces = await spacesCollection.countDocuments({ is_default: true });
    console.log(`   Default spaces: ${defaultSpaces}`);

    console.log('\n✅ Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Review the migration results above');
    console.log('2. Test space creation: POST /api/spaces');
    console.log('3. Test space filtering: GET /api/decisions?space_id=<space_id>');
    console.log('4. Deploy updated code with space features\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    throw error;
  } finally {
    await client.close();
    console.log('👋 Database connection closed');
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateToSpaces()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { migrateToSpaces };
