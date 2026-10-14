/**
 * Count what a run did, per party, between two times: the events that tell "the same work, slower"
 * from "more work, because slow" -- consensus rounds, requests, reads asked of the cohort, and the
 * signs of thrashing (silences, missed quorums, failed syncs, retries, redials).
 *
 *   node scripts/count-events.ts <dir> [<from-s> <to-s>]
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir, fromText, toText] = process.argv.slice(2)
if (!dir) {
	process.stderr.write('usage: count-events.ts <dir> [<from-s> <to-s>]\n')
	process.exit(1)
}
const marks = readFileSync(join(dir, 'marks.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { t: number; at: string })
const start = Date.parse(marks[0].at) - marks[0].t
const from = start + Number(fromText ?? 0) * 1000
const to = toText === undefined ? Infinity : start + Number(toText) * 1000

/** What to count: a label, and a test on `<namespace> <message>`. */
const EVENTS: Array<[string, RegExp]> = [
	['SQL commits (coordinator)', /network-transactor commit:done/],
	['  ...that did not succeed', /network-transactor commit:done.*success=false/],
	['block promise requests', /cluster-tx:promise-request/],
	['block commits as member', /cluster-member:action-commit/],
	['cluster dials (new streams)', /protocol-client dial peer=.*\/cluster\//],
	['reads asked of the cohort', /cluster-fetch:start|network-transactor get blockIds/],
	['cohort silent', /peers-silent|silent: [1-9]/],
	['no quorum', /no-quorum/],
	['failed syncs served', /Failed sync request/],
	['cohort-unreachable', /cohort-unreachable/],
	['super-majority missed', /super-majority/i],
	['retries', /\bretry(ing)?\b(?!: undefined)|retrying/i],
	['timeouts', /timed? ?out|timeout/i],
	['strand redials', /strand-redial.*dialing/],
	['first-sync probe failures', /probe failed/],
]

for (const party of ['jan', 'sam']) {
	let text: string
	try {
		text = readFileSync(join(dir, `${party}.log`), 'utf8')
	} catch {
		continue
	}
	const counts = new Map(EVENTS.map(([label]) => [label, 0]))
	let lines = 0
	for (const raw of text.split('\n')) {
		const match = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) (.*)$/.exec(raw)
		if (!match) continue
		const at = Date.parse(match[1])
		if (at < from || at > to) continue
		lines++
		for (const [label, test] of EVENTS) if (test.test(match[2])) counts.set(label, (counts.get(label) ?? 0) + 1)
	}
	process.stdout.write(`${party}: ${lines} debug lines\n`)
	for (const [label, n] of counts) process.stdout.write(`  ${String(n).padStart(6)}  ${label}\n`)
}
