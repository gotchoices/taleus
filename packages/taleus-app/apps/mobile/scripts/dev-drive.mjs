#!/usr/bin/env node
/**
 * Drive a running development build through `__taleusDev` (src/data/dev-bridge.ts), over
 * Metro's inspector, with no UI in between.
 *
 *   node scripts/dev-drive.mjs <device> <method> [json-arg ...]
 *
 * <device> matches the inspector page's device name or title (e.g. `SM-G935V`, `sdk_gphone`).
 * Methods: status, onboard <name>, invite [creditLimitUnits], accept <token> <name>
 * [creditLimitUnits], tallies, pay <tallyId> <units> <memo>. Arguments are JSON (a bare word is
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

const pages = await (await fetch(`http://localhost:${port}/json/list`)).json()
const page = pages.find(p => `${p.deviceName} ${p.title}`.includes(device))
if (!page) {
	console.error(`no inspector page matching ${device}: ${pages.map(p => p.deviceName).join(', ')}`)
	process.exit(2)
}

const ws = new WebSocket(page.webSocketDebuggerUrl, { headers: { Origin: `http://localhost:${port}` } })
await new Promise((resolve, reject) => {
	ws.once('open', resolve)
	ws.once('error', reject)
})

let nextId = 0
const pending = new Map()
ws.on('message', data => {
	const message = JSON.parse(data)
	pending.get(message.id)?.(message)
	pending.delete(message.id)
})
function evaluate(expression) {
	const id = ++nextId
	return new Promise(resolve => {
		pending.set(id, message => resolve(message.result?.result?.value))
		ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
	})
}

const callId = `drive-${Date.now()}`
const started = await evaluate(`globalThis.__taleusDev ? __taleusDev.start(${JSON.stringify(callId)}, ${JSON.stringify(method)}, ...${JSON.stringify(args)}) : 'no bridge'`)
if (started !== true) {
	console.error(`could not start ${method}: ${started}`)
	process.exit(1)
}
const t0 = Date.now()
for (;;) {
	const outcome = await evaluate(`JSON.stringify(__taleusDev.take(${JSON.stringify(callId)}) ?? null)`)
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
