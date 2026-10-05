/**
 * Approve someone for the private beta (BETA_REQUIRED=true) without the email link.
 * Useful for people who signed up before the Approve link existed, or a whole company.
 *
 * Usage:
 *   node scripts/beta-approve.js ana@acme.com                     # approve an email
 *   node scripts/beta-approve.js ana@acme.com --name Ana --welcome  # ...and send the welcome email
 *   node scripts/beta-approve.js ana@acme.com --welcome --lang es    # the welcome email in Spanish (default English)
 *   node scripts/beta-approve.js acme.com                          # approve a whole Google Workspace domain
 *   node scripts/beta-approve.js --list                            # show the approved list
 */
require('dotenv').config();
const database = require('../src/config/database');
const beta = require('../src/core/beta/beta-access');
const { approveBetaTester } = require('../src/core/beta/approve');

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
}

async function main() {
  const target = (process.argv[2] || '').trim().toLowerCase();
  if (!target || (target.startsWith('--') && target !== '--list')) {
    console.error('Usage: node scripts/beta-approve.js <email|domain> [--name <first name>] [--welcome] [--lang es] | --list');
    process.exit(1);
  }

  process.env.NODE_ENV = process.env.NODE_ENV || 'script'; // skip the outbound-IP log
  await database.connectToMongoDB();

  if (target === '--list') {
    const entries = await database.getDatabase().collection('beta_access').find({}).sort({ approved_at: -1 }).toArray();
    entries.forEach(e => console.log(`   ${e.email || `*@${e.domain}`}  ${e.approved_at.toISOString().slice(0, 10)}  ${e.approved_via}${e.welcome_sent_at ? '  (welcomed)' : ''}`));
    console.log(`\n${entries.length} approved`);
  } else if (target.includes('@')) {
    if (process.argv.includes('--welcome')) {
      const result = await approveBetaTester({ email: target, name: argument('name'), approvedVia: 'script', lang: argument('lang') === 'es' ? 'es' : 'en' });
      console.log(`Welcome email: ${result.welcome}${result.error ? ` (${result.error})` : ''}`);
    } else {
      const { alreadyApproved } = await beta.approve({ email: target, name: argument('name'), approvedVia: 'script' });
      console.log(alreadyApproved ? `${target} was already approved` : `✅ ${target} approved (no email sent; add --welcome to send one)`);
    }
  } else {
    const { alreadyApproved } = await beta.approve({ domain: target, approvedVia: 'script' });
    console.log(alreadyApproved ? `${target} was already approved` : `✅ Everyone with a ${target} Google Workspace account can now create a workspace`);
  }

  if (!beta.isBetaRequired()) console.log('ℹ️  BETA_REQUIRED is not "true" here, so the list is not enforced in this environment.');
  await database.closeMongoDB();
}

main().catch(error => {
  console.error('❌ Failed:', error);
  process.exit(1);
});
