<div align="center">

# HydroInsight Peru

### Multi-language hydrology, flood-risk and reservoir-scenario laboratory

[![Live Demo](https://img.shields.io/badge/Live_Demo-Open_Dashboard-20c997?style=for-the-badge)](https://vninamore.github.io/hydroinsight-peru/)
[![Validation](https://img.shields.io/github/actions/workflow/status/vninamore/hydroinsight-peru/validate.yml?style=for-the-badge&label=Validation)](https://github.com/vninamore/hydroinsight-peru/actions)
[![Portfolio](https://img.shields.io/badge/Portfolio-Vanessa_Nina_More-4c6ef5?style=for-the-badge)](https://vninamore.github.io)

</div>

## Why this project exists

HydroInsight Peru demonstrates how several programming languages can collaborate in one coherent geospatial data product. It models a simplified rainfall–runoff process, explores climate scenarios, prepares a spatial database, estimates extreme flows and simulates reservoir operations.

The bundled dataset is **synthetic and deterministic**. It is designed for reproducibility and portfolio demonstration—not operational forecasting.

## Live capabilities

- Interactive exploration of the Rímac, Piura and Mantaro basins
- Baseline, El Niño and drought stress scenarios
- Rainfall–runoff hydrograph built with dependency-free JavaScript and SVG
- Flood-risk indicators, soil moisture and peak-event detection
- Clickable basin geometries and responsive dashboard

## Technology roles

| Technology | Responsibility |
|---|---|
| Python | Synthetic data generation, conceptual water balance, routing and tests |
| PostgreSQL/PostGIS | Spatial schema, quality constraints, indexes and alert queries |
| R | Gumbel extreme-value analysis and return-period estimates |
| Julia | Reservoir rule-curve simulation and reliability indicators |
| JavaScript/HTML/CSS | Interactive static dashboard published through GitHub Pages |
| GitHub Actions | Automated validation and deterministic dataset regeneration |

## Repository structure

```text
hydroinsight-peru/
├── data/                  # Time series and demonstration basin geometries
├── python/                # Hydrological model, generator and unit tests
├── r/                     # Extreme-value analysis
├── sql/                   # PostGIS schema and analytical queries
├── julia/                 # Reservoir-operation simulation
├── web/                   # Dashboard logic and visual design
├── docs/                  # Architecture and methodology
├── .github/workflows/     # Continuous integration
└── index.html             # GitHub Pages entry point
```

## Quick start

```bash
python python/generate_data.py
python -m unittest discover -s python -p "test_*.py"
python -m http.server 8000
```

Open `http://localhost:8000`.

Optional language-specific analyses:

```bash
Rscript r/extreme_value_analysis.R
julia julia/reservoir_simulation.jl
```

## Model summary

1. A seasonal stochastic generator creates precipitation and temperature.
2. Potential evapotranspiration is estimated from temperature.
3. A soil bucket tracks storage and excess water.
4. A runoff coefficient and linear routing step estimate daily discharge.
5. A logistic transformation expresses flood risk on a 0–100 scale.
6. Client-side scenario multipliers support transparent sensitivity analysis.

See [the architecture document](docs/architecture.md) for the complete data flow.

## Limitations and next steps

- Calibrate parameters with observed station data before scientific use.
- Add ingestion adapters for SENAMHI, NASA POWER or ERA5.
- Replace simplified routing with a calibrated hydrological model.
- Deploy the PostGIS schema and connect a production API.
- Add uncertainty intervals and validation metrics such as NSE and KGE.

## Author

**Vanessa Nina More** — Geographic Engineer · GIS & Data Analyst  
[Portfolio](https://vninamore.github.io) · [GitHub](https://github.com/vninamore)

## License

MIT License. Demonstration data are synthetic.

