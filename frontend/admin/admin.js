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

function renderTemplateOptions() {
  wf.template.replaceChildren(
    ...Object.entries(manifest).map(([key, def]) => h('option', { value: key }, def.title || key)),
  );
}

function renderParams(values = {}, keepExtra = false) {
  const defs = manifest[wf.template.value]?.params || {};
  const box = $('#ws-params');
  box.replaceChildren();
  extraParams = {};
  for (const [key, def] of Object.entries(defs)) {
    const input = h('input', { type: def.type === 'number' ? 'number' : 'text', 'data-param': key });
    if (values[key] != null) input.value = values[key];
    box.append(h('label', {}, def.title || key, input));
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
    params[input.dataset.param] = input.type === 'number' ? Number(v) : v;
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
wf.template.addEventListener('change', () => { renderParams(collectParams()); updatePreview(); });
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
}

function resetProduct() {
  editingProduct = null;
  $('#product-form').reset();
  pf.characteristics.value = '{}';
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
  pf.characteristics.value = JSON.stringify(p.characteristics || {}, null, 2);
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
  let characteristics;
  try {
    characteristics = JSON.parse(pf.characteristics.value || '{}');
    if (characteristics === null || typeof characteristics !== 'object' || Array.isArray(characteristics)) throw new Error();
  } catch {
    notify('bad', 'Характеристики мають бути коректним JSON-обʼєктом');
    return;
  }
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
