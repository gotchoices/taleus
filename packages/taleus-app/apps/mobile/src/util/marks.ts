import type { Entry } from '../data/entries'

export interface EntryMark {
	/** Its string, under `marks.<key>`, with a longer `marks.<key>-note`. */
	key: 'waiting' | 'sending' | 'here-only' | 'unconfirmed' | 'may-fail' | 'dated-ahead'
	urgent?: true
}

/**
 * What an entry says about where it stands, beyond what it records (story 20 path D, story 24
 * path F): the party's own entry on its way to the counterparty, and an entry dated ahead of this
 * device's clock. A delivered entry says nothing; that is the normal case.
 */
export function entryMarks(entry: Entry): EntryMark[] {
	const marks: EntryMark[] = []
	const delivery = entry.delivery
	if (delivery && delivery !== 'delivered' && delivery !== 'not-recorded') marks.push({ key: delivery })
	if (entry.mayFail) marks.push({ key: 'may-fail', urgent: true })
	if (entry.datedAhead) marks.push({ key: 'dated-ahead', urgent: true })
	return marks
}
