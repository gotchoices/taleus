#!/usr/bin/env node
/**
 * Sample a running development build's Hermes CPU profile over Metro's inspector.
 *
 *   node scripts/cpu-profile.mjs <device> <seconds> <out.cpuprofile>
 *
 * <device> matches the inspector page's device name or title, as in `dev-drive.mjs`. The output is a
 * DevTools `.cpuprofile`; its frames name bundle URLs, which Metro's `/symbolicate` maps to sources.
 * METRO_PORT (default 8086).
 */
import WebSocket from 'ws'
import { writeFileSync } from 'node:fs'
const port = process.env.METRO_PORT ?? '8086'
const [device, secs, out] = process.argv.slice(2)
if (!device || !secs || !out) {
	console.error('usage: cpu-profile.mjs <device> <seconds> <out.cpuprofile>')
	process.exit(2)
}
const pages = await (await fetch(`http://localhost:${port}/json/list`)).json()
const page = pages.find(p => `${p.deviceName} ${p.title}`.includes(device))
if (!page) throw new Error('no page for ' + device)
const ws = new WebSocket(page.webSocketDebuggerUrl, { headers: { Origin: `http://localhost:${port}` } })
await new Promise((r, j) => { ws.once('open', r); ws.once('error', j) })
let id = 0
const pending = new Map()
ws.on('message', m => { const d = JSON.parse(m); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } })
const call = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await call('Profiler.enable')
await call('Profiler.start')
await new Promise(r => setTimeout(r, Number(secs) * 1000))
const res = await call('Profiler.stop')
writeFileSync(out, JSON.stringify(res.result?.profile ?? res))
ws.close()
console.log('wrote', out, res.error ? JSON.stringify(res.error) : '')
