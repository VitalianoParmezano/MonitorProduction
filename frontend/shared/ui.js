// Спільні дрібниці інтерфейсу: смуга, звук, блокування кнопок, форматування.

export function showMessage(text, kind) {
  const box = document.getElementById("message");
  if (!box) return;
  box.textContent = text;
  box.className = "message " + (kind === "err" ? "err" : "ok");
  box.hidden = false;
}

export function hideMessage() {
  const box = document.getElementById("message");
  if (!box) return;
  box.hidden = true;
  box.textContent = "";
}

let audioCtx = null;

function beep(freq, duration) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    gain.gain.value = 0.06;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch {
    /* без звуку — не критично */
  }
}

export function playSound(kind) {
  if (kind === "ok") {
    beep(880, 0.12);
    setTimeout(() => beep(1320, 0.18), 120);
  } else {
    beep(220, 0.35);
  }
}

export function setBusy(btn, busy) {
  if (btn) btn.disabled = busy;
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("uk-UA");
}

// Десяткову кому («0,5») сприймати як крапку.
export function commaToDot(s) {
  return s.replace(",", ".");
}
