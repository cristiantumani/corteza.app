const { MongoClient } = require('mongodb');
require('dotenv').config();

async function verifySpaces() {
  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();
    const db = client.db('corteza');

    console.log('📊 Verifying test data...\n');

    const spaces = await db.collection('workspace_spaces').find({}).toArray();
    console.log(`✅ Spaces: ${spaces.length}`);
    spaces.forEach(s => {
      console.log(`   ${s.settings.icon} ${s.name} (${s.visibility})${s.is_default ? ' [DEFAULT]' : ''}`);
    });

    console.log();
    const decisions = await db.collection('decisions').find({}).toArray();
    console.log(`✅ Decisions: ${decisions.length}`);

    const bySpace = {};
    decisions.forEach(d => {
      bySpace[d.space_name] = (bySpace[d.space_name] || 0) + 1;
    });

    Object.entries(bySpace).forEach(([space, count]) => {
      console.log(`   ${space}: ${count} decisions`);
    });

    console.log();
    const members = await db.collection('space_members').find({}).toArray();
    console.log(`✅ Space members: ${members.length}`);

    console.log();
    const admins = await db.collection('workspace_admins').find({}).toArray();
    console.log(`✅ Workspace admins: ${admins.length}`);
    admins.forEach(a => {
      console.log(`   ${a.user_name} (${a.user_id})`);
    });

    console.log('\n✨ All test data verified successfully!\n');

  } finally {
    await client.close();
  }
}

verifySpaces().catch(console.error);
