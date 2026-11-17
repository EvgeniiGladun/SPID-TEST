'use strict';

const {
  INDEX_PAD_CHAR,
  INDEX_PAD_LENGTH,
  TIME_DIGITS,
  UNIT_MIB,
  UNIT_MS,
  UNIT_SPEED,
} = require('../constants');
const { formatFixed, formatMib, formatSpeed } = require('../lib/format');
const { redactUrl } = require('../middleware/validate-url');

const printHeader = (url, requestCount) => {
  console.log(`Адрес: ${redactUrl(url)}`);
  console.log(`Запросов: ${requestCount}, один за другим\n`);
};

const printSample = (index, sample) => {
  console.log(
    `${String(index).padStart(INDEX_PAD_LENGTH, INDEX_PAD_CHAR)}. ${formatMib(sample.bytes)} ${UNIT_MIB}, ` +
      `${formatFixed(sample.elapsedMs, TIME_DIGITS)} ${UNIT_MS}, ` +
      `${formatSpeed(sample.bytes, sample.elapsedMs)} ${UNIT_SPEED}`,
  );
};

const printSummary = (result) => {
  console.log('');
  console.log(`Среднее время запроса: ${formatFixed(result.averageMs, TIME_DIGITS)} ${UNIT_MS}`);
  console.log(`Общий объём: ${formatMib(result.totalBytes)} ${UNIT_MIB} (${result.totalBytes} байт)`);
  console.log(`Скорость скачивания: ${formatSpeed(result.totalBytes, result.totalMs)} ${UNIT_SPEED}`);
};

module.exports = {
  printHeader,
  printSample,
  printSummary,
};
