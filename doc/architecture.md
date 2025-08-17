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

## Technical Implementation Details

### Stream Usage Patterns

Our libp2p protocol implementation uses specific stream patterns optimized for simple request-response flows:

#### Single-Request-Response Pattern
```typescript
// Most common: B dials A, sends request, reads response, closes
const stream = await peer.dialProtocol(maddr, BOOTSTRAP_PROTOCOL)
await writeJson(stream, request, false) // false = don't close, expect response
const response = await readJson(stream)
```

#### Fire-and-Forget Pattern  
```typescript
// Less common: B sends notification to A, no response expected
const stream = await peer.dialProtocol(maddr, BOOTSTRAP_PROTOCOL)
await writeJson(stream, notification, true) // true = close immediately
```

#### Fresh Streams Per Operation
We create new streams for each logical operation rather than multiplexing:

**Advantages:**
- Simpler state management (no stream reuse complexity)
- Clear error boundaries (stream failure affects only one operation)
- Easier debugging (one operation = one stream = one log trace)
- Natural idempotency (each retry gets fresh state)

**Tradeoffs:**
- Slightly higher connection overhead vs. stream reuse
- More TCP handshakes for complex multi-step flows
- Cannot leverage stream-level backpressure for large payloads

### Stream Closure Semantics

#### Half-Close Strategy
```typescript
await stream.closeWrite() // Signal "I'm done writing" 
// Other peer can still send response before closing their side
```

We use half-close (`closeWrite()`) rather than full close to:
- Allow response after request in request-response pattern
- Signal completion without terminating bidirectional capability
- Follow standard TCP half-close semantics

#### "Ended Pushable" Prevention
```typescript
if (req.type === 'provisioningResult') {
  // Dialer may have closed write side; avoid responding to prevent errors
  return
}
```

**The Problem:** When B sends `provisioningResult` and immediately closes its write side, A's attempt to acknowledge creates "Cannot push value onto an ended pushable" errors.

**Our Solution:** Fire-and-forget semantics for `provisioningResult` - A receives but doesn't acknowledge.

### Performance Characteristics

#### Message Size Assumptions
- **Small JSON payloads**: Typically < 1KB (tokens, peer addresses, minimal tally info)
- **Single-buffer reads**: No streaming JSON parser needed
- **Memory efficient**: Complete message fits in memory, no backpressure concerns

#### Connection Reuse
- **libp2p connection pooling**: Underlying TCP connections are reused automatically
- **Fresh streams**: New stream per operation, but same underlying connection
- **No connection management**: libp2p handles connection lifecycle

#### Error Recovery
- **Stream-level failures**: Retry creates fresh stream automatically
- **No persistent state**: Each stream is independent, simplifying error handling
- **Idempotency support**: `idempotencyKey` allows safe retries without side effects

### Protocol Evolution Considerations

#### Adding New Message Types
```typescript
if (req.type === 'newMessageType') {
  // Handle new type
} else if (req.type === 'existingType') {
  // Existing logic
} else {
  await writeJson(stream, { approved: false, reason: 'unknown_type' })
}
```

#### Version Compatibility
- Protocol ID includes version: `/taleus/bootstrap/1.0.0`
- New versions would use different protocol IDs
- Peers can register multiple protocol versions simultaneously

#### Error Handling Extensions
- Standardized error response format: `{ approved: false, reason: string }`
- Extensible via additional error fields
- Consumer hooks can provide application-specific error context

This document will be expanded as each module's concrete interfaces are finalized.