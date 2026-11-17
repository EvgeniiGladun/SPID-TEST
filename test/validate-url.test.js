'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ERROR_CODES } = require('../src/constants');
const { readUrl, redactUrl } = require('../src/middleware/validate-url');

test('принимает http и https', () => {
  assert.equal(readUrl('https://example.com/a.jpg').href, 'https://example.com/a.jpg');
  assert.equal(readUrl('http://127.0.0.1:9/x').hostname, '127.0.0.1');
});

test('отклоняет пустой адрес, чужой протокол и адрес без хоста', () => {
  assert.throws(() => readUrl(), { code: ERROR_CODES.MISSING_URL });
  assert.throws(() => readUrl('ftp://example.com/a'), { code: ERROR_CODES.INVALID_URL });
  assert.throws(() => readUrl('not a url'), { code: ERROR_CODES.INVALID_URL });
  assert.throws(() => readUrl('http://'), { code: ERROR_CODES.INVALID_URL });
});

test('убирает логин и пароль из адреса для печати', () => {
  const url = readUrl('https://user:secret@example.com/file.bin?x=1');
  assert.equal(redactUrl(url), 'https://example.com/file.bin?x=1');
});
