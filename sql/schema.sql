CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE hydro_basin (
    basin_id          BIGSERIAL PRIMARY KEY,
    basin_code        TEXT NOT NULL UNIQUE,
    basin_name        TEXT NOT NULL,
    area_km2          NUMERIC(12,2) NOT NULL CHECK (area_km2 > 0),
    flood_threshold   NUMERIC(12,2) NOT NULL CHECK (flood_threshold > 0),
    geom              geometry(MultiPolygon, 4326) NOT NULL
);

CREATE TABLE hydro_station (
    station_id        BIGSERIAL PRIMARY KEY,
    basin_id          BIGINT NOT NULL REFERENCES hydro_basin(basin_id),
    station_code      TEXT NOT NULL UNIQUE,
    station_name      TEXT NOT NULL,
    elevation_m       NUMERIC(8,2),
    geom              geometry(Point, 4326) NOT NULL
);

CREATE TABLE hydro_observation (
    observation_id    BIGSERIAL PRIMARY KEY,
    station_id        BIGINT NOT NULL REFERENCES hydro_station(station_id),
    observed_at       TIMESTAMPTZ NOT NULL,
    precipitation_mm  NUMERIC(8,2) CHECK (precipitation_mm >= 0),
    discharge_m3s     NUMERIC(12,2) CHECK (discharge_m3s >= 0),
    soil_moisture_pct NUMERIC(5,2) CHECK (soil_moisture_pct BETWEEN 0 AND 100),
    quality_flag      TEXT NOT NULL DEFAULT 'valid'
        CHECK (quality_flag IN ('valid', 'estimated', 'suspect', 'missing')),
    UNIQUE (station_id, observed_at)
);

CREATE INDEX hydro_basin_geom_gix ON hydro_basin USING GIST (geom);
CREATE INDEX hydro_station_geom_gix ON hydro_station USING GIST (geom);
CREATE INDEX hydro_observation_time_idx ON hydro_observation (observed_at DESC);
CREATE INDEX hydro_observation_station_time_idx
    ON hydro_observation (station_id, observed_at DESC);

CREATE VIEW latest_basin_status AS
WITH ranked AS (
    SELECT
        b.basin_name,
        b.flood_threshold,
        o.observed_at,
        o.precipitation_mm,
        o.discharge_m3s,
        o.soil_moisture_pct,
        ROW_NUMBER() OVER (PARTITION BY b.basin_id ORDER BY o.observed_at DESC) AS rn
    FROM hydro_basin b
    JOIN hydro_station s USING (basin_id)
    JOIN hydro_observation o USING (station_id)
    WHERE o.quality_flag IN ('valid', 'estimated')
)
SELECT
    basin_name,
    observed_at,
    precipitation_mm,
    discharge_m3s,
    soil_moisture_pct,
    ROUND(100 * discharge_m3s / flood_threshold, 1) AS threshold_utilization_pct
FROM ranked
WHERE rn = 1;

