/**
 * `@react-native/assets-registry/registry`, for React Native 0.87, which no longer ships it.
 *
 * `react-native-svg` (15.15) still imports `getAssetByID` from the old package; React Native 0.87
 * keeps the registry inside itself (`src/private/assets/AssetRegistry`, which its own
 * `resolveAssetSource` reads). Metro maps the old name here (`metro.config.js`). Private path, so
 * remove this once `react-native-svg` imports the new location.
 */
const { AssetRegistry } = require('react-native/src/private/assets/AssetRegistry')

module.exports = {
	registerAsset: asset => AssetRegistry.registerAsset(asset),
	getAssetByID: id => AssetRegistry.getAssetByID(id),
}
