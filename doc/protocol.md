# Taleus Protocol Description

This document defines the protocol by which nodes in a Taleus network communicate with each other to establish, maintain, and operate tallies.

## Protocol Overview

The Taleus protocol consists of several interconnected layers:

1. **Application Layer (Taleus)**: Manages tallies and credit relationships
2. **Database Layer (Quereus)**: Provides SQL query parsing and database operations
3. **Optimistic Layer (Optimystic)**: Implements optimistic database operations
4. **DHT Layer (Kademlia)**: Provides distributed hash table functionality
5. **Network Layer (libp2p)**: Handles peer discovery and communication

This document focuses primarily on the application-level protocols (Tally, Transaction, and Consensus layers) rather than the underlying network transport protocols.

### Node Management

The protocol implements a balanced node management approach:

- Each party nominates trusted nodes to participate in tally management
- The nominated nodes form a network with equal voting power (50/50 split)
- This ensures that neither party can unilaterally control the consensus
- In case of disputes, parties maintain local copies of critical records


## Shared Database Protocol

Taleus implements a shared database protocol that evolves from the original MyCHIPs design:

### Protocol Characteristics

- Parties maintain shared records in a distributed database hosted by nominated nodes
- Database is built atop Kademlia DHT using Optimystic and Quereus layers
- Uses mostly normalized SQL schema with JSON fields for flexibility
- Maintains stock/foil party nomenclature for MyCHIPs compatibility
- Consensus achieved through 50/50 voting power split between party-nominated nodes

### Database Operations

- **Record Creation**: Parties create signed records directly in the shared database
- **State Transitions**: Database triggers and constraints enforce valid state changes
- **Consensus**: All operations require agreement from both party groups (50/50 voting)
- **Integrity**: Cryptographic signatures validate all critical records
- **Dispute Resolution**: Parties maintain local copies of records protecting their interests

## State Processing

The Taleus protocol is implemented as a state transition model, with state changes managed through the shared database:

- Nodes may go offline at any time
- Network connections may not always be reliable
- Database operations may be delayed or need retries

The system is designed to:
- Maintain a consistent state in the distributed database
- Handle concurrent updates through database-level consensus
- Recover from network partitions and node failures
- Ensure eventual consistency across all participants
- Provide real-time state synchronization when possible

## Tally Protocol Flow

### Tally Establishment

The steps to establish a tally follow this general sequence:

1. **Initiation**: Party A creates a tally proposal
2. **Proposal**: Party A sends the proposal to Party B
3. **Negotiation**: Party B may accept, reject, or counter-propose
4. **Agreement**: Both parties sign the tally
5. **Activation**: The tally becomes active for recording transactions

### Tally States

A tally can exist in several states:

- **draft**: Initial creation, local only
- **offer**: Proposed to partner, awaiting response
- **open**: Active tally, both parties have agreed
- **closing**: Marked for closing once balance reaches zero
- **closed**: Fully closed, no more transactions possible
- **void**: Rejected or abandoned

### Tally State Transitions

State transitions occur when:
1. A user requests a change (via an API call)
2. The system processes the request
3. The change is communicated to the other party
4. The other party acknowledges or rejects the change

Each transition includes validation rules to ensure proper state progression.

---

## Tally Bootstrap (Tally Initiation) Protocol

Naming note: libp2p also uses the term "bootstrap" for peer discovery. In Taleus, "bootstrap" refers to initiating a tally negotiation between two parties. The implementation module is named `TallyBootstrapService`.

### Goals and scope
- Establish a shared database and minimal draft tally so negotiation can begin
- Keep the network flow simple, idempotent, and mostly stateless on the Taleus side
- Delegate token storage/policy and provisioning side effects to consumer-provided hooks

Database consensus and subsequent tally negotiation are handled outside this protocol (by Quereus/Optimystic and the negotiation layer).

### libp2p protocol
- Protocol ID: `/taleus/bootstrap/1.0.0`
- Actors: Initiator (A) exposes a passive listener; Respondent (B) dials using a private link payload

### Roles and builder selection
- The invitation link declares the initiator role: `stock` or `foil`
  - `stock`: A provisions the shared DB on approval
  - `foil`: B provisions the shared DB on approval, then informs A

### Message shapes (conceptual)

1) InboundContact (B → A)
- Request fields:
  - `token`: string (opaque)
  - `partyId`: string (respondent identity)
  - `proposedCadrePeerAddrs`: string[] (B's nominated nodes)
  - `identityBundle?`: any (app-defined identity/certificate material)
  - `idempotencyKey?`: string (caller-set; used to deduplicate retries)
- Response fields:
  - `approved`: boolean
  - `reason?`: string (if rejected)
  - `participatingCadrePeerAddrs?`: string[] (disclosed on approval)
  - `provisionResult?`: { `tally`, `dbConnectionInfo` } (present if A=stock)

2) ProvisioningResult (B → A, only if A=foil)
- Request fields:
  - `idempotencyKey?`: string
  - `tally`: { `tallyId`: string, `createdBy`: 'foil' }
  - `dbConnectionInfo`: { `endpoint`: string, `credentialsRef`: string }
- Response fields: ack or error

All messages should be treated as idempotent by the service.

### Stateless by design
- No per-connection session state is required; each RPC carries complete inputs
- Minimal persistence is recommended for idempotency (mapping `idempotencyKey` → result)
- Token status (one-time vs multi-use) and usage tracking are handled by consumer hooks (see below)

### Consumer-provided hooks (integration surface)
Taleus does not manage token storage or business policy. Instead, the application provides hooks:

- `getTokenInfo(token) → { initiatorRole: 'stock'|'foil'; expiryUtc: string; identityRequirements?: any; /* app-defined */ }`
  - Determines if the token is valid and which role applies

- `validateIdentity(identityBundle, identityRequirements) → Promise<boolean>`
  - Verifies the respondent's identity against app policy

- `markTokenUsed(token, context) → Promise<void>` (optional; recommended for one-time tokens)
  - Lets the app enforce one-time consumption and audit usage

- `provisionDatabase(createdBy, initiatorPeerId, respondentPeerId) → Promise<{ tally, dbConnectionInfo }>`
  - Implemented via a `DatabaseProvisioner` adapter; creates the shared DB and returns access info

- `recordProvisioning(idempotencyKey, result) / getProvisioning(idempotencyKey)` (optional)
  - Enables idempotent retries to return prior results without side effects

### Service API (library shape)
- Passive initiator:
  - `registerPassiveListener(peer, { role, validateIdentity? })` → unregister function
  - Registers `/taleus/bootstrap/1.0.0` and handles InboundContact requests using the hooks

- Active respondent:
  - `initiateFromLink(link, peer)` → `ProvisionResult | { approved: false; reason: string }`
  - Dials one of `link.responderPeerAddrs`, presents token and identity, and follows the role-based flow

### Error handling and idempotency
- All requests should supply an `idempotencyKey` so repeated calls (network retries) can safely return prior results
- Errors should be explicit and actionable (e.g., token expired, identity insufficient)
  - Policy decisions are the responsibility of consumer code via hooks

### Security and policy
- Token TTLs, rate limiting, and abuse controls are application responsibilities (enforced via hooks)
- Only responder-node peer addrs need to be disclosed in the invitation link; participating cadre is disclosed after approval
- Identity bundles, certificates, and proposed tally terms are opaque to Taleus during bootstrap; validation and acceptance are handled by consumer hooks


## Transaction Protocol Flow

Transactions (chits) in Taleus follow these database-centered steps:

1. **Creation**: A party creates a chit record with required fields (tally ID, party indicator, amount, etc.)
2. **Signing**: The party digitally signs the chit using their cryptographic key
3. **Database Insert**: The signed chit is inserted into the shared database
4. **Consensus Validation**: The database consensus mechanism validates the operation
5. **State Update**: Tally balance and state are updated automatically via database constraints
6. **Local Backup**: Each party maintains local copies of records protecting their position

### Transaction Types

Taleus supports several types of chit records:

- **Direct Chit**: A simple promise issued by one entity to its direct trading partner
- **Setting Chit**: A declaration by one entity that it wishes to change certain operating conditions
- **Lift Chit**: Part of a larger credit lift involving multiple parties

### Chit States

Chits can exist in the following states:

- **pending**: Created but not yet acknowledged
- **good**: Validated and accepted
- **void**: Rejected or invalid

## Consensus Protocol

The shared database model implements consensus at the database level:

1. **Database-Level Consensus**:
   - Uses distributed database consensus mechanisms
   - Ensures consistency across all participating nodes

2. **Transaction Verification**:
   - Each chit is signed by the creating party
   - Signatures are verified before database updates
   - Database-level consensus ensures agreement on state changes

3. **Node Participation**:
   - Small network of trusted nodes maintain the database
   - Nodes are selected based on trust criteria
   - Kademlia DHT provides efficient node discovery and routing




## Identity and Authentication

The protocol uses cryptographic identities:

1. **Party Identification**: Unique identifiers for participants
2. **Certificates**: Contain public keys and identity information
3. **Signatures**: All critical operations require digital signatures
4. **Key Rotation**: The protocol supports updating keys without closing tallies



## Security Considerations

The protocol addresses several security aspects:

1. **Byzantine Resilience**: Handling potentially malicious actors
2. **Replay Protection**: Preventing message replay attacks
3. **Tamper Proofing**: Ensuring integrity of records
4. **Identity Protection**: Securely managing participant identity

## Next Steps

The following protocol aspects are under active development:

1. Detailed database schema and access patterns
2. Consensus algorithm implementation and optimization
3. Node selection and trust criteria
4. Protocol version management
5. Integration with Kademlia DHT

---

*Note: This protocol specification is a working draft and will evolve as implementation decisions are finalized.*