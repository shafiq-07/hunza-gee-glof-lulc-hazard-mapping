// ============================================================================
// 2022 HASSANABAD GLOF - FLOOD EXTENT AND EXPOSURE
// HUNZA DISTRICT, GILGIT-BALTISTAN
//
// District source: geoBoundaries (WM/geoLab/geoBoundaries/600/ADM2) - NOT
// FAO GAUL, since GAUL 2015 omits Gilgit-Baltistan entirely.
//
// LANDSAT-8 (OPTICAL) VERSION - "MAXIMUM EXTENT" APPROACH
// ============================================================================

// ---------------- USER SETTINGS ----------------
var preStart = '2022-03-01';
var preEnd = '2022-05-06';
var floodStart = '2022-05-07';
var floodEnd = '2022-06-15';

var maxSceneCloudCoverPercent = 90;
var mndwiThreshold = 0.0;
var maximumSlopeDegrees = 15;
var minimumConnectedPixels = 5;
var closingRadiusMeters = 90;
var riverOccurrenceThreshold = 50;

// ---------------- DISTRICT SELECTION (geoBoundaries) ----------------
var geoBoundaries = ee.FeatureCollection('WM/geoLab/geoBoundaries/600/ADM2');

var selectedDistrict = geoBoundaries.filter(
  ee.Filter.and(
    ee.Filter.eq('shapeGroup', 'PAK'),
    ee.Filter.eq('shapeName', 'Hunza')
  )
);

print('Matched district feature count:', selectedDistrict.size());
print('Matched district name(s):', selectedDistrict.aggregate_array('shapeName'));

var aoi = selectedDistrict.geometry();

Map.centerObject(selectedDistrict, 10);
Map.addLayer(
  selectedDistrict.style({ color: '000000', fillColor: '00000000', width: 3 }),
  {},
  'Hunza district boundary'
);

// ---------------- LANDSAT-8 PREPARATION ----------------
function scaleLandsat(image) {
  var opticalBands = image.select('SR_B.').multiply(0.0000275).add(-0.2);
  return image.addBands(opticalBands, null, true);
}

function maskLandsatClouds(image) {
  var qa = image.select('QA_PIXEL');
  var dilatedCloudBit = 1 << 1;
  var cloudBit = 1 << 3;
  var cloudShadowBit = 1 << 4;
  var mask = qa.bitwiseAnd(dilatedCloudBit).eq(0)
    .and(qa.bitwiseAnd(cloudBit).eq(0))
    .and(qa.bitwiseAnd(cloudShadowBit).eq(0));
  return image.updateMask(mask);
}

function addMndwi(image) {
  var mndwi = image.normalizedDifference(['SR_B3', 'SR_B6']).rename('MNDWI');
  return image.addBands(mndwi);
}

function prepareLandsat(image) {
  return addMndwi(maskLandsatClouds(scaleLandsat(image))).select('MNDWI');
}

function getLandsat8(startDate, endDate) {
  return ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .filterBounds(aoi)
    .filterDate(startDate, endDate)
    .filter(ee.Filter.lt('CLOUD_COVER', maxSceneCloudCoverPercent))
    .map(prepareLandsat);
}

var beforeCollection = getLandsat8(preStart, preEnd);
var floodCollection = getLandsat8(floodStart, floodEnd);

print('Pre-event clear scene count:', beforeCollection.size());
print('Event-period clear scene count:', floodCollection.size());

// ---------------- WATER / TERRAIN MASKS ----------------
var permanentWater = ee.Image('JRC/GSW1_4/GlobalSurfaceWater')
  .select('seasonality').gte(10).clip(aoi);

var riverOccurrence = ee.Image('JRC/GSW1_4/GlobalSurfaceWater')
  .select('occurrence').gte(riverOccurrenceThreshold).clip(aoi);

var dem = ee.Image('USGS/SRTMGL1_003').clip(aoi);
var slope = ee.Terrain.slope(dem).rename('slope');

// ---------------- FLOOD DETECTION - MAXIMUM EXTENT ----------------
var floodWaterImages = floodCollection.map(function(image) {
  return image.gt(mndwiThreshold).rename('water');
});

var floodValidObsCount = floodWaterImages.count();
var floodMaxWater = floodWaterImages.max().updateMask(floodValidObsCount.gt(0));

var floodCandidate = floodMaxWater
  .and(permanentWater.not())
  .and(slope.lt(maximumSlopeDegrees))
  .clip(aoi);

var floodClosed = floodCandidate
  .selfMask().unmask(0)
  .focal_max({ radius: closingRadiusMeters, units: 'meters' })
  .focal_min({ radius: closingRadiusMeters, units: 'meters' });

var connectedPixels = floodClosed.selfMask().connectedPixelCount(100, true);
var validCoverage = floodValidObsCount.gt(0).clip(aoi).rename('valid_coverage');

var floodBinary = floodClosed
  .updateMask(connectedPixels.gte(minimumConnectedPixels))
  .selfMask().unmask(0)
  .updateMask(validCoverage)
  .rename('flood')
  .toByte();

var floodDisplay = floodBinary.selfMask();

// ---------------- DISPLAY COMPOSITES ----------------
var beforeDisplay = beforeCollection.median().clip(aoi);
var afterDisplay = floodCollection.median().clip(aoi);

// ---------------- EXPOSURE DATA ----------------
var population = ee.ImageCollection('WorldPop/GP/100m/pop')
  .filterDate('2020-01-01', '2021-01-01')
  .mosaic().select('population').clip(aoi);

var builtSurface = ee.Image('JRC/GHSL/P2023A/GHS_BUILT_S/2015')
  .select('built_surface').clip(aoi);

var worldCover = ee.ImageCollection('ESA/WorldCover/v200')
  .first().select('Map').clip(aoi);

var cropland = worldCover.eq(40);

// ---------------- AREA / EXPOSURE IMAGES ----------------
var floodForStatistics = floodBinary.unmask(0).clip(aoi);
var coverageForStatistics = validCoverage.unmask(0).clip(aoi);

var floodAreaImage = ee.Image.pixelArea().divide(1e6)
  .multiply(floodForStatistics).rename('flood_area_km2');

var coverageAreaImage = ee.Image.pixelArea().divide(1e6)
  .multiply(coverageForStatistics).rename('coverage_area_km2');

var affectedPopulationImage = population.multiply(floodForStatistics)
  .unmask(0).rename('affected_population');

var affectedBuiltImage = builtSurface.multiply(floodForStatistics)
  .unmask(0).rename('affected_built_m2');

var affectedCroplandImage = ee.Image.pixelArea().divide(1e6)
  .multiply(cropland).multiply(floodForStatistics)
  .unmask(0).rename('affected_cropland_km2');

// ---------------- DISTRICT STATISTICS ----------------
var districtGeometry = selectedDistrict.geometry();
var districtAreaKm2 = districtGeometry.area(1).divide(1e6);

var floodAreaKm2 = ee.Number(floodAreaImage.reduceRegion({
  reducer: ee.Reducer.sum(), geometry: districtGeometry,
  scale: 30, maxPixels: 1e13, tileScale: 4
}).get('flood_area_km2'));

var coveredAreaKm2 = ee.Number(coverageAreaImage.reduceRegion({
  reducer: ee.Reducer.sum(), geometry: districtGeometry,
  scale: 30, maxPixels: 1e13, tileScale: 4
}).get('coverage_area_km2'));

var affectedPopulation = ee.Number(affectedPopulationImage.reduceRegion({
  reducer: ee.Reducer.sum(), geometry: districtGeometry,
  scale: 100, maxPixels: 1e13, tileScale: 4
}).get('affected_population'));

var affectedBuiltM2 = ee.Number(affectedBuiltImage.reduceRegion({
  reducer: ee.Reducer.sum(), geometry: districtGeometry,
  scale: 100, maxPixels: 1e13, tileScale: 4
}).get('affected_built_m2'));

var affectedCroplandKm2 = ee.Number(affectedCroplandImage.reduceRegion({
  reducer: ee.Reducer.sum(), geometry: districtGeometry,
  scale: 30, maxPixels: 1e13, tileScale: 4
}).get('affected_cropland_km2'));

var floodPercentage = floodAreaKm2.divide(districtAreaKm2).multiply(100);
var coveragePercentage = coveredAreaKm2.divide(districtAreaKm2).multiply(100);

var districtStatistics = ee.FeatureCollection([
  ee.Feature(null, {
    district: 'Hunza',
    event_name: 'Hassanabad GLOF',
    event_year: 2022,
    pre_period: preStart + ' to ' + preEnd,
    flood_period: floodStart + ' to ' + floodEnd,
    satellite: 'Landsat-8 (optical, MNDWI, maximum extent)',
    closing_radius_m: closingRadiusMeters,
    district_area_km2: districtAreaKm2,
    valid_coverage_km2: coveredAreaKm2,
    valid_coverage_percent: coveragePercentage,
    flood_area_km2: floodAreaKm2,
    flood_percent_of_district: floodPercentage,
    affected_population: affectedPopulation.round(),
    affected_built_surface_m2: affectedBuiltM2,
    affected_cropland_km2: affectedCroplandKm2
  })
]);

print('Hunza GLOF/flood statistics:', districtStatistics);

// ---------------- CHART ----------------
var floodAreaChart = ui.Chart.feature.byFeature({
  features: districtStatistics,
  xProperty: 'district',
  yProperties: ['flood_area_km2']
})
  .setChartType('ColumnChart')
  .setOptions({
    title: 'Detected 2022 Hassanabad GLOF Extent (Landsat-8) - Hunza',
    hAxis: { title: 'District' },
    vAxis: { title: 'Flood extent, km2' },
    legend: { position: 'none' }
  });

print(floodAreaChart);

// ---------------- MAP DISPLAY ----------------
Map.addLayer(beforeDisplay,
  { min: -0.5, max: 0.5, palette: ['8b4513', 'ffffff', '08306b'] },
  'Landsat-8 MNDWI, pre-event (median)', false);

Map.addLayer(afterDisplay,
  { min: -0.5, max: 0.5, palette: ['8b4513', 'ffffff', '08306b'] },
  'Landsat-8 MNDWI, event period (median)', false);

Map.addLayer(validCoverage.selfMask(), { palette: ['808080'] },
  'Valid comparison coverage', false);

Map.addLayer(riverOccurrence.selfMask(), { palette: ['0d47a1'] },
  'River / permanent water', true);

Map.addLayer(floodDisplay, { palette: ['ff5500'] },
  'Detected 2022 GLOF/flood extent (raster)', true);

var floodOutline = floodBinary.selfMask().reduceToVectors({
  geometry: aoi, scale: 30, geometryType: 'polygon',
  eightConnected: true, maxPixels: 1e13, bestEffort: true
});

Map.addLayer(floodOutline.style({ color: 'ff5500', fillColor: 'ff550055', width: 2 }),
  {}, 'Detected 2022 GLOF/flood extent (outlined)', false);

Map.addLayer(population.updateMask(floodDisplay),
  { min: 0, max: 100, palette: ['ffffcc', 'fd8d3c', '800026'] },
  'Population in detected flood zone', false);

// ---------------- EXPORTS ----------------
Export.image.toDrive({
  image: floodBinary.clip(aoi),
  description: 'Hunza_2022_Hassanabad_GLOF_extent',
  folder: 'GEE_HUNZA_HAZARDS',
  fileNamePrefix: 'Hunza_2022_Hassanabad_GLOF_extent',
  region: aoi, scale: 30, maxPixels: 1e13
});

Export.table.toDrive({
  collection: districtStatistics,
  description: 'Hunza_2022_GLOF_flood_statistics',
  folder: 'GEE_HUNZA_HAZARDS',
  fileNamePrefix: 'Hunza_2022_GLOF_flood_statistics',
  fileFormat: 'CSV'
});
