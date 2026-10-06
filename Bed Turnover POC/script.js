// ---- Configuration (browsers have no real env vars, so all settings live here) ----
// Change values here only; the rest of the file never hardcodes a URL or path.
const ENV = {
  BASE_URL: "http://192.168.1.118:5000",                    // Confirm with the backend team
  API_BEDS: "/api/v1/beds",                             // GET
  API_METRICS: "/api/v1/metrics",                       // GET
  API_DISCHARGE: "/api/v1/simulate/discharge",          // POST { bed_id }
  API_CLEANED: "/api/v1/beds/{bed_id}/cleaned",         // POST { staff_id }
  API_OCCUPY: "/api/v1/beds/{bed_id}/occupy",           // POST
  FALLBACK_STAFF_ID: "STF-001",                         // only used if the assigned staff for a bed is unknown
};
// Remember which staff member the backend assigned to each bed (from the discharge response).
const STAFF_KEY = "bedStaffAssignments";
function loadStaff() {
  try { return JSON.parse(localStorage.getItem(STAFF_KEY)) || {}; } catch (e) { return {}; }
}
function saveStaff(map) {
  try { localStorage.setItem(STAFF_KEY, JSON.stringify(map)); } catch (e) { /* storage unavailable: keep going */ }
}
let staffByBed = loadStaff();

const WARD_ORDER = ["WARD-A", "WARD-B", "ICU"];

const $ = (id) => document.getElementById(id);

function showError(msg) {
  $("error-text").textContent = msg;
  $("error-banner").hidden = false;
}
function clearError() { $("error-banner").hidden = true; }
$("error-close").addEventListener("click", clearError);

async function api(path, options) {
  let res;
  try {
    res = await fetch(ENV.BASE_URL + path, options);
  } catch (e) {
    throw new Error("Cannot reach the backend at " + ENV.BASE_URL + ". Is the server running?");
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON body */ }
  if (!res.ok) throw new Error((data && data.error) || "Request failed (" + res.status + ")");
  return data;
}

function bedClass(status) {
  if (status === "AVAILABLE") return "bed-available";
  if (status === "OCCUPIED") return "bed-occupied";
  return "bed-cleaning";
}
function statusText(status) { return status.replace(/_/g, " "); }

function renderBeds(beds) {
  const byWard = {};
  beds.forEach((b) => (byWard[b.ward_id] = byWard[b.ward_id] || []).push(b));
  const wards = WARD_ORDER.filter((w) => byWard[w]).concat(Object.keys(byWard).filter((w) => !WARD_ORDER.includes(w)));

  const root = $("wards");
  root.innerHTML = "";
  wards.forEach((ward) => {
    const section = document.createElement("section");
    section.className = "ward";
    const h = document.createElement("h2");
    h.textContent = ward;
    const grid = document.createElement("div");
    grid.className = "grid";

    byWard[ward].sort((a, b) => a.bed_id.localeCompare(b.bed_id)).forEach((bed) => {
      const card = document.createElement("div");
      card.className = "bed " + bedClass(bed.status);
      card.innerHTML = '<div class="bed-id"></div><div class="bed-status"></div>';
      card.querySelector(".bed-id").textContent = bed.bed_id;
      card.querySelector(".bed-status").textContent = statusText(bed.status);

      if (bed.status.startsWith("CLEANING") && staffByBed[bed.bed_id]) {
        const who = document.createElement("div");
        who.className = "bed-staff";
        who.textContent = "Assigned: " + staffByBed[bed.bed_id];
        card.appendChild(who);
      }

      if (bed.status === "OCCUPIED") {
        card.appendChild(actionButton("Simulate Discharge", () => simulateDischarge(bed.bed_id)));
      } else if (bed.status === "AVAILABLE") {
        card.appendChild(actionButton("Occupy", () => occupyBed(bed.bed_id)));
      } else {
        card.appendChild(actionButton("Mark Cleaned", () => markCleaned(bed.bed_id)));
      }
      grid.appendChild(card);
    });
    section.append(h, grid);
    root.appendChild(section);
  });
}

function actionButton(label, handler) {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    await handler();
    btn.disabled = false; // no-op if the grid re-rendered
  });
  return btn;
}

function renderMetrics(m) {
  $("m-avg").textContent = Number(m.avg_turnover_min).toFixed(1);
  $("m-available").textContent = m.beds_available;
  $("m-pending").textContent = m.beds_pending;
}

async function refresh() {
  const [beds, metrics] = await Promise.all([api(ENV.API_BEDS), api(ENV.API_METRICS)]);
  renderBeds(beds.beds);
  renderMetrics(metrics);
}

async function post(path, body, onSuccess) {
  try {
    const data = await api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (onSuccess) onSuccess(data);
    clearError();
    await refresh();
  } catch (e) {
    showError(e.message);
  }
}

function occupyBed(bedId) {
  return post(ENV.API_OCCUPY.replace("{bed_id}", encodeURIComponent(bedId)), {});
}
function simulateDischarge(bedId) {
  return post(ENV.API_DISCHARGE, { bed_id: bedId }, (data) => {
    if (data && data.task && data.task.staff_id) {
      staffByBed[bedId] = data.task.staff_id;
      saveStaff(staffByBed);
    }
  });
}
function markCleaned(bedId) {
  const staffId = staffByBed[bedId] || ENV.FALLBACK_STAFF_ID;
  return post(ENV.API_CLEANED.replace("{bed_id}", encodeURIComponent(bedId)), { staff_id: staffId }, () => {
    delete staffByBed[bedId];
    saveStaff(staffByBed);
  });
}

refresh().catch((e) => {
  $("wards").innerHTML = '<p class="loading">Could not load beds.</p>';
  showError(e.message);
});