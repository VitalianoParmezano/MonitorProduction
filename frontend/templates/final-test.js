import { api } from '/shared/api.js';
import { beep, focusScan, showResult } from '/shared/ui.js';

export function init(root, cfg) {
  const input = root.querySelector('[data-barcode]');
  const unitBox = root.querySelector('[data-unit]');
  const rows = root.querySelector('[data-rows]');
  const note = root.querySelector('[data-note]');
  const result = root.querySelector('[data-result]');
  const buttons = root.querySelectorAll('[data-verdict]');
  let current = null;

  function reset() {
    current = null;
    unitBox.hidden = true;
    rows.replaceChildren();
    note.value = '';
    input.value = '';
    focusScan(root);
  }

  function cell(text, cls) {
    const td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  }

  async function lookup() {
    const code = input.value.trim();
    if (!code) return;
    try {
      const u = await api(`/api/units/${encodeURIComponent(code)}`);
      current = u.barcode;
      root.querySelector('[data-product]').textContent = `${u.product_name} (${u.article})`;
      rows.replaceChildren();
      const entries = Object.entries(u.q_tests_data || {});
      if (!entries.length) {
        const tr = document.createElement('tr');
        tr.append(cell('Ще немає результатів'), cell(''), cell(''));
        rows.append(tr);
      }
      for (const [key, v] of entries) {
        const tr = document.createElement('tr');
        tr.append(cell(key), cell(String(v.value)), cell(v.ok ? 'в нормі' : 'поза допуском', v.ok ? 'badge-ok' : 'badge-bad'));
        rows.append(tr);
      }
      unitBox.hidden = false;
      result.className = 'result';
      result.textContent = '';
    } catch (err) {
      current = null;
      unitBox.hidden = true;
      showResult(result, 'bad', err.message);
      beep(false);
      input.select();
    }
  }

  async function send(verdict) {
    if (!current) return;
    if (cfg.preview) { showResult(result, 'info', 'Режим превʼю: відправка вимкнена'); return; }
    buttons.forEach((b) => { b.disabled = true; });
    try {
      await api('/api/measurements/submit', {
        method: 'POST',
        body: {
          workstation: cfg.workstation,
          barcode: current,
          value: verdict,
          ok: verdict === 'ok',
          note: note.value.trim() || null,
        },
      });
      showResult(result, verdict === 'ok' ? 'ok' : 'bad', verdict === 'ok' ? 'Записано: придатний' : 'Записано: непридатний');
      beep(verdict === 'ok');
      reset();
    } catch (err) {
      showResult(result, 'bad', err.message);
      beep(false);
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); lookup(); }
  });
  buttons.forEach((b) => b.addEventListener('click', () => send(b.dataset.verdict)));
}
