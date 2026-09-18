/* =========================================================
   PERSONAL NORMAL RANGES
   ========================================================= */

function getPersonalRanges(days) {
  const baselineDays = Math.max(30, Math.min(365, Number(days) || 90));
  const today = new Date();
  const tomorrow = addDays_(today, 1);
  const historyStart = addDays_(today, -(baselineDays + 8));
  const yesterdayKey = formatDateKey_(addDays_(today, -1));
  const metrics = [];
  const errors = {};

  function addMetric(config, records) {
    try {
      const metric = buildPersonalMetric_(config, records, yesterdayKey, baselineDays);
      if (metric) metrics.push(metric);
    } catch (error) {
      errors[config.key] = error.message;
    }
  }

  try {
    const sleep = getSleepCalendar_(baselineDays + 8);
    addMetric({
      key: 'sleep', label: 'Sleep', unit: 'min', decimals: 0,
      direction: 'middle', formatter: 'duration', targetLow: 360, targetHigh: 540,
      description: 'Main sleep duration'
    }, sleep.map(item => ({ date: item.date, value: item.minutesAsleep })));

    addMetric({
      key: 'deepSleep', label: 'Deep sleep', unit: 'min', decimals: 0,
      direction: 'middle', formatter: 'duration',
      description: 'Minutes of deep sleep'
    }, sleep.map(item => ({ date: item.date, value: item.deepMinutes })));

    addMetric({
      key: 'remSleep', label: 'REM sleep', unit: 'min', decimals: 0,
      direction: 'middle', formatter: 'duration',
      description: 'Minutes of REM sleep'
    }, sleep.map(item => ({ date: item.date, value: item.remMinutes })));
  } catch (error) {
    errors.sleep = error.message;
  }

  try {
    addMetric({
      key: 'restingHeartRate', label: 'Resting heart rate', unit: 'bpm', decimals: 0,
      direction: 'lower', formatter: 'number',
      description: 'Daily resting heart rate'
    }, getDailyRestingHeartRates_(historyStart));
  } catch (error) {
    errors.restingHeartRate = error.message;
  }

  try {
    const steps = getChunkedDailyRollups_(
      'steps', historyStart, tomorrow,
      point => point.steps && numericOrNull_(point.steps.countSum)
    );
    addMetric({
      key: 'steps', label: 'Steps', unit: '', decimals: 0,
      direction: 'higher', formatter: 'integer',
      description: 'Latest completed day'
    }, steps);
  } catch (error) {
    errors.steps = error.message;
  }

  try {
    const active = getChunkedDailyRollups_(
      'active-minutes', historyStart, tomorrow,
      point => extractActiveMinutes_(point.activeMinutes)
    );
    addMetric({
      key: 'activeMinutes', label: 'Active minutes', unit: 'min', decimals: 0,
      direction: 'higher', formatter: 'number',
      description: 'Light + moderate + vigorous minutes'
    }, active);
  } catch (error) {
    errors.activeMinutes = error.message;
  }

  try {
    const calories = getChunkedDailyRollups_(
      'total-calories', historyStart, tomorrow,
      point => extractFirstNumber_(point.totalCalories, [
        'kcalSum', 'kilocaloriesSum', 'caloriesSum', 'kcal'
      ])
    );
    addMetric({
      key: 'calories', label: 'Calories burned', unit: 'kcal', decimals: 0,
      direction: 'neutral', formatter: 'integer',
      description: 'Total daily energy expenditure'
    }, calories);
  } catch (error) {
    errors.calories = error.message;
  }

  const dailyConfigs = [
    {
      dataType: 'daily-heart-rate-variability', field: 'dailyHeartRateVariability',
      valueField: 'averageHeartRateVariabilityMilliseconds',
      config: { key: 'hrv', label: 'HRV', unit: 'ms', decimals: 0,
        direction: 'higher', formatter: 'number', description: 'Nightly RMSSD average' }
    },
    {
      dataType: 'daily-oxygen-saturation', field: 'dailyOxygenSaturation',
      valueField: 'averagePercentage',
      config: { key: 'spo2', label: 'SpO₂', unit: '%', decimals: 1,
        direction: 'higher', formatter: 'number', description: 'Average during sleep' }
    },
    {
      dataType: 'daily-respiratory-rate', field: 'dailyRespiratoryRate',
      valueField: 'breathsPerMinute',
      config: { key: 'breathingRate', label: 'Breathing rate', unit: '/min', decimals: 1,
        direction: 'middle', formatter: 'number', description: 'Average during main sleep' }
    },
    {
      dataType: 'daily-sleep-temperature-derivations', field: 'dailySleepTemperatureDerivations',
      valueGetter: item => {
        const nightly = numericOrNull_(item.nightlyTemperatureCelsius);
        const baseline = numericOrNull_(item.baselineTemperatureCelsius);
        return nightly !== null && baseline !== null ? nightly - baseline : nightly;
      },
      config: { key: 'skinTemperature', label: 'Skin temperature', unit: '°C', decimals: 1,
        direction: 'middle', formatter: 'signed', description: 'Nightly difference from baseline' }
    }
  ];

  dailyConfigs.forEach(item => {
    try {
      const records = getDailyDataTypeSeries_(
        item.dataType,
        item.field,
        historyStart,
        item.valueGetter || (record => numericOrNull_(record[item.valueField]))
      );
      addMetric(item.config, records);
    } catch (error) {
      errors[item.config.key] = error.message;
    }
  });

  return {
    baselineDays: baselineDays,
    generatedAt: new Date().toISOString(),
    metrics: metrics,
    errors: errors
  };
}
