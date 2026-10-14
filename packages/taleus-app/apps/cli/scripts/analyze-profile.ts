/**
 * Where did the time go? Reads a `profile-formation.ts` output folder and, for one party between
 * two times, prints which debug namespaces were busy and the longest silences (a silence is usually
 * a timeout or a wait on the other side), with the line before and after each.
 *
 *   node scripts/analyze-profile.ts <dir> <party> <from-s> <to-s> [--gaps <n>] [--min-gap-ms <ms>]
 *
 * Times are seconds since the run began, as `marks.jsonl` and the profile's own output print them.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { positionals, values } = parseArgs({
	allowPositionals: true,
	options: { gaps: { type: 'string' }, 'min-gap-ms': { type: 'string' }, grep: { type: 'string' } },
})
const [dir, party, fromText, toText] = positionals
if (!dir || !party || fromText === undefined || toText === undefined) {
	process.stderr.write('usage: analyze-profile.ts <dir> <party> <from-s> <to-s> [--gaps <n>] [--min-gap-ms <ms>] [--grep <text>]\n')
	process.exit(1)
}

const marks = readFileSync(join(dir, 'marks.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { t: number; at: string })
const start = Date.parse(marks[0].at) - marks[0].t
const from = start + Number(fromText) * 1000
const to = start + Number(toText) * 1000

interface Line {
	at: number
	namespace: string
	text: string
}

/** Debug lines (`<ISO time> <namespace> <message>`) of the party's log in the window; continuation lines join the one before. */
function lines(): Line[] {
	const out: Line[] = []
	for (const raw of readFileSync(join(dir, `${party}.log`), 'utf8').split('\n')) {
		const match = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) (\S+) (.*)$/.exec(raw)
		if (match) out.push({ at: Date.parse(match[1]), namespace: match[2], text: match[3] })
		else if (out.length) out[out.length - 1].text += ` ${raw.trim()}`
	}
	return out.filter(line => line.at >= from && line.at <= to)
}

const window = lines()
const seconds = (at: number) => ((at - start) / 1000).toFixed(2)
process.stdout.write(`${party}, ${fromText}-${toText} s: ${window.length} debug lines\n\n`)

/** Namespaces, with any trailing peer-id suffix folded away. */
const counts = new Map<string, number>()
for (const line of window) {
	const namespace = line.namespace.replace(/:12D3Koo\w+$/, '').replace(/:[0-9a-f]{8,}$/i, '')
	counts.set(namespace, (counts.get(namespace) ?? 0) + 1)
}
process.stdout.write('busiest namespaces\n')
for (const [namespace, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 15)) process.stdout.write(`  ${String(n).padStart(6)}  ${namespace}\n`)

const minGap = Number(values['min-gap-ms'] ?? 500)
const gaps = window.slice(1).map((line, i) => ({ ms: line.at - window[i].at, before: window[i], after: line })).filter(gap => gap.ms >= minGap)
process.stdout.write(`\nlongest silences (>= ${minGap} ms), ${gaps.reduce((sum, gap) => sum + gap.ms, 0)} ms in all\n`)
for (const gap of gaps.sort((a, b) => b.ms - a.ms).slice(0, Number(values.gaps ?? 12))) {
	process.stdout.write(`  ${String(gap.ms).padStart(6)} ms  after ${seconds(gap.before.at)} s\n`)
	process.stdout.write(`      before: ${gap.before.namespace} ${gap.before.text.slice(0, 170)}\n`)
	process.stdout.write(`      after:  ${gap.after.namespace} ${gap.after.text.slice(0, 170)}\n`)
}

if (values.grep) {
	process.stdout.write(`\nlines matching ${JSON.stringify(values.grep)}\n`)
	for (const line of window.filter(l => l.text.includes(values.grep!) || l.namespace.includes(values.grep!))) {
		process.stdout.write(`  ${seconds(line.at)} s  ${line.namespace} ${line.text.slice(0, 170)}\n`)
	}
}
