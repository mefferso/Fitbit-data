

function extractWorkoutElevationFeet_(metrics) {
  const meters = extractFirstNumber_(metrics, [
    'elevationGainMeters',
    'elevationGainM'
  ]);

  if (meters !== null) {
    return roundTo_(meters * 3.28084, 0);
  }

  const millimeters = extractFirstNumber_(metrics, [
    'elevationGainMillimeters',
    'elevationGainMm'
  ]);

  if (millimeters !== null) {
    return roundTo_(millimeters / 304.8, 0);
  }

  return null;
}


function heartRateZoneInfo_(heartRate, zones) {
  const value = numericOrNull_(heartRate);
  const lightMin = numericOrNull_(zones && zones.lightMin);
  const moderateMin = numericOrNull_(zones && zones.moderateMin);
  const vigorousMin = numericOrNull_(zones && zones.vigorousMin);
  const peakMin = numericOrNull_(zones && zones.peakMin);

  if (value === null) {
    return { key: 'below', label: 'Below light' };
  }

  if (peakMin !== null && value >= peakMin) {
    return { key: 'peak', label: 'Peak' };
  }

  if (vigorousMin !== null && value >= vigorousMin) {
    return { key: 'vigorous', label: 'Vigorous' };
  }

  if (moderateMin !== null && value >= moderateMin) {
    return { key: 'moderate', label: 'Moderate' };
  }

  if (lightMin !== null && value >= lightMin) {
    return { key: 'light', label: 'Light' };
  }

  return { key: 'below', label: 'Below light' };
}

function workoutZoneThresholdLabel_(key, zones) {
  if (key === 'peak' && zones.peakMin !== null) return `${zones.peakMin}+ bpm`;
  if (key === 'vigorous' && zones.vigorousMin !== null) return `${zones.vigorousMin}+ bpm`;
  if (key === 'moderate' && zones.moderateMin !== null) return `${zones.moderateMin}+ bpm`;
  if (key === 'light' && zones.lightMin !== null) return `${zones.lightMin}+ bpm`;
  return 'Below threshold';
}
