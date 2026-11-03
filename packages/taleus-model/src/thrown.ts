/**
 * Any thrown value as text. An `Error` gives its message; anything else would read `[object Object]`
 * through `String()`, and on React Native a failed WebSocket rejects with an event object, not an
 * `Error`. Mirrors `@serfab/cadre-core`'s `describeThrown`, which this framework-free package cannot
 * depend on.
 */
export function describeThrown(value: unknown): string {
	if (value instanceof Error) return value.message
	if (typeof value === 'object' && value !== null) return describeObject(value as Record<string, unknown>)
	return String(value)
}

/** Its string `type`, `message` and `reason`, with any `code`; else its JSON, cut short. */
function describeObject(value: Record<string, unknown>): string {
	const parts = [value.type, value.message, value.reason].filter((part): part is string => typeof part === 'string' && part !== '')
	if (parts.length) return `${parts.join(': ')}${value.code !== undefined ? ` (code ${String(value.code)})` : ''}`
	try {
		return JSON.stringify(value).slice(0, 500)
	} catch {
		return String(value)
	}
}
