const HEALTH_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.location.readonly'
];

const DEFAULT_WEIGHT_SHEET_NAME = 'Shotsy_2026-05-23_08-09-34';

function getScriptConfig_() {
  const props = PropertiesService.getScriptProperties();
  const sheetId = String(props.getProperty('WEIGHT_SHEET_ID') || '').trim();
  const sheetName = String(props.getProperty('WEIGHT_SHEET_NAME') || DEFAULT_WEIGHT_SHEET_NAME).trim();

  if (!sheetId) {
    throw new Error(
      'Missing Script Property WEIGHT_SHEET_ID. Add the spreadsheet ID in Apps Script > Project Settings > Script properties.'
    );
  }

  return {
    weightSheetId: sheetId,
    weightSheetName: sheetName
  };
}

function getWeightSpreadsheet_() {
  return SpreadsheetApp.openById(getScriptConfig_().weightSheetId);
}

/* =========================================================
   GOOGLE HEALTH OAUTH
   ========================================================= */

function getHealthService_() {
  const props = PropertiesService.getScriptProperties();

  return OAuth2.createService('GoogleHealth')
    .setAuthorizationBaseUrl(
      'https://accounts.google.com/o/oauth2/v2/auth'
    )
    .setTokenUrl('https://oauth2.googleapis.com/token')
    .setClientId(props.getProperty('GOOGLE_CLIENT_ID'))
    .setClientSecret(props.getProperty('GOOGLE_CLIENT_SECRET'))
    .setCallbackFunction('authCallback')
    .setPropertyStore(PropertiesService.getUserProperties())
    .setCache(CacheService.getUserCache())
    .setLock(LockService.getUserLock())
    .setScope(HEALTH_SCOPES.join(' '))
    .setParam('access_type', 'offline')
    .setParam('prompt', 'consent');
}


function doGet() {
  const service = getHealthService_();

  if (!service.hasAccess()) {
    const authorizationUrl = escapeHtml_(
      service.getAuthorizationUrl()
    );

    return HtmlService.createHtmlOutput(`
      <!doctype html>
      <html>
        <head>
          <base target="_top">
          <meta name="viewport"
                content="width=device-width, initial-scale=1">
          <title>Michael's Health Dashboard</title>

          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 720px;
              margin: 60px auto;
              padding: 24px;
              background: #f5f7fb;
              color: #172033;
            }

            .panel {
              background: white;
              padding: 32px;
              border-radius: 16px;
              box-shadow: 0 12px 35px rgba(0,0,0,.08);
            }

            a {
              display: inline-block;
              margin-top: 12px;
              padding: 13px 20px;
              background: #1769e0;
              color: white;
              text-decoration: none;
              border-radius: 8px;
              font-weight: 700;
            }
          </style>
        </head>

        <body>
          <div class="panel">
            <h1>Michael's Health Dashboard</h1>
            <p>Connect your Google Health account to continue.</p>
            <a href="${authorizationUrl}">
              Connect Google Health
            </a>
          </div>
        </body>
      </html>
    `).setTitle("Michael's Health Dashboard");
  }

  return HtmlService
    .createTemplateFromFile('Index')
    .evaluate()
    .setTitle("Michael's Health Dashboard");
}



function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function authCallback(request) {
  const service = getHealthService_();
  const authorized = service.handleCallback(request);

  if (authorized) {
    return HtmlService.createHtmlOutput(`
      <h2>Authorization successful</h2>
      <p>You can close this tab and reopen your dashboard.</p>
    `);
  }

  return HtmlService.createHtmlOutput(`
    <h2>Authorization denied</h2>
    <p>Google Health access was not granted.</p>
  `);
}


function disconnectHealth() {
  getHealthService_().reset();
}

/* =========================================================
   DASHBOARD DATA
   ========================================================= */

function getDashboardData() {
  return {
    generatedAt: new Date().toISOString(),
    healthConnected: getHealthService_().hasAccess(),
    weight: getWeightData_(),
    fitbit: getFitbitSummary_(),
    changes: safeDashboardSection_(getWhatChanged_, []),
    workoutCalendar: safeDashboardSection_(
      function() { return getWorkoutMonthData(formatDateKey_(new Date()).slice(0, 7)); },
      []
    )
  };
}
const USER_TIME_ZONE = 'America/Chicago';
