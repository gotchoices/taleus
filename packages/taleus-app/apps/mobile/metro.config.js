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

/**
 * The Sereus stack, resolved from this app's node_modules whoever imports it.
 *
 * `taleus-model` and `taleus-core` are linked from the workspace, so Metro resolves their
 * imports from the repository's node_modules, which holds its own copy of the stack for their
 * Node tests. Two copies of cadre-core, Quereus or libp2p in one bundle break `instanceof`
 * checks and libp2p itself (sereus 1.10: an embedder must resolve a single
 * `@libp2p/interface`). So an import of the stack from outside this app is resolved as if the
 * app made it -- the rule `withCadreMetro` already applies to the kit's own peers.
 */
const STACK = /^(@serfab|@quereus|@optimystic|@libp2p|@chainsafe|@multiformats)\/|^libp2p$/;
const APP_ORIGIN = path.resolve(__dirname, 'index.js');
const APP_DIR = path.join(__dirname, path.sep);

function withOneStack(metroConfig) {
	const next = metroConfig.resolver.resolveRequest;
	metroConfig.resolver.resolveRequest = (context, moduleName, platform) => {
		// The linked packages live outside this directory; anything under it, its own
		// node_modules included, resolves as usual.
		const fromOutside = !context.originModulePath.startsWith(APP_DIR);
		const scoped = STACK.test(moduleName) && fromOutside
			? { ...context, originModulePath: APP_ORIGIN }
			: context;
		return next ? next(scoped, moduleName, platform) : context.resolveRequest(scoped, moduleName, platform);
	};
	return metroConfig;
}

// Sereus's Metro settings for the stack (Node built-in shims, one copy of each
// native module) on top of ours, then one copy of the stack itself.
module.exports = withOneStack(
	withCadreMetro(mergeConfig(getDefaultConfig(__dirname), config), { projectRoot: __dirname }),
);
