# First run

Kyle has the repository and wants a Taleus party on his laptop.

1. He runs `taleus` and gets a prompt. A party folder is made under `~/.taleus/default/`; nothing
   about him exists yet.
2. `party name Kyle` gives the party its identity and the name others will see.
3. `relay add relay.sereus.org`: a relay is how anyone reaches him. He is told the relay's full
   address and how its peer id was learned, and waits until the relay accepts him.
4. `status` shows his party, his node, and that he can be reached.
5. He quits. Running `taleus` again comes back as the same party, with the same relay.

## Acceptance

- [ ] The folder holds everything; deleting it is a clean slate.
- [ ] A second `taleus` on the same party is refused, naming the process that has it.
- [ ] Without a name, commands that need one say so rather than failing obscurely.
