/**
 * The four seeded network generators, their params types, and their stable `meta.generator` ids. Each
 * generator is `(params, rng?) => Network`; `rng` defaults to a fresh {@link SeededRandom} seeded from
 * `params.seed`, so `same seed ⇒ byte-identical Network`. See `docs/design.md` § Generators.
 */

export { type GeneratorParamsBase } from './shared.js'
export { uniform, type UniformParams, UNIFORM_ID } from './uniform.js'
export { scaleFree, type ScaleFreeParams, SCALE_FREE_ID } from './scale-free.js'
export { clustered, type ClusteredParams, CLUSTERED_ID } from './clustered.js'
export { smallWorld, type SmallWorldParams, SMALL_WORLD_ID } from './small-world.js'
