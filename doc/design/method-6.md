Method 6:

**Rough Process Flow**:
1. Party A creates a link containing:
  - PeerID's of A's cadre;
  - Authentication token;
  - A's role (stock, foil or null);
  - Optional identity requirements B must adhere to.
2. Party A privately makes the link available to B (or multiple B's).
3. Party B connects to any available node (Ax) of A's cadre, and discloses the token, its identity, cadre and desired tally contents.
4. If A is stock role (and B is compliant with identity requirements) A builds the DB and responds with connection info. Done.
5. If A is foil role, Ax discloses its identity, cadre and desired tally contents.
6. If B chooses to continue, it builds the DB and responds with connection info. Done.
