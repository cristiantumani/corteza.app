/**
 * Simple module loading test
 * Tests that all modules can be loaded without errors
 */

console.log('Testing module loading...\n');

try {
  console.log('✓ Loading config/environment...');
  const config = require('./src/config/environment');
  console.log('  - Port:', config.port);
  console.log('  - Jira configured:', config.jira.isConfigured);

  console.log('\n✓ Loading config/database...');
  const db = require('./src/config/database');
  console.log('  - Functions:', Object.keys(db).join(', '));

  console.log('\n✓ Loading services/jira...');
  const jira = require('./src/services/jira');
  console.log('  - Functions:', Object.keys(jira).join(', '));

  console.log('\n✓ Loading middleware/validation...');
  const validation = require('./src/middleware/validation');
  console.log('  - Functions:', Object.keys(validation).join(', '));

  console.log('\n✓ Loading routes/api...');
  const api = require('./src/routes/api');
  console.log('  - Functions:', Object.keys(api).join(', '));

  console.log('\n✓ Loading routes/dashboard...');
  const dashboard = require('./src/routes/dashboard');
  console.log('  - Functions:', Object.keys(dashboard).join(', '));

  console.log('\n✓ Loading routes/slack...');
  const slack = require('./src/routes/slack');
  console.log('  - Functions:', Object.keys(slack).join(', '));

  console.log('\n✅ All modules loaded successfully!');
  console.log('\n📁 Project structure:');
  console.log('  src/');
  console.log('  ├── config/');
  console.log('  │   ├── environment.js  (env validation)');
  console.log('  │   └── database.js     (MongoDB connection)');
  console.log('  ├── services/');
  console.log('  │   └── jira.js         (Jira integration)');
  console.log('  ├── middleware/');
  console.log('  │   └── validation.js   (input validation)');
  console.log('  ├── routes/');
  console.log('  │   ├── api.js          (REST API endpoints)');
  console.log('  │   ├── dashboard.js    (Dashboard route)');
  console.log('  │   └── slack.js        (Slack commands)');
  console.log('  ├── views/');
  console.log('  │   └── dashboard.html  (Dashboard UI)');
  console.log('  └── index.js            (Main entry point)');

  console.log('\n🚀 Ready to run: npm start');
  process.exit(0);

} catch (error) {
  console.error('\n❌ Module loading failed:');
  console.error(error);
  process.exit(1);
}
