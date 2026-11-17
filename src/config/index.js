'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const {
  DEFAULT_LOG_LEVEL,
  DEFAULT_REQUEST_COUNT,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
  DIGITS_PATTERN,
  DOUBLE_QUOTE,
  ENV,
  ENV_COMMENT_PREFIX,
  ENV_EXPORT_PREFIX,
  ENV_KEY_PATTERN,
  ERROR_CODES,
  FILE_NOT_FOUND,
  LOG_LEVEL_NAMES,
  MAX_REQUEST_COUNT,
  MAX_REQUEST_TIMEOUT_MS,
  MAX_USER_AGENT_LENGTH,
  MIN_QUOTED_LENGTH,
  SINGLE_QUOTE,
  USER_AGENT_FORBIDDEN,
} = require('../constants');
const { AppError } = require('../lib/errors');

const loadEnvFile = async (filePath) => {
  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    const fileIsMissing = error.code === FILE_NOT_FOUND;
    if (fileIsMissing) {
      return;
    }
    throw new AppError(`Не удалось прочитать ${filePath}.`, { code: ERROR_CODES.CONFIG, cause: error });
  }

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    const lineIsSkippable = !trimmed || trimmed.startsWith(ENV_COMMENT_PREFIX);
    if (lineIsSkippable) {
      continue;
    }

    const hasExportPrefix = trimmed.startsWith(ENV_EXPORT_PREFIX);
    const body = hasExportPrefix ? trimmed.slice(ENV_EXPORT_PREFIX.length).trim() : trimmed;
    const eq = body.indexOf('=');
    const separatorIsMissing = eq <= 0;
    if (separatorIsMissing) {
      throw new AppError(`Строка ${index + 1} в .env должна быть в виде KEY=VALUE.`, {
        code: ERROR_CODES.CONFIG,
      });
    }

    const key = body.slice(0, eq).trim();
    const keyIsInvalid = !ENV_KEY_PATTERN.test(key);
    if (keyIsInvalid) {
      throw new AppError(`Некорректное имя переменной в .env: ${key}`, { code: ERROR_CODES.CONFIG });
    }

    const rawValue = body.slice(eq + 1).trim();
    const doubleQuoted = rawValue.startsWith(DOUBLE_QUOTE) && rawValue.endsWith(DOUBLE_QUOTE);
    const singleQuoted = rawValue.startsWith(SINGLE_QUOTE) && rawValue.endsWith(SINGLE_QUOTE);
    const quoted = rawValue.length >= MIN_QUOTED_LENGTH && (doubleQuoted || singleQuoted);
    const value = quoted ? rawValue.slice(1, -1) : rawValue;

    const envValueIsUnset = process.env[key] === undefined;
    if (envValueIsUnset) {
      process.env[key] = value;
    }
  }
};

const readPositiveInt = (env, name, fallback, max) => {
  const raw = env[name];
  const rawIsEmpty = raw === undefined || raw === '';
  if (rawIsEmpty) {
    return fallback;
  }

  const rawIsNotInteger = !DIGITS_PATTERN.test(raw);
  if (rawIsNotInteger) {
    throw new AppError(`${name} должен быть целым числом больше нуля.`, { code: ERROR_CODES.CONFIG });
  }

  const value = Number(raw);
  const valueIsOutOfRange = !Number.isSafeInteger(value) || value <= 0 || value > max;
  if (valueIsOutOfRange) {
    throw new AppError(`${name} должен быть от 1 до ${max}.`, { code: ERROR_CODES.CONFIG });
  }

  return value;
};

const readUserAgent = (env) => {
  const value = env[ENV.USER_AGENT] || DEFAULT_USER_AGENT;
  const userAgentIsTooLong = value.length > MAX_USER_AGENT_LENGTH;
  const userAgentHasForbiddenChars = USER_AGENT_FORBIDDEN.test(value);
  const userAgentIsInvalid = userAgentIsTooLong || userAgentHasForbiddenChars;
  if (userAgentIsInvalid) {
    throw new AppError(`USER_AGENT должен быть одной строкой не длиннее ${MAX_USER_AGENT_LENGTH} символов.`, {
      code: ERROR_CODES.CONFIG,
    });
  }
  return value;
};

const createConfig = (env) => {
  const logLevel = env[ENV.LOG_LEVEL] || DEFAULT_LOG_LEVEL;
  const logLevelIsUnknown = !LOG_LEVEL_NAMES.includes(logLevel);
  if (logLevelIsUnknown) {
    throw new AppError(`LOG_LEVEL должен быть одним из: ${LOG_LEVEL_NAMES.join(', ')}.`, {
      code: ERROR_CODES.CONFIG,
    });
  }

  return Object.freeze({
    requestCount: readPositiveInt(env, ENV.REQUEST_COUNT, DEFAULT_REQUEST_COUNT, MAX_REQUEST_COUNT),
    requestTimeoutMs: readPositiveInt(
      env,
      ENV.REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
      MAX_REQUEST_TIMEOUT_MS,
    ),
    logLevel,
    userAgent: readUserAgent(env),
  });
};

const loadConfig = async (rootDir) => {
  await loadEnvFile(path.join(rootDir, ENV.FILE_NAME));
  return createConfig(process.env);
};

module.exports = {
  loadEnvFile,
  createConfig,
  loadConfig,
};
