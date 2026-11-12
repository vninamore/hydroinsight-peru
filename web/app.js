const state = {
  rows: [],
  geojson: null,
  basin: "Rimac",
  scenario: "baseline",
  window: 30,
  rainAnomaly: 0,
  compareBaseline: false,
  selectedDate: null,
  events: [],
  map: null,
  geoLayer: null,
  stationMarkers: new Map(),
};

const scenarioFactors = {
  baseline: { rain: 1, flow: 1, soil: 1, label: "Baseline" },
  elnino: { rain: 1.65, flow: 1.52, soil: 1.16, label: "El Niño pulse" },
  drought: { rain: 0.55, flow: 0.68, soil: 0.74, label: "Dry-year stress" },
};

const codeExamples = {
  python: {
    language: "Python",
    file: "python/hydrology.py",
    code: `def discharge_from_water_balance(
    precipitation_mm: float,
    excess_mm: float,
    previous_discharge_m3s: float,
    parameters: BasinParameters,
) -> float:
    effective_mm = (
        precipitation_mm * parameters.runoff_coefficient
        + excess_mm
    )
    runoff_volume_m3 = (
        effective_mm / 1000
        * parameters.area_km2 * 1_000_000
    )
    instantaneous_m3s = runoff_volume_m3 / 86_400
    routed = 0.68 * previous_discharge_m3s + 0.32 * instantaneous_m3s
    return max(parameters.baseflow_m3s, routed)`,
  },
  postgis: {
    language: "PostGIS",
    file: "sql/schema.sql",
    code: `CREATE VIEW latest_basin_status AS
WITH ranked AS (
    SELECT
        b.basin_name,
        b.flood_threshold,
        o.observed_at,
        o.precipitation_mm,
        o.discharge_m3s,
        o.soil_moisture_pct,
        ROW_NUMBER() OVER (
            PARTITION BY b.basin_id
            ORDER BY o.observed_at DESC
        ) AS rn
    FROM hydro_basin b
    JOIN hydro_station s USING (basin_id)
    JOIN hydro_observation o USING (station_id)
    WHERE o.quality_flag IN ('valid', 'estimated')
)`,
  },
  r: {
    language: "R",
    file: "r/extreme_value_analysis.R",
    code: `gumbel_quantile <- function(values, return_period) {
  mean_x <- mean(values, na.rm = TRUE)
  sd_x <- sd(values, na.rm = TRUE)
  beta <- sd_x * sqrt(6) / pi
  location <- mean_x - 0.5772156649 * beta
  probability <- 1 - (1 / return_period)

  location - beta * log(-log(probability))
}

periods <- c(2, 5, 10, 25, 50, 100)
results <- do.call(rbind, lapply(
  unique(hydro$basin),
  function(current_basin) {
    basin_data <- hydro[hydro$basin == current_basin, ]
    high_flows <- basin_data$discharge_m3s[
      basin_data$discharge_m3s >= quantile(basin_data$discharge_m3s, 0.90)
    ]
  }
))`,
  },
  julia: {
    language: "Julia",
    file: "julia/reservoir_simulation.jl",
    code: `function simulate(inflows_m3s;
    capacity=CAPACITY_HM3,
    initial_storage=INITIAL_STORAGE_HM3)

    storage = initial_storage
    successful_days = 0
    total_spill = 0.0
    trajectory = Float64[]

    for inflow in inflows_m3s
        available = storage + m3s_to_hm3_day(inflow)
        target = m3s_to_hm3_day(TARGET_RELEASE_M3S)
        release = min(target, max(0.0, available - 0.18 * capacity))
        successful_days += release >= 0.95 * target
        storage = available - release
        spill = max(0.0, storage - capacity)
        total_spill += spill
        storage = min(capacity, storage)
        push!(trajectory, storage)
    end`,
  },
  javascript: {
    language: "JavaScript",
    file: "web/app.js",
    code: `function scenarioProjection(options = {}) {
  const basin = options.basin ?? state.basin;
  const scenario = options.scenario ?? state.scenario;
  const anomaly = options.rainAnomaly ?? state.rainAnomaly;
  const factor = scenarioFactors[scenario];
  const rainFactor = Math.max(0.05, 1 + anomaly / 100);
  const flowFactor = Math.max(0.2, 1 + anomaly * 0.0072);

  return state.rows
    .filter((row) => row.basin === basin)
    .slice(-(options.window ?? state.window))
    .map((row) => ({
      ...row,
      precipitation: number(row.precipitation_mm) * factor.rain * rainFactor,
      discharge: number(row.discharge_m3s) * factor.flow * flowFactor,
      risk: Math.min(100,
        number(row.flood_risk_index) * Math.pow(factor.flow * flowFactor, 1.18)
      ),
    }));
}`,
  },
};

const $ = (selector) => document.querySelector(selector);
const number = (value) => Number.parseFloat(value);
const metricAnimations = new WeakMap();

function parseCSV(text) {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const keys = header.split(",");
  return lines.map((line) => Object.fromEntries(
    line.split(",").map((value, index) => [keys[index], value]),
  ));
}

function scenarioProjection(options = {}) {
  const basin = options.basin ?? state.basin;
  const scenario = options.scenario ?? state.scenario;
  const anomaly = options.rainAnomaly ?? state.rainAnomaly;
  const windowSize = options.window ?? state.window;
  const factor = scenarioFactors[scenario];
  const rainFactor = Math.max(0.05, 1 + anomaly / 100);
  const flowFactor = Math.max(0.2, 1 + anomaly * 0.0072);
  const soilFactor = Math.max(0.45, 1 + anomaly * 0.0025);

  return state.rows
    .filter((row) => row.basin === basin)
    .slice(-windowSize)
    .map((row) => ({
      ...row,
      precipitation: number(row.precipitation_mm) * factor.rain * rainFactor,
      discharge: number(row.discharge_m3s) * factor.flow * flowFactor,
      soil: Math.min(100, number(row.soil_moisture_pct) * factor.soil * soilFactor),
      risk: Math.min(
        100,
        number(row.flood_risk_index) * Math.pow(factor.flow * flowFactor, 1.18),
      ),
    }));
}

function classifyRisk(value) {
  if (value >= 80) return "critical";
  if (value >= 55) return "high";
  if (value >= 30) return "moderate";
  return "low";
}

function animateNumber(element, target, options = {}) {
  const { decimals = 0, suffix = "", animate = true } = options;
  const previous = number(element.dataset.numeric);
  const startValue = Number.isFinite(previous) ? previous : target;
  const format = (value) => `${value.toFixed(decimals)}${suffix}`;
  const previousFrame = metricAnimations.get(element);
  if (previousFrame) cancelAnimationFrame(previousFrame);

  if (!animate || Math.abs(startValue - target) < 0.001) {
    element.textContent = format(target);
    element.dataset.numeric = String(target);
    return;
  }

  const duration = 520;
  const startedAt = performance.now();
  const step = (time) => {
    const progress = Math.min(1, (time - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = startValue + (target - startValue) * eased;
    element.textContent = format(current);
    if (progress < 1) {
      metricAnimations.set(element, requestAnimationFrame(step));
    } else {
      element.dataset.numeric = String(target);
      metricAnimations.delete(element);
    }
  };
  metricAnimations.set(element, requestAnimationFrame(step));
}

function calculateMetrics(rows) {
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  const average = (key) => sum(key) / rows.length;
  return {
    discharge: average("discharge"),
    rain: sum("precipitation"),
    soil: average("soil"),
    risk: Math.max(...rows.map((row) => row.risk)),
  };
}

function updateMetrics(rows, animate = true) {
  const metrics = calculateMetrics(rows);
  animateNumber($("#dischargeMetric"), metrics.discharge, { decimals: 1, animate });
  animateNumber($("#rainMetric"), metrics.rain, { decimals: 0, animate });
  animateNumber($("#soilMetric"), metrics.soil, { decimals: 0, suffix: "%", animate });
  animateNumber($("#riskMetric"), metrics.risk, { decimals: 0, animate });
  animateNumber($("#heroRisk"), metrics.risk, { decimals: 0, animate });

  const level = classifyRisk(metrics.risk);
  $("#riskLabel").textContent = `${level} · scenario peak`;
  $("#riskFill").style.width = `${metrics.risk}%`;
  $(".risk-card").dataset.level = level;
  $("#heroRain").textContent = `${metrics.rain.toFixed(0)} mm`;
  $("#heroFlow").textContent = `${metrics.discharge.toFixed(1)} m³/s`;
  $("#heroSoil").textContent = `${metrics.soil.toFixed(0)}% moist.`;
  return metrics;
}

function svgElement(name, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function drawChart(rows, baselineRows) {
  const svg = $("#hydroChart");
  const tooltip = $("#chartTooltip");
  svg.replaceChildren();
  const width = 860;
  const height = 360;
  const left = 48;
  const right = 20;
  const top = 18;
  const bottom = 38;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const allFlows = state.compareBaseline
    ? [...rows.map((row) => row.discharge), ...baselineRows.map((row) => row.discharge)]
    : rows.map((row) => row.discharge);
  const maxFlow = Math.max(1, ...allFlows) * 1.08;
  const maxRain = Math.max(1, ...rows.map((row) => row.precipitation)) * 1.08;
  const xFor = (index) => left + (index / Math.max(1, rows.length - 1)) * plotW;
  const yFor = (value) => top + plotH - (value / maxFlow) * plotH;

  for (let index = 0; index <= 4; index += 1) {
    const y = top + (plotH / 4) * index;
    svg.append(svgElement("line", { x1: left, y1: y, x2: width - right, y2: y, class: "axis" }));
    const label = svgElement("text", { x: 2, y: y + 4, class: "axis-label" });
    label.textContent = `${(maxFlow * (1 - index / 4)).toFixed(0)} m³/s`;
    svg.append(label);
  }

  rows.forEach((row, index) => {
    const x = xFor(index);
    const barHeight = (row.precipitation / maxRain) * plotH * 0.42;
    svg.append(svgElement("rect", {
      x: x - 2,
      y: top,
      width: Math.max(2, plotW / rows.length - 1),
      height: barHeight,
      class: "rain-bar",
    }));
  });

  if (state.compareBaseline) {
    const baselinePoints = baselineRows.map((row, index) => (
      `${xFor(index).toFixed(1)},${yFor(row.discharge).toFixed(1)}`
    )).join(" ");
    svg.append(svgElement("polyline", { points: baselinePoints, class: "baseline-line" }));
  }

  const points = rows.map((row, index) => (
    `${xFor(index).toFixed(1)},${yFor(row.discharge).toFixed(1)}`
  )).join(" ");
  svg.append(svgElement("polyline", { points, class: "flow-line" }));

  [0, Math.floor(rows.length / 2), rows.length - 1].forEach((index) => {
    if (!rows[index]) return;
    const label = svgElement("text", {
      x: xFor(index),
      y: height - 10,
      class: "axis-label",
      "text-anchor": index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle",
    });
    label.textContent = rows[index].date.slice(5);
    svg.append(label);
  });

  if (state.selectedDate) {
    const selectedIndex = rows.findIndex((row) => row.date === state.selectedDate);
    if (selectedIndex >= 0) {
      const selected = rows[selectedIndex];
      const x = xFor(selectedIndex);
      const y = yFor(selected.discharge);
      svg.append(svgElement("line", { x1: x, y1: top, x2: x, y2: top + plotH, class: "selected-guide" }));
      svg.append(svgElement("circle", { cx: x, cy: y, r: 7, class: "selected-point" }));
    }
  }

  const guide = svgElement("line", { x1: left, y1: top, x2: left, y2: top + plotH, class: "hover-guide" });
  const hoverPoint = svgElement("circle", { cx: left, cy: top, r: 5, class: "hover-point" });
  guide.style.display = "none";
  hoverPoint.style.display = "none";
  svg.append(guide, hoverPoint);

  const overlay = svgElement("rect", {
    x: left,
    y: top,
    width: plotW,
    height: plotH,
    class: "chart-overlay",
    tabindex: 0,
  });
  svg.append(overlay);

  const showTooltip = (event) => {
    const bounds = svg.getBoundingClientRect();
    const relativeX = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    const chartX = (relativeX / bounds.width) * width;
    const index = Math.max(0, Math.min(
      rows.length - 1,
      Math.round(((chartX - left) / plotW) * (rows.length - 1)),
    ));
    const row = rows[index];
    const x = xFor(index);
    const y = yFor(row.discharge);
    guide.setAttribute("x1", x);
    guide.setAttribute("x2", x);
    hoverPoint.setAttribute("cx", x);
    hoverPoint.setAttribute("cy", y);
    guide.style.display = "block";
    hoverPoint.style.display = "block";
    tooltip.innerHTML = `<strong>${row.date}</strong><span>Rainfall <b>${row.precipitation.toFixed(1)} mm</b></span><span>Discharge <b>${row.discharge.toFixed(1)} m³/s</b></span>`;
    const panelBounds = $(".chart-panel").getBoundingClientRect();
    tooltip.style.left = `${event.clientX - panelBounds.left + 14}px`;
    tooltip.style.top = `${event.clientY - panelBounds.top - 24}px`;
    tooltip.hidden = false;
  };
  overlay.addEventListener("mousemove", showTooltip);
  overlay.addEventListener("mouseleave", () => {
    guide.style.display = "none";
    hoverPoint.style.display = "none";
    tooltip.hidden = true;
  });
}

function basinCentroid(feature) {
  const coordinates = feature.geometry.coordinates[0];
  const totals = coordinates.reduce((acc, coordinate) => [
    acc[0] + coordinate[0],
    acc[1] + coordinate[1],
  ], [0, 0]);
  return [totals[1] / coordinates.length, totals[0] / coordinates.length];
}

function basinStyle(feature) {
  const active = feature.properties.name === state.basin;
  return {
    color: active ? "#49e6d2" : "#4da3ff",
    weight: active ? 3 : 1.5,
    fillColor: active ? "#49e6d2" : "#4da3ff",
    fillOpacity: active ? 0.36 : 0.15,
  };
}

function initMap() {
  const target = $("#basinMap");
  if (!window.L) {
    target.innerHTML = '<div class="map-fallback">Interactive basemap unavailable. Basin data are still active.</div>';
    return;
  }

  const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution: '&copy; OpenStreetMap contributors, SRTM | &copy; OpenTopoMap',
  });
  const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap contributors | &copy; CARTO',
  });

  state.map = L.map(target, { zoomControl: true, layers: [topo] }).setView([-9.4, -76.2], 5);
  L.control.layers({ "Topographic relief": topo, "Dark Matter": dark }, null, {
    position: "topright",
  }).addTo(state.map);

  state.geoLayer = L.geoJSON(state.geojson, {
    style: basinStyle,
    onEachFeature(feature, layer) {
      layer.bindTooltip(`${feature.properties.name} basin · ${feature.properties.area_km2.toLocaleString()} km²`, {
        sticky: true,
      });
      layer.on("click", () => selectBasin(feature.properties.name, true));
    },
  }).addTo(state.map);

  state.geojson.features.forEach((feature) => {
    const name = feature.properties.name;
    const marker = L.circleMarker(basinCentroid(feature), {
      radius: 6,
      color: "#06151f",
      weight: 2,
      fillColor: "#ffba69",
      fillOpacity: 1,
    }).addTo(state.map);
    marker.bindPopup(`<strong>${name} demonstration station</strong><br><small>Synthetic portfolio location</small>`);
    state.stationMarkers.set(name, marker);
  });
  updateMapSelection(true);
}

function updateMapSelection(focus = false, eventRow = null) {
  if (!state.map || !state.geoLayer) return;
  let activeLayer = null;
  state.geoLayer.eachLayer((layer) => {
    layer.setStyle(basinStyle(layer.feature));
    if (layer.feature.properties.name === state.basin) activeLayer = layer;
  });
  state.stationMarkers.forEach((marker, name) => {
    marker.setStyle({
      radius: name === state.basin ? 8 : 5,
      fillColor: name === state.basin ? "#ffba69" : "#87a7ad",
      fillOpacity: name === state.basin ? 1 : 0.72,
    });
  });

  if (focus && activeLayer) state.map.flyToBounds(activeLayer.getBounds(), { padding: [28, 28], maxZoom: 7 });
  if (eventRow) {
    const marker = state.stationMarkers.get(eventRow.basin);
    if (marker) {
      marker.bindPopup(`<strong>${eventRow.basin} · ${eventRow.date}</strong><br>${eventRow.discharge.toFixed(1)} m³/s · risk ${eventRow.risk.toFixed(0)}/100`).openPopup();
      state.map.flyTo(marker.getLatLng(), 7, { duration: 0.7 });
    }
  }
}

function updateEvents(rows) {
  state.events = [...rows].sort((a, b) => b.discharge - a.discharge).slice(0, 6);
  $("#eventCount").textContent = `${state.events.length} events`;
  $("#eventRows").innerHTML = state.events.map((row) => {
    const level = classifyRisk(row.risk);
    const selected = row.date === state.selectedDate ? " selected" : "";
    return `<tr class="event-row${selected}" tabindex="0" data-date="${row.date}" aria-label="Focus event on ${row.date}"><td>${row.date}</td><td>${row.basin}</td><td>${row.precipitation.toFixed(1)} mm</td><td>${row.discharge.toFixed(1)} m³/s</td><td>${row.risk.toFixed(0)}/100</td><td><span class="risk-pill ${level}">${level}</span></td></tr>`;
  }).join("");

  $("#eventRows").querySelectorAll(".event-row").forEach((rowElement) => {
    const activate = () => {
      const eventRow = state.events.find((row) => row.date === rowElement.dataset.date);
      if (eventRow) focusEvent(eventRow);
    };
    rowElement.addEventListener("click", activate);
    rowElement.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") activate();
    });
  });
}

function focusEvent(row) {
  state.selectedDate = row.date;
  const projected = scenarioProjection();
  const baseline = scenarioProjection({ scenario: "baseline", rainAnomaly: 0 });
  drawChart(projected, baseline);
  updateEvents(projected);
  updateMapSelection(true, row);
  $(".chart-panel").scrollIntoView({ behavior: "smooth", block: "center" });
}

function updateDashboard(options = {}) {
  const { animateMetrics = true, focusMap = false } = options;
  const rows = scenarioProjection();
  if (!rows.length) return;
  const baselineRows = scenarioProjection({ scenario: "baseline", rainAnomaly: 0 });
  updateMetrics(rows, animateMetrics);
  drawChart(rows, baselineRows);
  updateEvents(rows);
  updateMapSelection(focusMap);
  $("#baselineLegend").hidden = !state.compareBaseline;
}

function selectBasin(basin, focusMap = true) {
  state.basin = basin;
  state.selectedDate = null;
  $("#basinSelect").value = basin;
  updateDashboard({ animateMetrics: true, focusMap });
}

function downloadBlob(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportEventsCSV() {
  const header = "date,basin,scenario,rain_anomaly_pct,precipitation_mm,discharge_m3s,risk_index,status";
  const lines = state.events.map((row) => [
    row.date,
    row.basin,
    scenarioFactors[state.scenario].label,
    state.rainAnomaly,
    row.precipitation.toFixed(2),
    row.discharge.toFixed(2),
    row.risk.toFixed(2),
    classifyRisk(row.risk),
  ].join(","));
  downloadBlob(`hydroinsight-${state.basin.toLowerCase()}-events.csv`, [header, ...lines].join("\n"), "text/csv;charset=utf-8");
}

function exportScenarioJSON() {
  const rows = scenarioProjection();
  const payload = {
    project: "HydroInsight Peru",
    disclaimer: "Synthetic demonstration data; not for operational forecasting.",
    exported_at: new Date().toISOString(),
    filters: {
      basin: state.basin,
      scenario: scenarioFactors[state.scenario].label,
      window_days: state.window,
      rain_anomaly_pct: state.rainAnomaly,
      compare_with_baseline: state.compareBaseline,
    },
    metrics: calculateMetrics(rows),
    events: state.events,
  };
  downloadBlob(`hydroinsight-${state.basin.toLowerCase()}-scenario.json`, JSON.stringify(payload, null, 2), "application/json");
}

function showCodeExample(key) {
  const example = codeExamples[key];
  if (!example) return;
  document.querySelectorAll(".pipeline article").forEach((card) => {
    const active = card.dataset.code === key;
    card.classList.toggle("active", active);
    card.setAttribute("aria-selected", String(active));
  });
  $("#codeLanguage").textContent = example.language;
  $("#codeFile").textContent = example.file;
  $("#codeSnippet").textContent = example.code;
  $("#codeLink").href = `https://github.com/vninamore/hydroinsight-peru/blob/main/${example.file}`;
}

function bindControls() {
  $("#basinSelect").addEventListener("change", (event) => selectBasin(event.target.value, true));
  $("#scenarioSelect").addEventListener("change", (event) => {
    state.scenario = event.target.value;
    state.selectedDate = null;
    updateDashboard({ animateMetrics: true });
  });
  $("#windowSelect").addEventListener("change", (event) => {
    state.window = Number(event.target.value);
    state.selectedDate = null;
    updateDashboard({ animateMetrics: true });
  });
  $("#rainAnomaly").addEventListener("input", (event) => {
    state.rainAnomaly = Number(event.target.value);
    $("#rainAnomalyValue").textContent = `${state.rainAnomaly > 0 ? "+" : ""}${state.rainAnomaly}%`;
    state.selectedDate = null;
    updateDashboard({ animateMetrics: true });
  });
  $("#compareBaseline").addEventListener("change", (event) => {
    state.compareBaseline = event.target.checked;
    updateDashboard({ animateMetrics: false });
  });
  $("#resetScenario").addEventListener("click", () => {
    state.scenario = "baseline";
    state.rainAnomaly = 0;
    state.compareBaseline = false;
    state.selectedDate = null;
    $("#scenarioSelect").value = "baseline";
    $("#rainAnomaly").value = "0";
    $("#rainAnomalyValue").textContent = "0%";
    $("#compareBaseline").checked = false;
    updateDashboard({ animateMetrics: true });
  });
  $("#downloadCsv").addEventListener("click", exportEventsCSV);
  $("#exportJson").addEventListener("click", exportScenarioJSON);
  document.querySelectorAll(".pipeline article").forEach((card) => {
    const activate = () => showCodeExample(card.dataset.code);
    card.addEventListener("click", activate);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") activate();
    });
  });
}

async function loadData() {
  const [csvResponse, geoResponse] = await Promise.all([
    fetch("data/hydro_timeseries.csv"),
    fetch("data/basins.geojson"),
  ]);
  if (!csvResponse.ok || !geoResponse.ok) throw new Error("Data files could not be loaded");
  state.rows = parseCSV(await csvResponse.text());
  state.geojson = await geoResponse.json();
}

document.addEventListener("DOMContentLoaded", async () => {
  state.basin = "Rimac";
  state.scenario = "baseline";
  state.window = 30;
  $("#basinSelect").value = "Rimac";
  $("#scenarioSelect").value = "baseline";
  $("#windowSelect").value = "30";
  bindControls();
  showCodeExample("python");

  try {
    await loadData();
    initMap();
    updateDashboard({ animateMetrics: false, focusMap: true });
    $(".status span").textContent = "Model ready";
  } catch (error) {
    $(".status span").textContent = "Data load error";
    $(".status").classList.add("error");
    console.error(error);
  }
});
