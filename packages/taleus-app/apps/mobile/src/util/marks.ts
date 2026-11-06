import type { Delivery } from '../data/types'

export interface ActMark {
	/** Its string, under `marks.<key>`, with a longer `marks.<key>-note`. */
	key: 'waiting' | 'sending' | 'here-only' | 'unconfirmed' | 'may-fail' | 'dated-ahead'
	urgent?: true
}

/** What any of the party's acts -- an entry, a request, a refusal, a close request -- may say. */
export interface Marked {
	delivery?: Delivery
	mayFail?: true
	datedAhead?: true
}

/**
 * What an act says about where it stands, beyond what it records (story 15; story 24 path F):
 * the party's own act on its way to the counterparty, and an entry dated ahead of this device's
 * clock. A delivered act says nothing; that is the normal case. A refused one has left the record
 * and is listed apart (TallyView's "Not recorded").
 */
export function actMarks(act: Marked): ActMark[] {
	const marks: ActMark[] = []
	const delivery = act.delivery
	if (delivery && delivery !== 'delivered' && delivery !== 'not-recorded') marks.push({ key: delivery })
	if (act.mayFail) marks.push({ key: 'may-fail', urgent: true })
	if (act.datedAhead) marks.push({ key: 'dated-ahead', urgent: true })
	return marks
}
