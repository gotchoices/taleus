/**
 * The few standard globals this package uses, declared narrowly.
 *
 * Every target has them -- Hermes, browsers, Node -- but they live in TypeScript's DOM and Node
 * type libraries, and pulling in either would let code reach for `document` or `Buffer` and still
 * typecheck. So the build includes neither, and these are the whole of what it may assume.
 */
declare class TextEncoder {
	encode(input?: string): Uint8Array
}
declare class TextDecoder {
	decode(input?: Uint8Array): string
}
declare function btoa(data: string): string
declare function atob(data: string): string
declare const console: { warn(...data: unknown[]): void }
