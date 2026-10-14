/**
 * Preload (`node --import ./scripts/count-fsync.mjs`): logs every fsync a process makes through
 * `fs.promises` -- one stderr line, `<ISO time> fsync:file|fsync:dir <ms> <path>` -- in the shape of
 * the stack's debug lines, so `analyze-profile.ts` counts them per window like any namespace.
 */
import { promises as fs, statSync } from 'node:fs'

const open = fs.open.bind(fs)
fs.open = async (path, ...rest) => {
	const handle = await open(path, ...rest)
	const sync = handle.sync.bind(handle)
	handle.sync = async () => {
		const started = performance.now()
		try {
			return await sync()
		} finally {
			let kind = 'file'
			try {
				kind = statSync(path).isDirectory() ? 'dir' : 'file'
			} catch {
				kind = 'file'
			}
			process.stderr.write(`${new Date().toISOString()} fsync:${kind} ${(performance.now() - started).toFixed(1)}ms ${String(path).split('/').slice(-3).join('/')}\n`)
		}
	}
	return handle
}
