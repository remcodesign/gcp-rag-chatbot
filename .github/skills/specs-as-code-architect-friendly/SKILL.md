---
name: specs-as-code-architect-friendly
description: "Use when a software idea, reverse-engineering task, or architecture blueprint needs a readable domain-by-domain structure with complete end-to-end journeys, explicit current-versus-target status, diagrams, contracts, and executable acceptance evidence."
argument-hint: "Describe the product flow or domain journey that should become a friendly architecture specification."
---

# Friendly Specs-As-Code Architect

Use this skill to turn a complex idea or partially implemented system into a
specification that people can read and implement one domain at a time. It is a
presentation and execution variant of specs-as-code, not a replacement for
security, validation, or test rigor.

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
4. External contract cards
5. End-to-end data flow
6. State and failure behavior
7. Domain journeys
8. Verification and definition of done

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
- exit state and data handed to the next domain;
- happy path;
- failure, retry, timeout, and expiration behavior;
- dependencies;
- focused test or manual evidence;
- condition for marking the domain complete.

A domain is complete only when its production boundary and its evidence exist.
A domain may use fakes for external systems, but its test must execute the real
application service, controller, job, or adapter being specified.

## Contract cards

For every external boundary, show:

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

- one `flowchart` for ownership and structure;
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

For Laravel, verify version-sensitive behavior with Laravel Boost and keep
controllers thin, DTOs typed, external calls outside transactions, and state
changes idempotent. For third-party platforms, verify current payloads,
callbacks, scopes, rate limits, and version rules with the platform's official
Context7 documentation.

## Definition of done

Finish with executable commands and evidence, not only a checklist:

- focused tests for each completed domain;
- metadata or schema validation from the owning package;
- formatting and static analysis where applicable;
- isolated external-account evidence for publication and end-to-end behavior;
- explicit remaining `Target` and `Verify` items.
