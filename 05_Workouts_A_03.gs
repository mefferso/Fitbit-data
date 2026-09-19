

function buildWorkoutPaceSeries_(start, end, rollups) {
  if (!start || !end || end <= start) return [];

  return (rollups || [])
    .map(point => {
      if (!point || !point.startTime) return null;

      const startTime = new Date(point.startTime);

      const endTime = point.endTime
        ? new Date(point.endTime)
        : new Date(
            Math.min(
              startTime.getTime() + 60000,
              end.getTime()
            )
          );

      const distance = point.distance || {};

      const millimeters = numericOrNull_(
        distance.millimetersSum !== undefined
          ? distance.millimetersSum
          : distance.distanceMillimeters
      );

      /*
       * No usable distance in this one-minute block.
       */
      if (millimeters === null || millimeters <= 0) {
        return null;
      }

      const seconds = Math.max(
        1,
        (endTime.getTime() - startTime.getTime()) / 1000
      );

      const miles = millimeters / 1609344;

      if (miles <= 0) return null;

      const paceSecondsPerMile = seconds / miles;

      /*
       * Very broad sanity limits.
       *
       * Faster than 1:15/mi or slower than 120:00/mi
       * is almost certainly garbage for what we're doing.
       */
      if (
        paceSecondsPerMile < 75 ||
        paceSecondsPerMile > 7200
      ) {
        return null;
      }

      return {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),

        /*
         * Put the pace observation at the midpoint
         * of its one-minute distance block.
         */
        time: new Date(
          (startTime.getTime() + endTime.getTime()) / 2
        ).toISOString(),

        distanceMiles: roundTo_(miles, 5),

        paceSecondsPerMile:
          roundTo_(paceSecondsPerMile, 0)
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        new Date(a.time).getTime() -
        new Date(b.time).getTime()
    );
}


/*
 * Build a high-resolution pace series from TCX cumulative distance.
 *
 * Each output row represents one NON-OVERLAPPING TCX trackpoint interval.
 * That matters because downstream paceMetricsForWindow_ sums distance and
 * elapsed time; using overlapping rolling windows there would double-count.
 */
function buildTcxPaceSeries_(trackpoints) {
  const points = (trackpoints || [])
    .map(point => ({
      time: point && point.time ? String(point.time) : '',
      distanceMeters: numericOrNull_(point && point.distanceMeters)
    }))
    .filter(point => point.time && point.distanceMeters !== null)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  const result = [];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];

    const startMs = new Date(previous.time).getTime();
    const endMs = new Date(current.time).getTime();
    const seconds = (endMs - startMs) / 1000;
    const distanceMeters = current.distanceMeters - previous.distanceMeters;

    /*
     * Ignore duplicate/reversed timestamps, long GPS gaps, no-movement
     * intervals, and distance resets.
     */
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60) continue;
    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) continue;

    const miles = distanceMeters / 1609.344;
    const paceSecondsPerMile = seconds / miles;

    /*
     * Broad sanity limits. Faster than 2:00/mi is a GPS spike for this use
     * case; slower than 120:00/mi is not a useful moving-pace observation.
     */
    if (
      !Number.isFinite(paceSecondsPerMile) ||
      paceSecondsPerMile < 120 ||
      paceSecondsPerMile > 7200
    ) {
      continue;
    }

    result.push({
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(endMs).toISOString(),
      time: new Date((startMs + endMs) / 2).toISOString(),
      distanceMiles: roundTo_(miles, 6),
      paceSecondsPerMile: roundTo_(paceSecondsPerMile, 0),
      source: 'tcx'
    });
  }

  return result;
}


/*
 * Distance-weighted trailing smoothing for high-resolution TCX pace.
 *
 * For each raw interval, calculate pace over the trailing N seconds. Partial
 * overlaps are prorated, so a 30-second window really represents ~30 seconds
 * rather than an arbitrary number of trackpoints.
 */
function smoothWorkoutPaceSeriesByTime_(paceSeries, windowSeconds) {
  const points = (paceSeries || []).slice().sort((a, b) =>
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  const windowMs = Math.max(5, Number(windowSeconds) || 30) * 1000;

  return points.map((point, index) => {
    const targetEnd = new Date(point.endTime).getTime();
    const targetStart = targetEnd - windowMs;
    let distanceMiles = 0;
    let elapsedSeconds = 0;

    for (let cursor = index; cursor >= 0; cursor -= 1) {
      const item = points[cursor];
      const itemStart = new Date(item.startTime).getTime();
      const itemEnd = new Date(item.endTime).getTime();

      if (itemEnd <= targetStart) break;

      const overlapStart = Math.max(itemStart, targetStart);
      const overlapEnd = Math.min(itemEnd, targetEnd);
      const overlapMs = Math.max(0, overlapEnd - overlapStart);
      const itemMs = Math.max(1, itemEnd - itemStart);

      if (overlapMs <= 0) continue;

      const fraction = overlapMs / itemMs;
      distanceMiles += Number(item.distanceMiles || 0) * fraction;
      elapsedSeconds += overlapMs / 1000;
    }

    const pace = distanceMiles > 0 && elapsedSeconds > 0
      ? elapsedSeconds / distanceMiles
      : null;

    return Object.assign({}, point, {
      paceSecondsPerMile: pace === null
        ? point.paceSecondsPerMile
        : roundTo_(pace, 0),
      smoothed: true,
      smoothingSeconds: windowMs / 1000
    });
  });
}
