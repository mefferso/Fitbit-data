const ROOT = '../';

export class DataStore {
  constructor(){
    this.latest = null;
    this.trends = null;
    this.index = null;
    this.runCache = new Map();
  }

  async fetchJson(path){
    const response = await fetch(path, {cache:'no-store'});
    if(!response.ok) throw new Error('Could not load ' + path + ' (' + response.status + ')');
    const data = await response.json();
    if(data && data.error) throw new Error(data.error);
    return data;
  }

  async loadCore(){
    const results = await Promise.all([
      this.fetchJson(ROOT + 'data/latest.json'),
      this.fetchJson(ROOT + 'data/trends.json'),
      this.fetchJson(ROOT + 'data/run-index.json')
    ]);
    this.latest = results[0];
    this.trends = results[1];
    this.index = results[2];
    return this;
  }

  get runs(){
    return (this.index && this.index.runs) || [];
  }

  get detailedRuns(){
    return this.runs.filter(function(run){ return Boolean(run.detailFile); });
  }

  get latestRun(){
    return this.latest && this.latest.run ? this.latest.run : null;
  }

  findRun(runId){
    if(!runId) return null;
    return this.runs.find(function(run){ return run.runId === runId; }) || null;
  }

  findPrevious(runId){
    const i = this.runs.findIndex(function(run){ return run.runId === runId; });
    return i >= 0 && i + 1 < this.runs.length ? this.runs[i + 1] : null;
  }

  async loadRun(runOrId){
    const summary = typeof runOrId === 'string' ? this.findRun(runOrId) : runOrId;
    if(!summary) throw new Error('Run not found.');
    if(this.runCache.has(summary.runId)) return this.runCache.get(summary.runId);

    if(this.latestRun && this.latestRun.runId === summary.runId){
      this.runCache.set(summary.runId, this.latestRun);
      return this.latestRun;
    }

    if(!summary.detailFile) throw new Error('Detailed trace is not available for this older run.');
    const run = await this.fetchJson(ROOT + summary.detailFile);
    this.runCache.set(summary.runId, run);
    return run;
  }

  filterRuns(days){
    const runs = this.runs.slice();
    if(days === 'all') return runs;
    const newest = runs.length ? new Date(runs[0].date + 'T12:00:00Z') : new Date();
    const cutoff = new Date(newest.getTime() - Number(days) * 86400000);
    return runs.filter(function(run){ return new Date(run.date + 'T12:00:00Z') >= cutoff; });
  }
}

export function number(value){
  if(value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function mean(values){
  const usable = values.map(number).filter(function(v){ return v !== null; });
  return usable.length ? usable.reduce(function(a,b){ return a + b; }, 0) / usable.length : null;
}

export function median(values){
  const usable = values.map(number).filter(function(v){ return v !== null; }).sort(function(a,b){ return a - b; });
  if(!usable.length) return null;
  const m = Math.floor(usable.length / 2);
  return usable.length % 2 ? usable[m] : (usable[m - 1] + usable[m]) / 2;
}

export function fmtDate(value, compact){
  if(!value) return '—';
  return new Date(value + 'T12:00:00').toLocaleDateString('en-US', compact
    ? {month:'short', day:'numeric'}
    : {month:'short', day:'numeric', year:'numeric'});
}

export function fmtTime(value){
  if(!value) return '—';
  return new Date(value).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
}

export function fmtDuration(seconds){
  const value = number(seconds);
  if(value === null) return '—';
  const total = Math.round(value);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? h + 'h ' + String(m).padStart(2,'0') + 'm' : m + ':' + String(s).padStart(2,'0');
}

export function fmtPace(seconds){
  const value = number(seconds);
  if(value === null || value <= 0) return '—';
  const total = Math.round(value);
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2,'0') + '/mi';
}

export function fmtNumber(value, digits){
  const n = number(value);
  return n === null ? '—' : n.toFixed(digits === undefined ? 0 : digits);
}

export function signed(value, digits, suffix){
  const n = number(value);
  if(n === null) return '—';
  return (n > 0 ? '+' : '') + n.toFixed(digits === undefined ? 1 : digits) + (suffix || '');
}

export function percentDelta(current, prior){
  const a = number(current), b = number(prior);
  if(a === null || b === null || b === 0) return null;
  return (a - b) / Math.abs(b) * 100;
}

export function rollingAverage(values, windowSize){
  return values.map(function(_, index){
    const start = Math.max(0, index - windowSize + 1);
    return mean(values.slice(start, index + 1));
  });
}

export function closestByDate(runs, date){
  const target = new Date(date).getTime();
  let best = null, delta = Infinity;
  runs.forEach(function(run){
    const d = Math.abs(new Date(run.startTime || run.date).getTime() - target);
    if(d < delta){ best = run; delta = d; }
  });
  return best;
}