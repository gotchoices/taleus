// The consumer surface. `API.md` is the argument for its shape; `SPEC.md` § 1 the rule it
// answers to. Nothing from `src/store/` or `src/tally/` is exported here -- those speak the
// schema's language and stay below the seam.
export * from './api/index.js'

export * from './crypto/index.js'
export * from './lift/index.js'
export * from './transport/index.js'
