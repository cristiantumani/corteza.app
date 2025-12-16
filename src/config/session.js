const session = require('express-session');
// connect-mongo v6 is an ES module, need to handle both CommonJS and ES module exports
const MongoStoreModule = require('connect-mongo');
const MongoStore = MongoStoreModule.default || MongoStoreModule;
const config = require('./environment');
const crypto = require('crypto');

/**
 * Creates and configures express-session middleware with MongoDB store
 * @returns {Function} Session middleware
 */
function createSessionMiddleware() {
  // Generate session secret from environment or create secure random one
  const sessionSecret = process.env.SESSION_SECRET || (() => {
    const generated = crypto.randomBytes(32).toString('hex');
    console.warn('⚠️  SESSION_SECRET not set. Generated temporary secret (NOT suitable for production)');
    console.warn('⚠️  Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    return generated;
  })();

  return session({
    // Session secret for signing cookies
    secret: sessionSecret,

    // Use MongoDB to store sessions
    store: MongoStore.create({
      mongoUrl: config.mongodb.uri,
      dbName: config.mongodb.dbName,
      collectionName: 'sessions',
      ttl: 7 * 24 * 60 * 60, // Session expires after 7 days
      autoRemove: 'native', // Use MongoDB's built-in TTL for cleanup
      touchAfter: 24 * 3600 // Update session only once per 24 hours (unless modified)
    }),

    // Cookie settings
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
      httpOnly: true, // Prevent JavaScript access to cookies (XSS protection)
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'lax' // CSRF protection
    },

    // Session options
    name: 'decision_logger_sid', // Custom session ID cookie name
    resave: false, // Don't save session if unmodified
    saveUninitialized: false, // Don't create session until something stored
    rolling: true // Reset expiration on every response
  });
}

module.exports = {
  createSessionMiddleware
};
