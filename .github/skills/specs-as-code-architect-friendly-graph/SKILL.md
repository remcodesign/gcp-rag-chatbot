---
name: specs-as-code-architect-friendly-graph
description: "Use when a software idea, reverse-engineering task, or architecture blueprint needs a readable domain-by-domain structure with complete end-to-end journeys, explicit current-versus-target status, diagrams, contracts, a dependency-ordered feature graph, and an executable file + acceptance-test plan."
argument-hint: "Describe the product flow or domain journey that should become a friendly architecture specification."
---

# Friendly Specs-As-Code Architect

Use this skill to turn a complex idea or partially implemented system into a
specification that people can read and implement one domain at a time. It is a
presentation and execution variant of specs-as-code, not a replacement for
security, validation, or test rigor.

The specification is built as an explicit pipeline so the plan is verifiable
before a single line of source exists:

    current spec  ->  feature graph  ->  file plan + acceptance test plan
                  ->  valid tests and valid source

Each stage is a named artifact. Do not skip ahead: the feature graph must be
complete and ordered before you write file paths, and both must exist before you
write source. "Valid" means the tests actually run against real application code
and the source satisfies them — not that they merely compile.

## Required structure: Domain → Step

Every specification MUST organize implementation under numbered domains, and
each domain MUST be broken into numbered steps. This is the canonical pattern
used by `docs/private/docs/hubpost-poc-3-tech-lead-arena-game/1-4-doc-specs-local-matching.md`.
Do not emit loose paragraphs or a flat checklist instead of this structure.

Use this exact heading hierarchy:

- `## Domain N: <Name>` — one per business/integration domain, in build order.
- `### Step N.M — <Action>` — numbered steps inside that domain, in execution order.

Example:

```markdown
## Domain 1: Dashboard & Analytics

Hub page showing the Tech Lead's game history, aggregate mood averages, jargon-frequency
ratios, and a skill-radar summary. Owns no state itself — it reads aggregates via a query
service.

### Step 1.1 — Web routes

- Register under `admin` in `routes/web.php`:
  ```php
Route::prefix('tlarena')->name('tlarena.')->group(function (): void {
Route::livewire('/', \App\Livewire\TLArena\Dashboard::class)->name('dashboard');
  });
  ```
```

Rules:

1. `N` starts at `1` and increments once per domain; the step counter restarts at
   `1` inside every domain (e.g. `Step 3.1`, `Step 3.2`).
2. The `Step` number must mirror the domain: `## Domain 3:` contains only
   `### Step 3.1 …`, `### Step 3.2 …`, etc.
3. Every domain opens with a 2–3 sentence summary of its entry point, owned state,
   and exit state before the first step.
4. Every step has a concrete action title (`Web routes`, `Database (migration)`,
   `Model`, `Factory`, `Service (+ DTO/Enum)`, `Seeds via service`,
   `Livewire 'controller'`).
5. Every step MUST end with a `- Tests:` block listing at least 1 **`Happy:`** and
   1 **`Non-happy:`** Pest/feature test (see the pest-testing skills for boundary
   quality). Write the tests as inline `it('…')` names with a short dash-explainer
   of the assertion, exactly like this:
   ```markdown
   - Tests:
   - **Happy:** `it('creates scenario, persona and pivot tables')` — schema assertions.
   - **Non-happy:** `it('rejects an unknown scenario type')` — DB enum constraint rejects `'weird'`.
   ```
6. Preserve the build order `routes → migrations → model → factory → service →
   seeds → livewire` when the repository follows it (Laravel convention), matching
   existing domain implementations.

## Artifact 1 — Feature graph

Before any file path or source, emit a dependency-ordered feature graph that
makes build order and ownership explicit. This is the bridge between readable
domains and executable work, and it MUST satisfy:

- **One node per feature.** A node is a self-contained capability (a domain,
  or a sub-feature large enough to be built and tested in isolation). Name nodes
  with the same vocabulary as their domain/step so a reader can trace node → step.
- **Edges = dependencies.** Draw an edge from a feature to every other feature it
  reads, calls, or persists into. An edge means "must exist (at least a stub)
  before this node's happy path runs."
- **Topological build order.** Order nodes so every dependency appears before its
  dependents. Where two features are independent, state they may be built in any
  order or by different people.
- **Shared vs. feature-owned.** Mark each node as `shared` (reused by ≥2 features;
  build once, early) or `feature-owned`. Do not let a feature own logic that two
  features need — pull it up to shared in the graph, not later.
- **State ownership.** For each node list the state it owns versus state it only
  reads. Two nodes must never own the same writable state; if one does, split or
  merge in the graph.

Render it as a Mermaid `flowchart` (see Diagrams) with one node per feature and
labeled edges, plus a short table:

| Node | Type (shared/feature) | Owns state | Depends on | Build order |
| --- | --- | --- | --- | --- |

Do not invent dependencies. If a feature's only dependency is an external system,
mark the edge `external` and route it to a contract card.


## Artifact 2 — File plan + acceptance test plan

After the feature graph, emit one table that maps every step to concrete files
and named tests. This is the checklist an implementer works through and a
reviewer verifies against "valid tests and valid source."

| Step | Files to create/modify (exact paths) | New public symbols | Acceptance tests (`it('…')`) | Evidence of "valid" |
| --- | --- | --- | --- | --- |

Rules:

- **Exact paths, not prose.** Every file entry is a real path relative to the
  repository root (e.g. `app/Services/TLArena/MoodAggregator.php`). If a file
  already exists, mark it `modify` and name the member being changed.
- **One row per step.** The file plan must cover every `### Step N.M` with no
  orphan steps and no files that map to no step. Every file in the plan must also
  appear in exactly one feature-graph node's scope.
- **Acceptance tests are named, not described.** Each row lists the `it('…')`
  names from that step's `- Tests:` block (happy + non-happy). A test is
  "valid" only if it exercises the real service/controller/job/adapter named in
  the same row — a fake external is allowed, but the application code under test
  must be real.
- **Round-trip check.** Before finalizing, verify: every feature-graph node has ≥1
  step; every step has ≥1 file and ≥2 tests (happy + non-happy); every test maps
  to exactly one file. If any check fails, fix the graph or plan — do not ship
  an unbalanced plan.

## Start with orientation

Open with five short facts:

1. **Outcome:** What should a user or external system be able to do?
2. **Already real:** Which files, endpoints, tests, metadata, or services prove
   current behavior?
3. **Not real yet:** Which visible placeholders, missing side effects, or
   unverified integrations remain?
4. **Next decision:** What single contract or boundary controls the next safe
   implementation step?
5. **Vocabulary:** Define domain terms and external names before using them.

Label every important statement as one of:

- `Implemented`: verified in the repository or by a focused executable check.
- `Target`: intended behavior that still requires implementation.
- `Verify`: an external or version-sensitive detail that needs documentation or
  isolated account evidence.

Never call a project end to end merely because its metadata validates or its
route exists.

## Use a friendly blueprint shape

Use this order unless the repository has a stronger local convention:

1. Context and constraints
2. Current state and target state
3. System ownership map
4. **Feature graph (Artifact 1)** — dependency-ordered nodes, shared/feature split
5. External contract cards
6. **File plan + acceptance test plan (Artifact 2)** — exact paths, named tests
7. End-to-end data flow
8. State and failure behavior
9. Domain journeys (`## Domain N` / `### Step N.M`)
10. Verification and definition of done

Keep paragraphs short. Use tables for ownership, fields, statuses, and failure
codes. Use JSON examples for boundary contracts. Put unresolved details in a
visible decision ledger instead of burying them in a Part.

## Domain journeys are vertical slices

Split the system by business or integration domain, not by technical layer
alone. Render each as a `## Domain N:` heading and decompose it into `### Step
N.M` sections (see "Required structure: Domain → Step"). Typical domains are:

- contract and configuration;
- authenticated intake and tenant resolution;
- external CRM or source context;
- deterministic domain rules;
- AI or recommendation decision;
- persistence and delivery side effect;
- callback, user-visible result, and release verification.

Each domain must describe the complete journey:

- entry event;
- trusted inputs and source of truth;
- owned transformations and side effects;
- exit state and data handed to the next domain (must match an edge in the feature graph);
- happy path;
- failure, retry, timeout, and expiration behavior;
- dependencies (must match the feature graph node's "Depends on" column);
- focused test or manual evidence;
- condition for marking the domain complete.

A domain is complete only when its production boundary and its evidence exist,
its feature-graph node has no unresolved forward dependency, and every file in
its plan rows is present with its named tests passing. A domain may use fakes for
external systems, but its test must execute the real application service,
controller, job, or adapter being specified.

## Contract cards

For every external boundary (and for every `external` edge in the feature graph),
show:

| Field | Required content |
| --- | --- |
| Direction | Inbound request, outbound request, callback, or event |
| Identity | Tenant, account, user, object, and correlation identity |
| Authentication | Signature, OAuth, JWT, or explicitly none |
| Payload | Exact bounded example and typed fields |
| Response | Status, envelope, output fields, and side effects |
| Timeout | Request and whole-workflow budget |
| Retry | Retryable status/categories and backoff |
| Idempotency | Key, uniqueness scope, and duplicate behavior |
| Redaction | What must not be logged or returned |
| Source | Official docs, repository file, or test-account evidence |

Do not invent callback URLs, tenant IDs, object IDs, or provider behavior when
only a callback identity or execution context is documented.

## Diagrams

For a multi-process flow, include:

- one `flowchart` for ownership and structure — reuse the feature graph (Artifact 1) here;
- one `sequenceDiagram` for request, queue, external calls, and callback order;
- one `stateDiagram-v2` when work can be blocked, retried, expired, or resumed.

Use the Mermaid documentation tool before creating an unfamiliar diagram. Then
validate and preview every diagram before presenting the specification. Keep
labels concise and make trust boundaries and asynchronous work visible.

## Current codebase discipline

Before writing the specification, inspect the nearest implementation, tests,
metadata, route, configuration, and current Git diff. Preserve user changes in
dirty files. Use existing names and abstractions where they are already the
public contract. Distinguish stale documentation from active metadata and code.

When building the feature graph and file plan, seed them from what is already
real (orientation fact 2) so existing files are marked `modify` and only genuinely
new work is added. For Laravel, verify version-sensitive behavior with Laravel Boost and keep
controllers thin, DTOs typed, external calls outside transactions, and state
changes idempotent. For third-party platforms, verify current payloads,
callbacks, scopes, rate limits, and version rules with the platform's official
Context7 documentation.

## Definition of done

Finish by proving the pipeline ran end to end, not only a checklist:

- **Feature graph valid:** every node is topologically ordered; no node owns
  writable state shared with another; `shared` nodes built before their dependents.
- **File plan valid:** every step maps to ≥1 real path and ≥2 named tests; no
  orphan files or steps.
- **Tests valid:** each acceptance test runs against the real application code in
  its row and passes; fakes are used only for external systems.
- **Source valid:** the named files exist and satisfy their tests; focused tests
  for each completed domain pass.
- metadata or schema validation from the owning package;
- formatting and static analysis where applicable;
- isolated external-account evidence for publication and end-to-end behavior;
- explicit remaining `Target` and `Verify` items.

A feature is done only when its graph node, plan row, tests, and source all
agree. Do not mark a domain complete because its route exists or metadata
validates — it is complete when valid tests and valid source both exist.