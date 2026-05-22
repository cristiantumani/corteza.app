const { MongoClient } = require('mongodb');
require('dotenv').config();

async function inspectWorkspaceMembers() {
  const uri = process.env.MONGODB_URI;
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('decision-logger');

    console.log('\n📊 Workspace Members:\n');
    const members = await db.collection('workspace_members').find({}).toArray();
    members.forEach(m => {
      console.log(`Workspace: ${m.workspace_name} (${m.workspace_id})`);
      console.log(`User: ${m.user_name} (${m.email})`);
      console.log(`Role: ${m.role}`);
      console.log(`Joined: ${m.joined_at}`);
      console.log(`Onboarding: ${m.onboarding_completed ? 'Completed' : 'Incomplete'}`);
      console.log('---');
    });

    console.log('\n📁 Workspace Spaces:\n');
    const spaces = await db.collection('workspace_spaces').find({}).toArray();
    spaces.forEach(s => {
      console.log(`Space: ${s.name} (${s.space_id})`);
      console.log(`Workspace: ${s.workspace_id}`);
      console.log(`Visibility: ${s.visibility}`);
      console.log(`Default: ${s.is_default}`);
      console.log('---');
    });

    console.log('\n👥 Workspace Admins:\n');
    const admins = await db.collection('workspace_admins').find({}).toArray();
    if (admins.length === 0) {
      console.log('No admins found');
    } else {
      admins.forEach(a => {
        console.log(`User: ${a.user_name} (${a.email})`);
        console.log(`Workspace: ${a.workspace_id}`);
        console.log(`Role: ${a.role}`);
        console.log('---');
      });
    }

  } finally {
    await client.close();
  }
}

inspectWorkspaceMembers().catch(console.error);
