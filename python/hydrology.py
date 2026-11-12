"""Core hydrological calculations for HydroInsight Peru.

The functions intentionally use only Python's standard library so the project
can be executed in lightweight environments and GitHub Actions.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import exp


@dataclass(frozen=True)
class BasinParameters:
    name: str
    area_km2: float
    runoff_coefficient: float
    baseflow_m3s: float
    soil_capacity_mm: float
    flood_threshold_m3s: float


BASINS = {
    "Rimac": BasinParameters("Rimac", 3503, 0.48, 18.0, 145.0, 125.0),
    "Piura": BasinParameters("Piura", 12216, 0.32, 12.0, 185.0, 310.0),
    "Mantaro": BasinParameters("Mantaro", 34363, 0.41, 95.0, 210.0, 690.0),
}


def potential_evapotranspiration(temperature_c: float) -> float:
    """Estimate daily PET in millimetres using a compact temperature model."""
    return max(0.0, 0.18 * temperature_c - 1.6)


def update_soil_storage(
    previous_storage_mm: float,
    precipitation_mm: float,
    evapotranspiration_mm: float,
    capacity_mm: float,
) -> tuple[float, float]:
    """Return new storage and excess water available for direct runoff."""
    available = max(0.0, previous_storage_mm + precipitation_mm - evapotranspiration_mm)
    storage = min(capacity_mm, available)
    excess = max(0.0, available - capacity_mm)
    return storage, excess


def discharge_from_water_balance(
    precipitation_mm: float,
    excess_mm: float,
    previous_discharge_m3s: float,
    parameters: BasinParameters,
) -> float:
    """Convert effective rainfall to a routed daily discharge estimate."""
    effective_mm = precipitation_mm * parameters.runoff_coefficient + excess_mm
    runoff_volume_m3 = effective_mm / 1000 * parameters.area_km2 * 1_000_000
    instantaneous_m3s = runoff_volume_m3 / 86_400
    routed = 0.68 * previous_discharge_m3s + 0.32 * instantaneous_m3s
    return max(parameters.baseflow_m3s, routed)


def flood_risk_index(discharge_m3s: float, threshold_m3s: float) -> float:
    """Return a smooth 0–100 flood-risk index around the alert threshold."""
    ratio = discharge_m3s / threshold_m3s
    return round(100 / (1 + exp(-7 * (ratio - 0.82))), 2)


def classify_risk(index: float) -> str:
    if index >= 80:
        return "critical"
    if index >= 55:
        return "high"
    if index >= 30:
        return "moderate"
    return "low"

