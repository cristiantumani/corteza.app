const session = require('express-session');
// connect-mongo v6 is an ES module, need to handle both CommonJS and ES module exports
const MongoStoreModule = require('connect-mongo');
const MongoStore = MongoStoreModule.default || MongoStoreModule;
const config = require('./environment');

/**
 * Creates and configures express-session middleware with MongoDB store
 * @returns {Function} Session middleware
 */
function createSessionMiddleware() {
  // Security: SESSION_SECRET is required (validated in environment.js)
  return session({
    // Session secret for signing cookies
    secret: process.env.SESSION_SECRET,

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
