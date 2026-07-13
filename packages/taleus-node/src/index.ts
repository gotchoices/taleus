/**
 * taleus-node — the always-on Taleus trading service.
 *
 * Role: a headless process that runs a party's lift agent and serves the
 * `/taleus/chipnet/1.0.0` endpoint continuously. It is the node-resident
 * extension the architecture calls for (the always-on member of the cadre
 * that MyCHIPs site servers used to be).
 *
 * Deployment stance (v1): this service runs as a **client of the party's
 * Sereus cadre**, not as an embedded cadre plugin. It connects to a running
 * cadre node to read/write the tally and portfolio strands, and it opens the
 * ChipNet transport to counterparties itself. Folding the agent into the
 * cadre process as a Sereus plugin is deferred (see the tickets); keeping it
 * a separate client keeps Taleus from depending on a plugin runtime Sereus
 * does not yet expose.
 *
 * This is a scaffolding stub. The wiring lands with `feat-taleus-node-service`.
 * It depends on the `taleus` library (lift agent, ChipNet transport, schema)
 * and will import from it once the service is implemented.
 */

export interface TaleusNodeConfig {
	/** Address of the local cadre node this service is a client of. */
	cadreEndpoint: string
}

export interface TaleusNodeService {
	start(): Promise<void>
	stop(): Promise<void>
}

export function createTaleusNode(_config: TaleusNodeConfig): TaleusNodeService {
	throw new Error('taleus-node not implemented yet — see feat-taleus-node-service')
}
