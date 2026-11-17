'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DECIMAL_DIGITS, MIB, TIME_DIGITS } = require('../src/constants');
const { formatFixed, formatMib, formatSpeed } = require('../src/lib/format');
const { summarize } = require('../src/services/measure');

test('округляет число и числовую строку до заданных знаков', () => {
  assert.equal(formatFixed(1.2, DECIMAL_DIGITS), '1.20');
  assert.equal(formatFixed('1.2', DECIMAL_DIGITS), '1.20');
  assert.equal(formatFixed(840.4, TIME_DIGITS), '840');
});

test('форматирует объём в мебибайтах', () => {
  assert.equal(formatMib(MIB), '1.00');
  assert.equal(formatMib(MIB * 2.5), '2.50');
});

test('скорость считается по сумме байт и сумме времени', () => {
  const result = summarize([
    { bytes: MIB, elapsedMs: 100 },
    { bytes: MIB, elapsedMs: 900 },
  ]);

  assert.equal(result.totalBytes, 2 * MIB);
  assert.equal(result.totalMs, 1000);
  assert.equal(result.averageMs, 500);
  assert.equal(formatSpeed(result.totalBytes, result.totalMs), '2.00');
});

test('нулевая длительность не даёт бесконечную скорость', () => {
  assert.equal(formatSpeed(100, 0), '0.00');
});
