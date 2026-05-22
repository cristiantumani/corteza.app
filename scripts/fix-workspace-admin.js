const { MongoClient } = require('mongodb');
require('dotenv').config();

async function fixWorkspaceAdmin() {
  const uri = process.env.MONGODB_URI;
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('decision-logger');

    const email = 'ctumani@gmail.com';
    const workspaceId = 'WCRIS-TEST';

    console.log(`\n🔧 Fixing workspace admin for ${email} in ${workspaceId}...\n`);

    // Get the workspace member
    const membersCollection = db.collection('workspace_members');
    const member = await membersCollection.findOne({
      workspace_id: workspaceId,
      email: email,
      removed_at: null
    });

    if (!member) {
      console.log('❌ Member not found!');
      return;
    }

    console.log(`Found member: ${member.user_name} (${member.email})`);
    console.log(`Current role: ${member.role}`);

    // Update role to admin
    await membersCollection.updateOne(
      {
        workspace_id: workspaceId,
        email: email,
        removed_at: null
      },
      {
        $set: { role: 'admin' }
      }
    );

    console.log(`✅ Updated workspace_members role to 'admin'`);

    // Create workspace_admins record
    const adminsCollection = db.collection('workspace_admins');

    // Check if admin record already exists
    const existingAdmin = await adminsCollection.findOne({
      workspace_id: workspaceId,
      user_id: member.user_id
    });

    if (existingAdmin) {
      console.log('⚠️  Admin record already exists');
    } else {
      await adminsCollection.insertOne({
        workspace_id: workspaceId,
        user_id: member.user_id,
        user_name: member.user_name,
        email: member.email,
        role: 'admin',
        created_at: new Date().toISOString(),
        deactivated_at: null
      });

      console.log(`✅ Created workspace_admins record`);
    }

    console.log('\n✅ Workspace admin fix complete!\n');

  } catch (error) {
    console.error('❌ Fix failed:', error);
  } finally {
    await client.close();
  }
}

fixWorkspaceAdmin().catch(console.error);
