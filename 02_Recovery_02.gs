
function getSleepCalendar_(days) {
  const start = addDays_(new Date(), -(Number(days) + 7));
  const filter =
    `sleep.interval.civil_end_time >= "` +
    `${formatDateKey_(start)}"`;

  const baseUrl =
    'https://health.googleapis.com/v4/users/me/' +
    'dataTypes/sleep/dataPoints' +
    '?pageSize=25&filter=' +
    encodeURIComponent(filter);

  let pageToken = '';
  const sleeps = [];

  do {
    const url = pageToken
      ? `${baseUrl}&pageToken=${encodeURIComponent(pageToken)}`
      : baseUrl;

    const response = callHealthApi_(url);

    sleeps.push.apply(
      sleeps,
      (response.dataPoints || [])
        .map(point => point.sleep)
        .filter(Boolean)
    );

    pageToken = response.nextPageToken || '';
  } while (pageToken);

  const byDate = {};

  sleeps
    .filter(sleep =>
      !sleep.metadata ||
      sleep.metadata.nap !== true
    )
    .forEach(sleep => {
      const summary = sleep.summary || {};
      const date = getSleepDateKey_(sleep);

      if (!date) {
        return;
      }

      const minutesAsleep =
        numericOrNull_(summary.minutesAsleep);

      if (minutesAsleep === null) {
        return;
      }

      const stages = summary.stagesSummary || [];
      const record = {
        date: date,
        minutesAsleep: minutesAsleep,
        minutesAwake:
          numericOrNull_(summary.minutesAwake) || 0,
        deepMinutes:
          getSleepStageMinutes_(stages, 'DEEP') || 0,
        remMinutes:
          getSleepStageMinutes_(stages, 'REM') || 0
      };

      record.score = calculateSleepQualityScore_(record);

      /*
       * Keep the longest main sleep if duplicate records land on
       * the same end date.
       */
      if (
        !byDate[date] ||
        record.minutesAsleep > byDate[date].minutesAsleep
      ) {
        byDate[date] = record;
      }
    });

  const cutoff = formatDateKey_(addDays_(new Date(), -(days - 1)));

  return Object.keys(byDate)
    .filter(date => date >= cutoff)
    .sort()
    .map(date => byDate[date]);
}


function getSleepDateKey_(sleep) {
  if (
    sleep.interval &&
    sleep.interval.civilEndTime &&
    sleep.interval.civilEndTime.date
  ) {
    return healthDateKey_(
      sleep.interval.civilEndTime.date
    );
  }

  if (
    sleep.interval &&
    sleep.interval.endTime
  ) {
    return Utilities.formatDate(
      new Date(sleep.interval.endTime),
      USER_TIME_ZONE,
      'yyyy-MM-dd'
    );
  }

  return '';
}


function calculateSleepQualityScore_(record) {
  const durationScore = Math.min(
    100,
    Math.max(
      0,
      100 - Math.abs(record.minutesAsleep - 450) * .32
    )
  );

  const totalInBed =
    record.minutesAsleep + record.minutesAwake;

  const efficiency = totalInBed > 0
    ? record.minutesAsleep / totalInBed
    : 0;

  const efficiencyScore = Math.min(
    100,
    Math.max(0, (efficiency - .65) / .25 * 100)
  );

  const deepShare =
    record.minutesAsleep > 0
      ? record.deepMinutes / record.minutesAsleep
      : 0;

  const remShare =
    record.minutesAsleep > 0
      ? record.remMinutes / record.minutesAsleep
      : 0;

  const deepScore = Math.min(
    100,
    Math.max(0, deepShare / .18 * 100)
  );

  const remScore = Math.min(
    100,
    Math.max(0, remShare / .22 * 100)
  );

  return Math.round(
    durationScore * .40 +
    efficiencyScore * .30 +
    deepScore * .15 +
    remScore * .15
  );
}


function formatDurationLabel_(minutes) {
  const total = Math.round(Number(minutes));
  const hours = Math.floor(total / 60);
  const remainder = total % 60;

  return `${hours}h ${remainder}m`;
}
