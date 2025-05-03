# Taleus Protocol Description

This document defines the protocol by which nodes in a Taleus network communicate with each other to establish, maintain, and operate tallies.

## Protocol Overview

The Taleus protocol consists of several interconnected layers:

1. **Network Layer**: Communication between peers using libp2p
2. **Tally Layer**: Establishment and maintenance of tallies
3. **Transaction Layer**: Recording and verification of chits
4. **Consensus Layer**: Ensuring agreement between parties

This document focuses primarily on the application-level protocols (Tally, Transaction, and Consensus layers) rather than the underlying network transport protocols.

## Protocol Models

Taleus is currently researching two primary protocol models:

### Message-Based Protocol

Similar to the original MyCHIPs design, this approach uses a state transition model where:
- Each party maintains their own copy of the tally
- State changes are communicated via messages
- Each message has specific validation and processing rules
- Explicit acknowledgments confirm receipt and processing

### Shared Database Protocol

A newer approach being explored that:
- Uses a shared database model with distributed consensus
- Both parties (and potentially their nominated nodes) maintain a common record
- Changes are written directly to the database
- Database consensus mechanisms ensure agreement

This document will describe both approaches where they differ, as the final protocol implementation is still under development.

## State Processing

Like MyCHIPs, the Taleus protocol is implemented as a state transition model. This is important because:

- Nodes may go offline at any time
- Network connections may not always be reliable
- Messages may be lost, delayed, or duplicated

The system is designed to:
- Maintain a consistent state until a message gets through or is abandoned
- Re-transmit messages as necessary
- Tolerate duplicate messages
- Recover from errant states and data loss
- Eventually bring associated parties into consensus

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

### Message-Based Consensus

In the message-based model, consensus uses a hash chain approach:

1. Each chit contains a hash of its contents
2. Each chit also contains a reference to the hash of the preceding chit
3. The hash of the latest chit serves as a verification point
4. Parties exchange messages to ensure chain consistency

The consensus algorithm uses these basic message types:
- **upd**: Updates the partner with new chits or information
- **req**: Requests information about specific chits
- **ack**: Acknowledges correct information
- **nak**: Rejects incorrect information

### Shared Database Consensus

In the shared database model, consensus may use:

1. Distributed database consensus mechanisms
2. Optional hash chain for additional integrity verification
3. Possibly multiple participating nodes for Byzantine fault tolerance

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

1. Final decision on message-based vs. shared database model
2. Detailed message formats and validation rules
3. Consensus algorithm optimization
4. Protocol version management

---

*Note: This protocol specification is a working draft and will evolve as implementation decisions are finalized.*