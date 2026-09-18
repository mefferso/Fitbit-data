/* =========================================================
   STEP CHARTS
   ========================================================= */

const STEP_INTRADAY_WINDOW_SECONDS = 15 * 60;


function getStepDayData(dateKey) {
  validateDateKey_(dateKey);

  const todayKey = formatDateKey_(new Date());

  if (dateKey > todayKey) {
    throw new Error('A future day cannot be selected.');
  }

  const start = localMidnightFromDateKey_(dateKey);
  const nextDateKey = addDaysToDateKey_(dateKey, 1);
  const fullDayEnd = localMidnightFromDateKey_(nextDateKey);
  const now = new Date();
  const end = dateKey === todayKey && now < fullDayEnd
    ? now
    : fullDayEnd;

  const rollups = getStepPhysicalRollups_(
    start,
    end,
    STEP_INTRADAY_WINDOW_SECONDS
  );

  const windowMilliseconds = STEP_INTRADAY_WINDOW_SECONDS * 1000;
  const countsByWindow = {};

  rollups.forEach(point => {
    if (!point || !point.startTime) return;

    const pointStart = new Date(point.startTime).getTime();
    const index = Math.round(
      (pointStart - start.getTime()) / windowMilliseconds
    );

    const count = point.steps && point.steps.countSum !== undefined
      ? Number(point.steps.countSum)
      : null;

    if (
      index >= 0 &&
      Number.isFinite(count)
    ) {
      countsByWindow[index] = count;
    }
  });

  const dataIntervals = Object.keys(countsByWindow).length;
  const windowCount = Math.max(
    1,
    Math.ceil(
      (end.getTime() - start.getTime()) /
      windowMilliseconds
    )
  );

  const points = [{
    time: start.toISOString(),
    cumulative: 0,
    intervalSteps: 0
  }];

  let cumulative = 0;
  let peakIntervalSteps = 0;
  let peakWindowStart = null;

  for (let index = 0; index < windowCount; index += 1) {
    const intervalSteps = Number(countsByWindow[index] || 0);
    cumulative += intervalSteps;

    const intervalEnd = new Date(
      Math.min(
        start.getTime() + (index + 1) * windowMilliseconds,
        end.getTime()
      )
    );

    points.push({
      time: intervalEnd.toISOString(),
      cumulative: cumulative,
      intervalSteps: intervalSteps
    });

    if (intervalSteps > peakIntervalSteps) {
      peakIntervalSteps = intervalSteps;
      peakWindowStart = new Date(
        start.getTime() + index * windowMilliseconds
      ).toISOString();
    }
  }

  return {
    date: dateKey,
    today: todayKey,
    start: start.toISOString(),
    end: end.toISOString(),
    isToday: dateKey === todayKey,
    windowMinutes: STEP_INTRADAY_WINDOW_SECONDS / 60,
    totalSteps: cumulative,
    peakIntervalSteps: peakIntervalSteps,
    peakWindowStart: peakWindowStart,
    hasData: dataIntervals > 0,
    dataIntervals: dataIntervals,
    points: points
  };
}


function getStepHistoryData(granularity) {
  const allowed = ['daily', 'weekly', 'monthly'];

  if (!allowed.includes(granularity)) {
    throw new Error(`Unknown step-history range: ${granularity}`);
  }

  const todayKey = formatDateKey_(new Date());
  const tomorrowKey = addDaysToDateKey_(todayKey, 1);
  let startKey;

  if (granularity === 'daily') {
    startKey = addDaysToDateKey_(todayKey, -29);
  } else if (granularity === 'weekly') {
    startKey = addDaysToDateKey_(
      startOfWeekDateKey_(todayKey),
      -(25 * 7)
    );
  } else {
    startKey = addMonthsToDateKey_(
      firstOfMonthDateKey_(todayKey),
      -11
    );
  }

  const dailyRecords = getStepDailySeries_(
    startKey,
    tomorrowKey
  );

  const valuesByDate = {};

  dailyRecords.forEach(item => {
    valuesByDate[item.date] = Number(item.value) || 0;
  });

  let periods;
  let description;

  if (granularity === 'daily') {
    periods = buildDailyStepPeriods_(
      startKey,
      todayKey,
      valuesByDate
    );

    description = 'Daily totals · last 30 days';
  } else if (granularity === 'weekly') {
    periods = buildWeeklyStepPeriods_(
      startKey,
      todayKey,
      valuesByDate
    );

    description = 'Sunday–Saturday totals · last 26 weeks';
  } else {
    periods = buildMonthlyStepPeriods_(
      startKey,
      todayKey,
      valuesByDate
    );

    description = 'Calendar-month totals · last 12 months';
  }

  return {
    granularity: granularity,
    today: todayKey,
    startDate: startKey,
    endDate: todayKey,
    description: description,
    periods: periods
  };
}


function getStepPhysicalRollups_(start, end, windowSeconds) {
  const url =
    'https://health.googleapis.com/v4/users/me/' +
    'dataTypes/steps/dataPoints:rollUp';

  const points = [];
  let pageToken = '';

  do {
    const payload = {
      range: {
        startTime: start.toISOString(),
        endTime: end.toISOString()
      },
      windowSize: `${windowSeconds}s`,
      pageSize: Math.min(
        8640,
        Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (windowSeconds * 1000)))
      )
    };

    if (pageToken) {
      payload.pageToken = pageToken;
    }

    const response = callHealthApi_(url, {
      method: 'post',
      payload: payload
    });

    points.push.apply(
      points,
      response.rollupDataPoints || []
    );

    pageToken = response.nextPageToken || '';
  } while (pageToken);

  return points.sort((a, b) =>
    new Date(a.startTime).getTime() -
    new Date(b.startTime).getTime()
  );
}


function getStepDailySeries_(startDateKey, endDateKey) {
  const url =
    'https://health.googleapis.com/v4/users/me/' +
    'dataTypes/steps/dataPoints:dailyRollUp';

  const recordsByDate = {};
  let cursorKey = startDateKey;

  /*
   * Steps supports a maximum 90-day rollup range.
   * Use 89-day chunks to stay comfortably inside that limit.
   */
  while (cursorKey < endDateKey) {
    const candidateEndKey = addDaysToDateKey_(cursorKey, 89);
    const chunkEndKey = candidateEndKey < endDateKey
      ? candidateEndKey
      : endDateKey;

    const response = callHealthApi_(url, {
      method: 'post',
      payload: {
        range: {
          start: civilDateTimeFromDateKey_(cursorKey),
          end: civilDateTimeFromDateKey_(chunkEndKey)
        },
        windowSizeDays: 1,
        pageSize: 89
      }
    });

    (response.rollupDataPoints || []).forEach(point => {
      const date =
        point.civilStartTime &&
        point.civilStartTime.date
          ? healthDateKey_(point.civilStartTime.date)
          : '';

      const value =
        point.steps &&
        point.steps.countSum !== undefined
          ? Number(point.steps.countSum)
          : null;

      if (date && Number.isFinite(value)) {
        recordsByDate[date] = {
          date: date,
          value: value
        };
      }
    });

    cursorKey = chunkEndKey;
  }

  return Object.keys(recordsByDate)
    .sort()
    .map(date => recordsByDate[date]);
}
