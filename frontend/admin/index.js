// Адмінка: CRUD моделей продукції.
// Автентифікація — рідне вікно браузера (HTTP Basic). Бекенд повертає
// 401 + WWW-Authenticate, тому браузер сам показує діалог входу.
import { showMessage } from "/shared/ui.js";

async function adminFetch(path, opts = {}) {
  const res = await fetch(path, opts);

  if (res.status === 401) {
    showMessage("Доступ заборонено. Оновіть сторінку та введіть логін і пароль у вікні браузера.", "err");
    throw new Error("Доступ заборонено");
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    const detail = data && data.detail ? data.detail : `Помилка ${res.status}`;
    throw new Error(detail);
  }
  return data;
}

// --- CRUD моделей ---

let editingId = null;

const nameInput = document.getElementById("m-name");
const insulationInput = document.getElementById("m-insulation");
const earthInput = document.getElementById("m-earth");
const datasheetInput = document.getElementById("m-datasheet");
const formTitle = document.getElementById("form-title");
const tbody = document.getElementById("models-body");

function resetForm() {
  editingId = null;
  formTitle.textContent = "Додати модель";
  nameInput.value = "";
  insulationInput.value = "";
  earthInput.value = "";
  datasheetInput.value = "";
}

async function loadModels() {
  const products = await adminFetch("/api/admin/products");
  tbody.innerHTML = "";
  products.forEach((p) => {
    const tr = document.createElement("tr");

    const tdId = document.createElement("td");
    tdId.textContent = p.id;
    const tdName = document.createElement("td");
    tdName.textContent = p.name;
    const tdIns = document.createElement("td");
    tdIns.textContent = p.insulation_min_mohm;
    const tdEarth = document.createElement("td");
    tdEarth.textContent = p.earth_max_ohm;

    const tdDs = document.createElement("td");
    if (p.datasheet_url) {
      const a = document.createElement("a");
      a.href = p.datasheet_url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "відкрити";
      tdDs.appendChild(a);
    } else {
      tdDs.textContent = "—";
    }

    const tdActions = document.createElement("td");
    const editBtn = document.createElement("button");
    editBtn.textContent = "Редагувати";
    editBtn.addEventListener("click", () => {
      editingId = p.id;
      formTitle.textContent = `Редагувати модель №${p.id}`;
      nameInput.value = p.name;
      insulationInput.value = p.insulation_min_mohm;
      earthInput.value = p.earth_max_ohm;
    });
    const delBtn = document.createElement("button");
    delBtn.textContent = "Видалити";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`Видалити модель «${p.name}»?`)) return;
      try {
        await adminFetch(`/api/admin/products/${p.id}`, { method: "DELETE" });
        showMessage("Модель видалено", "ok");
        await loadModels();
        if (editingId === p.id) resetForm();
      } catch (e) {
        showMessage(e.message, "err");
      }
    });
    tdActions.append(editBtn, " ", delBtn);

    tr.append(tdId, tdName, tdIns, tdEarth, tdDs, tdActions);
    tbody.appendChild(tr);
  });
}

async function saveModel() {
  const name = nameInput.value.trim();
  const insulation = parseFloat(insulationInput.value);
  const earth = parseFloat(earthInput.value);
  if (!name) { showMessage("Введіть назву", "err"); return; }
  if (!Number.isFinite(insulation) || insulation <= 0) { showMessage("Ліміт ізоляції має бути > 0", "err"); return; }
  if (!Number.isFinite(earth) || earth <= 0) { showMessage("Ліміт заземлення має бути > 0", "err"); return; }

  const payload = { name, insulation_min_mohm: insulation, earth_max_ohm: earth };
  try {
    if (editingId == null) {
      const created = await adminFetch("/api/admin/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (datasheetInput.files.length > 0) {
        await uploadDatasheet(created.id);
      }
      showMessage("Модель створено", "ok");
    } else {
      await adminFetch(`/api/admin/products/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (datasheetInput.files.length > 0) {
        await uploadDatasheet(editingId);
      }
      showMessage("Модель оновлено", "ok");
    }
    resetForm();
    await loadModels();
  } catch (e) {
    showMessage(e.message, "err");
  }
}

async function uploadDatasheet(productId) {
  const fd = new FormData();
  fd.append("file", datasheetInput.files[0]);
  await adminFetch(`/api/admin/products/${productId}/datasheet`, { method: "POST", body: fd });
}

document.getElementById("save-model").addEventListener("click", saveModel);
document.getElementById("reset-form").addEventListener("click", resetForm);

async function init() {
  try {
    await loadModels();
  } catch (e) {
    showMessage(e.message, "err");
  }
}

init();

