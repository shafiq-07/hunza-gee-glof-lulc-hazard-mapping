# Hunza District — GEE Hazard Mapping, LULC Classification & ML Forecasting

Geospatial analysis and machine learning coursework for Hunza district and the Chipurson Valley, Gilgit-Baltistan, Pakistan — built using Google Earth Engine (GEE) and Python.

This repository covers three related tasks, all focused on disaster risk and land monitoring in a glacierized, hazard-prone mountain region.

## Contents

### 1. Hazard Mapping (`task2_hazard_mapping/`)
Two-hazard mapping for Hunza district using Google Earth Engine:
- **GLOF/Flood extent mapping** — Landsat-8 MNDWI-based detection of the 2022 Hassanabad GLOF (Glacial Lake Outburst Flood) event, with district-wide exposure statistics (affected population, built-up area, cropland).
- **Landslide susceptibility mapping** — weighted GIS overlay (slope, extreme rainfall, drainage proximity, land cover, vegetation) producing a 5-class susceptibility surface across the district.

### 2. Land Use / Land Cover Classification (`task3_lulc_classification/`)
Random Forest supervised classification (6 classes: Water, Forest, Cropland, Urban, Barren, Grassland) using Sentinel-2 imagery, trained on ESA WorldCover reference labels:
- Chipurson Valley
- Skardu District

Includes accuracy assessment (confusion matrix, overall accuracy, kappa coefficient) and exported classification rasters.

### 3. XGBoost Time-Series Forecasting (`task5_xgboost_forecast/`)
A machine learning model forecasting Yeshkuk Glacier's monthly meltwater/lake surface area, using the NDWI-derived time series (2019–2026) from the [GLOF Risk Monitoring Dashboard](https://github.com/shafiq-07/GLOF-Dashboard-Yeshkuk-Glacier). XGBoost was used instead of an LSTM due to the small sample size (34 monthly observations); results include RMSE/MAE/MAPE/R² evaluation and feature importance analysis showing seasonal timing as the dominant predictor.

## Data Sources
- Sentinel-2 Surface Reflectance (COPERNICUS/S2_SR_HARMONIZED)
- Landsat-8 Surface Reflectance (LANDSAT/LC08/C02/T1_L2)
- ESA WorldCover v200
- CHIRPS daily precipitation
- MERIT Hydro
- USGS SRTM 30m DEM
- WorldPop population density
- JRC Global Surface Water

## Related Repository
- [GLOF-Dashboard-Yeshkuk-Glacier](https://github.com/shafiq-07/GLOF-Dashboard-Yeshkuk-Glacier) — the interactive glacier/lake monitoring dashboard this forecasting model builds on.

## Author
Shafiq — Civil Engineering, NUTECH Islamabad
