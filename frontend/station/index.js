// Екран робочого місця: один HTML, чотири режими за параметром n.
import { STATIONS } from "/shared/stations.js";
import { apiGet, apiPost, apiPostForm } from "/shared/api.js";
import { evaluateStage } from "/shared/evaluate.js";
import { showMessage, hideMessage, playSound, setBusy, commaToDot } from "/shared/ui.js";
import { bindEnter, focusAndSelect } from "/shared/scanner.js";

const params = new URLSearchParams(location.search);
const n = parseInt(params.get("n"), 10);
if (!n || n < 1 || n > 4) {
  document.body.textContent = "Невідоме робоче місце";
  throw new Error("невідоме місце");
}

const station = STATIONS[n];

document.getElementById("station-title").textContent = `Місце ${n}: ${station.name}`;

setInterval(() => {
  document.getElementById("clock").textContent = new Date().toLocaleTimeString("uk-UA");
}, 1000);

// --- Поточна партія (шапка) ---
let currentBatch = null;

async function refreshBatchInfo() {
  try {
    currentBatch = await apiGet("/api/batches/current");
    const box = document.getElementById("batch-info");
    if (!currentBatch) {
      box.textContent = "Партію не відкрито";
    } else {
      box.textContent = `Партія №${currentBatch.id}: ${currentBatch.done} / ${currentBatch.planned_qty}`;
    }
    if (n === 1) {
      const btn = document.getElementById("submit-1");
      const hint = document.getElementById("batch-hint");
      btn.disabled = !currentBatch;
      hint.textContent = currentBatch
        ? ""
        : "Немає відкритої партії. Відкрийте її в сервісному режимі.";
    }
  } catch {
    /* тимчасова помилка мережі */
  }
}

// --- Показати потрібну панель ---
document.querySelectorAll(".panel").forEach((p) => (p.hidden = true));
if (n === 1) {
  document.getElementById("panel-1").hidden = false;
} else if (n === 2 || n === 3) {
  document.getElementById("title-23").textContent = station.name;
  document.getElementById("panel-23").hidden = false;
} else {
  document.getElementById("panel-4").hidden = false;
}

// --- Місце 1 ---
if (n === 1) {
  const barcodeInput = document.getElementById("barcode-1");
  const driverInput = document.getElementById("barcode-driver");
  const submitBtn = document.getElementById("submit-1");

  async function submit1() {
    const barcode = barcodeInput.value.trim();
    const driver = driverInput.value.trim();
    if (!barcode) { showMessage("Відскануйте штрихкод світильника", "err"); focusAndSelect(barcodeInput); return; }
    if (!driver) { showMessage("Відскануйте штрихкод драйвера", "err"); focusAndSelect(driverInput); return; }
    if (!currentBatch) { showMessage("Немає відкритої партії", "err"); return; }
    setBusy(submitBtn, true);
    try {
      await apiPost("/api/stations/1/submit", { barcode, barcode_driver: driver });
      showMessage("Збережено", "ok");
      playSound("ok");
      barcodeInput.value = "";
      driverInput.value = "";
      focusAndSelect(barcodeInput);
      refreshBatchInfo();
    } catch (e) {
      showMessage(e.message, "err");
      playSound("err");
    } finally {
      setBusy(submitBtn, false);
    }
  }

  bindEnter(barcodeInput, () => {
    if (!barcodeInput.value.trim()) { showMessage("Відскануйте штрихкод світильника", "err"); return; }
    focusAndSelect(driverInput);
  });
  bindEnter(driverInput, submit1);
  submitBtn.addEventListener("click", submit1);
}

// --- Місця 2 і 3 ---
if (n === 2 || n === 3) {
  const barcodeInput = document.getElementById("barcode-23");
  const valueInput = document.getElementById("value");
  const norm = document.getElementById("norm");
  const submitBtn = document.getElementById("submit-23");
  let currentCard = null;

  function parseValue(raw) {
    if (!raw) return { error: "Введіть значення" };
    const s = commaToDot(raw.trim());
    if (s === "") return { error: "Введіть значення" };
    const v = Number(s);
    if (!Number.isFinite(v)) return { error: "Значення має бути числом" };
    if (v < 0) return { error: "Значення не може бути від'ємним" };
    return { value: v };
  }

  bindEnter(barcodeInput, async () => {
    const barcode = barcodeInput.value.trim();
    if (!barcode) { showMessage("Відскануйте штрихкод", "err"); return; }
    try {
      currentCard = await apiGet(`/api/units/${encodeURIComponent(barcode)}`);
      const p = currentCard.product;
      if (n === 2) {
        norm.textContent = `Норма: не менше ${p.insulation_min_mohm} ${station.unit}`;
      } else {
        norm.textContent = `Норма: не більше ${p.earth_max_ohm} ${station.unit}`;
      }
      norm.hidden = false;
      hideMessage();
      focusAndSelect(valueInput);
    } catch (e) {
      currentCard = null;
      norm.hidden = true;
      showMessage(e.message, "err");
      playSound("err");
    }
  });

  async function submit23() {
    const barcode = barcodeInput.value.trim();
    if (!barcode) { showMessage("Відскануйте штрихкод", "err"); return; }
    const parsed = parseValue(valueInput.value);
    if (parsed.error) { showMessage(parsed.error, "err"); focusAndSelect(valueInput); return; }
    setBusy(submitBtn, true);
    try {
      const data = await apiPost(`/api/stations/${n}/submit`, { barcode, value: parsed.value });
      const val = data.results[String(n)] ? data.results[String(n)].value : null;
      const verdict = evaluateStage(n, val, data.product);
      const ok = verdict === "ok";
      showMessage(ok ? "У нормі" : "Поза нормою", ok ? "ok" : "err");
      playSound(ok ? "ok" : "err");
      barcodeInput.value = "";
      valueInput.value = "";
      norm.hidden = true;
      focusAndSelect(barcodeInput);
      refreshBatchInfo();
    } catch (e) {
      showMessage(e.message, "err");
      playSound("err");
    } finally {
      setBusy(submitBtn, false);
    }
  }

  bindEnter(valueInput, submit23);
  submitBtn.addEventListener("click", submit23);
}

// --- Місце 4 ---
if (n === 4) {
  const barcodeInput = document.getElementById("barcode-4");
  const submitBtn = document.getElementById("submit-4");
  const video = document.getElementById("camera");
  const canvas = document.getElementById("canvas");
  const select = document.getElementById("camera-select");
  const elec = document.getElementById("elec-params");

  let stream = null;
  let currentDeviceId = localStorage.getItem("cameraDeviceId") || null;

  function renderElec(data) {
    if (!data) {
      elec.textContent = "Електричні параметри: Z2M ще не підключено";
      return;
    }
    const parts = [];
    if (data.voltage_v != null) parts.push(`Напруга: ${data.voltage_v} В`);
    if (data.current_a != null) parts.push(`Струм: ${data.current_a} А`);
    elec.textContent = parts.length ? parts.join(", ") : "Електричні параметри: Z2M ще не підключено";
  }

  async function listCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === "videoinput");
      select.innerHTML = "";
      cams.forEach((c, i) => {
        const opt = document.createElement("option");
        opt.value = c.deviceId;
        opt.textContent = c.label || `Камера ${i + 1}`;
        select.appendChild(opt);
      });
      if (cams.length === 0) return;
      if (currentDeviceId && cams.some((c) => c.deviceId === currentDeviceId)) {
        select.value = currentDeviceId;
      } else {
        currentDeviceId = cams[0].deviceId;
        select.value = currentDeviceId;
      }
    } catch {
      /* без списку камер */
    }
  }

  async function startCamera() {
    await listCameras();
    try {
      const constraints = currentDeviceId
        ? { video: { deviceId: { exact: currentDeviceId } } }
        : { video: true };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
    } catch {
      showMessage("Немає доступу до камери (потрібен HTTPS)", "err");
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }

  select.addEventListener("change", async () => {
    currentDeviceId = select.value;
    localStorage.setItem("cameraDeviceId", currentDeviceId);
    stopCamera();
    await startCamera();
  });

  window.addEventListener("beforeunload", stopCamera);

  bindEnter(barcodeInput, async () => {
    const barcode = barcodeInput.value.trim();
    if (!barcode) { showMessage("Відскануйте штрихкод", "err"); return; }
    try {
      const card = await apiGet(`/api/units/${encodeURIComponent(barcode)}`);
      renderElec(card.results["4"] ? card.results["4"].data : null);
      hideMessage();
    } catch (e) {
      renderElec(null);
      showMessage(e.message, "err");
      playSound("err");
    }
  });

  function captureFrame(cb) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => cb(blob), "image/jpeg", 0.9);
  }

  async function submit4() {
    const barcode = barcodeInput.value.trim();
    if (!barcode) { showMessage("Відскануйте штрихкод", "err"); focusAndSelect(barcodeInput); return; }
    captureFrame(async (blob) => {
      if (!blob) { showMessage("Не вдалося зняти кадр", "err"); return; }
      const fd = new FormData();
      fd.append("barcode", barcode);
      fd.append("photo", blob, "photo.jpg");
      setBusy(submitBtn, true);
      try {
        const card = await apiPostForm("/api/stations/4/capture", fd);
        showMessage("Зафіксовано", "ok");
        playSound("ok");
        barcodeInput.value = "";
        renderElec(card.results["4"] ? card.results["4"].data : null);
        focusAndSelect(barcodeInput);
        refreshBatchInfo();
      } catch (e) {
        showMessage(e.message, "err");
        playSound("err");
      } finally {
        setBusy(submitBtn, false);
      }
    });
  }

  submitBtn.addEventListener("click", submit4);
  startCamera();
}

refreshBatchInfo();
setInterval(refreshBatchInfo, 7000);

