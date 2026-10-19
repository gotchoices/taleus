/**
 * Where a profiled run's network requests went, act by act (`profile-formation.ts --count-requests`).
 *
 *   node scripts/analyze-requests.ts <dir> [--top <n>]
 *
 * An act is the span between two milestones the run marked (an invitation made, accepted, offered,
 * open, a payment). Per act, both parties' requests: how many, how many **rounds** -- groups of
 * requests in flight together; consecutive rounds are what a latency multiplies -- and the busiest
 * causes by protocol and operation, by the Optimystic code that sent them, and by the Sereus or
 * Taleus code that started them.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

interface Request {
	t: number
	ms: number
	ok: boolean
	protocol: string
	op: string
	via: string
	origin: string
	party: string
}

interface Mark {
	at: string
	party: string
	text: string
}

const MILESTONES: Array<[party: string, pattern: RegExp, name: string]> = [
	['jan', /making an invitation/, 'invite'],
	['jan', /out: taleus:offer/, 'invitation made'],
	['sam', /invites you/, 'accept'],
	['sam', /out: accepted/, 'accepted'],
	['sam', /Offered after/, 'offered'],
	['sam', /Open after/, 'open'],
	['sam', /out: act:/, 'paid'],
]

const { values, positionals } = parseArgs({ allowPositionals: true, options: { top: { type: 'string' } } })
const dir = positionals[0]
if (!dir) throw new Error('usage: analyze-requests.ts <dir> [--top <n>]')
const top = Number(values.top ?? 5)

const requests: Request[] = readdirSync(dir)
	.filter(name => /^requests-\w+\.jsonl$/.test(name))
	.flatMap(name => {
		const party = /^requests-(\w+)/.exec(name)![1]
		return readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean).map(line => ({ ...(JSON.parse(line) as Request), party }))
	})
	.sort((a, b) => a.t - b.t)

const marks = readFileSync(join(dir, 'marks.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Mark)
const points: Array<{ name: string; t: number }> = []
for (const [party, pattern, name] of MILESTONES) {
	const found = marks.find(m => m.party === party && pattern.test(m.text) && !points.some(p => p.name === name))
	if (found) points.push({ name, t: Date.parse(found.at) })
}
points.sort((a, b) => a.t - b.t)

for (let i = 0; i + 1 < points.length; i++) {
	const from = points[i]
	const to = points[i + 1]
	const inAct = requests.filter(r => r.t >= from.t && r.t < to.t)
	report(`${from.name} -> ${to.name}`, to.t - from.t, inAct)
}
const end = points.at(-1)
if (end) report(`after ${end.name}`, (requests.at(-1)?.t ?? end.t) - end.t, requests.filter(r => r.t >= end.t))

function report(name: string, spanMs: number, inAct: Request[]): void {
	const failed = inAct.filter(r => !r.ok).length
	console.log(`\n== ${name}: ${(spanMs / 1000).toFixed(1)} s, ${inAct.length} requests (${failed} failed), ${rounds(inAct)} rounds`)
	for (const party of ['jan', 'sam']) {
		const mine = inAct.filter(r => r.party === party)
		if (mine.length) console.log(`   ${party}: ${mine.length} requests, ${rounds(mine)} rounds`)
	}
	table('protocol / op', inAct, r => `${r.protocol.replace('/optimystic/<net>/', '')} ${r.op}`)
	table('sent by', inAct, r => r.via)
	table('started by', inAct, r => r.origin)
}

/** Groups of requests whose times overlap: each group is one round a latency is paid on. */
function rounds(list: Request[]): number {
	let count = 0
	let until = -Infinity
	for (const r of [...list].sort((a, b) => a.t - b.t)) {
		if (r.t >= until) count++
		until = Math.max(until, r.t + r.ms)
	}
	return count
}

function table(title: string, list: Request[], key: (r: Request) => string): void {
	const counts = new Map<string, { n: number; ms: number }>()
	for (const r of list) {
		const k = key(r)
		const entry = counts.get(k) ?? { n: 0, ms: 0 }
		entry.n++
		entry.ms += r.ms
		counts.set(k, entry)
	}
	const rows = [...counts].sort((a, b) => b[1].n - a[1].n).slice(0, top)
	if (!rows.length) return
	console.log(`   ${title}:`)
	for (const [k, { n, ms }] of rows) console.log(`     ${String(n).padStart(5)}  ${String(Math.round(ms / n)).padStart(5)} ms avg  ${k.slice(0, 110)}`)
}
