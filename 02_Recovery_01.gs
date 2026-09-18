/* =========================================================
   WHAT CHANGED
   ========================================================= */

function getWhatChanged_() {
  const today = new Date();
  const fourteenDaysAgo = addDays_(today, -13);
  const tomorrow = addDays_(today, 1);

  const stepDaily = getDailySteps_(fourteenDaysAgo, tomorrow);
  const rhrDaily = getDailyRestingHeartRates_(fourteenDaysAgo);
  const sleepDaily = getSleepCalendar_(14);
  const weight = getWeightData_().points;

  const items = [];

  const stepChange = compareSevenDayAverages_(
    stepDaily.map(item => ({
      date: item.date,
      value: item.value
    }))
  );

  if (stepChange) {
    items.push(makeChangeItem_(
      'Daily steps',
      stepChange,
      value => `${Math.round(value).toLocaleString()}/day`,
      true,
      0
    ));
  }

  const rhrChange = compareSevenDayAverages_(
    rhrDaily.map(item => ({
      date: item.date,
      value: item.value
    }))
  );

  if (rhrChange) {
    items.push(makeChangeItem_(
      'Resting heart rate',
      rhrChange,
      value => `${round1_(value)} bpm`,
      false,
      1
    ));
  }

  const sleepChange = compareSevenDayAverages_(
    sleepDaily.map(item => ({
      date: item.date,
      value: item.minutesAsleep
    }))
  );

  if (sleepChange) {
    items.push(makeChangeItem_(
      'Sleep duration',
      sleepChange,
      value => formatDurationLabel_(value),
      true,
      5
    ));
  }

  const qualityChange = compareSevenDayAverages_(
    sleepDaily.map(item => ({
      date: item.date,
      value: item.score
    }))
  );

  if (qualityChange) {
    items.push(makeChangeItem_(
      'Sleep quality',
      qualityChange,
      value => `${Math.round(value)}/100`,
      true,
      1
    ));
  }

  const weightRecent = weight
    .filter(point => point.date >= formatDateKey_(fourteenDaysAgo))
    .map(point => ({
      date: point.date,
      value: point.weight
    }));

  const weightChange = compareSevenDayAverages_(weightRecent);

  if (weightChange) {
    items.push(makeChangeItem_(
      'Average weight',
      weightChange,
      value => `${round1_(value)} lb`,
      false,
      .1
    ));
  }

  return items;
}


function makeChangeItem_(
  name,
  comparison,
  formatter,
  higherIsBetter,
  neutralThreshold
) {
  const delta = comparison.current - comparison.previous;
  let sentiment = 'neutral';

  if (Math.abs(delta) >= neutralThreshold) {
    const improved = higherIsBetter ? delta > 0 : delta < 0;
    sentiment = improved ? 'good' : 'bad';
  }

  const signed =
    delta > 0
      ? `+${formatter(Math.abs(delta))}`
      : delta < 0
        ? `-${formatter(Math.abs(delta))}`
        : formatter(0);

  return {
    name: name,
    displayChange: signed,
    currentLabel: formatter(comparison.current),
    previousLabel: formatter(comparison.previous),
    sentiment: sentiment
  };
}


function compareSevenDayAverages_(records) {
  const valid = records
    .filter(item => Number.isFinite(Number(item.value)))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (valid.length < 4) {
    return null;
  }

  const latestDate = new Date(
    `${valid[valid.length - 1].date}T12:00:00`
  );

  const currentStart = new Date(latestDate);
  currentStart.setDate(currentStart.getDate() - 6);

  const previousEnd = new Date(currentStart);
  previousEnd.setDate(previousEnd.getDate() - 1);

  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousEnd.getDate() - 6);

  const currentStartKey = formatDateKey_(currentStart);
  const previousStartKey = formatDateKey_(previousStart);
  const previousEndKey = formatDateKey_(previousEnd);

  const currentValues = valid
    .filter(item => item.date >= currentStartKey)
    .map(item => Number(item.value));

  const previousValues = valid
    .filter(item =>
      item.date >= previousStartKey &&
      item.date <= previousEndKey
    )
    .map(item => Number(item.value));

  if (!currentValues.length || !previousValues.length) {
    return null;
  }

  return {
    current:
      currentValues.reduce((sum, value) => sum + value, 0) /
      currentValues.length,
    previous:
      previousValues.reduce((sum, value) => sum + value, 0) /
      previousValues.length
  };
}


function getDailySteps_(start, end) {
  const response = callHealthApi_(
    'https://health.googleapis.com/v4/users/me/' +
    'dataTypes/steps/dataPoints:dailyRollUp',
    {
      method: 'post',
      payload: {
        range: {
          start: civilDateTime_(start),
          end: civilDateTime_(end)
        },
        windowSizeDays: 1
      }
    }
  );

  return (response.rollupDataPoints || []).map(point => ({
    date:
      point.civilStartTime &&
      point.civilStartTime.date
        ? healthDateKey_(point.civilStartTime.date)
        : '',
    value:
      point.steps && point.steps.countSum !== undefined
        ? Number(point.steps.countSum)
        : null
  }));
}


function getDailyRestingHeartRates_(start) {
  const filter =
    `daily_resting_heart_rate.date >= "` +
    `${formatDateKey_(start)}"`;

  const url =
    'https://health.googleapis.com/v4/users/me/' +
    'dataTypes/daily-resting-heart-rate/dataPoints' +
    '?pageSize=100&filter=' +
    encodeURIComponent(filter);

  const response = callHealthApi_(url);

  return (response.dataPoints || [])
    .map(point => point.dailyRestingHeartRate)
    .filter(Boolean)
    .map(item => ({
      date: healthDateKey_(item.date),
      value: Number(item.beatsPerMinute)
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* =========================================================
   SLEEP CALENDAR
   ========================================================= */
