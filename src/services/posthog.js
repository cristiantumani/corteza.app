const { PostHog, setupExpressErrorHandler, setupExpressRequestContext } = require('posthog-node');

const apiKey = process.env.POSTHOG_PROJECT_TOKEN;
const host = process.env.POSTHOG_HOST;
const isProduction = process.env.NODE_ENV === 'production';

function requireConfiguration(variableName) {
  if (!isProduction && process.env.NODE_ENV !== 'test') {
    throw new Error(`${variableName} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variableName} is configured`);
  }
}

let posthog = null;

if (!apiKey) {
  requireConfiguration('POSTHOG_PROJECT_TOKEN');
} else if (!host) {
  requireConfiguration('POSTHOG_HOST');
} else {
  posthog = new PostHog(apiKey, {
    host,
    enableExceptionAutocapture: true,
    privacyMode: false
  });
}

module.exports = {
  posthog,
  setupExpressErrorHandler,
  setupExpressRequestContext
};
