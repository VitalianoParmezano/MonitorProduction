import { api } from '/shared/api.js';
import { beep, focusScan, showResult } from '/shared/ui.js';

export function init(root, cfg) {
  const form = root.querySelector('form');
  const { barcode, file } = form.elements;
  const button = form.querySelector('button[type=submit]');
  const result = root.querySelector('[data-result]');
  const fileTitle = root.querySelector('[data-file-title]');
  const defaultTitle = fileTitle.textContent;

  barcode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (barcode.value.trim()) file.click(); }
  });
  file.addEventListener('change', () => {
    fileTitle.textContent = file.files[0] ? `Обрано: ${file.files[0].name}` : defaultTitle;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (button.disabled) return;
    if (cfg.preview) { showResult(result, 'info', 'Режим превʼю: відправка вимкнена'); return; }

    const code = barcode.value.trim();
    if (!code) { showResult(result, 'bad', 'Проскануйте штрихкод'); barcode.focus(); return; }
    if (!file.files[0]) { showResult(result, 'bad', 'Оберіть фото'); return; }

    const fd = new FormData();
    fd.append('workstation', cfg.workstation);
    fd.append('barcode', code);
    fd.append('file', file.files[0]);

    button.disabled = true;
    try {
      await api('/api/measurements/photo', { method: 'POST', form: fd });
      showResult(result, 'ok', 'Фото збережено');
      beep(true);
      form.reset();
      fileTitle.textContent = defaultTitle;
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
