/**
 * The few standard globals this package's neutral core uses, declared narrowly.
 *
 * Every target has `TextEncoder` — Hermes/React Native, browsers, Node — but it lives in TypeScript's
 * DOM and Node type libraries, and pulling in either would let code reach for `document` or `Buffer`
 * and still typecheck. The platform-neutral build (`tsconfig.build.json`, `types: []`, `lib: ES2022`)
 * includes neither, so this declaration is the whole of what TallySim's neutral runtime may assume
 * beyond ES2022. Mirrors `tallynet/src/globals.d.ts`. See `no-node-globals.test.ts`.
 */
declare class TextEncoder {
	encode(input?: string): Uint8Array
}
