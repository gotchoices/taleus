/** Dates are shown in the reader's locale and their own zone. */
export function formatDate(iso: string, locale = 'en'): string {
	return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))
}

export function formatDateTime(iso: string, locale = 'en'): string {
	return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}
