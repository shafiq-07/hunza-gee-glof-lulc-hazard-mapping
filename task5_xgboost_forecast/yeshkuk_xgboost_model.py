// ============================================================================
// STANDALONE: Rebuild Yeshkuk lake-area time series and export as CSV
// ============================================================================

function maskS2clouds(image) {
  var qa = image.select('QA60');
  var mask = qa.bitwiseAnd(1 << 10).eq(0).and(qa.bitwiseAnd(1 << 11).eq(0));
  return image.updateMask(mask).divide(10000).copyProperties(image, ['system:time_start']);
}

var collection = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(yishkukAOI)
  .filterDate('2019-01-01', '2026-07-23')
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 40))
  .map(maskS2clouds)
  .map(function(img) {
    var ndwi = img.normalizedDifference(['B3', 'B8']).rename('NDWI');
    return img.addBands(ndwi);
  });

print('Total images since 2019:', collection.size());

var YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
var MELT_MONTHS = [5, 6, 7, 8, 9];
var WATER_THRESHOLD = 0.1;
var combinedReducer = ee.Reducer.sum().combine({reducer2: ee.Reducer.mean(), sharedInputs: true});

var periodList = [];
YEARS.forEach(function(y) {
  MELT_MONTHS.forEach(function(m) {
    periodList.push({year: y, month: m});
  });
});

periodList = periodList.filter(function(p) {
  var d = new Date(p.year, p.month - 1, 1);
  return d <= new Date(); // trim future months
});

var lakeFeatures = periodList.map(function(p) {
  var start = ee.Date.fromYMD(p.year, p.month, 1);
  var end = start.advance(1, 'month');
  var monthly = collection.filterDate(start, end);
  var count = monthly.size();

  var ndwiband = ee.Image(ee.Algorithms.If(
    count.gt(0), monthly.median().select('NDWI'), ee.Image(0).rename('NDWI')
  ));

  var waterArea = ee.Image(ee.Algorithms.If(
    count.gt(0), ndwiband.gt(WATER_THRESHOLD).multiply(ee.Image.pixelArea()).rename('water'),
    ee.Image(0).rename('water')
  ));

  var combined = ndwiband.addBands(waterArea);

  var stats = combined.reduceRegion({
    reducer: combinedReducer,
    geometry: yishkukAOI,
    scale: 10, maxPixels: 1e13, bestEffort: true
  });

  return ee.Feature(null, {
    date: start.format('YYYY-MM'),
    lake_area_m2: stats.get('water_sum'),
    mean_NDWI: stats.get('NDWI_mean'),
    image_count: count
  });
});

var lakeAreaSeries = ee.FeatureCollection(lakeFeatures)
  .filter(ee.Filter.gt('image_count', 0));

print('Lake area time series (preview):', lakeAreaSeries);

// Export for ML modeling
Export.table.toDrive({
  collection: lakeAreaSeries,
  description: 'Yeshkuk_lake_area_timeseries_for_ML',
  folder: 'GEE_YESHKUK_ML',
  fileNamePrefix: 'Yeshkuk_lake_area_timeseries_for_ML',
  fileFormat: 'CSV',
  selectors: ['date', 'lake_area_m2', 'mean_NDWI']
});
