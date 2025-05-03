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

1. **Peer Network Layer**: Built on libp2p for discovery and communication
2. **Tally Manager**: Handles tally creation, negotiation, and maintenance
3. **Chit Manager**: Processes transactions and settings 
4. **Storage Layer**: Manages persistent record keeping
5. **Identity Manager**: Handles cryptographic identities and signatures
6. **Consensus Module**: Ensures consistent state between parties

## Architecture Models

Taleus is exploring two primary architectural models for tally management, each with their own advantages and trade-offs:

### Model 1: Message-Based Protocol (Original MyCHIPs Approach)

In the message-based model:

- Each party maintains their own independent copy of the tally
- Parties communicate changes through a well-defined message protocol
- Consensus is achieved through message exchanges and acknowledgments
- Parties are responsible for storing their own records

**Advantages:**
- More decentralized (no shared storage requirements)
- Each party has complete control over their own records
- Fewer dependencies on external services

**Challenges:**
- Requires more complex consensus protocols
- May have more difficulty recovering from network partitions
- Synchronization can be more complex

### Model 2: Shared Database Model

In the shared database model:

- Parties maintain a shared record of the tally in a distributed database
- Each party may nominate trusted nodes to participate in database management
- The resulting network of nodes forms a consensus about the state of the tally
- Records are stored in a distributed fashion (possibly using Kademlia DHT or similar)

**Advantages:**
- Potentially simpler consensus mechanism
- May recover more easily from network issues
- Single source of truth for all parties

**Challenges:**
- Requires trust in the shared database network
- More dependencies on external services
- May be less decentralized in practice

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
2. **Preferred Model**: Is the message-based or shared database model superior for this application?
3. **Identity Framework**: What's the best approach for ensuring secure, recoverable identities?
4. **Hash Chain Requirement**: Is a hash chain necessary in the shared database model?
5. **Standard Definition**: How is the "standard" defined in each model?

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

1. Evaluating pros and cons of both architectural models
2. Developing proof-of-concept implementations for critical components
3. Documenting interface specifications
4. Finalizing the security model

---

*Note: This architecture document is a working draft and will evolve as implementation decisions are finalized.*