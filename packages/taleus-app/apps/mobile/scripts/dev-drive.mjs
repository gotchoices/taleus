#!/usr/bin/env node
/**
 * Drive a running development build through `__taleusDev` (src/data/dev-bridge.ts), over
 * Metro's inspector, with no UI in between.
 *
 *   node scripts/dev-drive.mjs <device> <method> [json-arg ...]
 *
 * <device> matches the inspector page's device name or title (e.g. `SM-G935V`, `sdk_gphone`).
 * Methods: status, onboard <name>, invite [creditLimitUnits] [agreementId], agreements, agreement <cid>,
 * import <link>, sql <tallyId> <sql>, accept <token> <name>
 * [creditLimitUnits], answerOffer <tallyId>, close <tallyId>, preview <tallyId> <units>, generation, tallies,
 * pay <tallyId> <units> <memo>. Arguments are JSON (a bare word is
 * taken as a string). Prints the outcome as JSON; exits non-zero on an error.
 *
 * METRO_PORT (default 8086) and DRIVE_TIMEOUT_S (default 600) tune it.
 */
import WebSocket from 'ws'

const port = process.env.METRO_PORT ?? '8086'
const timeoutS = Number(process.env.DRIVE_TIMEOUT_S ?? 600)
const [device, method, ...rawArgs] = process.argv.slice(2)
if (!device || !method) {
	console.error('usage: dev-drive.mjs <device> <method> [json-arg ...]')
	process.exit(2)
}
const args = rawArgs.map(a => {
	try {
		return JSON.parse(a)
	} catch {
		return a
	}
})

// An inspector page can drop and come back while a long call runs (a busy emulator, a reload of
// the bundle), so every evaluation opens its page afresh if the last socket closed.
let ws
let nextId = 0
const pending = new Map()

async function connect() {
	const pages = await (await fetch(`http://localhost:${port}/json/list`)).json()
	const page = pages.find(p => `${p.deviceName} ${p.title}`.includes(device))
	if (!page) throw new Error(`no inspector page matching ${device}: ${pages.map(p => p.deviceName).join(', ')}`)
	const socket = new WebSocket(page.webSocketDebuggerUrl, { headers: { Origin: `http://localhost:${port}` } })
	await new Promise((resolve, reject) => {
		socket.once('open', resolve)
		socket.once('error', reject)
	})
	socket.on('message', data => {
		const message = JSON.parse(data)
		pending.get(message.id)?.(message)
		pending.delete(message.id)
	})
	socket.on('close', () => {
		for (const settle of pending.values()) settle({ closed: true })
		pending.clear()
	})
	return socket
}

/** Evaluate `expression` on the page; undefined if the socket closed before it answered. */
async function evaluate(expression) {
	if (!ws || ws.readyState !== WebSocket.OPEN) ws = await connect()
	const id = ++nextId
	return new Promise(resolve => {
		pending.set(id, message => resolve(message.result?.result?.value))
		ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
	})
}

const callId = `drive-${Date.now()}`
let started
try {
	started = await evaluate(`globalThis.__taleusDev ? __taleusDev.start(${JSON.stringify(callId)}, ${JSON.stringify(method)}, ...${JSON.stringify(args)}) : 'no bridge'`)
} catch (error) {
	console.error(error.message)
	process.exit(2)
}
if (started !== true) {
	console.error(`could not start ${method}: ${started}`)
	process.exit(1)
}
const t0 = Date.now()
for (;;) {
	const outcome = await evaluate(`JSON.stringify(__taleusDev.take(${JSON.stringify(callId)}) ?? null)`).catch(() => undefined)
	const parsed = outcome ? JSON.parse(outcome) : null
	if (parsed) {
		console.log(JSON.stringify({ ms: Date.now() - t0, ...parsed }, null, 1))
		ws.close()
		process.exit(parsed.ok ? 0 : 1)
	}
	if (Date.now() - t0 > timeoutS * 1000) {
		console.error(`${method} still pending after ${timeoutS} s`)
		ws.close()
		process.exit(1)
	}
	await new Promise(resolve => setTimeout(resolve, 1000))
}
