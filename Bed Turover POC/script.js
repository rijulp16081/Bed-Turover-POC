// Confirm with the backend team. Plan says port 5000 for uvicorn (one note says 8000).
const BASE_URL = "http://localhost:5000";
const CLEANING_STAFF_ID = "STF-001"; // hardcoded for POC
const WARD_ORDER = ["WARD-A", "WARD-B", "ICU"];

// Set to true to run the page with NO backend (fake data kept in the browser, resets on reload).
// Set back to false once the real backend is running.
const USE_MOCK = true;

// ---- In-browser mock of the 4 endpoints (same JSON shapes as the plan) ----
const mockDb = (() => {
  const free = [102, 104, 107, 112, 115, 118, 122, 125, 128, 130];
  const now = () => new Date().toISOString().slice(0, 19);
  const beds = [];
  for (let i = 101; i <= 130; i++) {
    beds.push({
      bed_id: "BED-" + i,
      ward_id: i <= 110 ? "WARD-A" : i <= 120 ? "WARD-B" : "ICU",
      status: free.includes(i) ? "AVAILABLE" : "OCCUPIED",
      status_updated_at: now(),
    });
  }
  return { beds, tasks: [], now };
})();

async function mockApi(path, options) {
  await new Promise((r) => setTimeout(r, 150)); // simulate latency
  const method = (options && options.method) || "GET";
  const body = options && options.body ? JSON.parse(options.body) : {};
  const { beds, tasks, now } = mockDb;
  const ok = (data) => ({ ok: true, status: 200, data });
  const bad = (error) => ({ ok: false, status: 400, data: { error } });

  if (method === "GET" && path === "/api/v1/beds") return ok({ beds });

  if (method === "GET" && path === "/api/v1/metrics") {
    const done = tasks.filter((t) => t.status === "DONE");
    const avg = done.length ? done.reduce((s, t) => s + t.turnover, 0) / done.length : 0;
    return ok({
      avg_turnover_min: avg,
      beds_available: beds.filter((b) => b.status === "AVAILABLE").length,
      beds_pending: beds.filter((b) => b.status.startsWith("CLEANING")).length,
    });
  }

  if (method === "POST" && path === "/api/v1/simulate/discharge") {
    const bed = beds.find((b) => b.bed_id === body.bed_id);
    if (!bed || bed.status !== "OCCUPIED") return bad("Bed " + body.bed_id + " is not OCCUPIED or does not exist");
    bed.status = "CLEANING_PENDING";
    bed.status_updated_at = now();
    const open = tasks.filter((t) => t.status !== "DONE").map((t) => t.staff_id);
    const staff = ["STF-001", "STF-002", "STF-003", "STF-004", "STF-005"].find((s) => !open.includes(s)) || "STF-001";
    tasks.push({
      task_id: "HK-" + String(tasks.length + 1).padStart(4, "0"),
      bed_id: bed.bed_id, staff_id: staff, status: "ASSIGNED",
      created_at: now(), completed_at: null, escalated: false, startedMs: Date.now(), turnover: 0,
    });
    return ok({ message: "Discharge simulated successfully", bed });
  }

  const m = path.match(/^\/api\/v1\/beds\/([^/]+)\/cleaned$/);
  if (method === "POST" && m) {
    const id = decodeURIComponent(m[1]);
    const bed = beds.find((b) => b.bed_id === id);
    const task = tasks.find((t) => t.bed_id === id && t.status !== "DONE");
    if (!bed || !bed.status.startsWith("CLEANING") || !task) return bad("Bed " + id + " is not in cleaning status or task not found");
    bed.status = "AVAILABLE";
    bed.status_updated_at = now();
    task.status = "DONE";
    task.completed_at = now();
    // POC demo: pretend each clean took 5-45 min so the average is meaningful
    task.turnover = Math.round((5 + Math.random() * 40) * 10) / 10;
    return ok({ message: "Bed marked as cleaned", bed, task, turnover_min: task.turnover });
  }
  return bad("Unknown mock route: " + method + " " + path);
}

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
    res = USE_MOCK
      ? await mockApi(path, options).then((r) => ({ ok: r.ok, status: r.status, json: async () => r.data }))
      : await fetch(BASE_URL + path, options);
  } catch (e) {
    throw new Error("Cannot reach the backend at " + BASE_URL + ". Is the server running?");
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

      if (bed.status === "OCCUPIED") {
        card.appendChild(actionButton("Simulate Discharge", () => simulateDischarge(bed.bed_id)));
      } else if (bed.status !== "AVAILABLE") {
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
  const [beds, metrics] = await Promise.all([api("/api/v1/beds"), api("/api/v1/metrics")]);
  renderBeds(beds.beds);
  renderMetrics(metrics);
}

async function post(path, body) {
  try {
    await api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    clearError();
    await refresh();
  } catch (e) {
    showError(e.message);
  }
}

function simulateDischarge(bedId) {
  return post("/api/v1/simulate/discharge", { bed_id: bedId });
}
function markCleaned(bedId) {
  return post("/api/v1/beds/" + encodeURIComponent(bedId) + "/cleaned", { staff_id: CLEANING_STAFF_ID });
}

refresh().catch((e) => {
  $("wards").innerHTML = '<p class="loading">Could not load beds.</p>';
  showError(e.message);
});