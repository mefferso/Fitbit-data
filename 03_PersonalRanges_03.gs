
function getWeightData_() {
  const spreadsheet =
    getWeightSpreadsheet_();

  const sheet =
    spreadsheet.getSheetByName(getScriptConfig_().weightSheetName);

  if (!sheet) {
    throw new Error(
      `Sheet tab "${getScriptConfig_().weightSheetName}" was not found.`
    );
  }

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    throw new Error('No weight records were found.');
  }

  /*
   * A = Date
   * B = Shot
   * C = Weight
   */
  const rows = sheet
    .getRange(2, 1, lastRow - 1, 3)
    .getValues();

  const timeZone =
    spreadsheet.getSpreadsheetTimeZone();

  const rawPoints = [];
  const medicationChanges = {};

  let previousMedication = '';

  rows.forEach(row => {
    const dateValue = row[0];
    const shotValue = row[1];
    const weightValue = row[2];

    const validDate =
      dateValue instanceof Date &&
      !isNaN(dateValue.getTime());

    if (!validDate) {
      return;
    }

    const dateKey = Utilities.formatDate(
      dateValue,
      timeZone,
      'yyyy-MM-dd'
    );

    const shot = String(shotValue || '').trim();

    /*
     * Record only actual medication/dose changes,
     * not every weekly injection.
     */
    if (shot && shot !== previousMedication) {
      medicationChanges[dateKey] = shot;
      previousMedication = shot;
    }

    /*
 * Ignore future dates and blank/formula-empty weight cells.
 * Number('') equals 0 in JavaScript, which caused the bogus
 * zero-pound entries.
 */
const todayKey = Utilities.formatDate(
  new Date(),
  timeZone,
  'yyyy-MM-dd'
);

if (dateKey > todayKey) {
  return;
}

if (
  weightValue === null ||
  weightValue === '' ||
  (
    typeof weightValue === 'string' &&
    weightValue.trim() === ''
  )
) {
  return;
}

const weight = Number(weightValue);

if (!Number.isFinite(weight) || weight <= 0) {
  return;
}

    rawPoints.push({
      date: dateKey,
      dateMs: dateValue.getTime(),
      weight: round1_(weight)
    });
  });

  rawPoints.sort((a, b) => a.dateMs - b.dateMs);

  if (!rawPoints.length) {
    throw new Error('No numeric weights were found.');
  }

  /*
   * Calculate a rolling seven-measurement average.
   * Since your sheet is generally daily, this acts
   * as the seven-day average.
   */
  const points = rawPoints.map((point, index) => {
    const firstIndex = Math.max(0, index - 6);
    const window = rawPoints.slice(firstIndex, index + 1);

    const average =
      window.reduce((sum, item) => sum + item.weight, 0) /
      window.length;

    return {
      date: point.date,
      weight: point.weight,
      average7: round1_(average),
      medication: medicationChanges[point.date] || null
    };
  });

  const first = rawPoints[0];
  const latest = rawPoints[rawPoints.length - 1];

  const lowest = rawPoints.reduce(
    (minimum, point) =>
      point.weight < minimum.weight ? point : minimum,
    rawPoints[0]
  );

  /*
   * Find the last measurement on or before
   * 30 days before the latest measurement.
   */
  const cutoff30 = new Date(latest.dateMs);
  cutoff30.setDate(cutoff30.getDate() - 30);

  let baseline30 = rawPoints[0];

  rawPoints.forEach(point => {
    if (point.dateMs <= cutoff30.getTime()) {
      baseline30 = point;
    }
  });

  const daySpan = Math.round(
    (latest.dateMs - first.dateMs) / 86400000
  ) + 1;

  return {
    sourceName: spreadsheet.getName(),
    sheetName: sheet.getName(),

    summary: {
      latestWeight: latest.weight,
      latestDate: latest.date,

      startingWeight: first.weight,
      startingDate: first.date,

      totalLoss: round1_(
        first.weight - latest.weight
      ),

      average7: points[points.length - 1].average7,

      change30: round1_(
        latest.weight - baseline30.weight
      ),

      lowestWeight: lowest.weight,
      lowestDate: lowest.date,

      measurements: points.length,
      daysTracked: daySpan
    },

    medicationChanges: points
      .filter(point => point.medication)
      .map(point => ({
        date: point.date,
        medication: point.medication
      })),

    points: points
  };
}
