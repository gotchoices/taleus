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
2. **Database Layer (SQLiter)**: Provides SQL query parsing and database operations
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

The shared database model represents a significant evolution from the original MyCHIPs message-based approach:

- Instead of each party maintaining their own copy of the tally (as in MyCHIPs), parties maintain a shared record in a distributed database
- The database is hosted by a small network of nodes built atop a Kademlia DHT
- Consensus is handled at the distributed database level rather than at the individual tally/chit layer
- This provides a single source of truth for all participants

**Advantages:**
- Single source of truth for all parties
- Simplified consensus mechanism (handled at database level)
- More efficient credit clearing and settlement
- Reduced complexity in reconciliation
- Better recovery from network issues

**Implementation Details:**
- Uses Kademlia DHT for node discovery and routing
- Small network of trusted nodes maintain the shared database
- Byzantine fault tolerance at the database level
- Cryptographic signatures ensure transaction integrity
- Real-time consistency across all participants

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

Depending on the chosen model, consensus works differently:

**Message-Based Model**:
- Chain-based consensus similar to MyCHIPs
- Hash chains verify record integrity
- Explicit acknowledgments of transmitted messages

**Shared Database Model**:
- Database consensus protocols (potentially built on libp2p)
- Byzantine fault tolerance considerations
- Possible use of voting or multi-signature approaches

## Identity Management

Taleus handles identity through:

1. **Party Identification**: Using libp2p PeerIDs or SSI (Self-Sovereign Identity)
2. **Key Management**: Supporting key rotation, recovery, and multiple device access
3. **Signatures**: Digital signatures for all transactions and changes

## Open Architecture Questions

The following questions are still being researched and resolved:

1. **Database Structure**: Should tallies use a single flexible table or a fully normalized schema?
2. **Identity Framework**: What's the best approach for ensuring secure, recoverable identities?
3. **Hash Chain Integration**: How should hash chains be integrated with the distributed database for additional integrity verification?
4. **Node Selection**: What criteria should be used for selecting trusted nodes to maintain the shared database?
5. **Standard Definition**: How should the "standard" be defined for the shared database implementation?

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