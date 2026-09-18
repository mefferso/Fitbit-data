

function buildPersonalMetric_(config, records, latestAllowedDate, baselineDays) {
  const valid = (records || [])
    .filter(item => item && item.date && Number.isFinite(Number(item.value)))
    .map(item => ({ date: item.date, value: Number(item.value) }))
    .filter(item => item.date <= latestAllowedDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!valid.length) return null;

  const latest = valid[valid.length - 1];
  const cutoff = formatDateKey_(addDays_(new Date(`${latest.date}T12:00:00`), -baselineDays));
  const baseline = valid
    .filter(item => item.date >= cutoff && item.date < latest.date)
    .map(item => item.value);

  if (baseline.length < 5) {
    return {
      key: config.key, label: config.label, description: config.description,
      current: latest.value, currentDate: latest.date, unit: config.unit,
      decimals: config.decimals, formatter: config.formatter,
      sampleCount: baseline.length, insufficient: true,
      status: 'Not enough history yet'
    };
  }

  const sorted = baseline.slice().sort((a, b) => a - b);
  const average = baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
  const median = percentile_(sorted, 50);
  const p10 = percentile_(sorted, 10);
  const p25 = percentile_(sorted, 25);
  const p75 = percentile_(sorted, 75);
  const p90 = percentile_(sorted, 90);
  const percentile = percentileRank_(sorted, latest.value);
  const delta = latest.value - average;

  return {
    key: config.key,
    label: config.label,
    description: config.description,
    current: roundTo_(latest.value, config.decimals),
    currentDate: latest.date,
    average: roundTo_(average, config.decimals),
    median: roundTo_(median, config.decimals),
    delta: roundTo_(delta, config.decimals),
    percentile: Math.round(percentile),
    p10: roundTo_(p10, config.decimals),
    p25: roundTo_(p25, config.decimals),
    p75: roundTo_(p75, config.decimals),
    p90: roundTo_(p90, config.decimals),
    minimum: roundTo_(sorted[0], config.decimals),
    maximum: roundTo_(sorted[sorted.length - 1], config.decimals),
    unit: config.unit,
    decimals: config.decimals,
    formatter: config.formatter,
    sampleCount: baseline.length,
    insufficient: false,
    status: personalStatus_(percentile),
    sentiment: personalSentiment_(config.direction, percentile, latest.value, config)
  };
}


function personalStatus_(percentile) {
  if (percentile < 5) return 'Extremely low for you';
  if (percentile < 15) return 'Unusually low for you';
  if (percentile < 30) return 'Somewhat low for you';
  if (percentile <= 70) return 'Typical for you';
  if (percentile <= 85) return 'Somewhat high for you';
  if (percentile <= 95) return 'Unusually high for you';
  return 'Extremely high for you';
}

function personalSentiment_(direction, percentile, value, config) {
  if (direction === 'neutral') return 'neutral';
  if (direction === 'higher') {
    if (percentile >= 70) return 'good';
    if (percentile < 15) return 'bad';
    return 'neutral';
  }
  if (direction === 'lower') {
    if (percentile <= 30) return 'good';
    if (percentile > 85) return 'bad';
    return 'neutral';
  }
  if (direction === 'middle') {
    if (config.targetLow !== undefined && value < config.targetLow) return 'bad';
    if (config.targetHigh !== undefined && value > config.targetHigh) return 'neutral';
    if (percentile < 10 || percentile > 90) return 'bad';
  }
  return 'neutral';
}


function percentile_(sorted, percentile) {
  if (!sorted.length) return null;
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}


function percentileRank_(sorted, value) {
  if (!sorted.length) return 0;
  let below = 0;
  let equal = 0;
  sorted.forEach(item => {
    if (item < value) below += 1;
    else if (item === value) equal += 1;
  });
  return ((below + equal * .5) / sorted.length) * 100;
}


function roundTo_(value, decimals) {
  const factor = Math.pow(10, Number(decimals) || 0);
  return Math.round(value * factor) / factor;
}


function getDailyDataTypeSeries_(dataType, fieldName, start, valueGetter) {
  const snake = dataType.replaceAll('-', '_');
  const filter = `${snake}.date >= "${formatDateKey_(start)}"`;
  const baseUrl =
    `https://health.googleapis.com/v4/users/me/dataTypes/${dataType}/dataPoints` +
    `?pageSize=500&filter=${encodeURIComponent(filter)}`;
  let pageToken = '';
  const result = [];

  do {
    const url = pageToken
      ? `${baseUrl}&pageToken=${encodeURIComponent(pageToken)}`
      : baseUrl;
    const response = callHealthApi_(url);
    (response.dataPoints || []).forEach(point => {
      const item = point[fieldName];
      if (!item || !item.date) return;
      const value = valueGetter(item);
      if (value === null || !Number.isFinite(Number(value))) return;
      result.push({ date: healthDateKey_(item.date), value: Number(value) });
    });
    pageToken = response.nextPageToken || '';
  } while (pageToken);

  return result.sort((a, b) => a.date.localeCompare(b.date));
}


function getChunkedDailyRollups_(dataType, start, end, valueGetter) {
  const chunks = [];
  let cursor = new Date(start);
  while (cursor < end) {
    const chunkEnd = new Date(Math.min(addDays_(cursor, 14).getTime(), end.getTime()));
    chunks.push({ start: new Date(cursor), end: chunkEnd });
    cursor = chunkEnd;
  }

  const results = [];
  chunks.forEach(chunk => {
    const response = callHealthApi_(
      `https://health.googleapis.com/v4/users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`,
      {
        method: 'post',
        payload: {
          range: { start: civilDateTime_(chunk.start), end: civilDateTime_(chunk.end) },
          windowSizeDays: 1
        }
      }
    );
    (response.rollupDataPoints || []).forEach(point => {
      const date = point.civilStartTime && point.civilStartTime.date
        ? healthDateKey_(point.civilStartTime.date)
        : '';
      const value = valueGetter(point);
      if (date && value !== null && Number.isFinite(Number(value))) {
        results.push({ date: date, value: Number(value) });
      }
    });
  });

  const byDate = {};
  results.forEach(item => { byDate[item.date] = item; });
  return Object.keys(byDate).sort().map(date => byDate[date]);
}


function extractActiveMinutes_(activeMinutes) {
  if (!activeMinutes) return null;
  const levels = activeMinutes.activeMinutesByActivityLevel || [];
  if (levels.length) {
    return levels.reduce((sum, item) => sum + (numericOrNull_(item.activeMinutes) || 0), 0);
  }
  return extractFirstNumber_(activeMinutes, ['activeMinutesSum', 'minutesSum', 'activeMinutes']);
}


function extractFirstNumber_(object, fields) {
  if (!object) return null;
  for (let index = 0; index < fields.length; index += 1) {
    const value = numericOrNull_(object[fields[index]]);
    if (value !== null) return value;
  }
  return null;
}
