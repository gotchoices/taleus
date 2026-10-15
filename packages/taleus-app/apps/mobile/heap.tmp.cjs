// Hermes heap snapshot (and heap stats) over Metro's inspector socket. Usage: node heap.tmp.cjs <wsUrl> <out.heapsnapshot|-stats>
const WebSocket = require('ws')
const fs = require('fs')
const [url, out] = process.argv.slice(2)
const ws = new WebSocket(url, { headers: { Origin: 'http://localhost:8086' } })
let id = 0
const pending = new Map()
const chunks = []
const send = (method, params = {}) => new Promise(resolve => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })) })
ws.on('message', data => {
	const msg = JSON.parse(data)
	if (msg.method === 'HeapProfiler.addHeapSnapshotChunk') chunks.push(msg.params.chunk)
	else if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
ws.on('open', async () => {
	await send('Runtime.enable')
	const stats = await send('Runtime.evaluate', { expression: 'JSON.stringify(HermesInternal.getInstrumentedStats())', returnByValue: true })
	const s = JSON.parse(stats.result?.result?.value ?? '{}')
	console.log(`js heap: allocated ${(s.js_heapSize / 1048576).toFixed(1)} MB, live after GC ${((s.js_allocatedBytes ?? 0) / 1048576).toFixed(1)} MB, external ${((s.js_externalBytes ?? 0) / 1048576).toFixed(1)} MB, gcs ${s.js_numGCs}`)
	if (out !== '-stats') {
		await send('HeapProfiler.enable')
		const t = Date.now()
		await send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
		fs.writeFileSync(out, chunks.join(''))
		console.log(`snapshot ${out}: ${(fs.statSync(out).size / 1048576).toFixed(1)} MB in ${((Date.now() - t) / 1000).toFixed(0)} s`)
	}
	process.exit(0)
})
ws.on('error', e => { console.log('ws error', e.message); process.exit(1) })
