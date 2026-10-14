/** Reading tallies: `tallies`, `tally`, `history`, `attention`, `watch`. */
import { onWorldChanged, type TallySummary } from 'taleus-model'

import { formatAmount } from '../amount.ts'
import type { Row } from '../output.ts'
import { CliFailure, EXIT, titleOf } from '../session.ts'
import { need, text, usage, type Command } from './command.ts'

const TALLY_COLUMNS = ['row', 'id', 'counterparty', 'balance', 'perspective', 'state', 'waitingOn', 'lastActivity'] as const

export function tallyRow(tally: TallySummary, row?: number): Row {
	return {
		row,
		id: tally.id,
		counterparty: titleOf(tally),
		balance: formatAmount(tally.balance.units, tally.unit),
		perspective: tally.balance.perspective,
		state: tally.invitation ? 'Invited' : tally.state,
		waitingOn: tally.waitingOn,
		lastActivity: tally.lastActivity,
	}
}

const tallies: Command = {
	name: 'tallies',
	aliases: ['ls'],
	noArgs: true,
	summary: 'Every tally, and every invitation not yet taken up',
	usage: '',
	async run(session) {
		const list = await session.tallies()
		await session.rememberTallies(list.map(tally => tally.id))
		session.out.rows(TALLY_COLUMNS, list.map((tally, i) => tallyRow(tally, i + 1)))
	},
}

const tally: Command = {
	name: 'tally',
	summary: 'One tally: its terms, balance and who it waits on',
	usage: '<tally>',
	async run(session, args) {
		const { id, unit } = await session.tally(need(tally, args, 0, 'tally'))
		const detail = session.unwrap(await session.party.model.tally.readTally(id))
		const money = (units: number) => formatAmount(units, unit)
		session.out.pairs([
			['id', detail.id],
			['counterparty', detail.counterparty.name],
			['state', detail.state],
			['waitingOn', detail.waitingOn],
			['balance', money(detail.balance.units)],
			['perspective', detail.balance.perspective],
			['myLimit', money(detail.terms.mine.creditLimit.units)],
			['myNotice', detail.terms.mine.noticeDays],
			['theirLimit', money(detail.terms.theirs.creditLimit.units)],
			['theirNotice', detail.terms.theirs.noticeDays],
			['roomToSpend', money(detail.roomToSpend.units)],
			['agreement', detail.agreement.title],
			['opened', detail.opened],
		])
	},
}

const history: Command = {
	name: 'history',
	summary: 'A tally\'s entries, oldest first (default the last 20)',
	usage: '<tally> [-n <count>]',
	options: { n: { type: 'string', short: 'n' } },
	async run(session, args, values) {
		const { id, unit } = await session.tally(need(history, args, 0, 'tally'))
		const count = usage(history, () => {
			const n = Number(text(values, 'n') ?? 20)
			if (!Number.isInteger(n) || n < 1) throw new Error('-n takes a count')
			return n
		})
		const entries = session.unwrap(await session.party.model.entries.listEntries(id))
		const oldestFirst = [...entries].sort((a, b) => a.date.localeCompare(b.date)).slice(-count)
		session.out.rows(['row', 'id', 'date', 'issuer', 'amount', 'balanceAfter', 'memo'], oldestFirst.map((entry, i) => ({
			row: i + 1,
			id: entry.id,
			date: entry.date,
			issuer: entry.issuer,
			amount: formatAmount(entry.amount.units, unit),
			balanceAfter: `${formatAmount(entry.balanceAfter.units, unit)} ${entry.balanceAfter.perspective}`,
			memo: entry.memo,
		})))
	},
}

const attention: Command = {
	name: 'attention',
	noArgs: true,
	summary: 'What waits on this party, across tallies',
	usage: '',
	async run(session) {
		const items = session.unwrap(await session.party.model.attention.listAttention())
		session.out.rows(['row', 'kind', 'tally', 'counterparty', 'amount', 'waitingOn', 'waitingDays'], items.map((item, i) => ({
			row: i + 1,
			kind: item.kind,
			tally: item.tallyId,
			counterparty: item.counterparty.name,
			amount: item.amount ? formatAmount(item.amount.units, item.amount) : undefined,
			waitingOn: item.waitingOn,
			waitingDays: item.waitingDays,
		})))
	},
}

const watch: Command = {
	name: 'watch',
	noArgs: true,
	summary: 'Follow: print each tally that changes, until Ctrl-C',
	usage: '',
	async run(session) {
		session.out.note('watching; Ctrl-C to stop')
		let seen = new Map((await session.tallies()).map(tally => [tally.id, signature(tally)]))
		let pending = Promise.resolve()
		const report = async () => {
			const now = await session.tallies()
			const changed = now.filter(tally => seen.get(tally.id) !== signature(tally))
			seen = new Map(now.map(tally => [tally.id, signature(tally)]))
			if (changed.length) session.out.rows(TALLY_COLUMNS, changed.map(tally => tallyRow(tally)))
		}
		const unsubscribe = onWorldChanged(() => {
			pending = pending.then(report).catch((error: unknown) => session.out.note(`watch: ${(error as Error).message}`))
		})
		try {
			await untilAborted(session.signal)
		} finally {
			unsubscribe()
			await pending
		}
	},
}

/** What makes a tally row worth printing again. */
function signature(tally: TallySummary): string {
	return JSON.stringify(tallyRow(tally))
}

export function untilAborted(signal: AbortSignal): Promise<void> {
	return new Promise(resolve => {
		if (signal.aborted) resolve()
		signal.addEventListener('abort', () => resolve(), { once: true })
	})
}

const STATES = ['Invited', 'Forming', 'Offered', 'Open', 'Closing', 'Closed', 'Expired'] as const

const wait: Command = {
	name: 'wait',
	summary: 'Wait until a tally reaches a state (for scripts): wait Open',
	usage: `<${STATES.join('|')}> [--tally <tally>] [--timeout <seconds>]`,
	options: { tally: { type: 'string' }, timeout: { type: 'string' } },
	async run(session, args, values) {
		const state = usage(wait, () => {
			const wanted = need(wait, args, 0, 'state')
			const found = STATES.find(known => known.toLowerCase() === wanted.toLowerCase())
			if (!found) throw new Error(`states are ${STATES.join(', ')}`)
			return found
		})
		const seconds = usage(wait, () => {
			const n = Number(text(values, 'timeout') ?? 600)
			if (!Number.isFinite(n) || n <= 0) throw new Error('--timeout takes seconds')
			return n
		})
		const only = text(values, 'tally')
		const deadline = Date.now() + seconds * 1000
		const started = Date.now()
		for (;;) {
			const list = await session.tallies()
			const candidates = only === undefined ? list : [await session.tally(only)]
			const reached = candidates.find(tally => tallyRow(tally).state === state)
			if (reached) {
				await session.rememberTallies(list.map(tally => tally.id))
				session.out.note(`${state} after ${((Date.now() - started) / 1000).toFixed(1)} s`)
				session.out.rows(TALLY_COLUMNS, [tallyRow(reached, list.indexOf(reached) + 1)])
				return
			}
			if (Date.now() >= deadline) throw new CliFailure(`wait: no tally reached ${state} in ${seconds} s`, EXIT.retryable)
			if (session.signal.aborted) throw new CliFailure('wait: interrupted', EXIT.interrupted)
			await new Promise(resolve => setTimeout(resolve, 1000))
		}
	},
}

export const tallyCommands = [tallies, tally, history, attention, watch, wait]
