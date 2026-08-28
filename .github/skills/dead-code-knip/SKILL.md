---
name: dead-code-knip
description: "Use when adding or running a dead-code gate with knip in a TypeScript/JavaScript project: install knip, configure entry points and project globs so it does NOT report half your codebase, wire it into the build/CI checks, and interpret its findings (unused exports, files, dependencies, types). Covers the exported-but-internal false-positive trap and the settings that keep knip useful without fighting your conventions."
argument-hint: "Describe the package or project you want to add a knip dead-code gate to."
---

# Dead-code detection with knip

Use this skill to add a **repeatable dead-code gate** to a TypeScript (or JS)
project. It records the hard-won settings that stop knip from flagging half your
codebase, so you get a *useful* report instead of a wall of false positives.

## What knip catches (and what it doesn't)

Knip finds **unused code that neither `tsc` nor ESLint can see**:

- **Unused exports** — exported functions/interfaces/types/constants that no
  other file imports. This is the "completed but never used" case: `tsc` treats
  an `export` as "used" from the module's perspective, so it never flags it.
- **Unused files** — files nothing imports.
- **Unused dependencies / devDependencies** — packages in `package.json` that
  no source imports.
- **Unused exported types** — interfaces/types exported but never referenced.

It does **NOT** catch unused *locals* within a file — that's `tsc`
(`noUnusedLocals`/`noUnusedParameters`) and ESLint (`no-unused-vars`). Run those
too; knip is complementary, not a replacement.

## The #1 trap: exported-but-internal symbols (false positives)

Knip's **default** behavior flags *any* exported symbol that isn't imported
elsewhere. But many codebases intentionally export symbols that are only used
**within their own module**:

- Factory input/output contract types (`GenerateOnceInput`, `StreamAnswerInput`)
- Constants used internally (`MAX_CONVERSATION_TURNS`, `CORS_ALLOW_METHODS`)
- Types consumed via `ReturnType<typeof createX>()` (knip can't see through
  `ReturnType<typeof>`)

Without configuration, knip reports ~19+ of these per package — a wall of noise
that makes the gate useless. The fix is one setting:

```json
{
  "ignoreExportsUsedInFile": true
}
```

This tells knip: *"an export used within its own file is not dead."* It keeps
knip catching genuinely dead exports while respecting the convention of
exporting a module's public contract.

## Recommended `knip.json` (project-agnostic)

```json
{
  "$schema": "https://unpkg.com/knip@6/schema.json",
  "entry": ["src/index.ts"],
  "project": ["src/**/*.ts", "test/**/*.ts"],
  "ignoreExportsUsedInFile": true
}
```

### Key settings explained

| Setting | Purpose | Why it matters |
|---|---|---|
| `entry` | The app's entry point(s) | Without this, knip flags your entry file as "unused". Use the real entry: `src/server.ts`, `src/cli.ts`, `src/main.ts`, `src/App.vue`, etc. |
| `project` | The files knip scans | Must cover all source + test files. **Include every extension you import** (see CSS gotcha below). |
| `ignoreExportsUsedInFile` | Treat in-file usage as "used" | **The critical one** — kills the exported-but-internal false positives. |
| `ignoreDependencies` | Whitelist deps knip can't trace | Only for deps referenced in ways knip can't follow (e.g. CSS `@import`, plugins). Prefer fixing the `project` glob first. |

### Gotchas

1. **CSS `@import` (Tailwind etc.)** — if a `.css` file does `@import 'tailwindcss'`
   and `.css` is NOT in `project`, knip reports `tailwindcss` as an unused
   dependency. Fix: add `"src/**/*.css"` to `project` — then knip traces the
   import and the false positive disappears (no `ignoreDependencies` needed).

2. **`ReturnType<typeof createX>()`** — knip can't see that a factory's contract
   types are used via `ReturnType<typeof>`. `ignoreExportsUsedInFile` handles
   most of these since the types are used within the factory file itself.

3. **Entry points** — always list the real entry. For a Vite app, `src/App.vue`
   is often a better entry than `src/main.ts` (knip follows the import graph
   from `index.html`). Knip will tell you if an entry is redundant ("Remove
   redundant entry pattern") — trust it and simplify.

4. **Test files count as usage** — a symbol used only in `test/**` is *not* dead.
   Keep `test/**` in `project` so knip doesn't flag test-only exports. (If you
   *want* to find test-only exports, that's a separate manual review — knip
   treats them as used.)

## Install + wire into the check chain

Install as a devDependency and add a script:

```bash
npm i -D knip
```

```json
{
  "scripts": {
    "knip": "knip"
  }
}
```

> **Wire knip into your CI/deploy check chain so it ALWAYS runs** — e.g.
> `typecheck → lint → knip → test → build`. The whole point is a permanent
> gate; if it's a separate manual command, it gets skipped.

### ⚠️ Do NOT put knip inside `npm run build` if the build runs in a container

If your `build` script runs inside a **Docker build** (or any context that
copies only `lib`/`src` and **not** `test/`), do NOT prepend `npm run knip &&`
to `build`. Knip's `project` glob includes `test/**/*.ts`, so in a test-less
build context it will:

- Flag dev-only deps as unused (`@eslint/js`, `@typescript-eslint/*`, etc.)
- Flag test-only exports as dead (`normalizeSourceToken`, etc.)
- Emit a "Refine project pattern (no matches)" hint for `test/**/*.ts`

That makes the container build fail on false positives. Instead, run knip in
the **local/CI check chain** where the full source + tests are present, and keep
`build` as the plain compile step. Example deploy gate:

```bash
run_checks() {
  npm run typecheck
  npm run lint
  npm run knip      # full source + tests present here
  npm test
  npm run build     # plain compile — knip already ran above
}
```

## Interpreting findings

When knip reports something, classify it:

1. **Genuinely dead** (never used even internally) → **delete it.** Examples:
   a `ChatResponse` interface nothing references, an `OPTIONAL_KEYS` constant
   nothing reads, a `StatusValue` type superseded by another type.
2. **Exported-but-internal** (used within its own file) → **false positive** if
   `ignoreExportsUsedInFile` is set; if it's still reported, the symbol is
   genuinely unused *within its own file too* → delete it.
3. **Used via `ReturnType<typeof>`** → false positive (handled by
   `ignoreExportsUsedInFile`).
4. **Dependency referenced via CSS/plugin** → fix the `project` glob, don't
   blanket-ignore.

## Verification checklist

After adding knip and removing dead code:

```bash
npm run knip        # should exit 0 with no findings
npm test            # still green
npm run build       # still green (now includes knip)
```

## Multi-package monorepos

Apply the same `knip.json` per package (each has its own `entry`/`project`).
Run knip from each package directory. Keep the config minimal and identical in
shape across packages so it's easy to copy to new ones.
