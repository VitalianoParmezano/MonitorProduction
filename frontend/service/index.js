// Сервісний режим: поточна партія та картка світильника.
import { STATIONS } from "/shared/stations.js";
import { apiGet, apiPost, apiPatch } from "/shared/api.js";
import { evaluateStage } from "/shared/evaluate.js";
import { showMessage, hideMessage, playSound, setBusy, formatDateTime } from "/shared/ui.js";
import { bindEnter } from "/shared/scanner.js";

let currentBatch = null;

const currentBox = document.getElementById("current-batch");
const progress = document.getElementById("progress");
const prevSelect = document.getElementById("prev-batch");
const modelSelect = document.getElementById("new-model");

function renderCurrent() {
  if (!currentBatch) {
    currentBox.textContent = "Партію не відкрито";
    progress.hidden = true;
    document.getElementById("edit-plan").value = "";
    return;
  }
  currentBox.textContent = `Партія №${currentBatch.id} · ${currentBatch.product} · готово ${currentBatch.done} / план ${currentBatch.planned_qty}`;
  const planInput = document.getElementById("edit-plan");
  if (document.activeElement !== planInput) {
    planInput.value = currentBatch.planned_qty;
  }

  progress.hidden = false;
  const pct = currentBatch.planned_qty > 0
    ? Math.min(100, Math.round((currentBatch.done / currentBatch.planned_qty) * 100))
    : 0;
  progress.querySelector("span").style.width = `${pct}%`;
}

async function refreshBatches() {
  currentBatch = await apiGet("/api/batches/current");
  renderCurrent();

  const batches = await apiGet("/api/batches");
  prevSelect.innerHTML = "";
  batches.forEach((b) => {
    const opt = document.createElement("option");
    opt.value = b.id;
    const open = b.status === "open" ? " (відкрита)" : "";
    opt.textContent = `Партія №${b.id} · ${b.product}${open}`;
    if (b.status === "open") opt.selected = true;
    prevSelect.appendChild(opt);
  });
}

async function refreshModels() {
  const products = await apiGet("/api/products");
  modelSelect.innerHTML = "";
  products.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    modelSelect.appendChild(opt);
  });
}

// --- Дії з партією ---

document.getElementById("new-batch").addEventListener("click", () => {
  document.getElementById("new-batch-form").hidden = false;
});

document.getElementById("cancel-new").addEventListener("click", () => {
  document.getElementById("new-batch-form").hidden = true;
});

document.getElementById("create-batch").addEventListener("click", async () => {
  const product_id = parseInt(modelSelect.value, 10);
  const planned_qty = parseInt(document.getElementById("new-plan").value, 10);
  if (!product_id) { showMessage("Оберіть модель", "err"); return; }
  if (!Number.isFinite(planned_qty) || planned_qty < 0) { showMessage("Введіть план (≥ 0)", "err"); return; }
  try {
    await apiPost("/api/batches", { product_id, planned_qty });
    document.getElementById("new-batch-form").hidden = true;
    document.getElementById("new-plan").value = "";
    showMessage("Партію створено", "ok");
    await refreshBatches();
  } catch (e) {
    showMessage(e.message, "err");
  }
});

document.getElementById("close-batch").addEventListener("click", async () => {
  if (!currentBatch) { showMessage("Немає відкритої партії", "err"); return; }
  try {
    await apiPost("/api/batches/close", {});
    showMessage("Партію закрито", "ok");
    await refreshBatches();
  } catch (e) {
    showMessage(e.message, "err");
  }
});

document.getElementById("open-batch").addEventListener("click", async () => {
  const id = parseInt(prevSelect.value, 10);
  if (!id) { showMessage("Оберіть партію", "err"); return; }
  try {
    await apiPost(`/api/batches/${id}/open`, {});
    showMessage("Партію зроблено поточною", "ok");
    await refreshBatches();
  } catch (e) {
    showMessage(e.message, "err");
  }
});

document.getElementById("save-plan").addEventListener("click", async () => {
  if (!currentBatch) { showMessage("Немає відкритої партії", "err"); return; }
  const planned_qty = parseInt(document.getElementById("edit-plan").value, 10);
  if (!Number.isFinite(planned_qty) || planned_qty < 0) { showMessage("Введіть план (≥ 0)", "err"); return; }
  try {
    await apiPatch(`/api/batches/${currentBatch.id}`, { planned_qty });
    showMessage("План оновлено", "ok");
    await refreshBatches();
  } catch (e) {
    showMessage(e.message, "err");
  }
});

// --- Картка світильника ---

const cardBox = document.getElementById("card");
const cardBarcode = document.getElementById("card-barcode");

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.appendChild(c);
  return node;
}

function renderCard(card) {
  cardBox.innerHTML = "";

  const rows = [
    ["Штрихкод", card.barcode],
    ["Штрихкод драйвера", card.barcode_driver || "—"],
    ["Партія", card.batch ? `№${card.batch.id} (${card.batch.status === "open" ? "відкрита" : "закрита"})` : "—"],
    ["Модель", card.product ? card.product.name : "—"],
  ];

  if (card.product) {
    rows.push(["Ліміт ізоляції", `не менше ${card.product.insulation_min_mohm} МОм`]);
    rows.push(["Ліміт заземлення", `не більше ${card.product.earth_max_ohm} Ом`]);
  }

  const info = el("div", { class: "card" });
  rows.forEach(([k, v]) => {
    info.appendChild(el("div", {}, [
      el("strong", { text: `${k}: ` }),
      el("span", { text: v }),
    ]));
  });

  // Результати етапів
  const resTitle = el("h3", { text: "Результати" });
  info.appendChild(resTitle);
  const table = el("table");
  const thead = el("thead", {}, [el("tr", {}, [
    el("th", { text: "Етап" }),
    el("th", { text: "Значення" }),
    el("th", { text: "Час" }),
    el("th", { text: "Оцінка" }),
  ])]);
  table.appendChild(thead);
  const tbody = el("tbody");

  for (let stage = 1; stage <= 4; stage++) {
    const r = card.results[String(stage)];
    const tr = el("tr");
    tr.appendChild(el("td", { text: `${stage}. ${STATIONS[stage].name}` }));
    if (!r) {
      tr.appendChild(el("td", { text: "—" }));
      tr.appendChild(el("td", { text: "—" }));
      tr.appendChild(el("td", { text: "—" }));
    } else {
      let valueText = "—";
      if (stage === 2 || stage === 3) valueText = r.value != null ? `${r.value} ${STATIONS[stage].unit}` : "—";
      if (stage === 4) valueText = "фото";
      tr.appendChild(el("td", { text: valueText }));
      tr.appendChild(el("td", { text: formatDateTime(r.tested_at) }));

      let verdict = null;
      if (stage === 2 || stage === 3) {
        verdict = evaluateStage(stage, r.value, card.product);
      }
      if (verdict) {
        const tag = el("span", { class: `tag ${verdict === "ok" ? "ok" : "bad"}`, text: verdict === "ok" ? "ок" : "не ок" });
        tr.appendChild(el("td", {}, [tag]));
      } else {
        tr.appendChild(el("td", { text: "—" }));
      }
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  info.appendChild(table);

  // Електричні параметри (етап 4)
  const d4 = card.results["4"] ? card.results["4"].data : null;
  const elecLine = el("div", { class: "hint" });
  if (d4) {
    const parts = [];
    if (d4.voltage_v != null) parts.push(`Напруга: ${d4.voltage_v} В`);
    if (d4.current_a != null) parts.push(`Струм: ${d4.current_a} А`);
    elecLine.textContent = parts.length ? parts.join(", ") : "Електричні параметри: Z2M ще не підключено";
  } else {
    elecLine.textContent = "Електричні параметри: Z2M ще не підключено";
  }
  info.appendChild(elecLine);

  // Фото
  if (card.photo_url) {
    info.appendChild(el("img", { class: "photo", src: card.photo_url, alt: "Фото світильника" }));
  }

  // Datasheet
  if (card.product && card.product.datasheet_url) {
    info.appendChild(el("div", {}, [
      el("a", { href: card.product.datasheet_url, target: "_blank", rel: "noopener", text: "Datasheet" }),
    ]));
  }

  // Примітки (редагуються)
  info.appendChild(el("h3", { text: "Примітки" }));
  const notesInput = el("textarea", { rows: "3" });
  notesInput.value = card.notes || "";
  const saveNotes = el("button", { text: "Зберегти примітки" });
  const notesHint = el("span", { class: "hint" });
  saveNotes.addEventListener("click", async () => {
    setBusy(saveNotes, true);
    try {
      const updated = await apiPatch(`/api/units/${encodeURIComponent(card.barcode)}`, { notes: notesInput.value });
      notesHint.textContent = "Збережено";
      card.notes = updated.notes;
    } catch (e) {
      notesHint.textContent = e.message;
    } finally {
      setBusy(saveNotes, false);
    }
  });
  info.appendChild(notesInput);
  info.appendChild(el("div", { class: "row" }, [saveNotes, notesHint]));

  cardBox.appendChild(info);
}

bindEnter(cardBarcode, async () => {
  const barcode = cardBarcode.value.trim();
  if (!barcode) { showMessage("Відскануйте штрихкод", "err"); return; }
  try {
    const card = await apiGet(`/api/units/${encodeURIComponent(barcode)}`);
    renderCard(card);
    hideMessage();
  } catch (e) {
    showMessage(e.message, "err");
  }
});

// --- Ініціалізація ---
(async () => {
  try {
    await refreshBatches();
    await refreshModels();
  } catch (e) {
    showMessage(e.message, "err");
  }
})();
setInterval(() => refreshBatches().catch(() => {}), 7000);

