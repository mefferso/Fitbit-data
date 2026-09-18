

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
