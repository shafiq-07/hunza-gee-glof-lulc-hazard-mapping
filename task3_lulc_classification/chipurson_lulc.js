// ============================================================================
// LAND USE / LAND COVER CLASSIFICATION - CHIPURSON VALLEY (RANDOM FOREST)
// Follows the 5-step supervised RF workflow:
// 1. Prepare image (Sentinel-2 bands + NDVI/NDWI/NDSI)
// 2. Add training data (from ESA WorldCover as reference labels)
// 3. Train RF model
// 4. Classify map
// 5. Validate (confusion matrix, overall accuracy, kappa)
//
// Classes: Water, Forest, Cropland, Urban, Barren, Grassland
// Snow/ice folded into Barren (not one of the 6 requested classes)
// AOI: manually drawn polygon over Chipurson Valley (import as chipursonAOI,
// type FeatureCollection)
// ============================================================================

var aoi = chipursonAOI.geometry();

Map.centerObject(chipursonAOI, 11);
Map.addLayer(
  chipursonAOI.style({ color: '000000', fillColor: '00000000', width: 2 }),
  {},
  'Chipurson Valley AOI'
);

function maskS2clouds(image) {
  var qa = image.select('QA60');
  var mask = qa.bitwiseAnd(1 << 10).eq(0).and(qa.bitwiseAnd(1 << 11).eq(0));
  return image.updateMask(mask).divide(10000).copyProperties(image, ['system:time_start']);
}

var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(aoi)
  .filterDate('2024-06-01', '2024-09-30')
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
  .map(maskS2clouds);

print('Sentinel-2 scenes used for composite:', s2.size());

var composite = s2.median().clip(aoi);

var ndvi = composite.normalizedDifference(['B8', 'B4']).rename('NDVI');
var ndwi = composite.normalizedDifference(['B3', 'B8']).rename('NDWI');
var ndsi = composite.normalizedDifference(['B3', 'B11']).rename('NDSI');

var bands = ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B8A', 'B11', 'B12'];
var imageForClassification = composite.select(bands)
  .addBands(ndvi).addBands(ndwi).addBands(ndsi);

// Shadow diagnostic
var dem = ee.Image('USGS/SRTMGL1_003').clip(aoi);
var hillshade = ee.Terrain.hillshade(dem, 315, 45);
var likelyShadow = hillshade.lt(60);

var shadowAreaKm2 = ee.Image.pixelArea().divide(1e6)
  .updateMask(likelyShadow)
  .reduceRegion({ reducer: ee.Reducer.sum(), geometry: aoi, scale: 30, maxPixels: 1e13, bestEffort: true });
print('Estimated shadow-affected area (km2), diagnostic only:', shadowAreaKm2);

Map.addLayer(likelyShadow.selfMask(), { palette: ['800080'] }, 'Likely terrain shadow (diagnostic)', false);

// Training labels from ESA WorldCover
var worldCover = ee.ImageCollection('ESA/WorldCover/v200').first().select('Map').clip(aoi);

var referenceLabels = worldCover.remap(
  [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100],
  [1,  5,  5,  2,  3,  4,  4,  0,  0,  4,  4]
).rename('class');

var classNames = ['Water', 'Forest', 'Cropland', 'Urban', 'Barren', 'Grassland'];
var classPalette = ['1a73e8', '2e7d32', 'fbc02d', 'e53935', '9e9e9e', '8bc34a'];

var snowIceArea = ee.Image.pixelArea().divide(1e6)
  .updateMask(worldCover.eq(70))
  .reduceRegion({ reducer: ee.Reducer.sum(), geometry: aoi, scale: 20, maxPixels: 1e13, bestEffort: true });
print('Area originally Snow/Ice (folded into Barren), km2:', snowIceArea);

var trainingImage = imageForClassification.addBands(referenceLabels);

var samples = trainingImage.stratifiedSample({
  numPoints: 400,
  classBand: 'class',
  region: aoi,
  scale: 20,
  seed: 42,
  geometries: true
});

print('Total training/validation samples:', samples.size());

var withRandom = samples.randomColumn('random', 42);
var trainingSamples = withRandom.filter(ee.Filter.lt('random', 0.7));
var validationSamples = withRandom.filter(ee.Filter.gte('random', 0.7));

print('Training samples:', trainingSamples.size());
print('Validation samples:', validationSamples.size());

var inputBands = bands.concat(['NDVI', 'NDWI', 'NDSI']);

var classifier = ee.Classifier.smileRandomForest({
  numberOfTrees: 100,
  seed: 42
}).train({
  features: trainingSamples,
  classProperty: 'class',
  inputProperties: inputBands
});

var classified = imageForClassification.select(inputBands)
  .classify(classifier)
  .clip(aoi);

Map.addLayer(composite, { min: 0, max: 0.3, bands: ['B4', 'B3', 'B2'] }, 'Sentinel-2 True Color', false);
Map.addLayer(classified, { min: 0, max: 5, palette: classPalette }, 'LULC Classification (Random Forest)');

var validationClassified = validationSamples.classify(classifier);
var confusionMatrix = validationClassified.errorMatrix('class', 'classification');

print('Confusion matrix:', confusionMatrix);
print('Overall accuracy:', confusionMatrix.accuracy());
print('Kappa coefficient:', confusionMatrix.kappa());
print('Producer\'s accuracy (rows = ' + classNames.join(', ') + '):', confusionMatrix.producersAccuracy());
print('Consumer\'s/User\'s accuracy (per class):', confusionMatrix.consumersAccuracy());

var areaImage = ee.Image.pixelArea().divide(1e6).addBands(classified);
var classAreaKm2 = areaImage.reduceRegion({
  reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'class' }),
  geometry: aoi, scale: 20, maxPixels: 1e13, bestEffort: true
});
print('Area (km2) per LULC class (0=Water,1=Forest,2=Cropland,3=Urban,4=Barren,5=Grassland):', classAreaKm2);

// Legend
var legend = ui.Panel({ style: { position: 'bottom-left', padding: '8px 15px' } });
legend.add(ui.Label({ value: 'LULC Classes', style: { fontWeight: 'bold', fontSize: '14px', margin: '0 0 6px 0' } }));

var makeLegendRow = function(color, name) {
  var colorBox = ui.Label({ style: { backgroundColor: color, padding: '8px', margin: '0 8px 4px 0' } });
  var description = ui.Label({ value: name, style: { margin: '0 0 4px 0' } });
  return ui.Panel({ widgets: [colorBox, description], layout: ui.Panel.Layout.Flow('horizontal') });
};

for (var i = 0; i < classNames.length; i++) {
  legend.add(makeLegendRow(classPalette[i], classNames[i]));
}
Map.add(legend);

// Exports
Export.image.toDrive({
  image: classified.toByte(),
  description: 'Chipurson_LULC_RandomForest_Classification',
  folder: 'GEE_CHIPURSON_LULC',
  fileNamePrefix: 'Chipurson_LULC_RandomForest_Classification',
  region: aoi, scale: 20, maxPixels: 1e13
});

Export.table.toDrive({
  collection: ee.FeatureCollection([
    ee.Feature(null, {
      area_name: 'Chipurson Valley',
      classifier: 'Random Forest (100 trees)',
      overall_accuracy: confusionMatrix.accuracy(),
      kappa: confusionMatrix.kappa(),
      training_samples: trainingSamples.size(),
      validation_samples: validationSamples.size(),
      composite_period: '2024-06-01 to 2024-09-30'
    })
  ]),
  description: 'Chipurson_LULC_accuracy_summary',
  folder: 'GEE_CHIPURSON_LULC',
  fileNamePrefix: 'Chipurson_LULC_accuracy_summary',
  fileFormat: 'CSV'
});
