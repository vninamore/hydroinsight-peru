# HydroInsight Peru — extreme-flow analysis in base R
# Usage: Rscript r/extreme_value_analysis.R

input_path <- "data/hydro_timeseries.csv"
output_path <- "data/return_periods.csv"

hydro <- read.csv(input_path, stringsAsFactors = FALSE)

gumbel_quantile <- function(values, return_period) {
  mean_x <- mean(values, na.rm = TRUE)
  sd_x <- sd(values, na.rm = TRUE)
  beta <- sd_x * sqrt(6) / pi
  location <- mean_x - 0.5772156649 * beta
  probability <- 1 - (1 / return_period)
  location - beta * log(-log(probability))
}

periods <- c(2, 5, 10, 25, 50, 100)
results <- do.call(rbind, lapply(unique(hydro$basin), function(current_basin) {
  basin_data <- hydro[hydro$basin == current_basin, ]
  high_flows <- basin_data$discharge_m3s[basin_data$discharge_m3s >= quantile(basin_data$discharge_m3s, 0.90)]
  data.frame(
    basin = current_basin,
    return_period_years = periods,
    estimated_discharge_m3s = round(sapply(periods, function(p) gumbel_quantile(high_flows, p)), 2)
  )
}))

write.csv(results, output_path, row.names = FALSE)
cat("Return-period table written to", output_path, "\n")

