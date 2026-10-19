/**
 * Preload (`node --import ./scripts/count-requests.mjs`, `TALEUS_REQUEST_LOG=<file>`): records every
 * remote request this process makes through Optimystic's `ProtocolClient` -- the one path all of its
 * clients (repo, cluster, sync, block transfer, dispute) send by. One JSON line per request, written
 * at exit:
 *
 *   { t, ms, ok, peer, protocol, op, blocks, ids, bytes, via, origin, record? }
 *
 * `t` is when it started (epoch ms) and `ms` how long it took; `protocol` has strand and network ids
 * folded (`<strand>`), `op` names what was asked (a repo request's operations, or a message's type),
 * `blocks` how many blocks it names (`ids`: which), `bytes` the request's JSON size,
 * `via` is the Optimystic code that sent it and `origin` the first Sereus or Taleus frame that led
 * there. A cluster request adds `record`: its transaction's `hash`, the repo operations it carries,
 * the blocks they name, and how many promises and commits it already holds.
 * `analyze-requests.ts` turns a log into rounds and causes per act.
 */
import { writeFileSync } from 'node:fs'

const file = process.env.TALEUS_REQUEST_LOG
if (file) {
	// Resolved as the CLI resolves it, so this patches the one copy every client inherits from.
	const { ProtocolClient } = await import('@optimystic/db-p2p')
	const records = []
	const original = ProtocolClient.prototype.processMessage
	ProtocolClient.prototype.processMessage = async function (message, protocol, options) {
		const record = { t: Date.now(), ms: 0, ok: false, peer: String(this.peerId ?? '?'), protocol: fold(protocol), op: opOf(message), blocks: blocksIn(message), ids: idsIn(message), bytes: sizeOf(message), ...callers(), ...recordOf(message) }
		records.push(record)
		try {
			const answer = await original.call(this, message, protocol, options)
			record.ok = true
			return answer
		} catch (error) {
			record.error = String(error?.message ?? error).slice(0, 160)
			throw error
		} finally {
			record.ms = Date.now() - record.t
		}
	}
	process.on('exit', () => {
		writeFileSync(file, records.map(record => JSON.stringify(record)).join('\n') + '\n')
	})
}

/** Strand and network ids out of a protocol id, so like requests group together. */
function fold(protocol) {
	return String(protocol)
		.replace(/strand-[\w-]+/g, '<strand>')
		.replace(/\/optimystic\/[^/]+\/(?=[\w-]+\/\d)/, '/optimystic/<net>/')
}

/** What a message asks for: a repo request's operation names, else its type, else its keys. */
function opOf(message) {
	if (message && Array.isArray(message.operations)) {
		return message.operations.map(op => Object.keys(op ?? {}).join('+')).join(',')
	}
	if (message && typeof message.type === 'string') return message.type
	return message && typeof message === 'object' ? Object.keys(message).slice(0, 3).join('+') : typeof message
}

/** How many blocks a request names: its `blockIds`, a single `blockId`, or a repo operation's ids. */
function blocksIn(message) {
	if (!message || typeof message !== 'object') return 0
	if (Array.isArray(message.blockIds)) return message.blockIds.length
	if (typeof message.blockId === 'string') return 1
	if (Array.isArray(message.operations)) {
		return message.operations.reduce((sum, op) => sum + Object.values(op ?? {}).reduce((n, v) => n + (Array.isArray(v?.blockIds) ? v.blockIds.length : 0), 0), 0)
	}
	return 0
}

/** The block ids a request names, for blockIds lists and single-block requests. */
function idsIn(message) {
	if (!message || typeof message !== 'object') return []
	if (Array.isArray(message.blockIds)) return message.blockIds.map(String)
	if (typeof message.blockId === 'string') return [message.blockId]
	return []
}

/** A cluster request's record, summarised: which transaction, what it asks, of which blocks. */
function recordOf(message) {
	const record = message?.record
	if (!record || typeof record !== 'object') return {}
	const ops = Array.isArray(record.message?.operations) ? record.message.operations : []
	const ids = new Set()
	for (const op of ops) {
		for (const value of Object.values(op ?? {})) {
			for (const id of value?.blockIds ?? []) ids.add(String(id))
			const transforms = value?.transforms ?? {}
			for (const id of Object.keys(transforms.inserts ?? {})) ids.add(id)
			for (const id of Object.keys(transforms.updates ?? {})) ids.add(id)
			for (const id of transforms.deletes ?? []) ids.add(String(id))
		}
	}
	return {
		record: {
			hash: String(record.messageHash ?? '').slice(0, 12),
			ops: ops.map(op => Object.keys(op ?? {}).join('+')).join(','),
			ids: [...ids],
			promises: Object.keys(record.promises ?? {}).length,
			commits: Object.keys(record.commits ?? {}).length,
		},
	}
}

/** A request's size as JSON (what most of these protocols send). */
function sizeOf(message) {
	try {
		return JSON.stringify(message)?.length ?? 0
	} catch {
		return 0
	}
}

/** The Optimystic frame that sent this (`via`) and the first Sereus/Taleus frame behind it (`origin`). */
function callers() {
	const limit = Error.stackTraceLimit
	Error.stackTraceLimit = 80
	const frames = (new Error().stack ?? '').split('\n').slice(2).map(line => line.trim())
	Error.stackTraceLimit = limit
	const name = frame => {
		const fn = /at (?:async )?([\w.$<>]+)/.exec(frame)?.[1] ?? '?'
		const file = /([\w-]+)\.[jt]s:\d+/.exec(frame)?.[1] ?? '?'
		return `${fn} (${file})`
	}
	const via = frames.find(frame => /@optimystic\//.test(frame) && !/protocol-client|repo\/client|cluster\/client|sync\/client|count-requests/.test(frame))
	const origin = frames.find(frame => /cadre-core\/dist|taleus-(core|model|sereus)\//.test(frame))
	return { via: via ? name(via) : '?', origin: origin ? name(origin) : '?' }
}
