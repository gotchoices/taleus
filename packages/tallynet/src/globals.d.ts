/**
 * The few standard globals this package uses, declared narrowly.
 *
 * Every target has them -- Hermes/React Native, browsers, Node -- but they live in
 * TypeScript's DOM and Node type libraries, and pulling in either would let code reach for
 * `document` or `Buffer` and still typecheck. The platform-neutral build (`tsconfig.build.json`,
 * `types: []`) includes neither, so these plus the timer globals declared in `clock.ts` are the
 * whole of what TallyNet's runtime may assume. The timer globals (`setTimeout`/`clearTimeout`) live
 * in `clock.ts` instead of here, because it is the one file allowed to use them (see
 * `no-node-globals.test.ts`). See docs/design.md § Scope and boundaries (platform-neutral).
 */
declare class TextEncoder {
	encode(input?: string): Uint8Array
}
declare class TextDecoder {
	decode(input?: Uint8Array): string
}
declare function btoa(data: string): string
declare function atob(data: string): string
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T }
declare const console: { error(...args: unknown[]): void }

/**
 * The slice of the DOM/Node `AbortSignal` TallyNet's sequencing uses. Narrowed to the three
 * members it touches so the platform-neutral build needs neither the DOM nor the Node lib.
 */
interface AbortSignal {
	readonly aborted: boolean
	addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void
	removeEventListener(type: 'abort', listener: () => void): void
}
