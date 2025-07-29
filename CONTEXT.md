# Taleus Project Guide for Developers and AI agents

## General Principles
- Normalized code
  - reusable
  - consistent
  - single-responsibility, single point of change
- Use typescript
- Solve problems the right way, don't kludge, even if it's a little harder
- Follow conventions found in existing code where possible
- If existing code is messy, propose appropriate refactors to remedy this
- Handle functions like cryptography, conversions centrally, consistently
- Systematize repetative tasks such as tests, validations
- Use test-driven workflow as much as possible

## Project Phases
- Design and documentation phase
  - resolve unanswered design questions
  - document desired functionality
  - document state transition rules
  - model in tla+ if possible
  - define interfaces
  - select appropriate dependencies
- Coding and testing phase
- Implementation phase
  - Re-integrate back into MyCHIPs engine
  - Possible standalone mobile phone implementation
- Maintenance

## Work Flow
- Maintain a doc/STATUS.md file with a detailed project development roadmap
- For more complex features, refactors, fixes, create a separate tracking file in doc/issues/<issue>.md.
  - Describe work to be done: bugs, problems, goals, objectives, detailed checklist
  - Develop in incremental, testable stages
    - Build regression test to exercise each new feature
    - Test, adjust until working, then clean, optimize, re-test
    - Upon user's approval, update issues file
    - User should commit code to repository (remind if necessary)
    - Iterate through checklist items
  - Document possible future enhancements in the issues folder
  - Review and update all relevant files in doc/*.md (API changes, for example)

## AI Agents
- You will be asked to read this file at the beginning of a work session
- Follow the procedures outlined above when working on any issue
- Review doc/STATUS.md and prepare to work on the current or next task/issue
- Don't guess about things you are unsure of
- Better to say "I don't know" than to make something up
- If you find unrelated things that should be fixed, suggest a checklist item
- Tell the user what you think is next or ask if you don't know
