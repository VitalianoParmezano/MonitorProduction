import { api } from './api.js';
import { focusScan, startClock } from './ui.js';

const $ = (id) => document.getElementById(id);
const isPreview = new URLSearchParams(location.search).has('preview');
const NAME_RE = /^[a-z0-9-]+$/;

let cleanup = null;
let seq = 0;

function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}
function recall(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}

async function loadTemplate(name, cfg) {
  if (!NAME_RE.test(name || '')) throw new Error('Невірна назва шаблону');
  const id = ++seq;
  const res = await fetch(`/templates/${name}.html`);
  if (!res.ok) throw new Error(`Шаблон «${name}» не знайдено`);
  const html = await res.text();
  const mod = await import(`/templates/${name}.js`);
  if (id !== seq) return; // прийшов новіший запит (превʼю)
  if (cleanup) { cleanup(); cleanup = null; }
  $('content').innerHTML = html;
  cleanup = mod.init($('content'), { ...cfg, preview: isPreview }) || null;
  // У превʼю не перехоплюємо фокус: iframe має лишатися «неактивним»,
  // інакше при введенні тексту в адмінці фокус тікає на штрихкод у превʼю.
  if (!isPreview) focusScan($('content'));
}

function showApp(title) {
  $('login').hidden = true;
  $('app').hidden = false;
  $('ws-title').textContent = title;
}

function showLogin(message = '') {
  seq++;
  if (cleanup) { cleanup(); cleanup = null; }
  $('content').innerHTML = '';
  $('app').hidden = true;
  $('login').hidden = false;
  $('login-error').textContent = message;
  $('ws-number').value = recall('ws');
  $('ws-number').focus();
  $('ws-number').select();
}

async function openWorkstation(number) {
  const cfg = await api(`/api/workstations/${number}/config`);
  store('ws', String(cfg.number));
  showApp(`Робоче місце ${cfg.number}${cfg.name ? ` · ${cfg.name}` : ''}`);
  await loadTemplate(cfg.template, { workstation: cfg.number, params: cfg.params, name: cfg.name });
}

startClock($('clock'));

if (isPreview) {
  // Режим превʼю: конфіг надходить з адмінки через postMessage
  showApp('Превʼю');
  $('change-ws').hidden = true;
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.type !== 'config') return;
    const { template, number = 0, config = {} } = e.data;
    loadTemplate(template, { workstation: number, params: config }).catch((err) => {
      $('content').textContent = err.message;
    });
  });
} else {
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = Number($('ws-number').value);
    if (!Number.isInteger(n) || n < 1) { $('login-error').textContent = 'Введіть номер робочого місця'; return; }
    try {
      $('login-error').textContent = '';
      await openWorkstation(n);
    } catch (err) {
      showLogin(err.message);
    }
  });
  $('change-ws').addEventListener('click', () => showLogin());
  showLogin();
}
