/** Making and answering invitations, and agreeing terms: `agreements`, `invite`, `invites`, `accept`, `offer`. */
import { buildInviteLink, inviteToken, type Unit } from 'taleus-model'
import { DEFAULT_NOTICE_DAYS, type Agreement } from 'taleus-model/invitations'
import { writeFile } from 'node:fs/promises'

import { codeOf, formatAmount, parseAmount, UNITS } from '../amount.ts'
import { CliFailure, EXIT, UsageError, type Session } from '../session.ts'
import { need, text, usage, type Command } from './command.ts'

const VALID_DAYS: Record<string, number> = { day: 1, week: 7, month: 30 }

const agreements: Command = {
	name: 'agreements',
	noArgs: true,
	summary: 'The agreements this party can offer, from its trusted publishers',
	usage: '',
	async run(session) {
		const list = session.unwrap(await session.party.model.invitations.listAgreements())
		session.out.rows(['row', 'id', 'title', 'publisher'], list.map((agreement, i) => ({
			row: i + 1,
			id: agreement.id,
			title: agreement.title,
			publisher: agreement.publisher,
		})))
	},
}

const invite: Command = {
	name: 'invite',
	summary: 'Make an invitation to a new tally, and print its link',
	usage: '[--limit <amount>] [--notice <days>] [--unit USD|CHIP] [--agreement <row|id>] [--valid day|week|month] [--note <text>] [-o <file>]',
	options: {
		limit: { type: 'string' },
		notice: { type: 'string' },
		unit: { type: 'string' },
		agreement: { type: 'string' },
		valid: { type: 'string' },
		note: { type: 'string' },
		o: { type: 'string', short: 'o' },
	},
	noArgs: true,
	async run(session, _args, values) {
		await needIdentity(session)
		const unit = usage(invite, () => unitOf(text(values, 'unit') ?? 'USD'))
		const creditLimit = usage(invite, () => parseAmount(text(values, 'limit') ?? '0', unit))
		const noticeDays = usage(invite, () => days(text(values, 'notice')))
		const goodForDays = usage(invite, () => validity(text(values, 'valid') ?? 'week'))
		const agreement = await agreementFor(session, text(values, 'agreement'))
		session.out.note(`making an invitation under ${agreement.title} (${agreement.publisher})…`)
		const made = session.unwrap(await session.party.model.invitations.createInvitation({
			unit,
			creditLimit,
			noticeDays,
			agreementId: agreement.id,
			goodForDays,
			...(text(values, 'note') ? { note: text(values, 'note') } : {}),
		}))
		const link = buildInviteLink(made.token)
		const file = text(values, 'o')
		// Whoever holds the link can take up the invitation: owner-only.
		if (file) await writeFile(file, `${link}\n`, { mode: 0o600 })
		session.out.rows(['token', 'link', 'expires'], [{ token: made.token, link, expires: made.expires }])
	},
}

const invites: Command = {
	name: 'invites',
	noArgs: true,
	summary: 'The invitations this party has made',
	usage: '',
	async run(session) {
		const list = session.unwrap(await session.party.model.invitations.listInvitations())
		session.out.rows(['row', 'token', 'note', 'state', 'limit', 'notice', 'expires'], list.map((made, i) => ({
			row: i + 1,
			token: made.token,
			note: made.note,
			state: made.state,
			limit: formatAmount(made.creditLimit.units, made.unit),
			notice: made.noticeDays,
			expires: made.expires,
		})))
	},
}

const accept: Command = {
	name: 'accept',
	summary: 'Take up an invitation: show who invites and on what terms, then accept',
	usage: '<link|token> [--limit <amount>] [--notice <days>] [--yes]',
	options: {
		limit: { type: 'string' },
		notice: { type: 'string' },
		yes: { type: 'boolean', short: 'y' },
	},
	async run(session, args, values) {
		const me = await needIdentity(session)
		const given = need(accept, args, 0, 'the invitation link or token')
		const token = inviteToken(given) ?? given.trim()
		const offered = session.unwrap(await session.party.model.invitations.readInvitation(token))
		const creditLimit = usage(accept, () => parseAmount(text(values, 'limit') ?? '0', offered.unit))
		const noticeDays = usage(accept, () => days(text(values, 'notice')))
		session.out.note([
			`${offered.inviter.disclosed?.name ?? offered.inviter.sid} invites you to a tally in ${codeOf(offered.unit)}, under ${offered.agreement.title} (${offered.agreement.publisher}).`,
			`  They would let you owe them up to ${formatAmount(offered.theirCreditLimit.units, offered.unit)}, with ${offered.theirNoticeDays} days' notice.`,
			`  You would let them owe you up to ${formatAmount(creditLimit.units, offered.unit)}, with ${noticeDays} days' notice.`,
			`  They will see your name, ${me.displayName}. The invitation expires ${offered.expires}.`,
		].join('\n'))
		if (offered.state !== 'outstanding') throw new CliFailure(`accept: this invitation is ${offered.state}`, EXIT.failed)
		if (!values.yes) {
			if (!session.interactive) throw new UsageError('accept: nobody is here to confirm; add --yes')
			if (!(await session.confirm('Accept?'))) return
		}
		const disclose = Object.fromEntries(offered.asks.filter(ask => ask.field === 'name').map(ask => [ask.field, me.displayName]))
		const answer = session.unwrap(await session.party.model.invitations.respondToInvitation(token, 'accept', { disclose, creditLimit, noticeDays }))
		session.out.rows(['answer'], [{ answer }])
	},
}

const offer: Command = {
	name: 'offer',
	summary: 'Show the terms proposed on a tally, or accept them',
	usage: '<tally> [accept]',
	async run(session, args) {
		const { id, unit } = await session.tally(need(offer, args, 0, 'tally'))
		if (args[1] !== undefined && args[1] !== 'accept') throw new UsageError(`usage: offer ${offer.usage}`)
		const proposal = session.unwrap(await session.party.model.offers.readOffer(id))
		if (!proposal) throw new CliFailure('offer: nothing is proposed on this tally', EXIT.failed)
		if (args[1] === 'accept') {
			session.out.rows(['answer'], [{ answer: session.unwrap(await session.party.model.offers.respondToOffer(id, 'accept')) }])
			return
		}
		const { mine, theirs } = proposal.proposed
		session.out.pairs([
			['waitingOn', proposal.waitingOn],
			['myLimit', formatAmount(mine.creditLimit.units, unit)],
			['myNotice', mine.noticeDays],
			['theirLimit', formatAmount(theirs.creditLimit.units, unit)],
			['theirNotice', theirs.noticeDays],
			['agreement', proposal.agreement.title],
		])
	},
}

/** This party, which must have its identity and name before acting on tallies. */
async function needIdentity(session: Session) {
	const me = session.unwrap(await session.party.model.party.readParty())
	if (!me?.displayName) throw new CliFailure('this party has no name yet: "party name <name>" first', EXIT.failed)
	return me
}

async function agreementFor(session: Session, ref: string | undefined): Promise<Agreement> {
	const list = session.unwrap(await session.party.model.invitations.listAgreements())
	if (!list.length) throw new CliFailure('no agreement to offer: none of this party\'s trusted publishers could be read', EXIT.retryable)
	if (ref === undefined) return list[0]
	const found = /^\d+$/.test(ref) ? list[Number(ref) - 1] : list.find(agreement => agreement.id === ref)
	if (!found) throw new UsageError(`invite: no agreement ${JSON.stringify(ref)}; "agreements" lists them`)
	return found
}

function unitOf(code: string): Unit {
	const unit = UNITS[code.toUpperCase()]
	if (!unit) throw new Error(`units are ${Object.keys(UNITS).join(', ')}`)
	return unit
}

function days(given: string | undefined): number {
	if (given === undefined) return DEFAULT_NOTICE_DAYS
	const n = Number(given)
	if (!Number.isInteger(n) || n < 0) throw new Error('notice is a whole number of days')
	return n
}

function validity(given: string): number {
	const n = VALID_DAYS[given]
	if (n === undefined) throw new Error(`--valid is ${Object.keys(VALID_DAYS).join(', ')}`)
	return n
}

export const inviteCommands = [agreements, invite, invites, accept, offer]
