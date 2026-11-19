import { mountDaytimeHrv } from './daytime-hrv.mjs';

const root = document.documentElement;
const themeKey = 'performance-lab-theme';
try { root.dataset.theme = localStorage.getItem(themeKey) || 'dark'; }
catch { root.dataset.theme = 'dark'; }

for (const id of ['theme-toggle', 'mobile-theme']) {
  document.getElementById(id).addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(themeKey, root.dataset.theme); } catch {}
    root.dispatchEvent(new Event('experiment-theme'));
  });
}
document.getElementById('mobile-menu').addEventListener('click', event => {
  const open = document.getElementById('sidebar').classList.toggle('open');
  event.currentTarget.setAttribute('aria-expanded', String(open));
});

mountDaytimeHrv(document.getElementById('daytime-hrv'));
