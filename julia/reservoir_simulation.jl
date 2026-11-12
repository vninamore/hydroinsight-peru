"""
HydroInsight Peru — simplified reservoir-operation simulator.

The model applies a rule curve to daily inflows and reports reliability,
spill volume and final storage. It uses only Julia's standard library.
"""

using DelimitedFiles
using Dates
using Statistics

const CAPACITY_HM3 = 320.0
const INITIAL_STORAGE_HM3 = 190.0
const TARGET_RELEASE_M3S = 42.0
const SECONDS_PER_DAY = 86_400

function m3s_to_hm3_day(flow_m3s)
    flow_m3s * SECONDS_PER_DAY / 1_000_000
end

function simulate(inflows_m3s; capacity=CAPACITY_HM3, initial_storage=INITIAL_STORAGE_HM3)
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
    end

    return (
        reliability = successful_days / length(inflows_m3s),
        total_spill_hm3 = total_spill,
        final_storage_hm3 = storage,
        mean_storage_hm3 = mean(trajectory),
    )
end

function main()
    raw, header = readdlm("data/hydro_timeseries.csv", ',', header=true)
    basin_col = findfirst(==("basin"), vec(header))
    discharge_col = findfirst(==("discharge_m3s"), vec(header))
    inflows = Float64[parse(Float64, string(row[discharge_col])) for row in eachrow(raw) if row[basin_col] == "Mantaro"]
    result = simulate(inflows)
    println("Mantaro reservoir scenario")
    println("Reliability: ", round(100 * result.reliability, digits=1), "%")
    println("Total spill: ", round(result.total_spill_hm3, digits=2), " hm³")
    println("Final storage: ", round(result.final_storage_hm3, digits=2), " hm³")
end

main()

