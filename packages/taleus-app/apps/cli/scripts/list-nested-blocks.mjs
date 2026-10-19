/**
 * Diagnostic preload (`node --import ./scripts/list-nested-blocks.mjs`), not a fix to ship:
 * `@optimystic/db-p2p-storage-fs`'s `FileStoreDriver` (under `FileRawStorage`) keeps a block at `basePath/<blockId>/` with the
 * id used raw, so a named block (`default/app/Ledger`, `optimystic/schema`) lands in nested
 * directories -- but its `listBlockIds()` yields only `basePath`'s direct children that hold a
 * `meta.json`. Every block id with a `/` is never listed. This replaces `listBlockIds` with one
 * that descends, to measure what the miss costs (Sereus's peer-join backfill pushes what it lists).
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

const { FileStoreDriver } = await import('@optimystic/db-p2p-storage-fs')

FileStoreDriver.prototype.listBlockIds = async function* () {
	yield* walk(this.basePath, '')
}

/** A block directory's own contents (see `FileRawStorage.getBlockPath` and its siblings). */
const OWN = new Set(['revs', 'pend', 'actions', 'proofs', 'blocks'])

async function* walk(dir, prefix) {
	const entries = await fs.readdir(dir, { withFileTypes: true }).catch(error => {
		if (error?.code === 'ENOENT') return []
		throw error
	})
	const isBlock = prefix !== '' && (await fs.access(join(dir, 'meta.json')).then(() => true, () => false))
	for (const entry of entries) {
		if (!entry.isDirectory() || (isBlock && OWN.has(entry.name))) continue
		const id = prefix ? `${prefix}/${entry.name}` : entry.name
		const path = join(dir, entry.name)
		if (await fs.access(join(path, 'meta.json')).then(() => true, () => false)) yield id
		// Descend either way: a named block may sit inside another's directory (an index's header
		// under its table's), and a plain directory (`default/`) holds blocks below it.
		yield* walk(path, id)
	}
}
