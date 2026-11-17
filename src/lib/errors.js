'use strict';

const { ERROR_CODES, EXIT_CODE_FAILURE } = require('../constants');

class AppError extends Error {
  constructor(message, { code = ERROR_CODES.APP, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AppError';
    this.code = code;
  }
}

const handleFatal = (error, logger) => {
  const known = error instanceof AppError;
  const message = known
    ? error.message
    : (error && error.message) || 'Внутренняя ошибка замера.';

  logger.error(message, { code: known ? error.code : ERROR_CODES.INTERNAL });

  const hasUnexpectedStack = !known && error && error.stack;
  if (hasUnexpectedStack) {
    logger.debug(error.stack);
  }

  process.exitCode = EXIT_CODE_FAILURE;
};

module.exports = {
  AppError,
  handleFatal,
};
