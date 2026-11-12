-- Stations within a selected basin polygon.
SELECT s.station_code, s.station_name, s.elevation_m
FROM hydro_station s
JOIN hydro_basin b USING (basin_id)
WHERE b.basin_code = :basin_code
  AND ST_Within(s.geom, b.geom);

-- Seven-day rolling rainfall and discharge indicators.
SELECT
    s.station_code,
    DATE_TRUNC('day', o.observed_at) AS observation_day,
    SUM(o.precipitation_mm) OVER (
        PARTITION BY s.station_id
        ORDER BY DATE_TRUNC('day', o.observed_at)
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    ) AS rainfall_7d_mm,
    AVG(o.discharge_m3s) OVER (
        PARTITION BY s.station_id
        ORDER BY DATE_TRUNC('day', o.observed_at)
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    ) AS discharge_7d_avg_m3s
FROM hydro_observation o
JOIN hydro_station s USING (station_id)
WHERE o.quality_flag IN ('valid', 'estimated');

-- Current flood alerts.
SELECT *
FROM latest_basin_status
WHERE threshold_utilization_pct >= 80
ORDER BY threshold_utilization_pct DESC;

-- Detect duplicate timestamps before ingestion.
SELECT station_id, observed_at, COUNT(*) AS duplicate_count
FROM hydro_observation
GROUP BY station_id, observed_at
HAVING COUNT(*) > 1;

