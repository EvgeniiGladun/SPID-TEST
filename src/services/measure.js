'use strict';

const {
  ERROR_CODES,
  FETCH,
  FETCH_ERROR_NAMES,
  MS_IN_SECOND,
} = require('../constants');
const { AppError } = require('../lib/errors');

const summarize = (samples) => {
  const totalBytes = samples.reduce((sum, sample) => sum + sample.bytes, 0);
  const totalMs = samples.reduce((sum, sample) => sum + sample.elapsedMs, 0);

  return {
    samples,
    totalBytes,
    totalMs,
    averageMs: samples.length === 0 ? 0 : totalMs / samples.length,
  };
};

const normalizeFetchError = (error, config) => {
  const isAppError = error instanceof AppError;
  if (isAppError) {
    return error;
  }

  const requestTimedOut =
    error.name === FETCH_ERROR_NAMES.TIMEOUT || error.name === FETCH_ERROR_NAMES.ABORT;
  if (requestTimedOut) {
    return new AppError(
      `Запрос не завершился за ${config.requestTimeoutMs / MS_IN_SECOND} секунд.`,
      { code: ERROR_CODES.TIMEOUT, cause: error },
    );
  }

  const cause = error.cause;
  const detail = cause && cause.message ? `${error.message}: ${cause.message}` : error.message;
  return new AppError(detail || 'Не удалось выполнить запрос.', { code: ERROR_CODES.NETWORK, cause: error });
};

const readBodyBytes = async (stream) => {
  const reader = stream.getReader();
  let bytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bytes += value.byteLength;
    }
    return bytes;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
};

const downloadOnce = async (url, config) => {
  const startedAt = performance.now();

  try {
    const response = await fetch(url, {
      redirect: FETCH.REDIRECT,
      cache: FETCH.CACHE,
      headers: {
        // Просим несжатое тело, чтобы посчитанные байты были байтами ответа, а не распакованного gzip.
        [FETCH.ACCEPT_ENCODING_HEADER]: FETCH.ACCEPT_ENCODING_VALUE,
        [FETCH.USER_AGENT_HEADER]: config.userAgent,
      },
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });

    const responseFailed = !response.ok;
    if (responseFailed) {
      await response.body?.cancel();
      throw new AppError(`Сервер ответил ${response.status} ${response.statusText}`, {
        code: ERROR_CODES.HTTP,
      });
    }

    const bytes = response.body ? await readBodyBytes(response.body) : 0;
    return {
      bytes,
      elapsedMs: performance.now() - startedAt,
    };
  } catch (error) {
    throw normalizeFetchError(error, config);
  }
};

const measure = async (url, config, onSample) => {
  const samples = [];

  for (let index = 1; index <= config.requestCount; index += 1) {
    const sample = await downloadOnce(url, config);
    samples.push(sample);
    if (onSample) {
      onSample(index, sample);
    }
  }

  return summarize(samples);
};

module.exports = {
  summarize,
  measure,
};
