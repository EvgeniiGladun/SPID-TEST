'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_FRESH_CONNECTION,
  DEFAULT_LOG_LEVEL,
  DEFAULT_REQUEST_COUNT,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
  DEFAULT_WARMUP,
  ENV,
  ERROR_CODES,
  MAX_REQUEST_COUNT,
} = require('../src/constants');
const { createConfig, loadEnvFile } = require('../src/config');

test('подставляет значения по умолчанию', () => {
  const config = createConfig({});
  assert.deepEqual(config, {
    requestCount: DEFAULT_REQUEST_COUNT,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    logLevel: DEFAULT_LOG_LEVEL,
    userAgent: DEFAULT_USER_AGENT,
    warmup: DEFAULT_WARMUP,
    freshConnection: DEFAULT_FRESH_CONNECTION,
  });
});

test('читает числовые настройки и отклоняет мусор', () => {
  const config = createConfig({
    [ENV.REQUEST_COUNT]: '3',
    [ENV.REQUEST_TIMEOUT_MS]: '5000',
    [ENV.LOG_LEVEL]: 'error',
  });
  assert.equal(config.requestCount, 3);
  assert.equal(config.requestTimeoutMs, 5000);
  assert.equal(config.logLevel, 'error');

  assert.throws(() => createConfig({ [ENV.REQUEST_COUNT]: '0' }), { code: ERROR_CODES.CONFIG });
  assert.throws(() => createConfig({ [ENV.REQUEST_COUNT]: String(MAX_REQUEST_COUNT + 1) }), {
    code: ERROR_CODES.CONFIG,
  });
  assert.throws(() => createConfig({ [ENV.LOG_LEVEL]: 'verbose' }), { code: ERROR_CODES.CONFIG });
  assert.throws(() => createConfig({ [ENV.USER_AGENT]: 'bad\nagent' }), { code: ERROR_CODES.CONFIG });
  assert.throws(() => createConfig({ [ENV.WARMUP]: 'yes' }), { code: ERROR_CODES.CONFIG });
  assert.throws(() => createConfig({ [ENV.FRESH_CONNECTION]: '2' }), { code: ERROR_CODES.CONFIG });
});

test('читает флаги прогрева и нового соединения', () => {
  const config = createConfig({
    [ENV.WARMUP]: '0',
    [ENV.FRESH_CONNECTION]: '1',
  });
  assert.equal(config.warmup, false);
  assert.equal(config.freshConnection, true);
});

test('файл .env не перезаписывает уже заданные переменные', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spid-test-'));
  const key = 'SPID_TEST_ENV_PROBE';
  const previous = process.env[key];
  process.env[key] = 'from-shell';

  try {
    await fs.writeFile(path.join(directory, '.env'), `${key}=from-file\n# comment\n`, 'utf8');
    await loadEnvFile(path.join(directory, '.env'));
    assert.equal(process.env[key], 'from-shell');
    delete process.env[key];
    await loadEnvFile(path.join(directory, '.env'));
    assert.equal(process.env[key], 'from-file');
  } finally {
    previous === undefined ? delete process.env[key] : (process.env[key] = previous);
    await fs.rm(directory, { recursive: true, force: true });
  }
});
