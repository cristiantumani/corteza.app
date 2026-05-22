const { MongoClient } = require('mongodb');
const crypto = require('crypto');
require('dotenv').config();

async function fixSpaceMembership() {
  const uri = process.env.MONGODB_URI;
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('decision-logger');

    const spaceId = 'sp_76516438b589fd7e358c8c62';
    const workspaceId = 'WCRIS-TEST';
    const userEmail = 'ctumani@gmail.com';

    // Get user info from workspace_members
    const membersCollection = db.collection('workspace_members');
    const member = await membersCollection.findOne({
      workspace_id: workspaceId,
      email: userEmail,
      removed_at: null
    });

    if (!member) {
      console.log('❌ User not found in workspace_members');
      return;
    }

    const userId = member.user_id;
    const userName = member.user_name;

    console.log(`\n🔧 Adding ${userName} as owner of space ${spaceId}...\n`);

    // Check if membership already exists
    const spaceMembersCollection = db.collection('space_members');
    const existingMember = await spaceMembersCollection.findOne({
      space_id: spaceId,
      user_id: userId,
      removed_at: null
    });

    if (existingMember) {
      console.log('⚠️  User is already a member of this space');
      return;
    }

    // Add user as owner
    const membershipId = `smem_${crypto.randomBytes(12).toString('hex')}`;
    await spaceMembersCollection.insertOne({
      membership_id: membershipId,
      workspace_id: workspaceId,
      space_id: spaceId,
      user_id: userId,
      user_name: userName,
      role: 'owner',
      added_by: userId,
      added_by_name: userName,
      added_at: new Date().toISOString(),
      removed_at: null
    });

    console.log(`✅ Added ${userName} as owner of the space`);
    console.log('\n✅ Fix complete! You should now see your space in the dashboard.\n');

  } catch (error) {
    console.error('❌ Fix failed:', error);
  } finally {
    await client.close();
  }
}

fixSpaceMembership().catch(console.error);
