function summarizeWorkoutZones_(heartRateSeries, zones, workoutStart, workoutEnd) {
  const zoneMap = {
    below: { key: 'below', label: 'Below light', seconds: 0 },
    light: { key: 'light', label: 'Light', seconds: 0 },
    moderate: { key: 'moderate', label: 'Moderate', seconds: 0 },
    vigorous: { key: 'vigorous', label: 'Vigorous', seconds: 0 },
    peak: { key: 'peak', label: 'Peak', seconds: 0 }
  };

  const points = (heartRateSeries || []).slice().sort((a, b) =>
    new Date(a.time).getTime() - new Date(b.time).getTime()
  );

  const gaps = [];
  for (let index = 1; index < points.length; index += 1) {
    const gap = (new Date(points[index].time).getTime() - new Date(points[index - 1].time).getTime()) / 1000;
    if (gap > 0 && gap <= 120) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 5;
  const maxCarrySeconds = Math.max(5, Math.min(30, medianGap * 3));
  const endMs = workoutEnd ? new Date(workoutEnd).getTime() : null;

  points.forEach((point, index) => {
    const key = point.zoneKey || 'below';
    if (!zoneMap[key]) return;
    const currentMs = new Date(point.time).getTime();
    const nextMs = index + 1 < points.length
      ? new Date(points[index + 1].time).getTime()
      : endMs;
    let seconds = nextMs && nextMs > currentMs ? (nextMs - currentMs) / 1000 : medianGap;
    seconds = Math.max(0, Math.min(maxCarrySeconds, seconds));
    zoneMap[key].seconds += seconds;
  });

  const totalSeconds = Object.keys(zoneMap).reduce(
    (sum, key) => sum + zoneMap[key].seconds,
    0
  ) || 1;

  return ['peak', 'vigorous', 'moderate', 'light', 'below'].map(key => ({
    key: key,
    label: zoneMap[key].label,
    seconds: roundTo_(zoneMap[key].seconds, 0),
    minutes: roundTo_(zoneMap[key].seconds / 60, 1),
    percent: roundTo_(zoneMap[key].seconds / totalSeconds * 100, 0),
    threshold: workoutZoneThresholdLabel_(key, zones)
  }));
}



function smoothWorkoutPaceSeries_(paceSeries, windowPoints) {
  const points = paceSeries || [];
  const radius = Math.max(1, Number(windowPoints) || 3);
  return points.map((point, index) => {
    const startIndex = Math.max(0, index - radius + 1);
    const window = points.slice(startIndex, index + 1);
    const weightedDistance = window.reduce((sum, item) => sum + Number(item.distanceMiles || 0), 0);
    const elapsedSeconds = window.reduce((sum, item) => {
      const a = new Date(item.startTime).getTime();
      const b = new Date(item.endTime).getTime();
      return sum + Math.max(0, (b - a) / 1000);
    }, 0);
    const pace = weightedDistance > 0 ? elapsedSeconds / weightedDistance : null;
    return Object.assign({}, point, {
      paceSecondsPerMile: pace === null ? point.paceSecondsPerMile : roundTo_(pace, 0),
      smoothed: true
    });
  });
}

function averageHeartRateForWindow_(heartRateSeries, startMs, endMs) {
  const values = (heartRateSeries || [])
    .filter(point => {
      const time = new Date(point.time).getTime();
      return time >= startMs && time < endMs;
    })
    .map(point => Number(point.value))
    .filter(Number.isFinite);
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function paceMetricsForWindow_(paceSeries, startMs, endMs) {
  const points = (paceSeries || []).filter(point => {
    const time = new Date(point.time).getTime();
    return time >= startMs && time < endMs;
  });
  if (!points.length) return null;
  const distance = points.reduce((sum, point) => sum + Number(point.distanceMiles || 0), 0);
  const seconds = points.reduce((sum, point) => {
    const a = new Date(point.startTime).getTime();
    const b = new Date(point.endTime).getTime();
    return sum + Math.max(0, (b - a) / 1000);
  }, 0);
  if (distance <= 0 || seconds <= 0) return null;
  return {
    distanceMiles: distance,
    seconds: seconds,
    paceSecondsPerMile: seconds / distance,
    speedMph: distance / (seconds / 3600)
  };
}

function calculateAerobicDecoupling_(start, end, heartRateSeries, paceSeries) {
  if (!start || !end || end <= start || !heartRateSeries.length || !paceSeries.length) return null;
  const startMs = start.getTime();
  const endMs = end.getTime();
  const midpoint = startMs + (endMs - startMs) / 2;
  const firstHr = averageHeartRateForWindow_(heartRateSeries, startMs, midpoint);
  const secondHr = averageHeartRateForWindow_(heartRateSeries, midpoint, endMs);
  const firstPace = paceMetricsForWindow_(paceSeries, startMs, midpoint);
  const secondPace = paceMetricsForWindow_(paceSeries, midpoint, endMs);
  if (!firstHr || !secondHr || !firstPace || !secondPace) return null;

  const firstEfficiency = firstPace.speedMph / firstHr;
  const secondEfficiency = secondPace.speedMph / secondHr;
  if (!firstEfficiency || !Number.isFinite(firstEfficiency) || !Number.isFinite(secondEfficiency)) return null;

  return {
    percent: roundTo_((firstEfficiency - secondEfficiency) / firstEfficiency * 100, 1),
    firstHalfHeartRate: roundTo_(firstHr, 0),
    secondHalfHeartRate: roundTo_(secondHr, 0),
    firstHalfPaceSecondsPerMile: roundTo_(firstPace.paceSecondsPerMile, 0),
    secondHalfPaceSecondsPerMile: roundTo_(secondPace.paceSecondsPerMile, 0),
    firstHalfEfficiency: roundTo_(firstEfficiency, 4),
    secondHalfEfficiency: roundTo_(secondEfficiency, 4)
  };
}

function estimateHeartRateAt_(points, targetMs) {
  const usable = (points || [])
    .map(point => ({
      timeMs: new Date(point.time).getTime(),
      value: Number(point.value)
    }))
    .filter(point => Number.isFinite(point.timeMs) && Number.isFinite(point.value))
    .sort((a, b) => a.timeMs - b.timeMs);

  if (!usable.length) return null;

  let before = null;
  let after = null;
  let nearest = null;
  let nearestDelta = Infinity;

  usable.forEach(point => {
    const delta = Math.abs(point.timeMs - targetMs);
    if (delta < nearestDelta) {
      nearest = point;
      nearestDelta = delta;
    }
    if (point.timeMs <= targetMs && (!before || point.timeMs > before.timeMs)) before = point;
    if (point.timeMs >= targetMs && (!after || point.timeMs < after.timeMs)) after = point;
  });

  if (before && after) {
    const beforeDelta = targetMs - before.timeMs;
    const afterDelta = after.timeMs - targetMs;
    const gap = after.timeMs - before.timeMs;

    if (before.timeMs === after.timeMs) {
      return {
        value: before.value,
        method: 'exact',
        offsetSeconds: 0
      };
    }

    if (beforeDelta <= 10000 && afterDelta <= 10000 && gap <= 15000) {
      const fraction = (targetMs - before.timeMs) / gap;
      return {
        value: before.value + (after.value - before.value) * fraction,
        method: 'interpolated',
        beforeOffsetSeconds: roundTo_(-beforeDelta / 1000, 1),
        afterOffsetSeconds: roundTo_(afterDelta / 1000, 1)
      };
    }
  }

  if (nearest && nearestDelta <= 5000) {
    return {
      value: nearest.value,
      method: 'nearest',
      offsetSeconds: roundTo_((nearest.timeMs - targetMs) / 1000, 1)
    };
  }

  return null;
}

function calculateHeartRateRecovery_(workoutEnd, points) {
  if (!workoutEnd || !points || !points.length) return null;

  const endMs = workoutEnd.getTime();
  const endEstimate = estimateHeartRateAt_(points, endMs);
  if (!endEstimate) return null;

  const result = {
    endHeartRate: roundTo_(endEstimate.value, 1),
    endEstimate: endEstimate
  };

  [1, 2, 3].forEach(minute => {
    const estimate = estimateHeartRateAt_(points, endMs + minute * 60000);
    result[`minute${minute}HeartRate`] = estimate === null ? null : roundTo_(estimate.value, 1);
    result[`minute${minute}Drop`] = estimate === null
      ? null
      : roundTo_(endEstimate.value - estimate.value, 1);
    result[`minute${minute}Estimate`] = estimate;
  });

  return result;
}
