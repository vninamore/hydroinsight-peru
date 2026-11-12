import unittest

from hydrology import (
    BASINS,
    classify_risk,
    discharge_from_water_balance,
    flood_risk_index,
    update_soil_storage,
)


class HydrologyTests(unittest.TestCase):
    def test_storage_is_bounded(self):
        storage, excess = update_soil_storage(90, 80, 3, 120)
        self.assertEqual(storage, 120)
        self.assertEqual(excess, 47)

    def test_discharge_never_falls_below_baseflow(self):
        parameters = BASINS["Rimac"]
        discharge = discharge_from_water_balance(0, 0, 0, parameters)
        self.assertEqual(discharge, parameters.baseflow_m3s)

    def test_risk_grows_with_discharge(self):
        self.assertLess(flood_risk_index(20, 100), flood_risk_index(120, 100))

    def test_risk_categories(self):
        self.assertEqual(classify_risk(10), "low")
        self.assertEqual(classify_risk(40), "moderate")
        self.assertEqual(classify_risk(60), "high")
        self.assertEqual(classify_risk(90), "critical")


if __name__ == "__main__":
    unittest.main()
