'use strict';

const { DECIMAL_DIGITS, MIB, MS_IN_SECOND } = require('../constants');

const formatFixed = (value, digits) => Number(value).toFixed(digits);

const formatMib = (bytes) => formatFixed(bytes / MIB, DECIMAL_DIGITS);

const formatSpeed = (bytes, elapsedMs) => (
  elapsedMs <= 0
    ? formatFixed(0, DECIMAL_DIGITS)
    : formatFixed(bytes / MIB / (elapsedMs / MS_IN_SECOND), DECIMAL_DIGITS)
);

module.exports = {
  formatFixed,
  formatMib,
  formatSpeed,
};
