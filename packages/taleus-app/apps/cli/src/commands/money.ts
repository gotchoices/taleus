/** Moving value: `pay`, `request`, `requests`, `decline`. */
import { randomUUID } from 'node:crypto'

import { formatAmount, parseAmount } from '../amount.ts'
import { CliFailure, EXIT, type Session } from '../session.ts'
import { need, text, usage, type Command } from './command.ts'

const pay: Command = {
	name: 'pay',
	summary: 'Record value given to the partner on a tally: pay 2 12.50 lunch',
	usage: '<tally> <amount> [--answers <request>] [<memo...>]',
	options: { answers: { type: 'string' } },
	async run(session, args, values) {
		const { id, unit } = await session.tally(need(pay, args, 0, 'tally'))
		const amount = usage(pay, () => parseAmount(need(pay, args, 1, 'amount'), unit))
		const memo = args.slice(2).join(' ').trim()
		const answering = text(values, 'answers')
		const answers = answering === undefined ? undefined : [await requestId(session, answering)]
		// One act id per command: the model makes a retried act safe by it.
		const entry = session.unwrap(await session.party.model.entries.recordEntry(id, {
			actId: `act:${randomUUID()}`,
			amount,
			...(memo ? { memo } : {}),
			...(answers ? { answers } : {}),
		}))
		session.out.rows(['id', 'date', 'issuer', 'amount', 'balanceAfter', 'memo'], [{
			id: entry.id,
			date: entry.date,
			issuer: entry.issuer,
			amount: formatAmount(entry.amount.units, unit),
			balanceAfter: `${formatAmount(entry.balanceAfter.units, unit)} ${entry.balanceAfter.perspective}`,
			memo: entry.memo,
		}])
	},
}

const REQUEST_COLUMNS = ['row', 'id', 'tally', 'direction', 'amount', 'stillAsked', 'state', 'memo'] as const

const request: Command = {
	name: 'request',
	summary: 'Ask the partner on a tally to pay: request 2 40 "March hours"',
	usage: '<tally> <amount> [<memo...>]',
	async run(session, args) {
		const { id, unit } = await session.tally(need(request, args, 0, 'tally'))
		const amount = usage(request, () => parseAmount(need(request, args, 1, 'amount'), unit))
		const memo = args.slice(2).join(' ').trim()
		const made = session.unwrap(await session.party.model.requests.createRequest(id, { amount, ...(memo ? { memo } : {}) }))
		session.out.rows(REQUEST_COLUMNS, [{
			id: made.id,
			tally: made.tallyId,
			direction: made.direction,
			amount: formatAmount(made.amount.units, unit),
			stillAsked: formatAmount(made.stillAsked.units, unit),
			state: made.state,
			memo: made.memo,
		}])
	},
}

const requests: Command = {
	name: 'requests',
	summary: 'Requests to pay, on one tally or all',
	usage: '[<tally>]',
	async run(session, args) {
		const tallies = await session.tallies()
		const only = args[0] === undefined ? undefined : await session.tally(args[0])
		const list = session.unwrap(await session.party.model.requests.listRequests(only?.id))
		const unitOf = (tallyId: string) => tallies.find(tally => tally.id === tallyId)?.unit
		session.out.rows(REQUEST_COLUMNS, list.map((item, i) => {
			const unit = unitOf(item.tallyId)
			const money = (units: number) => (unit ? formatAmount(units, unit) : String(units))
			return {
				row: i + 1,
				id: item.id,
				tally: item.tallyId,
				direction: item.direction,
				amount: money(item.amount.units),
				stillAsked: money(item.stillAsked.units),
				state: item.state,
				memo: item.memo,
			}
		}))
	},
}

const decline: Command = {
	name: 'decline',
	summary: 'Decline a request to pay: decline 1 "not this month"',
	usage: '<request> [<why...>]',
	async run(session, args) {
		const id = await requestId(session, need(decline, args, 0, 'request'))
		const why = args.slice(1).join(' ').trim()
		const declined = session.unwrap(await session.party.model.requests.declineRequest(id, why || undefined))
		session.out.rows(['id', 'state'], [{ id: declined.id, state: declined.state }])
	},
}

/** A request named by its id, or by its row in `requests` (all tallies, the same order). */
async function requestId(session: Session, ref: string): Promise<string> {
	if (!/^\d+$/.test(ref)) return ref
	const list = session.unwrap(await session.party.model.requests.listRequests())
	const found = list[Number(ref) - 1]
	if (!found) throw new CliFailure(`no request at row ${ref} (there are ${list.length})`, EXIT.notFound)
	return found.id
}

export const moneyCommands = [pay, request, requests, decline]
