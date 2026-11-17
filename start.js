'use strict';

const path = require('node:path');

const { ENV, EXIT_CODE_FAILURE } = require('./src/constants');
const { printHeader, printSample, printSummary } = require('./src/cli/report');
const { loadConfig } = require('./src/config');
const { createLogger } = require('./src/lib/logger');
const { handleFatal } = require('./src/lib/errors');
const { readUrl, redactUrl } = require('./src/middleware/validate-url');
const { measure } = require('./src/services/measure');

const fallbackLogger = createLogger(process.env[ENV.LOG_LEVEL]);

const installGlobalHandlers = (getLogger) => {
  process.on('unhandledRejection', (reason) => {
    handleFatal(reason instanceof Error ? reason : new Error(String(reason)), getLogger());
  });

  process.on('uncaughtException', (error) => {
    handleFatal(error, getLogger());
    process.exit(process.exitCode || EXIT_CODE_FAILURE);
  });
};

const main = async () => {
  let logger = fallbackLogger;
  installGlobalHandlers(() => logger);

  try {
    const config = await loadConfig(path.join(__dirname));
    logger = createLogger(config.logLevel);
    const url = readUrl(process.argv[2]);

    logger.info('measurement.start', {
      url: redactUrl(url),
      requests: config.requestCount,
    });

    printHeader(url, config.requestCount);
    const result = await measure(url, config, printSample);
    printSummary(result);

    logger.info('measurement.finish', {
      bytes: result.totalBytes,
      durationMs: Math.round(result.totalMs),
    });
  } catch (error) {
    handleFatal(error, logger);
  }
};

main();
