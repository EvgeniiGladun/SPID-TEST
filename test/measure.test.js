'use strict';

const http = require('node:http');
const zlib = require('node:zlib');
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
  warmup: false,
  freshConnection: false,
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
        WARMUP: '1',
        FRESH_CONNECTION: '0',
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
    assert.match(stdout, /Прогрев: 1 запрос, в итог не входит/);
    assert.match(stdout, /прогрев\./);
    assert.match(stdout, /до первого байта/);
    assert.match(stdout, /Минимум:/);
    assert.match(stdout, /Максимум:/);
    assert.match(stdout, /Медиана:/);
    assert.match(stdout, new RegExp(`Общий объём: .* \\(${payload.length * 2} байт\\)`));
    assert.match(stdout, /Скорость скачивания: .* МиБ\/с/);
  } finally {
    await close(server);
  }
});

test('прогрев не входит в итог, зачётные запросы идут по тому же соединению', async () => {
  const payload = Buffer.alloc(128, 3);
  const ports = [];
  const server = await listen((request, response) => {
    ports.push(request.socket.remotePort);
    response.writeHead(200, { 'Content-Length': String(payload.length) });
    response.end(payload);
  });

  try {
    const { port } = server.address();
    const result = await measure(new URL(`http://127.0.0.1:${port}/warm.bin`), {
      ...CONFIG,
      requestCount: 3,
      warmup: true,
      freshConnection: false,
    });

    assert.equal(ports.length, 4);
    assert.equal(new Set(ports).size, 1);
    assert.equal(result.samples.length, 3);
    assert.equal(result.totalBytes, payload.length * 3);
  } finally {
    await close(server);
  }
});

test('режим нового соединения открывает сокет на каждый запрос', async () => {
  const ports = [];
  const server = await listen((request, response) => {
    ports.push(request.socket.remotePort);
    response.writeHead(200, { 'Content-Length': '1' });
    response.end('x');
  });

  try {
    const { port } = server.address();
    const result = await measure(new URL(`http://127.0.0.1:${port}/fresh.bin`), {
      ...CONFIG,
      requestCount: 3,
      warmup: false,
      freshConnection: true,
    });

    assert.equal(result.samples.length, 3);
    assert.equal(ports.length, 3);
    assert.equal(new Set(ports).size, 3);
  } finally {
    await close(server);
  }
});

test('сжатое тело останавливает замер', async () => {
  const gzip = zlib.gzipSync(Buffer.alloc(4096, 9));
  const server = await listen((request, response) => {
    response.writeHead(200, {
      'Content-Encoding': 'gzip',
      'Content-Length': String(gzip.length),
    });
    response.end(gzip);
  });

  try {
    const { port } = server.address();
    await assert.rejects(
      measure(new URL(`http://127.0.0.1:${port}/gzip.bin`), { ...CONFIG, requestCount: 2 }),
      { code: ERROR_CODES.COMPRESSED },
    );
  } finally {
    await close(server);
  }
});

test('время до заголовков и время тела разделяются', async () => {
  const server = await listen((request, response) => {
    response.writeHead(200, { 'Content-Length': '4' });
    response.flushHeaders();
    setTimeout(() => response.end('abcd'), 50);
  });

  try {
    const { port } = server.address();
    const result = await measure(new URL(`http://127.0.0.1:${port}/split.bin`), {
      ...CONFIG,
      requestCount: 1,
    });
    const sample = result.samples[0];

    assert.equal(sample.bytes, 4);
    assert.ok(sample.bodyMs >= 40);
    assert.ok(sample.ttfbMs < sample.bodyMs);
    assert.ok(Math.abs(sample.elapsedMs - (sample.ttfbMs + sample.bodyMs)) < 1);
  } finally {
    await close(server);
  }
});

test('редирект учитывает только итоговое тело', async () => {
  const payload = Buffer.alloc(100, 2);
  const server = await listen((request, response) => {
    const isStart = request.url === '/start';
    if (isStart) {
      response.writeHead(302, { Location: '/file' });
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Length': String(payload.length) });
    response.end(payload);
  });

  try {
    const { port } = server.address();
    const result = await measure(new URL(`http://127.0.0.1:${port}/start`), {
      ...CONFIG,
      requestCount: 1,
    });
    assert.equal(result.totalBytes, payload.length);
    assert.equal(result.samples.length, 1);
  } finally {
    await close(server);
  }
});
