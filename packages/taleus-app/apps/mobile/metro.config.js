const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withCadreMetro } = require('@serfab/cadre-rn/metro');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * `mock/data` is a symlink to the appeus project's shared `mock/data`, so Metro
 * has to watch the project root to resolve fixtures through it.
 *
 * `taleus-model` is a linked package (`file:` in package.json, so a symlink in
 * node_modules) that lives outside this project, so Metro watches it too. It
 * ships built ESM in its `dist/`; rebuild it (`yarn model:build`, or `tsc
 * --watch` in the package) and Metro picks the change up. In engine mode it
 * imports `taleus-core`, another workspace package, whose own dependencies
 * (Quereus and its crypto plugin) are hoisted to the repository's node_modules
 * -- Metro finds them walking up from the core, and must watch where they are.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
	watchFolders: [
		path.resolve(__dirname, '../..'),
		path.resolve(__dirname, '../../../taleus-model'),
		path.resolve(__dirname, '../../../taleus-core'),
		path.resolve(__dirname, '../../../../node_modules'),
	],
	resolver: {
		unstable_enableSymlinks: true,
		// Code linked in from outside the project (taleus-model) resolves its
		// imports -- including the Babel helpers the transform injects -- from
		// this app's node_modules, not from beside its own real path.
		nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
	},
};

// Sereus's Metro settings for the stack (Node built-in shims, one copy of each
// native module) on top of ours.
module.exports = withCadreMetro(mergeConfig(getDefaultConfig(__dirname), config), { projectRoot: __dirname });
