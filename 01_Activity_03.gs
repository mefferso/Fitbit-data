

function getHeartRateRollups_(start, end, windowSeconds) {
  const ss = getWeightSpreadsheet_();
  const sheetName = `HR_Cache_${windowSeconds}`;
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(['Timestamp', 'Value', 'Minimum', 'Maximum']);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
  }

  const lastRow = sheet.getLastRow();
  let cachedPoints = [];

  if (lastRow > 1) {
    const rawValues = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    cachedPoints = rawValues
      .filter(row => row[0] instanceof Date && !isNaN(row[0].getTime()))
      .map(row => ({
        time: new Date(row[0]).toISOString(),
        value: Number(row[1]),
        minimum: row[2] !== '' ? Number(row[2]) : null,
        maximum: row[3] !== '' ? Number(row[3]) : null
      }))
      .filter(point => Number.isFinite(point.value))
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  }

  const windowMs = windowSeconds * 1000;
  const earliestCached = cachedPoints.length ? new Date(cachedPoints[0].time) : null;
  const latestCached = cachedPoints.length ? new Date(cachedPoints[cachedPoints.length - 1].time) : null;
  const missingRanges = [];

  if (!cachedPoints.length) {
    missingRanges.push({ start: new Date(start), end: new Date(end) });
  } else {
    if (start.getTime() < earliestCached.getTime() - windowMs) {
      missingRanges.push({ start: new Date(start), end: new Date(earliestCached) });
    }
    if (end.getTime() > latestCached.getTime() + windowMs) {
      missingRanges.push({ start: new Date(latestCached), end: new Date(end) });
    }
  }

  let fetched = [];
  missingRanges.forEach(range => {
    if (range.end.getTime() - range.start.getTime() <= windowMs) return;
    fetched = fetched.concat(fetchHeartRateRollupsRange_(range.start, range.end, windowSeconds));
  });

  if (fetched.length) {
    const byTime = {};
    cachedPoints.concat(fetched).forEach(point => {
      byTime[point.time] = point;
    });
    cachedPoints = Object.keys(byTime)
      .sort()
      .map(time => byTime[time]);

    // Rewrite once so a historical backfill lands in chronological order.
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).clearContent();
    }
    const rows = cachedPoints.map(point => [
      new Date(point.time),
      point.value,
      point.minimum,
      point.maximum
    ]);
    if (rows.length) {
      sheet.getRange(2, 1, rows.length, 4).setValues(rows);
    }
  }

  return cachedPoints.filter(point => {
    const time = new Date(point.time).getTime();
    return time >= start.getTime() && time <= end.getTime();
  });
}



function fetchHeartRateRollupsRange_(start, end, windowSeconds) {
  const maxRangeMs = 14 * 86400000;
  const chunks = [];
  let cursor = new Date(start);

  while (cursor < end) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + maxRangeMs, end.getTime()));
    chunks.push({ start: new Date(cursor), end: chunkEnd });
    cursor = chunkEnd;
  }

  const service = getHealthService_();
  if (!service.hasAccess()) {
    throw new Error('Google Health authorization is required.');
  }

  const token = service.getAccessToken();
  const url = 'https://health.googleapis.com/v4/users/me/dataTypes/heart-rate/dataPoints:rollUp';
  const requests = chunks.map(chunk => {
    const chunkSeconds = Math.max(1, Math.ceil((chunk.end.getTime() - chunk.start.getTime()) / 1000));
    const maxPageSize = Math.max(1, Math.floor((14 * 86400) / windowSeconds));
    const windowsNeeded = Math.max(1, Math.ceil(chunkSeconds / windowSeconds));

    return {
      url: url,
      method: 'post',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({
        range: { startTime: chunk.start.toISOString(), endTime: chunk.end.toISOString() },
        windowSize: `${windowSeconds}s`,
        pageSize: Math.min(maxPageSize, windowsNeeded)
      })
    };
  });

  const responses = [];
  for (let index = 0; index < requests.length; index += 50) {
    responses.push.apply(responses, UrlFetchApp.fetchAll(requests.slice(index, index + 50)));
  }

  const points = [];
  responses.forEach(response => {
    const status = response.getResponseCode();
    const body = response.getContentText();
    if (status < 200 || status >= 300) {
      throw new Error(`Google Health heart-rate API error ${status}: ${body}`);
    }
    const parsed = body ? JSON.parse(body) : {};
    (parsed.rollupDataPoints || []).forEach(point => {
      if (point.heartRate && point.heartRate.beatsPerMinuteAvg !== undefined) {
        points.push({
          time: point.startTime,
          value: round1_(Number(point.heartRate.beatsPerMinuteAvg)),
          minimum: numericOrNull_(point.heartRate.beatsPerMinuteMin),
          maximum: numericOrNull_(point.heartRate.beatsPerMinuteMax)
        });
      }
    });
  });

  return points;
}

function getLatestHeartRateZones_() {
  const ninetyDaysAgo = addDays_(new Date(), -90);

  try {
    const filter =
      `daily_heart_rate_zones.date >= "` +
      `${formatDateKey_(ninetyDaysAgo)}"`;

    const url =
      'https://health.googleapis.com/v4/users/me/' +
      'dataTypes/daily-heart-rate-zones/dataPoints' +
      '?pageSize=100&filter=' +
      encodeURIComponent(filter);

    const response = callHealthApi_(url);

    const records = (response.dataPoints || [])
      .map(point => point.dailyHeartRateZones)
      .filter(Boolean)
      .sort((a, b) =>
        healthDateKey_(b.date).localeCompare(
          healthDateKey_(a.date)
        )
      );

    if (!records.length) {
      return emptyHeartRateZones_();
    }

    const result = emptyHeartRateZones_();

    (records[0].heartRateZones || []).forEach(zone => {
      const minimum = numericOrNull_(zone.minBeatsPerMinute);

      if (zone.heartRateZoneType === 'LIGHT') {
        result.lightMin = minimum;
      } else if (zone.heartRateZoneType === 'MODERATE') {
        result.moderateMin = minimum;
      } else if (zone.heartRateZoneType === 'VIGOROUS') {
        result.vigorousMin = minimum;
      } else if (zone.heartRateZoneType === 'PEAK') {
        result.peakMin = minimum;
      }
    });

    result.date = healthDateKey_(records[0].date);
    result.source = 'Fitbit daily heart-rate zones';
    return result;
  } catch (error) {
    return emptyHeartRateZones_();
  }
}


function emptyHeartRateZones_() {
  return {
    /*
     * Used only if Fitbit has not returned daily zone thresholds yet.
     * Change these four values if you prefer different fallback bands.
     */
    lightMin: 100,
    moderateMin: 120,
    vigorousMin: 140,
    peakMin: 160,
    date: null,
    source: 'Dashboard fallback thresholds'
  };
}
