# Project docs

Per-subsystem deep references live here. Keep `CLAUDE.md` short — it should read as a **table of contents** that points at files in this directory.

## Pattern

When you find yourself adding more than a paragraph to `CLAUDE.md`, create a new `docs/<topic>.md` instead and link to it from `CLAUDE.md`. Goal: the project's `CLAUDE.md` stays under ~250 lines.

Examples of good `docs/*.md` topics:
- Subsystem deep-dives (one per area of the codebase)
- Architectural decisions / "why we built it this way"
- Defaults tables, behavior matrices, edge cases
- Setup walkthroughs that don't belong in `README.md`

## See also

The framework's own docs follow this same pattern — browse `node_modules/electron-manager/docs/` for the canonical examples.
