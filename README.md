<div align="center">
  <img src="doc/images/logo.svg" alt="Taleus Logo" width="150" align="left">
  <h1>Taleus</h1>
  <p>A standardized library for managing private credit tallies using libp2p.</p>
  <br clear="all">
</div>

## Overview

Taleus is a library for negotiating, establishing and maintaining private credit relationships (tallies) between participants in a Private Credit Network (PCN).

- A **Private Credit Network (PCN)** is a graph network where:
  - Nodes represent individuals, organizations, or entities
  - Edges represent peer-to-peer credit relationships (tallies)
  
- A **tally** is a mutually signed contract between two parties that:
  - Formalizes a trusted relationship
  - Contains identifying information including cryptographic keys
  - Tracks transactions (chits) between parties
  - Enables credit-based exchanges of value
  - Allows for automated, distributed credit clearing (lifts)

Taleus extends and builds upon concepts developed in the [MyCHIPs](https://github.com/gotchoices/MyCHIPs) project, but focuses on creating a standalone, standard library implementation of the tally, built atop modern peer-to-peer technologies.

## Features

- **Decentralized Architecture**: Built on [libp2p](https://libp2p.io/), enabling truly peer-to-peer interactions
- **Standard Library**: Provides a consistent implementation for multiple PCN applications
- **Secure Identity**: Uses cryptographic identity verification and signatures
- **Contract Management**: Handles contract references and agreement validation
- **Transaction Tracking**: Records and validates chits (transactions)
- **Consensus Mechanisms**: Ensures both parties maintain accurate and consistent records

## Current Status

Taleus is currently in the design and documentation phase. We are:

- Establishing architecture and protocol specifications
- Researching and comparing database models and identity frameworks
 - Defining chunk structure and SQL operations
 - Designing tally structures and operations

For a detailed roadmap of development, see [Development Roadmap](doc/STATUS.md).

## Architecture

Taleus implements a decentralized tally management system using a specific technical stack:

- **libp2p**: For peer discovery, connection, and communication
- **Kademlia DHT**: For distributed hash table functionality
- **Optimystic**: For optimistic database operations atop Kademlia
- **Quereus**: For SQL query parsing and database operations
- **Taleus**: The application layer managing tallies and credit relationships

The system uses a shared database model where:
- Each party nominates trusted nodes to participate in tally management
- The nominated nodes form a network with equal voting power (50/50 split)
- Consensus is handled at the database level
- Cryptographic signatures ensure transaction integrity
- Parties maintain local copies of critical records for dispute resolution

This represents a significant evolution from the original MyCHIPs message-based approach, where each party maintained their own copy of the tally and used a message protocol for synchronization.

See [Architecture Documentation](doc/architecture.md) for more details.

## Relationship to MyCHIPs

MyCHIPs serves as the prototype implementation for a PCN, demonstrating the viability of private credit as a medium of exchange. Taleus aims to:

1. Extract and standardize the core tally management functionality
2. Implement this functionality using modern peer-to-peer technologies
3. Create a reusable library that can be incorporated into various applications
4. Enable broader adoption of private credit networks

## Documentation

- [Architecture Overview](doc/architecture.md)
- [Protocol Specification](doc/protocol.md)
- [Tally Structure](doc/tally.md)
- [Development Roadmap](doc/STATUS.md)

## Contributing

The Taleus project follows the principles outlined in the [Project Objectives](doc/PROJECT.md) file. When contributing:

- Follow normalized coding practices
- Use TypeScript
- Solve problems the right way, avoiding kludges
- Follow conventions found in existing code
- Use test-driven workflow

## License

[License information will be added]

---

*Taleus is currently in active development. Documentation and implementation details are subject to change.*
