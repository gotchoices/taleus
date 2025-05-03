# Taleus Communication Models

This document outlines the communication approaches being considered for Taleus, acknowledging that the final implementation model is still under evaluation.

## Communication Approaches

Taleus is considering two primary approaches for communication between nodes:

1. **Message-Based Protocol**: Similar to MyCHIPs, where entities exchange structured messages
2. **Shared Database Model**: Where entities interact through a common distributed database

The final approach will significantly impact how nodes communicate and how the standard is defined.

## Message-Based Model

If Taleus adopts a message-based approach, it would involve:

- Structured message formats (likely JSON-based initially)
- Specific message types for different operations
- State transitions triggered by message exchanges
- Explicit acknowledgments

This would be similar to the MyCHIPs approach where each tally operation requires message exchanges between parties to achieve consensus.

### Potential Message Categories

- **Tally Messages**: For establishing and managing tallies
- **Chit Messages**: For recording transactions and settings
- **Consensus Messages**: For ensuring agreement between parties
- **Lift Messages**: For coordinating distributed credit lifts

### Communication Layer

In either model, Taleus will leverage libp2p for:
- Peer discovery
- Connection establishment
- Secure communication
- NAT traversal

## Shared Database Model

If Taleus adopts a shared database approach, communication would be primarily through:

- Database operations on a distributed database
- Potentially using technologies like libp2p's Kademlia DHT
- Changes detected through database triggers or events
- Consensus achieved through database protocols

In this model, explicit message formats may be less relevant as interactions happen through database operations.

## Hybrid Approach

A hybrid approach could combine aspects of both models:
- Using message exchanges for initial setup and negotiations
- Using shared database for ongoing record keeping
- Messages could be used for notifications and events

## Data Structures

Regardless of the communication model, certain core data structures will be required:

### Tally Structure
- Unique identifier
- Party identification
- Contract terms
- Signatures
- Status information

### Chit Structure
- Unique identifier
- Tally reference
- Value amount
- Type (transaction, setting, etc.)
- Signature
- Metadata

### External Formats

For interaction with external systems, standard formats will be needed for:
- Tally invitations
- Payment requests
- Identity exports/imports

## Next Steps

As part of the architecture evaluation process, Taleus will:

1. Evaluate the pros and cons of each communication model
2. Create prototype implementations of key interactions
3. Test performance and reliability characteristics
4. Finalize the communication approach
5. Document detailed message formats or database schemas as appropriate

Once the communication model is determined, this document will be expanded with specific implementation details.

---

*Note: This documentation will be updated as architectural decisions are finalized.*