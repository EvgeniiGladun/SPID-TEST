'use strict';

const http = require('node:http');
const https = require('node:https');

const {
  ALLOWED_PROTOCOLS,
  ERROR_CODES,
  FETCH,
  FETCH_ERROR_NAMES,
  HTTP_OK_BEFORE,
  HTTP_OK_FROM,
  HTTPS_PROTOCOL,
  MAX_ENCODING_LABEL,
  MAX_REDIRECTS,
  MS_IN_SECOND,
  REDIRECT_STATUSES,
} = require('../constants');
const { AppError } = require('../lib/errors');

const median = (values) => {
  const countIsEmpty = values.length === 0;
  if (countIsEmpty) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const countIsEven = sorted.length % 2 === 0;
  return countIsEven ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const summarize = (samples) => {
  const totalBytes = samples.reduce((sum, sample) => sum + sample.bytes, 0);
  const totalMs = samples.reduce((sum, sample) => sum + sample.elapsedMs, 0);
  const totalTtfbMs = samples.reduce((sum, sample) => sum + sample.ttfbMs, 0);
  const totalBodyMs = samples.reduce((sum, sample) => sum + sample.bodyMs, 0);
  const elapsed = samples.map((sample) => sample.elapsedMs);
  const count = samples.length;
  const countIsEmpty = count === 0;

  return {
    samples,
    totalBytes,
    totalMs,
    averageMs: countIsEmpty ? 0 : totalMs / count,
    averageTtfbMs: countIsEmpty ? 0 : totalTtfbMs / count,
    averageBodyMs: countIsEmpty ? 0 : totalBodyMs / count,
    minMs: countIsEmpty ? 0 : Math.min(...elapsed),
    maxMs: countIsEmpty ? 0 : Math.max(...elapsed),
    medianMs: median(elapsed),
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

const createAgents = (freshConnection) => {
  // Один сокет на протокол: прогрев открывает соединение, зачётные запросы идут по нему же.
  const agentOptions = {
    keepAlive: !freshConnection,
    maxSockets: 1,
  };

  return {
    http: new http.Agent(agentOptions),
    https: new https.Agent(agentOptions),
  };
};

const destroyAgents = (agents) => {
  agents.http.destroy();
  agents.https.destroy();
};

const headerText = (value) => {
  const valueIsMissing = value === undefined;
  if (valueIsMissing) {
    return '';
  }
  return Array.isArray(value) ? value.join(',') : String(value);
};

const sendRequest = (url, config, agents, signal) => new Promise((resolve, reject) => {
  const urlIsHttps = url.protocol === HTTPS_PROTOCOL;
  const client = urlIsHttps ? https : http;
  const agent = urlIsHttps ? agents.https : agents.http;
  const headers = {
    [FETCH.ACCEPT_ENCODING_HEADER]: FETCH.ACCEPT_ENCODING_VALUE,
    [FETCH.USER_AGENT_HEADER]: config.userAgent,
  };

  if (config.freshConnection) {
    headers[FETCH.CONNECTION_HEADER] = FETCH.CONNECTION_CLOSE;
  }

  const request = client.request(url, {
    method: 'GET',
    agent,
    headers,
    signal,
  }, (response) => {
    response.pause();
    resolve(response);
  });

  request.on('error', reject);
  request.end();
});

const dropResponse = (response) => {
  response.on('error', () => {});
  response.destroy();
};

const discardBody = (response) => new Promise((resolve, reject) => {
  response.on('error', reject);
  response.on('end', resolve);
  response.resume();
});

const readBody = (response, startedAt) => new Promise((resolve, reject) => {
  const headersAt = performance.now();
  let bytes = 0;
  let settled = false;

  const finish = (callback, value) => {
    if (settled) {
      return;
    }
    settled = true;
    callback(value);
  };

  response.on('data', (chunk) => {
    bytes += chunk.length;
  });
  response.on('end', () => {
    const finishedAt = performance.now();
    finish(resolve, {
      bytes,
      elapsedMs: finishedAt - startedAt,
      ttfbMs: headersAt - startedAt,
      bodyMs: finishedAt - headersAt,
    });
  });
  response.on('error', (error) => finish(reject, error));
  // pause() в sendRequest оставляет поток остановленным: слушатель data сам его не запускает.
  response.resume();
});

const encodingTokens = (response) => headerText(response.headers[FETCH.CONTENT_ENCODING_HEADER])
  .split(',')
  .map((part) => part.trim().toLowerCase())
  .filter((part) => part.length > 0);

const assertIdentityBody = (response) => {
  const compressed = encodingTokens(response)
    .filter((token) => token !== FETCH.ACCEPT_ENCODING_VALUE);
  const bodyIsCompressed = compressed.length > 0;
  if (bodyIsCompressed) {
    dropResponse(response);
    const encodingLabel = compressed.join(', ').slice(0, MAX_ENCODING_LABEL);
    throw new AppError(
      `Сервер отдал сжатое тело (${encodingLabel}), хотя запрошен несжатый ответ. Объём после распаковки завысил бы скорость.`,
      { code: ERROR_CODES.COMPRESSED },
    );
  }
};

const assertRedirectTarget = (response, location, currentUrl) => {
  const locationIsMissing = location.length === 0;
  if (locationIsMissing) {
    dropResponse(response);
    throw new AppError('Редирект без адреса Location.', { code: ERROR_CODES.REDIRECT });
  }

  let nextUrl;
  try {
    nextUrl = new URL(location, currentUrl);
  } catch (error) {
    dropResponse(response);
    throw new AppError('Редирект содержит некорректный адрес.', {
      code: ERROR_CODES.INVALID_URL,
      cause: error,
    });
  }

  const protocolIsNotAllowed = !ALLOWED_PROTOCOLS.includes(nextUrl.protocol);
  if (protocolIsNotAllowed) {
    dropResponse(response);
    throw new AppError('Редирект ведёт на неподдерживаемый протокол.', { code: ERROR_CODES.INVALID_URL });
  }

  return nextUrl;
};

const downloadOnce = async (url, config, agents) => {
  const startedAt = performance.now();
  const signal = AbortSignal.timeout(config.requestTimeoutMs);
  let currentUrl = url;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await sendRequest(currentUrl, config, agents, signal);
      const status = response.statusCode;
      const isRedirect = REDIRECT_STATUSES.includes(status);

      if (isRedirect) {
        const followedTooMany = hop === MAX_REDIRECTS;
        if (followedTooMany) {
          dropResponse(response);
          throw new AppError('Слишком много редиректов.', { code: ERROR_CODES.REDIRECT });
        }

        const location = headerText(response.headers[FETCH.LOCATION_HEADER]);
        const nextUrl = assertRedirectTarget(response, location, currentUrl);
        await discardBody(response);
        currentUrl = nextUrl;
        continue;
      }

      const responseFailed = status < HTTP_OK_FROM || status >= HTTP_OK_BEFORE;
      if (responseFailed) {
        dropResponse(response);
        throw new AppError(`Сервер ответил ${status} ${response.statusMessage || ''}`.trim(), {
          code: ERROR_CODES.HTTP,
        });
      }

      assertIdentityBody(response);
      return await readBody(response, startedAt);
    }

    throw new AppError('Слишком много редиректов.', { code: ERROR_CODES.REDIRECT });
  } catch (error) {
    throw normalizeFetchError(error, config);
  }
};

const measure = async (url, config, hooks = {}) => {
  const agents = createAgents(config.freshConnection === true);

  try {
    const warmupIsEnabled = config.warmup === true;
    if (warmupIsEnabled) {
      const warmup = await downloadOnce(url, config, agents);
      if (hooks.onWarmup) {
        hooks.onWarmup(warmup);
      }
    }

    const samples = [];
    for (let index = 1; index <= config.requestCount; index += 1) {
      const sample = await downloadOnce(url, config, agents);
      samples.push(sample);
      if (hooks.onSample) {
        hooks.onSample(index, sample);
      }
    }

    return summarize(samples);
  } finally {
    destroyAgents(agents);
  }
};

module.exports = {
  summarize,
  measure,
};
