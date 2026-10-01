const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * `mock/data` is a symlink to the appeus project's shared `mock/data`, so Metro
 * has to watch the project root to resolve fixtures through it.
 *
 * `taleus-model` is a linked workspace package (`file:` in package.json, so a
 * symlink in node_modules) that lives outside this project, so Metro watches it
 * too. It ships built ESM in its `dist/`; rebuild it (`yarn build` in the
 * package, or `tsc --watch`) and Metro picks the change up.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
	watchFolders: [path.resolve(__dirname, '../..'), path.resolve(__dirname, '../../../taleus-model')],
	resolver: {
		unstable_enableSymlinks: true,
		// Code linked in from outside the project (taleus-model) resolves its
		// imports -- including the Babel helpers the transform injects -- from
		// this app's node_modules, not from beside its own real path.
		nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
	},
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
