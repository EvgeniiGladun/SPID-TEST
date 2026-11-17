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

const formatSample = (label, sample) => (
  `${label} ${formatMib(sample.bytes)} ${UNIT_MIB}, ` +
  `${formatFixed(sample.elapsedMs, TIME_DIGITS)} ${UNIT_MS}, ` +
  `до первого байта ${formatFixed(sample.ttfbMs, TIME_DIGITS)} ${UNIT_MS}, ` +
  `тело ${formatFixed(sample.bodyMs, TIME_DIGITS)} ${UNIT_MS}, ` +
  `${formatSpeed(sample.bytes, sample.elapsedMs)} ${UNIT_SPEED}`
);

const printHeader = (url, config) => {
  const warmupText = config.warmup ? '1 запрос, в итог не входит' : 'выключен';
  const connectionText = config.freshConnection ? 'новое на каждый запрос' : 'повторно используется';

  console.log(`Адрес: ${redactUrl(url)}`);
  console.log(`Запросов: ${config.requestCount}, один за другим`);
  console.log(`Прогрев: ${warmupText}`);
  console.log(`Соединение: ${connectionText}\n`);
};

const printWarmup = (sample) => {
  console.log(formatSample('прогрев.', sample));
};

const printSample = (index, sample) => {
  const label = `${String(index).padStart(INDEX_PAD_LENGTH, INDEX_PAD_CHAR)}.`;
  console.log(formatSample(label, sample));
};

const printSummary = (result) => {
  console.log(`Среднее время запроса: ${formatFixed(result.averageMs, TIME_DIGITS)} ${UNIT_MS}`);
  console.log(`Минимум: ${formatFixed(result.minMs, TIME_DIGITS)} ${UNIT_MS}`);
  console.log(`Максимум: ${formatFixed(result.maxMs, TIME_DIGITS)} ${UNIT_MS}`);
  console.log(`Медиана: ${formatFixed(result.medianMs, TIME_DIGITS)} ${UNIT_MS}`);
  console.log(`Среднее до первого байта: ${formatFixed(result.averageTtfbMs, TIME_DIGITS)} ${UNIT_MS}`);
  console.log(`Среднее время тела: ${formatFixed(result.averageBodyMs, TIME_DIGITS)} ${UNIT_MS}`);
  console.log(`Общий объём: ${formatMib(result.totalBytes)} ${UNIT_MIB} (${result.totalBytes} байт)`);
  console.log(`Скорость скачивания: ${formatSpeed(result.totalBytes, result.totalMs)} ${UNIT_SPEED}`);
};

module.exports = {
  printHeader,
  printWarmup,
  printSample,
  printSummary,
};
