/**
 * A party's folder on a Node machine: everything one Taleus identity keeps, under
 * `<home>/<profile>/` (home: the caller's, else `$TALEUS_HOME`, else `~/.taleus`). Deleting the
 * folder is a clean slate. The shape follows sereus chat's CLI profile.
 */
import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The form of everything a party folder stores. Bump it when a stack upgrade or a change here
 * makes older folders unreadable (Sereus 1.15 changed the control schema: parties made with 1.14
 * do not load). A folder in another form is refused, never misread.
 */
export const DATA_FORMAT = 'sereus-1.15'

/** What `party.json` holds: the node's start options, kept across runs. */
export interface PartyConfig {
	dataFormat: string
	partyId: string
	relays: string[]
	/** The loopback port a listening node uses, chosen once and kept so a peer finds it again. */
	listenPort?: number
	createdAt: string
}

export interface PartyDirs {
	name: string
	root: string
	keys: string
	blocks: string
	node: string
	slots: string
	configFile: string
	lockFile: string
}

const NAME = /^[A-Za-z0-9._-]{1,64}$/

export function partyDirs(name: string, home?: string): PartyDirs {
	if (!NAME.test(name) || name.startsWith('.')) {
		throw new Error(`party names are letters, digits, '.', '_' and '-': ${JSON.stringify(name)}`)
	}
	const root = join(home ?? process.env.TALEUS_HOME ?? join(homedir(), '.taleus'), name)
	return {
		name,
		root,
		keys: join(root, 'keys'),
		blocks: join(root, 'blocks'),
		node: join(root, 'node'),
		slots: join(root, 'slots'),
		configFile: join(root, 'party.json'),
		lockFile: join(root, 'lock'),
	}
}

/** Make the folders (owner-only) and, on first use, the config. */
export async function openParty(dirs: PartyDirs): Promise<{ config: PartyConfig; created: boolean }> {
	for (const dir of [dirs.root, dirs.keys, dirs.blocks, dirs.node, dirs.slots]) {
		await mkdir(dir, { recursive: true, mode: 0o700 })
	}
	// The key folder holds the identity: owner-only even if it existed with looser modes.
	await chmod(dirs.keys, 0o700)
	const existing = await readJson<PartyConfig>(dirs.configFile)
	if (existing) {
		if (existing.dataFormat !== DATA_FORMAT) {
			throw new Error(`party ${dirs.name} was made in another form (${existing.dataFormat}) that this build `
				+ `(${DATA_FORMAT}) cannot read. Delete ${dirs.root} to start it again.`)
		}
		return { config: existing, created: false }
	}
	const config: PartyConfig = { dataFormat: DATA_FORMAT, partyId: randomUUID(), relays: [], createdAt: new Date().toISOString() }
	await saveConfig(dirs, config)
	return { config, created: true }
}

export function saveConfig(dirs: PartyDirs, config: PartyConfig): Promise<void> {
	return writeTextAtomic(dirs.configFile, `${JSON.stringify(config, null, 2)}\n`)
}

async function readJson<T>(path: string): Promise<T | undefined> {
	const text = await readText(path)
	return text === undefined ? undefined : (JSON.parse(text) as T)
}

/** A file's text, or undefined when there is no file. Any other failure rejects. */
export async function readText(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, 'utf8')
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
		throw error
	}
}

/** Write, then rename, so a crash never leaves half a file. */
export async function writeTextAtomic(path: string, text: string): Promise<void> {
	const temp = `${path}.${process.pid}.tmp`
	await writeFile(temp, text, { mode: 0o600 })
	await rename(temp, path)
}

/**
 * One process per party: two nodes over the same files would corrupt them. Takes the lock file
 * (holding this process's id) or throws naming the holder; a lock left by a process that is gone
 * is taken over. Released when this process exits.
 */
export async function lockParty(dirs: PartyDirs): Promise<void> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			await writeFile(dirs.lockFile, `${process.pid}\n`, { flag: 'wx', mode: 0o600 })
			process.on('exit', () => releaseLock(dirs))
			return
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
			const holder = Number((await readText(dirs.lockFile))?.trim())
			if (holder && holder !== process.pid && isRunning(holder)) {
				throw new Error(`party ${dirs.name} is in use by process ${holder}`, { cause: error })
			}
			releaseLock(dirs)
		}
	}
	throw new Error(`party ${dirs.name} is in use`)
}

function releaseLock(dirs: PartyDirs): void {
	try {
		unlinkSync(dirs.lockFile)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
	}
}

function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM'
	}
}
