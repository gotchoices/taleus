const WebSocket = require('ws')
const [url, seconds, out] = process.argv.slice(2)
const ws = new WebSocket(url, { headers: { Origin: 'http://localhost:8086' } })
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise(resolve => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })) })
ws.on('message', data => { const msg = JSON.parse(data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) } })
ws.on('open', async () => {
	await send('Profiler.enable')
	await send('Profiler.start')
	await new Promise(r => setTimeout(r, Number(seconds) * 1000))
	const res = await send('Profiler.stop')
	const profile = res.result?.profile
	if (!profile) { console.log('no profile', JSON.stringify(res).slice(0, 300)); process.exit(1) }
	require('fs').writeFileSync(out, JSON.stringify(profile))
	const byId = new Map(profile.nodes.map(n => [n.id, n]))
	const self = new Map()
	const deltas = profile.timeDeltas || []
	profile.samples.forEach((sid, i) => { const n = byId.get(sid); const f = n.callFrame; const key = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber}`; self.set(key, (self.get(key) || 0) + (deltas[i] || 0)) })
	const total = [...self.values()].reduce((a, b) => a + b, 0)
	console.log('total ms', Math.round(total / 1000))
	for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(Math.round(v / 1000), 'ms', k.slice(0, 160))
	process.exit(0)
})
ws.on('error', e => { console.log('ws error', e.message); process.exit(1) })
