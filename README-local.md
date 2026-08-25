# README - Local

---

now lets build and document `docs/poc-2 gcp-sse-chatbot/1-1-idea-specs.md`:

- `## TODO - Domain 7: Production Hardening (SSE pitfalls)`

---

## Pre-prompt (paste at top of every new chat)

---

> **VERY IMPORTANT — read and follow these instructions in order:**
>
> **VERY IMPORTANT — NEVER RUN `./tf.sh apply` and `./tf.sh destroy` YOURSELF, YOU CAN RUN `./tf.sh plan`:**
>
> **VERY IMPORTANT — Do not use GCloud deployment or user.roles changes - only use Terraform and GIT**
>
> **VERY IMPORTANT — Do not use GIT commit and push yourself - only use GIT for checking state and history:**
>
> **VERY IMPORTANT — use `100% strict TypeScript` where possible, `.ts` files and non usage of `any`, (frontend) only use `TailwindCSS` styling - but can use (scoped) CSS if it is really needed**

### 1.1 Read Project I

Instructions

```txt
.github/instructions/workspace.instructions.md
```

Skills

```txt
.github/skills/nodejs-strict-typescript/SKILL.md
```

### 1.2 Load project context

Read the full build spec first — it is the single source of truth for this greenfield project:

```txt
docs/1-1-idea-specs.md
```

> document per domain in this format, example `docs/1-1-domain-2-external-client-arena.md`

- Important! Do not use special chars in the `Mermaid` diagram labels

- template for the document

```txt
docs/1-1-domain-X-XXX.md.  
```

### 1.3 Extra Documentation

Use the tool `context 7` for more indepth documentation about any of the project subjects.

### 2. Follow the locked decisions

These are locked — do not revisit without explicit approval:

- **Cloud Firestore** is both the vector store (`findNearest`, COSINE) and the session/event/message state store. No Cloud SQL, no VPC connector, no BigQuery.
- **OpenRouter** for all embeddings (`openai/text-embedding-3-small`, 1536 dims, batched array calls) and chat (streaming).
- **Terraform** owns all GCP resources (`infra/`).
- **Northwind Outfitters** = the fictional e-commerce corpus (products, faq, policies, loyalty, support).

### 3. Follow existing code style

Before creating or editing a file, check **sibling files** and **related code** for the current patterns:

- Creating a module? Look at existing modules in the same or neighboring directory.
- Creating a test? Check existing tests for the same patterns.
- Creating a Vue component? Check existing components for conventions.

### 4. Core rules

- **No overengineering** — keep it clean, simple, and consistent with the spec.
- **No new dependencies** without explicit approval.
- **Every step in the spec has happy + non-happy tests** — implement both when implementing the step.
- **Deterministic doc IDs** = SHA-256 of chunk text; writes must stay idempotent.
- **Never log** the full prompt text or API keys — log model, count, latency only.

### 5. After completing the job

Run these in order and fix any errors:

```bash
# Backend (Node)
npm test

# Frontend (builds assets, catches Vite/TypeScript errors)
npm run build

# Infra (when touching infra/)
terraform plan
```

### 6. Tests

- Update tests when the codebase changes — but first verify the code change is correct.
- No need for backward compatibility for most changes (or otherwise stated).
- Run affected tests to confirm they pass and if not fix the errors.

### 7. AI CODING AGENT OPERATIONS & CODEBASE UNDERSTANDING RULES

#### 0. Read > Plan > Patch > Verify > Review (add tests?)

#### 1. Graph-Based Codebase Navigation

- Do not treat this codebase as flat text. You must traverse it as a dependency graph of logical references, function calls, class hierarchies, and modules.
- When an execution path is unclear, explicitly trace the import trees and data models end-to-end before proposing structural changes.

#### 2. Dynamic Structural Scanning

- Before modifying or generating code, partition your analysis into distinct, meaningful semantic chunks (classes, methods, interfaces) instead of reading random text blocks.
- Map the explicit abstractions and relationships of the affected domain to prevent regressions in tightly coupled modules.

#### 3. Strict Context Optimization (Node-First Retrieval)

- Prevent information overload and context-window pollution. Fetch and analyze repository files iteratively and targeted ("just-in-time"), focusing only on the specific execution nodes relevant to the current task.
- Rely on verified local or cloud-based indexing structures to pinpoint code logic, rather than guessing file relevance via blanket keyword searches.

#### 4. Multi-Step Execution Planning

- You must function with goal-oriented reasoning: formulate a declarative, multi-step execution plan (identifying dependencies, required refactors, and external tools) before writing a single line of code.
- Anticipate the ripple effects of your edits downstream in the program's structural well-formedness.

#### 5. Reflection & Test-Driven Verification

- For every code change, execute an internal self-correction and reflection loop.
- Validate your output against the repository's compilers, linters, and test suites. If a regression or test failure occurs, adjust your implementation path autonomously based on the error output.

---

> **The job to be done:**
