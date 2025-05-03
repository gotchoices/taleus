  
  
Technical Details

- Taleus will be build atop libp2p
- Tallies contain several types of records
  - Tally ID:
    - Somewhere, somehow, we need to establish a UUID or similar ID for the tally so all other records can be relational to it.
  - Party ID: 
    - Each of the two parties to the tally will need to have an ID recorded on the tally.
    - The two parties need to be distinctly identified.
    - Whoever first forms a tally proposal would record their ID first and become id0 (or proposer)
    - The respondant would become id1 (or respondant)
    - The party ID should be a libp2p peerid if possible
    - However, if the party ID ever has to change, it necessitates closing the tally and opening a new one.
    - IOW, the party ID should be writable one-time to a tally and be immutable through the life of the tally.
    - It would be nice if the party ID could be related to a SSI (self-sovereign-identify) seed so that
      a party could issue a series of keys over the lifetime of the tally.  Is there a way to do this with SSI?
      All new keys issued would be the progeny of the original seed ID so they could be verified as valid by
      the partner.  But a partner could invalidate old keys and issue new ones as needed.
    - If we use SSI (or similar) can/should the private key be contained within a device vault (i.e. not even
      accessible to the user)?  Or should the private key be exportable so it can be moved from one device to
      the next?
    - If the private key(s) are kept in a device vault, do we have a way to deal with lost devices?  Can I
      register multiple keys (or key seeds) on a tally so I can use them to revoke old keys or register new
      keys later?
  - Credit offering
    - This represents the credit limit, call term, and possibly other terms one party extends to the other.
    - Like all records (except party ID) it must be signed
    - It should be signed only by the party extending the terms
    - An new record (amendment) can be logged to the tally at any time
    - But if it represents a restriction, it will only take effect after the call term (in days) has expired
  - Contract
    - This record references a governing document which is the agreement between the parties
    - It must be signed by both parties to be in force
    - This will typically be an IPFS or similar content-based address
    - The nodes that host the tally will be duty-bound to host/cache any such documents referenced by the
      tallies they handle
    - A new contract record can be logged at any time by either party.  It becomes operative when signed by
      the other party.
    - The format of the document must be understood by the system and/or the parties.  Presumably this could
      just be a PDF document.  But there are some advantages to the structured document format used in the
      original MyCHIPs as it is nearly all content (and no formatting) and so makes it easier to understand
      what is being hashed (to know that two different documents are distinct and not just a differently
      formatted/presented version of the same thing).
  - Trading Variables
    - This record contains four variables that instruct automated agents how to perform credit lifts
      on behalf of the party.
    - This record is signed by only one party to signify how to treat trades from his perspective of the tally.
    - The file mychips/schema/tallies.wmt contains definitions for these values.
      - bound
      - target
      - margin
      - clutch
  - Chit
    - A chit is a pledge for a certain number of CHIPs
    - It should be signed by the party making the pledge
    - A tally contains a total balance which is the net sum of all valid chits.
  - Chit Request
    - This requests a certain number of CHIPs from the other party
    - It should be signed by the party requesting the payment
  - Close Request
    - Either party can register a record requesting the tally to close
    - The record must be signed by the requesting party
    - The tally will remain open until its balance reaches zero, at which point it is closed
    - Zero can be achieved throught lifts or manual chits
    - A tally marked as closing should only accept chits that move it closer to zero
- Tallies records can stand on their own in terms of their validity (cryptographic signatures).  However
  each record needs to be linked back to a universally unique identifier (tally ID) so they can be taken
  in context.
- In the event of a corrupt partner (who somehow tries to delete or hide records), it is up to the
  other partner to maintain posession of all records that protect his position (for example, signed pledges
  from the other party).  A complete tally is the collection of all duly signed records that reference
  the tally ID.  The parties might end up in court presenting 'their version' of the tally, but the legally
  binding tally is the set of all valid records produced by the parties.

Questions
- Original model
  - In the original MyCHIPs, each party was responsible for keeping a separate record of his half of the tally.
  - This required some kind of consensus algorithm to help the two parties keep their copies of the ledger consistent.
  - Parties to the tally were identified by the historical tags 'stock holder' and 'foil holder'
  - So one party's copy of the tally was 'the stock' and the other party held 'the foil'
  - Tally negotiation and Synchronization was accomplished by a protocol of messages sent back and forth between the parties.
- Shared database model
  - Taleus may move to a shared database model where:
    - Each party will propose a set of libp2p nodes to participate in management of the tally
    - The resulting set of nodes will establish a common network
    - A kademlia database will established on the network
    - This may have other abstractions on top of that (see github.com/gotchoices/sqliter)
    - The parties will communicate with each other by writing records to the database
  - Question: is this model preferable to the split tally model?
  - What are the pro's/con's of each model?
- Tally balance sign
  - In the original MyCHIPs, parties would think of net positive pledges to themselves as an asset 
    (positive number) and net pledges to the other party as a liability (negative number)
  - But if the tally were ever represented externally, it would need a more objective measure
  - For that context, a positive tally balance represents money owed by the foil holder to the stock holder.
  - If we go to the shared database model, do we keep the stock/foil references if, for no other reason,
    to keep track of what a positive or negative number means?
- Libp2p peerID's vs SSI identities
  - How do cycled keys work in SSI?
  - Can we create a libp2p peer id based on the original SSI seed, as opposed to the 'current public key'?
  - Are there alternatives to SSI that might work better?
- Schema
  - The original MyCHIPs implementation stored tallies as follows:
    - Tally header (contained party identification, contract, initial terms)
    - Chits (originally for payments only but settings, trading variables were wedged into the same model)
    - Chits were stored in a hash-chain so as to easily verify consenus (by comparing end of chain index and hash)
  - If we go to a shared database model, is it necessary to keep a hash chain at all?
    - Probably not.  However consider the byzantine case where one party has more nodes than the other and
      purposely throws away certain records in order to gain advantage.
    - In this case, even though the parties operate on a shared database, individual parties will need a way
      to locally store valuable records the other party refuses to acknowledge/store so the true tally can
      be proven in court.
  - What would the schema look like to contain a full tally?
    - It could be a single table that contained something like the following
      - Tally ID (what tally the record pertains to)
      - Record index (0..n)
      - Record date
      - Record type (party ID, terms, contract, chit, etc.)
      - Record contents (type-specific JSON record)
      - Signatures
    - The above structure deals with the variant nature of records by putting a flexible 'contents' record in
    - We could also contemplate a fully-normalized SQL schema, with separate tables for each different type
      of record.  What are the pro's/con's of each approach?
- Standard
  - The objective of this library is to establish the standard by which all PCN nodes operate.
  - In the case of a messaage-based protocol (like the original MyCHIPs), the standard is in the message 
    packets themselves.  It is up to the implementation to store state as it will.
  - In the case of a shared-database model, it seems perhaps the libary itself becomes more of the standard.
  - Or if alternate implementations of the library can be made, there must be some other level at which
    the standard is defined.  What is it?
  
      
