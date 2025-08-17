# Taleus Architecture

This document describes the Taleus library modules and how to interact with them. It is intentionally concise and focused on the current implementation plan.

## Naming note: "Bootstrap"
- libp2p also uses the term "bootstrap" for peer discovery. To avoid confusion, our module is named `TallyBootstrap` and refers to starting a tally negotiation between two parties.

## Module overview

- `TallyBootstrap` (this document focuses here)
  - Establishes a tally negotiation using libp2p messages (see `doc/design/bootstrap.md`, Method 6)
  - Exposes APIs for the passive initiator (“listener”) and the active respondent

- `DatabaseProvisioner` (adapter)
  - Single-purpose abstraction that will create a new shared DB instance and return access details
  - Implemented later via Quereus/Optimystic

- `IdentityService` (placeholder)
  - Validates identity/certificate material supplied during bootstrap

- `CadreManager` (placeholder)
  - Manages nominated nodes and enforces 50/50 governance membership

- `TallyService` (placeholder)
  - Creates the minimal draft tally that enables negotiation to begin

- `CryptoService` (placeholder)
  - Centralized signing, digest and verification utilities

Consensus and database behavior are handled by Quereus/Optimystic and are out of scope here.

## TallyBootstrap

### Protocol
- Uses a dedicated libp2p protocol ID: `/taleus/bootstrap/1.0.0`

### Constructor
```
new TallyBootstrap(hooks: Hooks)
```

Where `Hooks` interface includes:
```
interface Hooks {
  getTokenInfo: (token: string) => Promise<TokenInfo | null>
  validateIdentity?: (identityBundle: unknown, identityRequirements?: unknown) => Promise<boolean>
  markTokenUsed?: (token: string, context?: unknown) => Promise<void>
  provisionDatabase: (createdBy: PartyRole, initiatorPeerId: string, respondentPeerId: string) => Promise<ProvisionResult>
  recordProvisioning?: (idempotencyKey: string, result: ProvisionResult) => Promise<void>
  getProvisioning?: (idempotencyKey: string) => Promise<ProvisionResult | null>
}
```

### Types (simplified)
```
type PartyRole = 'stock' | 'foil'

interface BootstrapLinkPayload {
  responderPeerAddrs: string[]
  token: string
  tokenExpiryUtc: string
  initiatorRole: PartyRole
  identityRequirements?: string
}

interface ProvisionResult {
  tally: { tallyId: string; createdBy: PartyRole }
  dbConnectionInfo: { endpoint: string; credentialsRef: string }
}
```

### Public API
- `registerPassiveListener(peer: Libp2p, options: RegisterOptions): () => void`
  - Registers the libp2p protocol handler for inbound bootstrap messages
  - Returns an unregister function to remove the handler
  - `RegisterOptions`: `{ role: PartyRole; getParticipatingCadrePeerAddrs?: () => Promise<string[]> | string[] }`

- `initiateFromLink(link: BootstrapLinkPayload, peer: Libp2p, args?: { identityBundle?: unknown; idempotencyKey?: string }): Promise<ProvisionResult | { approved: false; reason: string }>`
  - Active (respondent) entrypoint: dials one of `link.responderPeerAddrs`, presents token and identity, and completes Method 6 flow
  - If `link.initiatorRole === 'foil'`, the respondent will provision the DB and return access details
  - If `link.initiatorRole === 'stock'`, the initiator will provision and return access details

### Consumer-provided hooks (integration surface)
Taleus does not manage token storage or business policy. The application provides hooks used by `TallyBootstrap`:

- `getTokenInfo(token) → Promise<{ initiatorRole: 'stock'|'foil'; expiryUtc: string; identityRequirements?: unknown } | null>`
  - Determines token validity and role; returns null for invalid tokens
- `validateIdentity(identityBundle, identityRequirements) → Promise<boolean>` (optional)
  - Verifies respondent identity against app policy
- `markTokenUsed(token, context) → Promise<void>` (optional)
  - Enables one-time token consumption and auditing
- `provisionDatabase(createdBy, initiatorPeerId, respondentPeerId) → Promise<ProvisionResult>`
  - Creates the shared DB and returns access info (to be implemented via Quereus/Optimystic)
- `recordProvisioning(idempotencyKey, result) / getProvisioning(idempotencyKey)` (optional)
  - Supports idempotent retries without repeated side effects

### Idempotency and state
- Requests should include an `idempotencyKey` so repeated calls can return prior results
- Service is mostly stateless; minimal persistence for idempotency mapping is recommended

### Opaque application payloads
- During bootstrap, Taleus treats identity bundles, certificates, and proposed tally terms as opaque application data
- Validation and policy decisions for these payloads are performed via consumer-provided hooks; Taleus does not enforce structure or semantics here

## Usage

### Passive initiator (A)
```
import { createLibp2p } from 'libp2p'
import { TallyBootstrap } from 'taleus/src/tallyBootstrap'

const node = await createLibp2p({ /* transports, encrypters, muxers */ })
await node.start()

const bootstrap = new TallyBootstrap({
  getTokenInfo: async (token) => ({ initiatorRole: 'stock', expiryUtc: '...', identityRequirements: null }),
  provisionDatabase: async (createdBy, initiatorPeerId, respondentPeerId) => ({ /* provision result */ }),
  // ... other hooks
})
const unregister = bootstrap.registerPassiveListener(node, {
  role: 'stock'
})

// later: unregister() to remove the protocol handler
```

### Active respondent (B)
```
import { createLibp2p } from 'libp2p'
import { TallyBootstrap } from 'taleus/src/tallyBootstrap'

const node = await createLibp2p({ /* transports, encrypters, muxers */ })
await node.start()

const bootstrap = new TallyBootstrap({
  getTokenInfo: async (token) => ({ initiatorRole: 'foil', expiryUtc: '...', identityRequirements: null }),
  provisionDatabase: async (createdBy, initiatorPeerId, respondentPeerId) => ({ /* provision result */ }),
  // ... other hooks
})

const link: BootstrapLinkPayload = {
  responderPeerAddrs: ["/ip4/127.0.0.1/tcp/34001/p2p/..."],
  token: 'multi-use-qr',
  tokenExpiryUtc: new Date(Date.now() + 10 * 60_000).toISOString(),
  initiatorRole: 'foil'
}

const result = await bootstrap.initiateFromLink(link, node)
// result contains dbConnectionInfo and tally metadata or an approval failure reason
```

## Other modules (brief)
- `IdentityService`: TBD – interface for verifying identity requirements (currently handled via hooks)
- `CadreManager`: TBD – interface for disclosing/accepting cadre nodes (currently handled via hooks)
- `TallyService`: TBD – interface for creating the minimal draft tally (currently handled via hooks)
- `DatabaseProvisioner`: TBD – implemented when Quereus/Optimystic are available (currently handled via hooks)

This document will be expanded as each module’s concrete interfaces are finalized.