/**
 * Test database helper.
 *
 * Integration tests need a MongoDB server. Set TEST_MONGODB_URI (CI starts a
 * `mongo` service container, see .github/workflows/ci.yml). Without it, the
 * integration tests are skipped so `npm test` still runs the unit tests locally.
 *
 * Each test file gets its own throwaway database, dropped when it finishes.
 */
const crypto = require('crypto');

const TEST_MONGODB_URI = process.env.TEST_MONGODB_URI;
const skip = TEST_MONGODB_URI ? false : 'TEST_MONGODB_URI not set (integration tests need MongoDB)';

/**
 * Connects the app's database module to a fresh test database.
 * Must run before any module that reads config/environment is required.
 * @returns {Promise<{ database: object, cleanup: Function }>}
 */
async function setupTestDatabase() {
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = TEST_MONGODB_URI;
  process.env.DB_NAME = `corteza_test_${crypto.randomBytes(4).toString('hex')}`;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';

  const database = require('../../src/config/database');
  await database.connectToMongoDB();

  return {
    database,
    cleanup: async () => {
      await database.getDatabase().dropDatabase();
      await database.closeMongoDB();
    }
  };
}

module.exports = { setupTestDatabase, skip };
