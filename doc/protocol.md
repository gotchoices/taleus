# Taleus Protocol Description

This document defines the protocol by which nodes in a Taleus network communicate with each other to establish, maintain, and operate tallies.

## Protocol Overview

The Taleus protocol consists of several interconnected layers:

1. **Application Layer (Taleus)**: Manages tallies and credit relationships
2. **Database Layer (SQLiter)**: Provides SQL query parsing and database operations
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
- The system supports Byzantine fault tolerance at the database level

## Protocol Models

Taleus implements a shared database protocol, evolving from the original MyCHIPs message-based approach:

### Shared Database Protocol

The shared database protocol represents a significant advancement over the original MyCHIPs message-based design:

- Instead of each party maintaining their own copy of the tally (as in MyCHIPs), parties maintain a shared record in a distributed database
- The database is hosted by a small network of nodes built atop a Kademlia DHT
- Consensus is handled at the distributed database level rather than at the individual tally/chit layer
- This provides a single source of truth for all participants

Key characteristics:
- Uses a distributed database with built-in consensus mechanisms
- Both parties (and their nominated nodes) maintain a common record
- Changes are written directly to the database
- Database-level consensus ensures agreement
- Kademlia DHT provides efficient node discovery and routing

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

## Transaction Protocol Flow

Transactions (chits) in Taleus follow these general steps:

1. **Creation**: A party creates a chit
2. **Signing**: The party digitally signs the chit
3. **Transmission**: The chit is sent to the partner
4. **Validation**: The partner validates the chit
5. **Recording**: The chit is recorded on both sides of the tally
6. **Consensus**: Both parties ensure agreement about the chit's place in the record

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
   - Implements Byzantine fault tolerance
   - Ensures consistency across all participating nodes

2. **Transaction Verification**:
   - Each chit is signed by the creating party
   - Signatures are verified before database updates
   - Hash chains provide additional integrity verification
   - Database-level consensus ensures agreement on state changes

3. **Node Participation**:
   - Small network of trusted nodes maintain the database
   - Nodes are selected based on trust criteria
   - Kademlia DHT provides efficient node discovery and routing
   - Byzantine fault tolerance handles potentially malicious nodes

## Route Discovery and Lifts

While the primary focus of Taleus is tally management, it also supports the concept of credit lifts:

1. **Route Discovery**: Finding viable pathways through the network
2. **Lift Negotiation**: Proposing and agreeing to a lift
3. **Lift Execution**: Creating and signing chits as part of the lift
4. **Lift Finalization**: Confirming the lift is complete

These operations may be performed by interacting with other components like ChipNet.

## Identity and Authentication

The protocol uses cryptographic identities:

1. **Party Identification**: Unique identifiers for participants
2. **Certificates**: Contain public keys and identity information
3. **Signatures**: All critical operations require digital signatures
4. **Key Rotation**: The protocol supports updating keys without closing tallies

## Protocol Versions

The Taleus protocol is versioned to allow for future enhancements:

- **Version 1.0**: Initial release based on MyCHIPs concepts
- **Future Versions**: Will be documented with backward compatibility considerations

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