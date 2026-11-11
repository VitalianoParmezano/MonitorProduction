import { api } from '/shared/api.js';
import { beep, focusScan, showResult } from '/shared/ui.js';

export function init(root, cfg) {
  const p = cfg.params || {};
  const form = root.querySelector('form');
  const input = form.elements.barcode;
  const question = root.querySelector('[data-label]');
  const result = root.querySelector('[data-result]');
  const yesBtn = root.querySelector('[data-answer="yes"]');
  const noBtn = root.querySelector('[data-answer="no"]');

  question.textContent = p.label || 'Перевірка пройдена?';
  yesBtn.textContent = p.yes_label || 'Так';
  noBtn.textContent = p.no_label || 'Ні';

  // Сканер надсилає Enter після коду: переходимо на першу кнопку відповіді.
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (input.value.trim()) yesBtn.focus();
  });

  async function send(value) {
    const code = input.value.trim();
    if (!code) {
      showResult(result, 'bad', 'Проскануйте штрихкод');
      input.focus();
      return;
    }
    if (cfg.preview) {
      showResult(result, 'info', 'Режим превʼю: відправка вимкнена');
      return;
    }
    yesBtn.disabled = noBtn.disabled = true;
    try {
      const r = await api('/api/measurements/submit', {
        method: 'POST',
        body: { workstation: cfg.workstation, barcode: code, value, ok: value },
      });
      showResult(result, r.ok ? 'ok' : 'bad', r.ok ? 'Записано · в нормі' : 'Записано · поза нормою');
      beep(r.ok);
      form.reset();
      focusScan(root);
    } catch (err) {
      showResult(result, 'bad', err.message);
      beep(false);
      input.focus();
      input.select();
    } finally {
      yesBtn.disabled = noBtn.disabled = false;
    }
  }

  yesBtn.addEventListener('click', () => send(true));
  noBtn.addEventListener('click', () => send(false));
}
