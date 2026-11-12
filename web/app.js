const state = { rows: [], geojson: null, basin: "Rimac", scenario: "baseline", window: 90 };
const scenarioFactors = {
  baseline: { rain: 1, flow: 1, soil: 1, label: "Baseline" },
  elnino: { rain: 1.65, flow: 1.52, soil: 1.16, label: "El Niño pulse" },
  drought: { rain: 0.55, flow: 0.68, soil: 0.74, label: "Dry-year stress" },
};

const $ = (selector) => document.querySelector(selector);
const number = (value) => Number.parseFloat(value);
const parseCSV = (text) => {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const keys = header.split(",");
  return lines.map((line) => Object.fromEntries(line.split(",").map((value, index) => [keys[index], value])));
};

function projectedRows() {
  const factor = scenarioFactors[state.scenario];
  const basinRows = state.rows.filter((row) => row.basin === state.basin).slice(-state.window);
  return basinRows.map((row) => ({
    ...row,
    precipitation: number(row.precipitation_mm) * factor.rain,
    discharge: number(row.discharge_m3s) * factor.flow,
    soil: Math.min(100, number(row.soil_moisture_pct) * factor.soil),
    risk: Math.min(100, number(row.flood_risk_index) * Math.pow(factor.flow, 1.18)),
  }));
}

function classifyRisk(value) {
  if (value >= 80) return "critical";
  if (value >= 55) return "high";
  if (value >= 30) return "moderate";
  return "low";
}

function updateMetrics(rows) {
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  const average = (key) => sum(key) / rows.length;
  const peakRisk = Math.max(...rows.map((row) => row.risk));
  $("#dischargeMetric").textContent = average("discharge").toFixed(1);
  $("#rainMetric").textContent = sum("precipitation").toFixed(0);
  $("#soilMetric").textContent = `${average("soil").toFixed(0)}%`;
  $("#riskMetric").textContent = peakRisk.toFixed(0);
  $("#riskLabel").textContent = `${classifyRisk(peakRisk)} · scenario peak`;
  $("#riskFill").style.width = `${peakRisk}%`;
  $("#heroRisk").textContent = peakRisk.toFixed(0);
}

function svgElement(name, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function drawChart(rows) {
  const svg = $("#hydroChart");
  svg.replaceChildren();
  const width = 860, height = 360, left = 48, right = 20, top = 18, bottom = 38;
  const plotW = width - left - right, plotH = height - top - bottom;
  const maxFlow = Math.max(...rows.map((row) => row.discharge)) * 1.08;
  const maxRain = Math.max(1, ...rows.map((row) => row.precipitation)) * 1.08;
  for (let index = 0; index <= 4; index += 1) {
    const y = top + (plotH / 4) * index;
    svg.append(svgElement("line", { x1: left, y1: y, x2: width - right, y2: y, class: "axis" }));
    const label = svgElement("text", { x: 2, y: y + 4, class: "axis-label" });
    label.textContent = `${(maxFlow * (1 - index / 4)).toFixed(0)} m³/s`;
    svg.append(label);
  }
  const stride = Math.max(1, Math.ceil(rows.length / 80));
  const visible = rows.filter((_, index) => index % stride === 0);
  visible.forEach((row, index) => {
    const x = left + (index / Math.max(1, visible.length - 1)) * plotW;
    const barHeight = (row.precipitation / maxRain) * plotH * 0.42;
    svg.append(svgElement("rect", { x: x - 2, y: top, width: Math.max(2, plotW / visible.length - 1), height: barHeight, class: "rain-bar" }));
  });
  const points = visible.map((row, index) => {
    const x = left + (index / Math.max(1, visible.length - 1)) * plotW;
    const y = top + plotH - (row.discharge / maxFlow) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  svg.append(svgElement("polyline", { points, class: "flow-line" }));
  [0, Math.floor(visible.length / 2), visible.length - 1].forEach((index) => {
    if (!visible[index]) return;
    const label = svgElement("text", { x: left + (index / Math.max(1, visible.length - 1)) * plotW, y: height - 10, class: "axis-label", "text-anchor": index === 0 ? "start" : index === visible.length - 1 ? "end" : "middle" });
    label.textContent = visible[index].date.slice(5);
    svg.append(label);
  });
}

function drawMap() {
  const svg = $("#basinMap");
  svg.replaceChildren();
  const outline = "M92 25 L190 46 234 101 287 126 272 177 314 221 284 267 298 314 253 359 248 410 208 454 174 418 163 372 127 338 139 289 105 245 124 193 104 148 132 106 126 62 Z";
  svg.append(svgElement("path", { d: outline, class: "peru-outline" }));
  const project = ([lon, lat]) => [((lon + 82) / 14) * 390 + 55, ((0 - lat) / 19) * 420 + 20];
  state.geojson.features.forEach((feature) => {
    const points = feature.geometry.coordinates[0].map(project).map(([x, y]) => `${x},${y}`).join(" ");
    const polygon = svgElement("polygon", { points, class: `basin-shape${feature.properties.name === state.basin ? " active" : ""}`, "data-basin": feature.properties.name, tabindex: 0 });
    polygon.addEventListener("click", () => selectBasin(feature.properties.name));
    polygon.addEventListener("keydown", (event) => { if (event.key === "Enter") selectBasin(feature.properties.name); });
    svg.append(polygon);
    const coords = feature.geometry.coordinates[0].map(project);
    const center = coords.reduce((acc, item) => [acc[0] + item[0] / coords.length, acc[1] + item[1] / coords.length], [0, 0]);
    const label = svgElement("text", { x: center[0], y: center[1], class: "map-label", "text-anchor": "middle" });
    label.textContent = feature.properties.name;
    svg.append(label);
  });
}

function updateEvents(rows) {
  const events = [...rows].sort((a, b) => b.discharge - a.discharge).slice(0, 6);
  $("#eventCount").textContent = `${events.length} events`;
  $("#eventRows").innerHTML = events.map((row) => {
    const level = classifyRisk(row.risk);
    return `<tr><td>${row.date}</td><td>${row.basin}</td><td>${row.precipitation.toFixed(1)} mm</td><td>${row.discharge.toFixed(1)} m³/s</td><td>${row.risk.toFixed(0)}/100</td><td><span class="risk-pill ${level}">${level}</span></td></tr>`;
  }).join("");
}

function render() {
  const rows = projectedRows();
  if (!rows.length) return;
  updateMetrics(rows);
  drawChart(rows);
  drawMap();
  updateEvents(rows);
}

function selectBasin(basin) {
  state.basin = basin;
  $("#basinSelect").value = basin;
  render();
}

async function init() {
  try {
    const [csvResponse, geoResponse] = await Promise.all([fetch("data/hydro_timeseries.csv"), fetch("data/basins.geojson")]);
    if (!csvResponse.ok || !geoResponse.ok) throw new Error("Data files could not be loaded");
    state.rows = parseCSV(await csvResponse.text());
    state.geojson = await geoResponse.json();
    $("#basinSelect").addEventListener("change", (event) => { state.basin = event.target.value; render(); });
    $("#scenarioSelect").addEventListener("change", (event) => { state.scenario = event.target.value; render(); });
    $("#windowSelect").addEventListener("change", (event) => { state.window = Number(event.target.value); render(); });
    render();
  } catch (error) {
    document.querySelector(".status span").textContent = "Data load error";
    document.querySelector(".status").style.color = "#ff6b78";
    console.error(error);
  }
}

init();

