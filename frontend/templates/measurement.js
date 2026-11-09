import { api } from '/shared/api.js';
import { beep, focusScan, showResult } from '/shared/ui.js';

export function init(root, cfg) {
  const p = cfg.params || {};
  const form = root.querySelector('form');
  const { barcode, value } = form.elements;
  const button = form.querySelector('button[type=submit]');
  const result = root.querySelector('[data-result]');

  root.querySelector('[data-label]').textContent = p.label || 'Значення';
  root.querySelector('[data-unit]').textContent = p.unit || '';

  // Сканер надсилає Enter після коду: переходимо до поля вимірювання
  barcode.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (barcode.value.trim()) value.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (button.disabled) return;
    if (cfg.preview) { showResult(result, 'info', 'Режим превʼю: відправка вимкнена'); return; }

    const code = barcode.value.trim();
    const raw = value.value.trim().replace(',', '.');
    const num = Number(raw);
    if (!code) { showResult(result, 'bad', 'Проскануйте штрихкод'); barcode.focus(); return; }
    if (raw === '' || !Number.isFinite(num)) { showResult(result, 'bad', 'Введіть число'); value.focus(); return; }

    button.disabled = true;
    try {
      const r = await api('/api/measurements/submit', {
        method: 'POST',
        body: { workstation: cfg.workstation, barcode: code, value: num },
      });
      showResult(result, r.ok ? 'ok' : 'bad', r.ok ? `Записано: ${num} · в нормі` : `Записано: ${num} · ПОЗА ДОПУСКОМ`);
      beep(r.ok);
      form.reset();
      focusScan(root);
    } catch (err) {
      showResult(result, 'bad', err.message);
      beep(false);
      barcode.focus();
      barcode.select();
    } finally {
      button.disabled = false;
    }
  });
}
