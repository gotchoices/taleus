# Taleus Tally Structure and Operations

This document describes the structure of tallies in Taleus and the operations that can be performed on them.

## Tally Overview

A tally is a digital contract between two parties that:
- Formalizes a trusted trading relationship
- Establishes credit terms
- Records transactions (chits) between the parties
- Enables credit-based exchanges of value

## Tally Structure

A tally consists of several types of records:

### 1. Tally Identification

- **Tally ID**: A universally unique identifier (UUID) that identifies the tally
- **Version**: Protocol version information
- **Creation Date**: When the tally was initially created

### 2. Party Identification

Each tally has two participants, identified by:

- **Party ID**: The unique identifier for each party (ideally a libp2p peerID)
- **Party Roles**: Distinguishing between the two parties using stock/foil nomenclature
  - **Stock Holder**: The party who first proposes the tally (vendor/creditor role)
  - **Foil Holder**: The party who responds to the tally proposal (client/debtor role)
  - Maintains compatibility with MyCHIPs terminology and balance sign conventions
- **Party Certificates**: Containing identity and cryptographic key information

Important considerations:
- Party IDs should be immutable through the life of the tally
- If a party ID needs to change, it requires closing the tally and opening a new one
- There are open questions about using SSI (Self-Sovereign Identity) to allow key rotation while maintaining the same identity

### 3. Credit Terms

Each party may extend credit to the other under specific terms:

- **Credit Limit**: Maximum credit extended
- **Call Term**: Number of days notice required to reduce the limit
- **Other Terms**: Additional credit parameters

Credit terms:
- Are signed by the party extending credit
- Can be amended with a new record at any time
- If restrictive, only take effect after the call term has expired

### 4. Contract Reference

Each tally references a governing contract:

- **Contract ID**: A content-addressable reference (e.g., IPFS hash)
- **Contract Format**: How the contract document is structured
- **Hosting**: Nodes that host the tally are expected to also host/cache referenced contracts

### 5. Trading Variables

Each party can specify variables that control automated trading:

- **Bound**: Maximum balance (positive or negative) to maintain
- **Target**: Preferred balance to maintain
- **Margin**: How much can be earned on lifts that exceed target
- **Clutch**: How much can be earned on reverse lifts (drops)

These variables:
- Are stored as records in the tally
- Are signed by the party setting them
- Only affect that party's perspective of the tally
- Control how automated credit lifts are performed

### 6. Transaction Records (Chits)

Tallies contain transaction records called "chits":

- **Pledge Chits**: Recording a certain number of CHIPs pledged from one party to another
- **Chit Requests**: Requesting a certain number of CHIPs from the other party
- **Setting Chits**: Changing operating parameters of the tally

#### Chit Digest Format

Each chit digest consists of the following serialized fields:
- **Tally ID**: ID of the tally the chit belongs to
- **Party Indicator**: Which party is issuing the pledge (stock 's' or foil 'f')
- **Date**: Date of the pledge (format: YYYY-MM-DDTHH:mm:ss.SSSZ in UTC)
- **Memo**: Human readable comment
- **Reference**: Machine readable JSON data
- **Units**: Integer number of milliCHIPs as a positive number

Each chit:
- Has a unique identifier
- Is signed by the party creating it using their cryptographic key
- Contains the standardized digest format above
- May include references to external documents (e.g., invoices)
- Affects tally balance (net sum of all valid chits)

### 7. Close Requests

Either party can register a request to close the tally:
- The request is signed by the requesting party
- The tally remains open until its balance reaches zero
- Zero can be achieved through lifts or manual chits
- A closing tally should only accept chits that move it closer to zero

## Tally States

A tally progresses through several states during its lifecycle:

1. **Draft**: Initial creation, not yet shared
2. **Offered**: Proposed to partner, awaiting response
3. **Open**: Active and accepted by both parties
4. **Closing**: Marked for closing when balance reaches zero
5. **Closed**: Fully closed, no more transactions allowed
6. **Void**: Rejected or abandoned

## Tally Operations

### Establishing a Tally

1. **Creation**: A party creates a draft tally
2. **Proposal**: The tally is offered to another party
3. **Negotiation**: The recipient can accept, reject, or counter-propose
4. **Agreement**: Both parties sign the tally
5. **Activation**: The tally becomes open for transactions

### Recording Transactions

1. **Direct Payment**: One party issues a chit to the other
2. **Payment Request**: One party requests a chit from the other
3. **Settings Change**: A party updates their trading variables or other settings
4. **Close Request**: A party requests to close the tally when balanced

### Maintaining Consensus

Depending on the chosen protocol model, consensus is maintained either through:

- **Message-Based Model**: Chain-based consensus with explicit acknowledgments
- **Shared Database Model**: Database consensus mechanisms

In either case, the tally must remain in a consistent state that both parties agree upon.

## Security Considerations

Tallies incorporate several security features:

1. **Cryptographic Signatures**: All critical records are signed by the creating party
2. **Immutable Records**: Once signed, records cannot be altered
3. **Complete Record**: The legally binding tally is the collection of all valid, signed records
4. **Resilience**: Each party maintains records that protect their position

## Open Questions

Several design decisions regarding tallies are still being resolved:

1. **Party Identification**: How to handle identity changes without closing tallies
2. **Shared vs. Split Model**: Whether to use a message-based or shared database approach
3. **Schema Design**: Single flexible record structure vs. normalized schema
4. **Contract Format**: Structured documents vs. PDFs

## Example Tally Structure

While the exact structure depends on the final protocol model, a tally might contain:

```
Tally:
  - UUID: "unique-identifier"
  - Version: 1
  - Date: "creation-timestamp"
  
  Party1:
    - PeerID: "libp2p-peer-id-1"
    - Certificate: {...}
    - Credit Terms: {...}
    - Trading Variables: {...}
    
  Party2:
    - PeerID: "libp2p-peer-id-2"
    - Certificate: {...}
    - Credit Terms: {...}
    - Trading Variables: {...}
    
  Contract:
    - Reference: "content-hash"
    - Format: "structured-yaml"
    
  Signatures:
    - Party1: "digital-signature-1"
    - Party2: "digital-signature-2"
    
  Chits:
    - [...chit records...]
```

---

*Note: This document is a working draft and will evolve as implementation decisions are finalized.*