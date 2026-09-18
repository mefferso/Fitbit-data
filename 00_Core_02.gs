

function getFitbitSummary_() {
  const today = new Date();
  const tomorrow = addDays_(today, 1);
  const fourteenDaysAgo = addDays_(today, -14);
  const sevenDaysAgo = addDays_(today, -7);

  const result = {
    steps: null,
    stepsDate: formatDateKey_(today),

    restingHeartRate: null,
    restingHeartRateDate: null,

    sleepMinutes: null,
    sleepDate: null,
    deepMinutes: null,
    remMinutes: null,
    awakeMinutes: null,

    errors: {}
  };

  /*
   * TODAY'S STEPS
   */
  try {
    const stepsResponse = callHealthApi_(
      'https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints:dailyRollUp',
      {
        method: 'post',
        payload: {
          range: {
            start: civilDateTime_(today),
            end: civilDateTime_(tomorrow)
          },
          windowSizeDays: 1
        }
      }
    );

    const rollup =
      (stepsResponse.rollupDataPoints || [])[0];

    if (
      rollup &&
      rollup.steps &&
      rollup.steps.countSum !== undefined
    ) {
      result.steps = Number(rollup.steps.countSum);
    }
  } catch (error) {
    result.errors.steps = error.message;
  }

  /*
   * LATEST DAILY RESTING HEART RATE
   */
  try {
    const filter =
      `daily_resting_heart_rate.date >= "` +
      `${formatDateKey_(fourteenDaysAgo)}"`;

    const url =
      'https://health.googleapis.com/v4/users/me/' +
      'dataTypes/daily-resting-heart-rate/dataPoints' +
      '?pageSize=30&filter=' +
      encodeURIComponent(filter);

    const response = callHealthApi_(url);

    const records = (response.dataPoints || [])
      .map(point => point.dailyRestingHeartRate)
      .filter(Boolean)
      .sort((a, b) =>
        healthDateKey_(b.date)
          .localeCompare(healthDateKey_(a.date))
      );

    if (records.length) {
      result.restingHeartRate =
        Number(records[0].beatsPerMinute);

      result.restingHeartRateDate =
        healthDateKey_(records[0].date);
    }
  } catch (error) {
    result.errors.restingHeartRate = error.message;
  }

  /*
   * MOST RECENT MAIN SLEEP
   */
  try {
    const filter =
      `sleep.interval.civil_end_time >= "` +
      `${formatDateKey_(sevenDaysAgo)}"`;

    const url =
      'https://health.googleapis.com/v4/users/me/' +
      'dataTypes/sleep/dataPoints' +
      '?pageSize=25&filter=' +
      encodeURIComponent(filter);

    const response = callHealthApi_(url);

    const sleeps = (response.dataPoints || [])
      .map(point => point.sleep)
      .filter(Boolean)
      .filter(sleep =>
        !sleep.metadata ||
        sleep.metadata.nap !== true
      )
      .sort((a, b) =>
        new Date(b.interval.endTime).getTime() -
        new Date(a.interval.endTime).getTime()
      );

    if (sleeps.length) {
      const sleep = sleeps[0];
      const summary = sleep.summary || {};

      result.sleepMinutes =
        numericOrNull_(summary.minutesAsleep);

      result.awakeMinutes =
        numericOrNull_(summary.minutesAwake);

      const stages =
        summary.stagesSummary || [];

      result.deepMinutes =
        getSleepStageMinutes_(stages, 'DEEP');

      result.remMinutes =
        getSleepStageMinutes_(stages, 'REM');

      if (
        sleep.interval &&
        sleep.interval.civilEndTime &&
        sleep.interval.civilEndTime.date
      ) {
        result.sleepDate = healthDateKey_(
          sleep.interval.civilEndTime.date
        );
      } else {
        result.sleepDate = Utilities.formatDate(
          new Date(sleep.interval.endTime),
          USER_TIME_ZONE,
          'yyyy-MM-dd'
        );
      }
    }
  } catch (error) {
    result.errors.sleep = error.message;
  }

  return result;
}


function civilDateTime_(date) {
  return {
    date: {
      year: Number(
        Utilities.formatDate(
          date,
          USER_TIME_ZONE,
          'yyyy'
        )
      ),

      month: Number(
        Utilities.formatDate(
          date,
          USER_TIME_ZONE,
          'M'
        )
      ),

      day: Number(
        Utilities.formatDate(
          date,
          USER_TIME_ZONE,
          'd'
        )
      )
    },

    time: {
      hours: 0,
      minutes: 0,
      seconds: 0,
      nanos: 0
    }
  };
}


function formatDateKey_(date) {
  return Utilities.formatDate(
    date,
    USER_TIME_ZONE,
    'yyyy-MM-dd'
  );
}


function healthDateKey_(dateObject) {
  if (!dateObject) {
    return '';
  }

  return [
    String(dateObject.year).padStart(4, '0'),
    String(dateObject.month).padStart(2, '0'),
    String(dateObject.day).padStart(2, '0')
  ].join('-');
}


function addDays_(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}


function numericOrNull_(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


function getSleepStageMinutes_(stages, type) {
  const stage = stages.find(item =>
    item.type === type
  );

  return stage
    ? numericOrNull_(stage.minutes)
    : null;
}
