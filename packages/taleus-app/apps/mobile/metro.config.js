const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * `mock/data` is a symlink to the appeus project's shared `mock/data`, so Metro
 * has to watch the project root to resolve fixtures through it.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
	watchFolders: [path.resolve(__dirname, '../..')],
	resolver: { unstable_enableSymlinks: true },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
