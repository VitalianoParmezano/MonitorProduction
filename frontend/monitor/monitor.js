import { api } from '/shared/api.js';
import { startClock } from '/shared/ui.js';

const $ = (id) => document.getElementById(id);
const REFRESH_MS = 10_000;
const DUCK_EVERY_MS = 30 * 60 * 1000;

startClock($('clock'));

// ------------------------------------------------------------ план / факт

function card(ws, plan) {
  const pct = plan > 0 ? Math.min(100, Math.round((ws.fact / plan) * 100)) : 0;
  const el = document.createElement('div');
  el.className = `card${plan > 0 && ws.fact >= plan ? ' done' : ''}`;

  const num = document.createElement('div');
  num.className = 'num';
  num.textContent = `Робоче місце ${ws.number}`;
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = ws.name || '';
  const nums = document.createElement('div');
  nums.className = 'nums';
  nums.textContent = String(ws.fact);
  const small = document.createElement('small');
  small.textContent = ` / ${plan} (${pct}%)`;
  nums.append(small);
  const bar = document.createElement('div');
  bar.className = 'bar';
  const fill = document.createElement('div');
  fill.style.width = `${pct}%`;
  bar.append(fill);

  el.append(num, title, nums, bar);
  return el;
}

async function refresh() {
  try {
    const data = await api('/api/monitor/summary');
    $('plan').textContent = data.plan;
    $('cards').replaceChildren(...data.workstations.map((ws) => card(ws, data.plan)));
    $('error').className = 'result';
    $('error').textContent = '';
  } catch (err) {
    $('error').className = 'result bad';
    $('error').textContent = err.message;
  }
}

refresh();
setInterval(refresh, REFRESH_MS);

// ------------------------------------------------------------ качечка

let audio = null;

$('sound').addEventListener('click', () => {
  audio ||= new (window.AudioContext || window.webkitAudioContext)();
  audio.resume();
  $('sound').hidden = true;
});

function quack() {
  if (!audio || audio.state !== 'running') return;
  // «Кря-кря»: два коротких пилкоподібних імпульси зі спадною частотою
  [0, 0.22].forEach((offset) => {
    const t = audio.currentTime + offset;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(260, t + 0.15);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

function duck() {
  const win = document.querySelector('.duck-window');
  const bubble = $('bubble');
  win.classList.add('out');
  bubble.classList.add('show');
  quack();
  setTimeout(() => {
    win.classList.remove('out');
    bubble.classList.remove('show');
  }, 4000);
}

setInterval(duck, DUCK_EVERY_MS);
// Для перевірки: натисни D на сторінці моніторингу
document.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'd') duck(); });
