import { api } from '/shared/api.js';

const $ = (sel, root = document) => root.querySelector(sel);
const API = '/api/admin';

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter((k) => k != null));
  return el;
}

function notify(kind, text) {
  const m = $('#msg');
  m.className = `result ${kind}`;
  m.textContent = text;
  if (kind === 'ok') setTimeout(() => { if (m.textContent === text) { m.className = 'result'; m.textContent = ''; } }, 3000);
}

async function guard(fn) {
  try { return await fn(); } catch (e) { notify('bad', e.message); }
}

function table(el, headers, rows) {
  el.replaceChildren(
    h('thead', {}, h('tr', {}, ...headers.map((t) => h('th', {}, t)))),
    h('tbody', {}, ...rows),
  );
}

function actions(...buttons) {
  return h('td', { class: 'actions-cell' }, ...buttons);
}

// ---------------------------------------------------------------- вкладки

const TABS = ['ws', 'types', 'products', 'plan'];

function openTab(name) {
  for (const t of TABS) {
    $(`#tab-${t}`).hidden = t !== name;
    $(`[data-tab=${t}]`).classList.toggle('secondary', t !== name);
  }
  if (name === 'ws') fitPreview();
}

$('#tabs').addEventListener('click', (e) => {
  const tab = e.target.dataset?.tab;
  if (tab) openTab(tab);
});

// ---------------------------------------------------------------- робочі місця

let manifest = {};
let workstations = [];
let editingWs = null;
let extraParams = {};
const wsForm = $('#ws-form');
const wf = wsForm.elements;

function fitPreview() {
  const wrap = $('#preview-wrap');
  const scale = wrap.clientWidth / 1280;
  if (!scale) return;
  $('#preview').style.transform = `scale(${scale})`;
  wrap.style.height = `${720 * scale}px`;
}
window.addEventListener('resize', fitPreview);

function updateTemplateHint() {
  const def = manifest[wf.template.value];
  $('#template-hint').textContent = def?.description || '';
}

function renderTemplateOptions() {
  wf.template.replaceChildren(
    ...Object.entries(manifest).map(([key, def]) => h('option', { value: key }, def.title || key)),
  );
  updateTemplateHint();
}

function modelSelect(key, value) {
  const sel = h('select', { 'data-param': key, 'data-kind': 'model' },
    h('option', { value: '' }, '— не обирати —'),
    ...products.map((p) => h('option', { value: String(p.id) }, `${p.article} — ${p.name}`)));
  if (value != null) sel.value = String(value);
  return sel;
}

function fillModelSelects() {
  for (const sel of document.querySelectorAll('#ws-params select[data-kind="model"]')) {
    const current = sel.value;
    sel.replaceChildren(
      h('option', { value: '' }, '— не обирати —'),
      ...products.map((p) => h('option', { value: String(p.id) }, `${p.article} — ${p.name}`)),
    );
    if ([...sel.options].some((o) => o.value === current)) sel.value = current;
  }
}

function paramInput(key, def, value) {
  if (def.type === 'model') return modelSelect(key, value);
  const input = h('input', {
    type: def.type === 'number' ? 'number' : 'text',
    'data-param': key,
    'data-kind': def.type === 'number' ? 'number' : 'text',
  });
  if (value != null) input.value = value;
  return input;
}

function renderParams(values = {}, keepExtra = false) {
  const defs = manifest[wf.template.value]?.params || {};
  const box = $('#ws-params');
  box.replaceChildren();
  extraParams = {};
  for (const [key, def] of Object.entries(defs)) {
    const lab = h('span', { class: 'lab' }, def.title || key,
      def.hint ? h('span', { class: 'q', title: def.hint }, '?') : null);
    box.append(h('label', {}, lab, paramInput(key, def, values[key])));
  }
  if (keepExtra) {
    for (const [k, v] of Object.entries(values)) if (!(k in defs)) extraParams[k] = v;
  }
}

function collectParams() {
  const params = { ...extraParams };
  for (const input of $('#ws-params').querySelectorAll('[data-param]')) {
    const v = input.value.trim();
    if (v === '') continue;
    const kind = input.dataset.kind;
    params[input.dataset.param] = (kind === 'number' || kind === 'model') ? Number(v) : v;
  }
  return params;
}

function updatePreview() {
  const win = $('#preview').contentWindow;
  if (!win || !wf.template.value) return;
  win.postMessage(
    { type: 'config', template: wf.template.value, number: Number(wf.number.value) || 0, config: collectParams() },
    location.origin,
  );
}

function renderWsTable() {
  table($('#ws-table'), ['№', 'Назва', 'Шаблон', 'Ключ', ''], workstations.map((ws) => h('tr', {},
    h('td', {}, String(ws.number)),
    h('td', {}, ws.name || ''),
    h('td', {}, manifest[ws.template]?.title || ws.template),
    h('td', {}, ws.result_key || ''),
    actions(
      h('button', { type: 'button', class: 'secondary', onclick: () => editWs(ws) }, 'Редагувати'),
      h('button', { type: 'button', class: 'danger', onclick: () => deleteWs(ws) }, 'Видалити'),
    ),
  )));
}

async function loadWorkstations() {
  workstations = await api(`${API}/workstations`);
  renderWsTable();
}

function resetWs() {
  editingWs = null;
  wsForm.reset();
  $('#ws-form-title').textContent = 'Нове робоче місце';
  updateTemplateHint();
  renderParams();
  updatePreview();
}

function editWs(ws) {
  editingWs = ws.id;
  $('#ws-form-title').textContent = `Редагування: місце ${ws.number}`;
  wf.number.value = ws.number;
  wf.name.value = ws.name || '';
  if (![...wf.template.options].some((o) => o.value === ws.template)) {
    wf.template.append(h('option', { value: ws.template }, `${ws.template} (немає в маніфесті)`));
  }
  wf.template.value = ws.template;
  wf.result_key.value = ws.result_key || '';
  updateTemplateHint();
  renderParams(ws.template_params || {}, true);
  updatePreview();
}

function deleteWs(ws) {
  if (!confirm(`Видалити робоче місце ${ws.number}?`)) return;
  guard(async () => {
    await api(`${API}/workstations/${ws.id}`, { method: 'DELETE' });
    notify('ok', 'Видалено');
    if (editingWs === ws.id) resetWs();
    await loadWorkstations();
  });
}

wsForm.addEventListener('input', updatePreview);
wf.template.addEventListener('change', () => { updateTemplateHint(); renderParams(collectParams()); updatePreview(); });
$('#ws-reset').addEventListener('click', resetWs);
$('#preview').addEventListener('load', () => { fitPreview(); updatePreview(); });
wsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  guard(async () => {
    const body = {
      number: Number(wf.number.value),
      name: wf.name.value.trim() || null,
      template: wf.template.value,
      template_params: collectParams(),
      result_key: wf.result_key.value.trim() || null,
    };
    if (editingWs) await api(`${API}/workstations/${editingWs}`, { method: 'PUT', body });
    else await api(`${API}/workstations`, { method: 'POST', body });
    notify('ok', 'Збережено');
    await loadWorkstations();
    resetWs();
  });
});

// ---------------------------------------------------------------- типи продукції

let types = [];

function renderTypes() {
  table($('#types-table'), ['ID', 'Назва', ''], types.map((t) => h('tr', {},
    h('td', {}, String(t.id)),
    h('td', {}, t.name),
    actions(
      h('button', { type: 'button', class: 'secondary', onclick: () => renameType(t) }, 'Перейменувати'),
      h('button', { type: 'button', class: 'danger', onclick: () => deleteType(t) }, 'Видалити'),
    ),
  )));
  const select = $('#product-form').elements.type_id;
  const current = select.value;
  select.replaceChildren(...types.map((t) => h('option', { value: t.id }, t.name)));
  if (current) select.value = current;
}

async function loadTypes() {
  types = await api(`${API}/product-types`);
  renderTypes();
}

function renameType(t) {
  const name = prompt('Нова назва типу', t.name)?.trim();
  if (!name || name === t.name) return;
  guard(async () => {
    await api(`${API}/product-types/${t.id}`, { method: 'PUT', body: { name } });
    await loadTypes();
    await loadProducts();
  });
}

function deleteType(t) {
  if (!confirm(`Видалити тип «${t.name}»?`)) return;
  guard(async () => {
    await api(`${API}/product-types/${t.id}`, { method: 'DELETE' });
    notify('ok', 'Видалено');
    await loadTypes();
  });
}

$('#type-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = e.target.elements.name;
  guard(async () => {
    await api(`${API}/product-types`, { method: 'POST', body: { name: input.value.trim() } });
    input.value = '';
    notify('ok', 'Додано');
    await loadTypes();
  });
});

// ---------------------------------------------------------------- моделі

let products = [];
let editingProduct = null;
const pf = $('#product-form').elements;
const limitsBox = $('#limits-builder');
let productExtra = {};   // ключі characteristics поза limits — зберігаємо недоторканими

function renderProducts() {
  table($('#products-table'), ['ID', 'Назва', 'Артикул', 'Тип', 'Datasheet', ''], products.map((p) => h('tr', {},
    h('td', {}, String(p.id)),
    h('td', {}, p.name),
    h('td', {}, p.article),
    h('td', {}, p.type_name),
    h('td', {}, p.datasheet_path ? h('a', { href: p.datasheet_path, target: '_blank' }, 'PDF') : ''),
    actions(
      h('button', { type: 'button', class: 'secondary', onclick: () => editProduct(p) }, 'Редагувати'),
      h('button', { type: 'button', class: 'danger', onclick: () => deleteProduct(p) }, 'Видалити'),
    ),
  )));
}

async function loadProducts() {
  products = await api(`${API}/products`);
  renderProducts();
  fillModelSelects();
}

const LIMIT_TYPES = [
  { value: 'number', title: 'Число (min/max)' },
  { value: 'expected', title: 'Так/ні (норма)' },
  { value: 'allowed', title: 'Вибір зі списку' },
];

function limitRow(data = {}) {
  const row = h('div', { class: 'limit-row' });

  const key = h('input', { type: 'text', placeholder: 'напр. dielectric', maxlength: '64', 'data-k': 'key' });
  if (data.key) key.value = data.key;

  const typeSel = h('select', { 'data-k': 'type' },
    ...LIMIT_TYPES.map((t) => h('option', { value: t.value }, t.title)));
  typeSel.value = data.type || 'number';

  const fields = h('div', { 'data-k': 'fields' });

  function num(name, val) {
    const input = h('input', { type: 'number', 'data-k': name, placeholder: name });
    if (val != null) input.value = val;
    return h('label', {}, name, input);
  }

  function renderFields() {
    fields.replaceChildren();
    if (typeSel.value === 'number') {
      fields.append(h('div', { class: 'grid4' },
        num('min', data.min), num('max', data.max),
        num('range_min', data.range_min), num('range_max', data.range_max)));
    } else if (typeSel.value === 'expected') {
      const sel = h('select', { 'data-k': 'expected' },
        h('option', { value: 'true' }, 'Так (true)'),
        h('option', { value: 'false' }, 'Ні (false)'));
      sel.value = data.expected === false ? 'false' : 'true';
      fields.append(h('label', {}, 'Норма (що вважати «в нормі»)', sel));
    } else {
      const input = h('input', { type: 'text', placeholder: 'напр. zigbee, matter', 'data-k': 'allowed' });
      if (data.allowed) input.value = data.allowed.join(', ');
      fields.append(h('label', {}, 'Дозволені значення (через кому)', input));
    }
  }

  typeSel.addEventListener('change', renderFields);
  renderFields();

  row.append(
    h('label', {}, 'Назва параметра (збігається з ключем робочого місця)', key),
    h('label', {}, 'Тип значення', typeSel),
    fields,
    h('button', { type: 'button', class: 'danger limit-remove', onclick: () => { row.remove(); updateLimitsEmpty(); } }, 'Видалити'),
  );
  return row;
}

function updateLimitsEmpty() {
  $('#limits-empty').hidden = limitsBox.children.length > 0;
}

function renderLimits(characteristics) {
  limitsBox.replaceChildren();
  const limits = (characteristics || {}).limits || {};
  for (const [key, l] of Object.entries(limits)) {
    const data = { key };
    if (l && typeof l === 'object') {
      if ('expected' in l) { data.type = 'expected'; data.expected = l.expected; }
      else if ('allowed' in l) { data.type = 'allowed'; data.allowed = l.allowed; }
      else { data.type = 'number'; data.min = l.min; data.max = l.max; data.range_min = l.range_min; data.range_max = l.range_max; }
    }
    limitsBox.append(limitRow(data));
  }
  updateLimitsEmpty();
}

function collectLimits() {
  const limits = {};
  for (const row of limitsBox.querySelectorAll('.limit-row')) {
    const key = row.querySelector('[data-k="key"]').value.trim();
    if (!key) continue;
    const type = row.querySelector('[data-k="type"]').value;
    if (type === 'number') {
      const l = {};
      for (const n of ['min', 'max', 'range_min', 'range_max']) {
        const el = row.querySelector(`[data-k="${n}"]`);
        if (el && el.value.trim() !== '') l[n] = Number(el.value);
      }
      limits[key] = l;
    } else if (type === 'expected') {
      limits[key] = { expected: row.querySelector('[data-k="expected"]').value === 'true' };
    } else {
      const raw = row.querySelector('[data-k="allowed"]').value;
      limits[key] = { allowed: raw.split(',').map((s) => s.trim()).filter(Boolean) };
    }
  }
  return limits;
}

$('#limits-add').addEventListener('click', () => {
  limitsBox.append(limitRow());
  updateLimitsEmpty();
});

function resetProduct() {
  editingProduct = null;
  $('#product-form').reset();
  productExtra = {};
  renderLimits({});
  $('#product-form-title').textContent = 'Нова модель';
  $('#datasheet-label').hidden = true;
}

function editProduct(p) {
  editingProduct = p.id;
  $('#product-form-title').textContent = `Редагування: ${p.article}`;
  pf.name.value = p.name;
  pf.article.value = p.article;
  pf.type_id.value = p.type_id;
  pf.description.value = p.description || '';
  const chars = p.characteristics || {};
  productExtra = { ...chars };
  delete productExtra.limits;
  renderLimits(chars);
  $('#datasheet-label').hidden = false;
  $('#product-form').scrollIntoView({ behavior: 'smooth' });
}

function deleteProduct(p) {
  if (!confirm(`Видалити модель ${p.article}?`)) return;
  guard(async () => {
    await api(`${API}/products/${p.id}`, { method: 'DELETE' });
    notify('ok', 'Видалено');
    if (editingProduct === p.id) resetProduct();
    await loadProducts();
  });
}

$('#product-reset').addEventListener('click', resetProduct);
$('#product-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const limits = collectLimits();
  const characteristics = { ...productExtra };
  if (Object.keys(limits).length) characteristics.limits = limits;
  guard(async () => {
    const body = {
      name: pf.name.value.trim(),
      article: pf.article.value.trim(),
      type_id: Number(pf.type_id.value),
      description: pf.description.value.trim() || null,
      characteristics,
    };
    if (editingProduct) await api(`${API}/products/${editingProduct}`, { method: 'PUT', body });
    else await api(`${API}/products`, { method: 'POST', body });
    notify('ok', 'Збережено');
    await loadProducts();
    resetProduct();
  });
});

$('#datasheet-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file || !editingProduct) return;
  const fd = new FormData();
  fd.append('file', file);
  guard(async () => {
    await api(`${API}/products/${editingProduct}/datasheet`, { method: 'POST', form: fd });
    notify('ok', 'Datasheet завантажено');
    await loadProducts();
  }).finally(() => { e.target.value = ''; });
});

// ---------------------------------------------------------------- план

$('#plan-form').addEventListener('submit', (e) => {
  e.preventDefault();
  guard(async () => {
    await api(`${API}/settings`, { method: 'PUT', body: { daily_plan: Number(e.target.elements.daily_plan.value) } });
    notify('ok', 'План збережено');
  });
});

// ---------------------------------------------------------------- старт

guard(async () => {
  manifest = await fetch('/templates/templates.json').then((r) => r.json());
  renderTemplateOptions();
  renderParams();
  await loadTypes();
  await Promise.all([loadWorkstations(), loadProducts()]);
  $('#plan-form').elements.daily_plan.value = (await api(`${API}/settings`)).daily_plan;
  openTab('ws');
});
