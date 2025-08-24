# Taleus Architecture

This document describes the Taleus library modules and how to interact with them. It is intentionally concise and focused on the current implementation plan.

## Naming note: "Bootstrap"
- libp2p also uses the term "bootstrap" for peer discovery. To avoid confusion, our bootstrap components refer to starting a tally negotiation between two parties.

## Module overview

- **Bootstrap Components** (this document focuses here)
  - `SessionManager` - Orchestrates bootstrap sessions and manages resources
  - `ListenerSession` - Handles incoming bootstrap requests (passive role)  
  - `DialerSession` - Initiates outgoing bootstrap requests (active role)
  - Establishes shared databases for tally negotiation using Method 6 protocol (see `doc/bootstrap.md`)

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

## Bootstrap Components

### SessionManager
**Purpose**: Orchestrates bootstrap sessions and manages concurrent operations.

**Constructor**:
```typescript
new SessionManager(hooks: SessionHooks, config?: SessionConfig)
```

**Key Methods**:
- `handleNewStream(stream)` - Process incoming bootstrap requests
- `initiateBootstrap(link, node)` - Start outgoing bootstrap requests
- `getActiveSessionCounts()` - Monitor concurrent sessions

### ListenerSession and DialerSession
**Purpose**: Handle individual bootstrap sessions with state machine architecture.

- **ListenerSession**: Processes incoming requests (passive role)
- **DialerSession**: Initiates outgoing requests (active role)

Both classes implement:
- Multi-level timeout protection
- Error isolation and cleanup
- State transition logging
- Resource management

### SessionHooks Interface
**Purpose**: Application integration points for policy and storage.

```typescript
interface SessionHooks {
  validateToken(token: string, sessionId: string): Promise<{valid: boolean, role: 'stock' | 'foil'}>
  validateIdentity(identity: any, sessionId: string): Promise<boolean>
  provisionDatabase(role: 'stock' | 'foil', partyA: string, partyB: string, sessionId: string): Promise<ProvisionResult>
  validateResponse(response: any, sessionId: string): Promise<boolean>
  validateDatabaseResult(result: any, sessionId: string): Promise<boolean>
}
```

### SessionConfig Interface
**Purpose**: Configure session behavior and limits.

```typescript
interface SessionConfig {
  sessionTimeoutMs: number        // Total session timeout
  stepTimeoutMs: number          // Individual step timeout  
  maxConcurrentSessions: number  // Resource limiting
  enableDebugLogging: boolean    // Development support
}
```

### BootstrapLink Structure
**Purpose**: Information needed to initiate bootstrap.

```typescript
type BootstrapLink = {
  responderPeerAddrs: string[]  // libp2p multiaddrs of listener nodes
  token: string                 // Application-specific tally intent
  tokenExpiryUtc: string       // Token expiration
  initiatorRole: 'stock' | 'foil'  // Role assignment
}
```

### ProvisionResult Type
**Purpose**: Result of successful bootstrap containing shared database access.

```typescript
interface ProvisionResult {
  tally: { tallyId: string; createdBy: 'stock' | 'foil' }
  dbConnectionInfo: { endpoint: string; credentialsRef: string }
}
```

### Component Integration
The bootstrap components use a session-based architecture with consumer-provided hooks for policy and storage integration. **For complete implementation details, examples, and best practices, see `doc/bootstrap.md`.**

---

## Other Components

The following components are designed but not yet implemented:

- **DatabaseProvisioner** (adapter) - Creates shared DB instances via Quereus/Optimystic
- **IdentityService** (placeholder) - Validates identity/certificate material
- **CadreManager** (placeholder) - Manages nominated nodes and 50/50 governance
- **TallyService** (placeholder) - Creates minimal draft tallies
- **CryptoService** (placeholder) - Signing, digest and verification utilities

Consensus and database behavior are handled by Quereus/Optimystic and are out of scope for this architecture.