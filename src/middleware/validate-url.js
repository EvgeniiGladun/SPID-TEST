'use strict';

const {
  ALLOWED_PROTOCOLS,
  ERROR_CODES,
  HTTP_PROTOCOL,
  HTTPS_PROTOCOL,
  MAX_URL_LENGTH,
} = require('../constants');
const { AppError } = require('../lib/errors');

const readUrl = (raw) => {
  const urlIsMissing = !raw;
  if (urlIsMissing) {
    throw new AppError(
      [
        'Укажите адрес для замера.',
        'Запуск: node start.js <url>',
        'Пример: node start.js https://example.com/image.jpg',
      ].join('\n'),
      { code: ERROR_CODES.MISSING_URL },
    );
  }

  const urlIsTooLong = raw.length > MAX_URL_LENGTH;
  if (urlIsTooLong) {
    throw new AppError(`Адрес длиннее ${MAX_URL_LENGTH} символов.`, { code: ERROR_CODES.INVALID_URL });
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(`Некорректный адрес: ${raw}`, { code: ERROR_CODES.INVALID_URL });
  }

  const protocolIsNotAllowed = !ALLOWED_PROTOCOLS.includes(url.protocol);
  if (protocolIsNotAllowed) {
    throw new AppError(`Адрес должен начинаться с ${HTTP_PROTOCOL}// или ${HTTPS_PROTOCOL}//`, {
      code: ERROR_CODES.INVALID_URL,
    });
  }

  const hostnameIsMissing = !url.hostname;
  if (hostnameIsMissing) {
    throw new AppError('В адресе нет имени хоста.', { code: ERROR_CODES.INVALID_URL });
  }

  return url;
};

const redactUrl = (url) => {
  const copy = new URL(url.href);
  copy.username = '';
  copy.password = '';
  return copy.href;
};

module.exports = {
  readUrl,
  redactUrl,
};
