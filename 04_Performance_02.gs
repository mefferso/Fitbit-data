
function callHealthRaw_(url, options) {
  const service = getHealthService_();
  if (!service.hasAccess()) throw new Error('Google Health authorization is required.');
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: `Bearer ${service.getAccessToken()}`,
      Accept: options && options.accept ? options.accept : '*/*'
    },
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const body = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error(`Google Health API error ${status}: ${body}`);
  }
  return body;
}

function getHealthIdentity_() {
  return callHealthApi_(
    'https://health.googleapis.com/v4/users/me/identity'
  );
}


function callHealthApi_(url, requestOptions) {
  const service = getHealthService_();

  if (!service.hasAccess()) {
    throw new Error(
      'Google Health authorization is required.'
    );
  }

  const suppliedOptions = requestOptions || {};

  const fetchOptions = {
    method: suppliedOptions.method || 'get',

    headers: {
      Authorization:
        `Bearer ${service.getAccessToken()}`,
      Accept: 'application/json'
    },

    muteHttpExceptions: true
  };

  if (suppliedOptions.payload !== undefined) {
    fetchOptions.contentType = 'application/json';

    fetchOptions.payload =
      typeof suppliedOptions.payload === 'string'
        ? suppliedOptions.payload
        : JSON.stringify(suppliedOptions.payload);
  }

  const response = UrlFetchApp.fetch(
    url,
    fetchOptions
  );

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error(
      `Google Health API error ${status}: ${body}`
    );
  }

  return body
    ? JSON.parse(body)
    : {};
}

/* =========================================================
   UTILITIES
   ========================================================= */

function safeDashboardSection_(callback, fallback) {
  try {
    return callback();
  } catch (error) {
    console.error(error);
    return fallback;
  }
}


function round1_(value) {
  return Math.round(value * 10) / 10;
}


function escapeHtml_(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
