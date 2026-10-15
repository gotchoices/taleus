/**
 * Preload (`node --import ./scripts/count-peerstore.mjs`): counts this process's libp2p peer-store
 * operations (`@libp2p/peer-store`'s `PersistentStore`: load, save, patch, merge, has, all) by the
 * code that asked -- the first stack frames outside libp2p's own peer store -- and prints the tally
 * to stderr at exit. On a phone each write re-sorts the peer's protocols and addresses (string
 * compares of every multiaddr) and each load re-parses every multiaddr, so their count is a cost.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const storeUrl = new URL('store.js', `file://${require.resolve('@libp2p/peer-store')}`)
const { PersistentStore } = await import(storeUrl.href)

const OPERATIONS = ['load', 'save', 'patch', 'merge', 'has', 'all']
const counts = new Map()

/** The asking code: the first frames outside the peer store and the async plumbing. */
function asker() {
	const frames = (new Error().stack ?? '').split('\n').slice(3)
		.map(line => line.trim().replace(/^at /, ''))
		.filter(line => !/peer-store|node:internal|<anonymous>|processTicksAndRejections/.test(line))
	return frames.slice(0, 2).map(frame => frame.replace(/\(?file:\/\/.*node_modules\//, '(').replace(/:\d+:\d+\)?$/, ')')).join(' < ')
}

for (const operation of OPERATIONS) {
	const original = PersistentStore.prototype[operation]
	if (typeof original !== 'function') continue
	PersistentStore.prototype[operation] = function (...args) {
		const key = `${operation}  ${asker()}`
		counts.set(key, (counts.get(key) ?? 0) + 1)
		return original.apply(this, args)
	}
}

process.on('exit', () => {
	const rows = [...counts].sort((a, b) => b[1] - a[1])
	const total = rows.reduce((sum, [, n]) => sum + n, 0)
	process.stderr.write(`peer-store operations: ${total}\n`)
	for (const [key, n] of rows.slice(0, 25)) process.stderr.write(`${String(n).padStart(7)}  ${key}\n`)
})
