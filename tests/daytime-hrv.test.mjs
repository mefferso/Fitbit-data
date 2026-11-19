import assert from 'node:assert/strict';
import test from 'node:test';
import {measurementHistory, readFitSummary} from '../docs/v2/js/daytime-hrv.mjs';

const fit = {
  id: 'a'.repeat(64), time: '2026-11-17T10:00', instant: '2026-11-17T16:00:00+00:00',
  source: 'Garmin activity FIT', method: 'fit-rmssd-v1', rmssd: 24, duration: 301,
  intervals: 310, recordedIntervals: 600, invalidIntervals: 1, sensor: 'unknown',
  timing: 'session-start', quality: 'screened',
};

test('FIT import accepts only its summary contract and strips extra fields', () => {
  assert.deepEqual(readFitSummary({version: 1, readings: [{...fit, rr: [123]}]}), [fit]);
  assert.throws(() => readFitSummary({version: 1, readings: [{...fit, duration: 20}]}));
  assert.throws(() => readFitSummary({version: 1, readings: [{...fit, rmssd: null}]}));
});

test('date filter uses recording dates and history sorts by instant', () => {
  const snapshot = {id: 'snapshot', time: '2026-11-18T06:00', instant: '2026-11-18T12:00Z'};
  assert.deepEqual(measurementHistory([fit, snapshot]), [snapshot, fit]);
  assert.deepEqual(measurementHistory([fit, snapshot], '2026-11-17'), [fit]);
  assert.deepEqual(measurementHistory([fit, snapshot], '2026-11-19'), []);
});

test('Garmin-synced Snapshots keep only approved fields and a stable local identity', async () => {
  const {readSnapshotSummary} = await import('../docs/v2/js/daytime-hrv.mjs');
  const row = {instant: '2026-11-18T14:31+00:00', time: '2026-11-18T08:31', rmssd: 24, sdrr: null};
  assert.deepEqual(readSnapshotSummary([{...row, location: 'private'}]), [{
    ...row, id: 'snapshot:' + row.instant, source: 'Garmin Health Snapshot', method: 'garmin-sync',
  }]);
  assert.throws(() => readSnapshotSummary([{...row, rmssd: null}]));
});
