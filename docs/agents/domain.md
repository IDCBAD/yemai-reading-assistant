# Domain Docs

This repository uses a single-context domain-document layout.

## Before exploring

- Read `CONTEXT.md` at the repository root.
- Read ADRs under `docs/adr/` that affect the area being changed.
- If either location is absent, proceed silently instead of creating placeholder documents.

## Vocabulary

Use the terms defined in `CONTEXT.md` in issue titles, specifications, implementation plans, tests, and code.

Do not replace established terms with synonyms that the glossary explicitly avoids. If a required concept is missing, note it as a possible domain-modeling gap instead of silently inventing competing language.

## Architectural decisions

Treat accepted ADRs under `docs/adr/` as active constraints.

If proposed work conflicts with an ADR, state the conflict explicitly and explain why the decision may need to be reopened. Do not silently override it.

## Layout

- Domain glossary: `CONTEXT.md`
- Architectural decisions: `docs/adr/`
- Context model: single-context
