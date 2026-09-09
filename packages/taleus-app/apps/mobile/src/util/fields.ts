import { t } from '../i18n'

/**
 * The fields a party can hold about themselves and read about others.
 *
 * A fixed vocabulary rather than free text, so that "you have no address for
 * them" is a thing the app can say at all — an absence is only visible against
 * a list of what could have been there (story 11 path E). The engine will
 * eventually own this list; until then both directions read it from here, which
 * is what keeps `sent` and `received` comparable.
 */
export const knownFields = ['name', 'phone', 'email', 'address', 'business', 'taxId'] as const

export type FieldKey = (typeof knownFields)[number]

/** A field's name as a heading — "Business name". */
export function fieldLabel(key: string): string {
	return t(`field.${key}`)
}

/**
 * A field's name inside a sentence — "their business name". A separate string
 * rather than a lowercased label: which words a language capitalises mid-
 * sentence is the language's business, not a transformation this app can make.
 */
export function fieldInline(key: string): string {
	return t(`field-inline.${key}`)
}

/** "name, phone number and address" — a list a person would read aloud. */
export function fieldList(keys: string[]): string {
	const labels = keys.map(fieldInline)
	if (labels.length <= 1) {
		return labels.join('')
	}
	const last = labels[labels.length - 1]
	return `${labels.slice(0, -1).join(', ')} ${t('common.and')} ${last}`
}
