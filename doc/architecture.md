# Taleus Architecture

This document outlines the architectural design of the Taleus library, describing the core components, models, and interactions.

## System Overview

Taleus is a library for managing private credit relationships (tallies) between participants in a decentralized network. The architecture is designed to provide:

1. Secure, peer-to-peer communication
2. Persistent, verifiable transaction records
3. Consistent state management between parties
4. Standard protocol implementation for applications

### Core Components

![Architecture Components](images/architecture-placeholder.png)

The Taleus system consists of the following key components:

1. **Application Layer (Taleus)**: Manages tallies and credit relationships
2. **Database Layer (Quereus)**: Provides SQL query parsing and database operations
3. **Optimistic Layer (Optimystic)**: Implements optimistic database operations
4. **DHT Layer (Kademlia)**: Provides distributed hash table functionality
5. **Network Layer (libp2p)**: Handles peer discovery and communication
6. **Identity Manager**: Handles cryptographic identities and signatures
7. **Consensus Module**: Ensures consistent state between parties

### Node Management

The system uses a balanced node management approach:

- Each party nominates trusted nodes to participate in tally management
- The nominated nodes form a network with equal voting power (50/50 split)
- This ensures that neither party can unilaterally control the consensus
- In case of disputes, parties maintain local copies of critical records
- The system supports Byzantine fault tolerance at the database level

## Architecture Models

Taleus implements a shared database model for tally management, building upon and improving the original MyCHIPs message-based approach:

### Shared Database Model

Taleus implements a shared database model that represents a significant evolution from the original MyCHIPs approach where each party maintained their own copy of the tally:

- Parties maintain a shared record in a distributed database hosted by nominated nodes
- The database is built atop a Kademlia DHT using the Optimystic and Quereus layers
- Consensus is handled at the distributed database level using a 50/50 voting power split
- This provides a single source of truth while maintaining Byzantine fault tolerance

**Schema Design:**
- Uses a mostly normalized SQL schema for efficient querying and relationships
- JSON fields are used where flexibility is needed (e.g., certificates, contract references)
- Maintains stock/foil party nomenclature for compatibility with MyCHIPs concepts
- Separate tables for different record types (tallies, chits, credit terms, etc.)

**Implementation Details:**
- Uses Kademlia DHT for node discovery and routing
- Each party nominates trusted nodes with equal voting power (50/50 split)
- Database consensus prevents unilateral control by either party
- Cryptographic signatures ensure transaction integrity
- Parties maintain local copies of critical records for dispute resolution

## System Interactions

### Tally Establishment Flow

1. Party A proposes a tally to Party B
2. Party B reviews and either accepts, rejects or modifies the proposal
3. If accepted, both parties sign the tally
4. The tally becomes active for transaction recording

### Transaction Flow

1. Party A creates a chit (transaction)
2. Party A signs the chit
3. The chit is transmitted to Party B
4. The system ensures both parties have consistent records

### Consensus Mechanism

Taleus implements database-level consensus for the shared database model:

**Database Consensus**:
- Each party nominates trusted nodes to participate in tally management
- Nominated nodes form a network with equal voting power (50/50 split between parties)
- Database operations require consensus between the two party groups
- Prevents either party from unilaterally modifying tally records
- Hash chains may be integrated for additional integrity verification

**Dispute Resolution**:
- Parties maintain local copies of all records that protect their position
- Cryptographically signed records serve as legally binding evidence
- In case of disagreement, parties can present their records to arbitrators

## Identity Management

Taleus handles identity through:

1. **Party Identification**: Using libp2p PeerIDs or SSI (Self-Sovereign Identity)
2. **Key Management**: Supporting key rotation, recovery, and multiple device access
3. **Signatures**: Digital signatures for all transactions and changes

## Architecture Decisions Made

The following architectural decisions have been finalized:

1. **Database Structure**: ✅ Mostly normalized SQL schema with JSON fields where flexibility is needed
2. **Party Nomenclature**: ✅ Stock/foil terminology (maintaining MyCHIPs compatibility)
3. **Consensus Model**: ✅ Shared database with 50/50 voting power split between parties

## Open Architecture Questions

The following questions are still being researched and resolved:

1. **Identity Framework**: Should we use SSI (Self-Sovereign Identity) or alternative approaches for secure, recoverable identities?
2. **Hash Chain Integration**: How should hash chains be integrated with the distributed database for additional integrity verification?
3. **Node Selection**: What criteria should be used for selecting trusted nodes to maintain the shared database?
4. **Key Management**: Should private keys be stored in device vaults or be exportable for device migration?

## Interfaces

Taleus will provide the following key interfaces:

1. **Tally Management API**: For creating, negotiating, and maintaining tallies
2. **Transaction API**: For recording and validating transactions
3. **Network Management API**: For handling peer connections and discovery
4. **Storage Interface**: For customizing the persistent storage layer
5. **Identity Interface**: For plugging in different identity solutions

## Security Considerations

The Taleus architecture addresses several key security concerns:

1. **Byzantine Fault Tolerance**: Handling potentially malicious actors
2. **Tamper-Proof Records**: Ensuring transaction integrity
3. **Identity Security**: Preventing impersonation
4. **Key Recovery**: Handling lost or compromised keys
5. **Consensus Integrity**: Ensuring valid state transitions

## Next Steps

The architecture team is currently:

1. Implementing the shared database model with Kademlia DHT
2. Developing proof-of-concept implementations for critical components
3. Documenting interface specifications
4. Finalizing the security model and consensus mechanisms
5. Defining node selection and trust criteria

---

*Note: This architecture document is a working draft and will evolve as implementation decisions are finalized.*