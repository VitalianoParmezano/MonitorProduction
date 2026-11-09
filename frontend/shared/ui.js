let audio;

export function showResult(el, kind, text) {
  el.className = `result ${kind}`;
  el.textContent = text;
}

export function beep(ok) {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (ok ? 0.12 : 0.35));
  } catch { /* звук необовʼязковий */ }
}

/** Повертає фокус на поле штрихкоду (елемент із data-scan). */
export function focusScan(root) {
  const el = root.querySelector('[data-scan]');
  if (el) { el.focus(); el.select?.(); }
}

export function startClock(el) {
  const tick = () => { el.textContent = new Date().toLocaleTimeString('uk-UA'); };
  tick();
  return setInterval(tick, 1000);
}
