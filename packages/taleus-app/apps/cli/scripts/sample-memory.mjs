/**
 * Preload (`node --import ./scripts/sample-memory.mjs`, `TALEUS_MEM_EVERY_MS=5000`): logs this process's
 * memory every so often -- one stderr line, `<ISO time> mem rss=<MB> heap=<MB> external=<MB> buffers=<MB>`
 * -- in the shape of the stack's debug lines, so it lands in the party's log beside them.
 */
const everyMs = Number(process.env.TALEUS_MEM_EVERY_MS ?? 5000)
const mb = bytes => (bytes / 1048576).toFixed(1)

setInterval(() => {
	const { rss, heapUsed, external, arrayBuffers } = process.memoryUsage()
	process.stderr.write(`${new Date().toISOString()} mem rss=${mb(rss)} heap=${mb(heapUsed)} external=${mb(external)} buffers=${mb(arrayBuffers)}\n`)
}, everyMs).unref()
