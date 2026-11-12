"""Generate a deterministic synthetic hydrological dataset for the demo."""

from __future__ import annotations

import csv
import math
import random
from datetime import date, timedelta
from pathlib import Path

from hydrology import (
    BASINS,
    discharge_from_water_balance,
    flood_risk_index,
    potential_evapotranspiration,
    update_soil_storage,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "hydro_timeseries.csv"
START = date(2025, 1, 1)
DAYS = 365


def seasonal_rainfall(day: int, basin: str, rng: random.Random) -> float:
    wet_season = max(0.0, math.sin((day - 5) / 365 * 2 * math.pi))
    scale = {"Rimac": 13.0, "Piura": 10.0, "Mantaro": 16.0}[basin]
    event = rng.gammavariate(1.35, scale * (0.18 + wet_season))
    if rng.random() < {"Rimac": 0.52, "Piura": 0.64, "Mantaro": 0.42}[basin]:
        event *= 0.08
    if 55 <= day <= 85 and basin == "Piura" and rng.random() < 0.18:
        event *= 3.4
    return round(min(event, 145.0), 2)


def generate() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    rng = random.Random(20261111)
    for basin, parameters in BASINS.items():
        storage = parameters.soil_capacity_mm * 0.46
        discharge = parameters.baseflow_m3s
        phase = {"Rimac": 0.0, "Piura": 1.3, "Mantaro": -0.8}[basin]
        for offset in range(DAYS):
            current = START + timedelta(days=offset)
            temperature = 18.5 + 5.2 * math.sin((offset - 42) / 365 * 2 * math.pi + phase)
            temperature += rng.uniform(-1.6, 1.6)
            rainfall = seasonal_rainfall(offset, basin, rng)
            pet = potential_evapotranspiration(temperature)
            storage, excess = update_soil_storage(storage, rainfall, pet, parameters.soil_capacity_mm)
            discharge = discharge_from_water_balance(rainfall, excess, discharge, parameters)
            risk = flood_risk_index(discharge, parameters.flood_threshold_m3s)
            rows.append(
                {
                    "date": current.isoformat(),
                    "basin": basin,
                    "precipitation_mm": f"{rainfall:.2f}",
                    "temperature_c": f"{temperature:.2f}",
                    "evapotranspiration_mm": f"{pet:.2f}",
                    "soil_moisture_pct": f"{storage / parameters.soil_capacity_mm * 100:.2f}",
                    "discharge_m3s": f"{discharge:.2f}",
                    "flood_risk_index": f"{risk:.2f}",
                }
            )
    return rows


def main() -> None:
    rows = generate()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f"Generated {len(rows)} rows at {OUTPUT}")


if __name__ == "__main__":
    main()

