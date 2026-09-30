const apiKey = process.env.POSTHOG_PROJECT_TOKEN;
const host = process.env.POSTHOG_HOST;
const isProduction = process.env.NODE_ENV === 'production';

function requireConfiguration(variableName) {
  if (!isProduction && process.env.NODE_ENV !== 'test') {
    throw new Error(`${variableName} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variableName} is configured`);
  }
}

let posthogLogger = null;

if (!apiKey) {
  requireConfiguration('POSTHOG_PROJECT_TOKEN');
} else if (!host) {
  requireConfiguration('POSTHOG_HOST');
} else {
  const { logs } = require('@opentelemetry/api-logs');
  const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  const { BatchLogRecordProcessor, LoggerProvider } = require('@opentelemetry/sdk-logs');

  const exporter = new OTLPLogExporter({
    url: new URL('/i/v1/logs', host).toString(),
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });
  const loggerProvider = new LoggerProvider({
    resource: resourceFromAttributes({
      'service.name': 'corteza'
    }),
    processors: [new BatchLogRecordProcessor(exporter)]
  });

  // This provider only receives records emitted by the dedicated logger below.
  logs.setGlobalLoggerProvider(loggerProvider);
  posthogLogger = logs.getLogger('corteza.posthog-integration');
}

function emitPostHogLog(severityText, body, attributes = {}) {
  if (posthogLogger) {
    posthogLogger.emit({ severityText, body, attributes });
  }
}

module.exports = { emitPostHogLog };
