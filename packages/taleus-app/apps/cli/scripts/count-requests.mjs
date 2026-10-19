/**
 * Preload (`node --import ./scripts/count-requests.mjs`, `TALEUS_REQUEST_LOG=<file>`): records every
 * remote request this process makes through Optimystic's `ProtocolClient` -- the one path all of its
 * clients (repo, cluster, sync, block transfer, dispute) send by. One JSON line per request, written
 * at exit:
 *
 *   { t, ms, ok, protocol, op, via, origin }
 *
 * `t` is when it started (epoch ms) and `ms` how long it took; `protocol` has strand and network ids
 * folded (`<strand>`), `op` names what was asked (a repo request's operations, or a message's type),
 * `via` is the Optimystic code that sent it and `origin` the first Sereus or Taleus frame that led
 * there. `analyze-requests.ts` turns a log into rounds and causes per act.
 */
import { writeFileSync } from 'node:fs'

const file = process.env.TALEUS_REQUEST_LOG
if (file) {
	// Resolved as the CLI resolves it, so this patches the one copy every client inherits from.
	const { ProtocolClient } = await import('@optimystic/db-p2p')
	const records = []
	const original = ProtocolClient.prototype.processMessage
	ProtocolClient.prototype.processMessage = async function (message, protocol, options) {
		const record = { t: Date.now(), ms: 0, ok: false, protocol: fold(protocol), op: opOf(message), ...callers() }
		records.push(record)
		try {
			const answer = await original.call(this, message, protocol, options)
			record.ok = true
			return answer
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
