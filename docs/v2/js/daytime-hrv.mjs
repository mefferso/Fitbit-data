const STORAGE_KEY = 'performance-lab-daytime-hrv-v1';
const SNAPSHOT = 'Garmin Health Snapshot';
const FIT = 'Garmin activity FIT';
const STATUS = {
  'awaiting-recording': 'Recent Garmin activities were checked. Awaiting a FIT file with usable RR intervals.',
  'rr-detected': 'The automatic check found plausible RR intervals. Import a private FIT summary to view any windows that pass screening.',
  unverified: 'Garmin FIT availability could not be verified on the latest check. You can still record a Snapshot or import a private FIT summary.',
};

const finiteNonnegative = value => Number.isFinite(value) && value >= 0;
const validLocalTime = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
const formatMs = value => value.toLocaleString(undefined, {maximumFractionDigits: 1}) + ' ms';

export function readFitSummary(file) {
  if (file?.version !== 1 || !Array.isArray(file.readings) || file.readings.length > 1000) {
    throw new Error('Unsupported FIT summary');
  }
  return file.readings.map(row => {
    if (!row || row.source !== FIT || row.method !== 'fit-rmssd-v1' ||
        typeof row.id !== 'string' || !/^[0-9a-f]{64}$/.test(row.id) || !validLocalTime(row.time) ||
        typeof row.instant !== 'string' || !row.instant.endsWith('+00:00') ||
        !Number.isFinite(Date.parse(row.instant)) || !finiteNonnegative(row.rmssd) ||
        !Number.isFinite(row.duration) || row.duration < 300 || row.duration > 310 ||
        ![row.intervals, row.recordedIntervals, row.invalidIntervals].every(Number.isSafeInteger) ||
        row.intervals < 2 || row.invalidIntervals < 0 ||
        row.recordedIntervals < row.intervals + row.invalidIntervals ||
        row.sensor !== 'unknown' || row.timing !== 'session-start' || row.quality !== 'screened') {
      throw new Error('Invalid FIT measurement');
    }
    const {id, time, instant, source, method, rmssd, duration, intervals, recordedIntervals,
      invalidIntervals, sensor, timing, quality} = row;
    return {id, time, instant, source, method, rmssd, duration, intervals, recordedIntervals,
      invalidIntervals, sensor, timing, quality};
  });
}

export function measurementHistory(rows, day = '') {
  return rows.filter(row => !day || row.time.startsWith(day + 'T'))
    .sort((a, b) => Date.parse(b.instant) - Date.parse(a.instant) || b.id.localeCompare(a.id));
}

function describeTime(row) {
  const date = row.time.replace('T', ' ');
  return row.source === FIT ? date + ' CT (session start)' : date + ' (local time)';
}

function describeQuality(row) {
  if (row.source === SNAPSHOT) return 'Manual entry · Garmin-reported';
  return `Screened FIT · ${row.intervals} intervals over ${row.duration} s · sensor unverified`;
}

function mountChart(canvas, rows) {
  const css = getComputedStyle(document.documentElement);
  const colors = ['--primary', '--warning'].map(name => css.getPropertyValue(name).trim());
  return new window.Chart(canvas, {
    type: 'scatter',
    data: {
      datasets: [FIT, SNAPSHOT].map((source, i) => ({
        label: source,
        data: rows.filter(row => row.source === source).map(row => ({
          x: Date.parse(row.instant), y: row.rmssd, time: describeTime(row),
        })),
        pointRadius: 5,
        pointStyle: i ? 'triangle' : 'circle',
        backgroundColor: colors[i],
      })).filter(series => series.data.length),
    },
    options: {
      maintainAspectRatio: false,
      color: css.getPropertyValue('--ink').trim(),
      plugins: {tooltip: {callbacks: {
        title: items => items[0]?.raw.time,
        label: item => item.dataset.label + ' · ' + formatMs(item.raw.y),
      }}},
      scales: {
        x: {ticks: {maxTicksLimit: 5, callback: value => new Date(value).toLocaleDateString()}},
        y: {beginAtZero: true, title: {display: true, text: 'RMSSD (ms)'}},
      },
    },
  });
}

export function mountDaytimeHrv(root) {
  const field = key => root.querySelector(`[data-hrv="${key}"]`);
  const form = field('form');
  const feedback = message => { field('feedback').textContent = message; };
  let rows = [];
  let editing = null;
  let chart = null;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(saved)) rows = saved.filter(row => row && typeof row.id === 'string' &&
      validLocalTime(row.time) && Number.isFinite(Date.parse(row.instant)) &&
      finiteNonnegative(row.rmssd) && [SNAPSHOT, FIT].includes(row.source));
  } catch {
    feedback('Browser storage could not be read.');
  }

  function persist(next) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      rows = next;
      return true;
    } catch {
      feedback('Could not save changes. Check this browser’s storage settings.');
      return false;
    }
  }

  function resetForm() {
    editing = null;
    form.reset();
    field('save').textContent = 'Save Snapshot';
    field('cancel').hidden = true;
  }

  function edit(row) {
    editing = row.id;
    for (const key of ['time', 'rmssd', 'sdrr', 'context']) {
      form.elements.namedItem(key).value = row[key] ?? '';
    }
    field('save').textContent = 'Update Snapshot';
    field('cancel').hidden = false;
    form.elements.namedItem('time').focus();
  }

  function remove(row) {
    if (!window.confirm('Delete this Health Snapshot?')) return;
    if (!persist(rows.filter(item => item.id !== row.id))) return;
    if (editing === row.id) resetForm();
    feedback('Snapshot deleted.');
    render();
  }

  function button(label, action) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'secondary-button';
    element.textContent = label;
    element.addEventListener('click', action);
    return element;
  }

  function renderRow(row) {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = formatMs(row.rmssd) + ' RMSSD · ' + row.source;
    const detail = document.createElement('small');
    detail.textContent = [describeTime(row), describeQuality(row),
      row.source === FIT ? `${row.invalidIntervals} invalid of ${row.recordedIntervals} recorded intervals` : '',
      row.sdrr != null ? 'SDRR ' + formatMs(row.sdrr) : '', row.context].filter(Boolean).join(' · ');
    item.append(title, detail);
    if (row.source === SNAPSHOT) {
      const actions = document.createElement('div');
      actions.className = 'hrv-actions';
      actions.append(button('Edit', () => edit(row)), button('Delete', () => remove(row)));
      item.append(actions);
    }
    return item;
  }

  function render() {
    const latest = measurementHistory(rows)[0];
    field('latest').textContent = latest ? formatMs(latest.rmssd) : '—';
    field('latest-detail').textContent = latest
      ? [latest.source, describeTime(latest), describeQuality(latest)].join(' · ')
      : 'No daytime readings saved';
    const day = field('filter').value;
    const history = measurementHistory(rows, day);
    field('empty').hidden = rows.length > 0;
    field('history-note').textContent = day && !history.length ? 'No readings on this date.' : '';
    field('history').replaceChildren(...history.map(renderRow));
    chart?.destroy();
    chart = null;
    field('chart-wrap').hidden = !history.length || !window.Chart;
    if (!field('chart-wrap').hidden) chart = mountChart(field('chart'), history);
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const formData = new FormData(form);
    const time = String(formData.get('time'));
    const rmssd = Number(formData.get('rmssd'));
    const sdrr = formData.get('sdrr') === '' ? null : Number(formData.get('sdrr'));
    if (!validLocalTime(time) || formData.get('rmssd') === '' || !finiteNonnegative(rmssd) ||
        (sdrr !== null && !finiteNonnegative(sdrr))) {
      feedback('Enter a valid local time and nonnegative HRV values.');
      return;
    }
    const row = {id: editing ?? crypto.randomUUID(), time, instant: new Date(time).toISOString(),
      source: SNAPSHOT, rmssd, sdrr, context: String(formData.get('context')).trim()};
    if (!persist([...rows.filter(item => item.id !== row.id), row])) return;
    field('filter').value = '';
    resetForm();
    feedback('Snapshot saved in this browser.');
    render();
  });

  field('cancel').addEventListener('click', resetForm);
  field('filter').addEventListener('change', render);
  field('show-all').addEventListener('click', () => {
    field('filter').value = '';
    render();
  });
  field('import').addEventListener('change', async event => {
    const input = event.currentTarget;
    const file = input.files[0];
    if (!file) return;
    try {
      if (file.size > 1_000_000) throw new Error('Summary too large');
      const imported = readFitSummary(JSON.parse(await file.text()));
      if (!imported.length) {
        feedback('This file contains no screened FIT measurements.');
        return;
      }
      const merged = new Map(rows.map(row => [row.id, row]));
      for (const row of imported) merged.set(row.id, row);
      if (persist([...merged.values()])) {
        field('filter').value = '';
        feedback('FIT measurements saved in this browser.');
        render();
      }
    } catch {
      feedback('Could not read a valid FIT summary JSON file.');
    } finally {
      input.value = '';
    }
  });

  document.documentElement.addEventListener('experiment-theme', render);
  window.addEventListener('load', render, {once: true});
  render();
  fetch('../data/daytime-hrv-status.json', {cache: 'no-store'})
    .then(response => {
      if (!response.ok) throw new Error('Status unavailable');
      return response.json();
    })
    .then(data => { field('status').textContent = Object.hasOwn(STATUS, data.fit) ? STATUS[data.fit] : STATUS.unverified; })
    .catch(() => { field('status').textContent = STATUS.unverified; });
}
