'use strict';

const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_REQUEST_COUNT, ERROR_CODES } = require('../src/constants');
const { measure } = require('../src/services/measure');

const CONFIG = {
  requestCount: DEFAULT_REQUEST_COUNT,
  requestTimeoutMs: 5_000,
  logLevel: 'silent',
  userAgent: 'spid-test/test',
};

const listen = (handler) => {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
};

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => (error ? reject(error) : resolve()));
});

test('десять запросов идут по очереди и тело считается целиком', async () => {
  const payload = Buffer.alloc(64 * 1024, 7);
  let inFlight = 0;
  let maxInFlight = 0;

  const server = await listen((request, response) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    setTimeout(() => {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.write(payload.subarray(0, 1024));
      response.end(payload.subarray(1024));
      inFlight -= 1;
    }, 20);
  });

  try {
    const { port } = server.address();
    const result = await measure(new URL(`http://127.0.0.1:${port}/blob.bin`), CONFIG);
    assert.equal(result.samples.length, DEFAULT_REQUEST_COUNT);
    assert.equal(result.totalBytes, payload.length * DEFAULT_REQUEST_COUNT);
    assert.equal(maxInFlight, 1);
  } finally {
    await close(server);
  }
});

test('ответ не 2xx останавливает замер', async () => {
  const server = await listen((request, response) => {
    response.writeHead(500, { 'Content-Type': 'text/plain' });
    response.end('nope');
  });

  try {
    const { port } = server.address();
    await assert.rejects(
      measure(new URL(`http://127.0.0.1:${port}/fail`), { ...CONFIG, requestCount: 2 }),
      { code: ERROR_CODES.HTTP },
    );
  } finally {
    await close(server);
  }
});

test('без адреса команда завершается с кодом 1', async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'start.js')], {
    env: { ...process.env, LOG_LEVEL: 'error' },
  });

  let stderr = '';
  child.stdout.on('data', () => {});
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const code = await new Promise((resolve) => {
    child.on('close', resolve);
  });

  assert.equal(code, 1);
  assert.match(stderr, /Укажите адрес/);
  assert.match(stderr, new RegExp(ERROR_CODES.MISSING_URL));
});

test('команда печатает итог и код 0', async () => {
  const payload = Buffer.alloc(1024, 1);
  const server = await listen((request, response) => {
    response.writeHead(200, { 'Content-Length': String(payload.length) });
    response.end(payload);
  });

  try {
    const { port } = server.address();
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'start.js'), `http://127.0.0.1:${port}/a.bin`], {
      env: {
        ...process.env,
        REQUEST_COUNT: '2',
        LOG_LEVEL: 'silent',
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    const code = await new Promise((resolve) => {
      child.on('close', resolve);
    });

    assert.equal(code, 0, stderr);
    assert.match(stdout, /Запросов: 2/);
    assert.match(stdout, new RegExp(`Общий объём: .* \\(${payload.length * 2} байт\\)`));
    assert.match(stdout, /Скорость скачивания: .* МиБ\/с/);
  } finally {
    await close(server);
  }
});
