---
name: vue-component-decomposition
description: "Use when building or reviewing a Vue 3 SFC (or similar reactive component) that is growing too large: a single .vue file holding the whole page, too many responsibilities, or a template that is hard to read. Covers splitting big template files into focused components on logical boundaries — both larger page-level sections and smaller reusable pieces — with typed props/emits, shared pure helpers in lib/, and keeping App.vue as a thin composition root."
argument-hint: "Describe the Vue component or template file you want to break up, and the logical boundaries you see."
---

# Vue Component Decomposition

Use this skill when a Vue SFC is getting too big and you need to break it up into
components. The goal is **readability and single responsibility**, not
over-engineering: split on *logical* boundaries, at both the larger page-level
scale and the smaller reusable scale, and keep the parent as a thin composition
root that wires state and events.

## When to decompose
A single `.vue` file is a candidate when it shows several of these signs:
- The `<template>` is many hundreds of lines and mixes several unrelated UI
  regions (header, chat thread, sidebar, multiple modals, forms).
- The `<script setup>` holds state and helpers for many distinct concerns.
- A section is self-contained: it has its own visible state, its own rendering
  logic, and a clear boundary (a panel, a modal, a list, a form, a chart).
- The same markup/logic is (or could be) reused in more than one place.
- You keep scrolling past unrelated code to edit one feature.

## The two decomposition scales
Decompose on **logical** boundaries, not arbitrarily. Two useful scales:

1. **Larger page-level sections** — a whole region of the page that is
   self-contained and has a clear purpose (e.g. a sidebar, a modal, a chat
   thread, a settings panel). These become components that receive the data
   they render and emit the events they trigger.
2. **Smaller reusable pieces** — a focused, repeatable unit (a source chip, a
   timing bar, a progress indicator, a modal shell). These become components
   that are easy to reuse and test in isolation.

Both scales follow the same rules below. Prefer extracting the *larger* logical
sections first; extract smaller pieces when they are reused or when a section
itself gets too big.

## Rules

### 1. One component, one responsibility
Each component should answer "what does this render / what does this do?" in one
sentence. If you need "and" or "also", split it.

### 2. Parent is a thin composition root
`App.vue` (or the page component) should mostly **wire** things: own the shared
state, pass data down as props, and handle events up. It should not contain the
full markup of every region. After decomposition the parent template reads like
a list of components with their props and event handlers.

### 3. Data flows down via typed props; events flow up via typed emits
- Pass only what the child needs to render — not the whole store.
- Use `defineProps<{ ... }>()` and `defineEmits<{ ... }>()` with explicit types
  (100% strict TypeScript, no `any`).
- The child never mutates parent state directly; it emits an event and the
  parent decides what to change.
- Name events with kebab-case in the template (`@open-chunk`) and camelCase in
  the emit declaration (`'open-chunk'`).

### 4. Shared pure logic lives in `lib/`, not in components
If two components need the same helper (a color map, a formatter, a computed
breakdown), move it to a pure function in `lib/` (e.g. `lib/trace.ts`) and import
it directly. Do not duplicate it, and do not prop-drill a function down just to
share it. Pure helpers stay unit-testable without mounting a component.

### 5. Keep the transition/teleport ownership clear
- A `<Transition>` that wraps a component stays in the parent (the parent owns
  the show/hide state and the animation).
- A `<Teleport to="body">` that is intrinsic to a modal belongs *inside* that
  modal component, so the modal is self-contained.
- The component receives a `show`/`open` prop and emits `close`; the parent owns
  the boolean.

### 6. Follow existing sibling conventions
Before creating a component, look at neighboring components and the codebase
conventions: naming (PascalCase files), `<script setup lang="ts">`, Tailwind
utility styling (scoped CSS only if truly needed), and how props/emits are typed.

### 7. Shared non-scoped CSS goes in a global stylesheet, not a component
When several components need the same CSS that **cannot** be a Tailwind utility
or a scoped rule, extract it to a single global stylesheet imported once in
`main.ts` (e.g. `src/utilities.css`), not duplicated per component. The classic
cases:
- **`v-html` markdown output** (`.answer`): the generated HTML carries no
  `data-v` scoping attribute, so `scoped` + `:deep()` per component is fragile
  and duplicated. Style it globally once.
- **Pseudo-element scrollbar utilities** (`.no-scrollbar`): `::-webkit-scrollbar`
  rules don't extend into scoped selectors well.
- **Shared animations / transitions** used by multiple components (busy `dots`,
  indeterminate `bar-breathing`, the `drawer` transition).

Keep `src/style.css` as only the Tailwind import + `@theme`/`:root` tokens +
`body` reset; put the shared component CSS in a separate `utilities.css` so the
two concerns stay distinct.

### 8. Shared pure logic lives in `lib/`, not in components
If two components need the same helper (a color map, a formatter, a computed
breakdown, a chunk-modal normalizer), move it to a pure function in `lib/` (e.g.
`lib/trace.ts`, `lib/chunkModal.ts`, `lib/format.ts`) and import it directly. Do
not duplicate it, and do not prop-drill a function down just to share it. Pure
helpers stay unit-testable without mounting a component.

## Worked example — extracting a sidebar and a modal
A large `App.vue` held a RAG trace sidebar and a timings modal inline. The
decomposition:

- **`components/TraceSidebar.vue`** — the sidebar. Props: `trace`, `canAsk`,
  `turnCount`, `conversationEnded`, `timingRows`, `hasUsage`. Emits: `close`,
  `open-chunk`, `open-timings`. The `<Transition name="drawer">` stayed in
  `App.vue` around the component.
- **`components/TimingsModal.vue`** — the modal. Props: `show`, `timingRows`.
  Emits: `close`. It owns its own `<Teleport to="body">` and computes its
  stacked-bar breakdown internally.
- **`lib/trace.ts`** — the shared `timingColor()` helper moved here so both
  components import it (no duplication, no prop-drilling).
- **`App.vue`** — became a thin root: `<TraceSidebar ... @close @open-chunk
  @open-timings />` and `<TimingsModal :show @close />`, wiring the shared state.

## Worked example — a full page decomposed into a thin root
A single page component held the entire UI (header, a status/progress strip,
banners, a scrollable content list, an input form, a side panel, and several
modals). It was split on logical boundaries so the page component became a thin
composition root that only wires state and events. The same shape applies to any
page, whatever the domain:

- **`components/PageHeader.vue`** — the page title, any counter/badge pills, and
  the primary action buttons. Props: the values it renders (e.g. `count`,
  `canAct`, `panelOpen`, `busy`). Emits: the actions (`toggle-panel`,
  `new-item`).
- **`components/StatusStrip.vue`** — a progress/status indicator. Props:
  `label`, `progress`, `indeterminate`.
- **`components/InfoBanner.vue`** / **`components/ErrorBanner.vue`** — the
  informational and error banners. Emits: their single action (`retry`,
  `dismiss`).
- **`components/ContentList.vue`** — the scrollable main content region. Props:
  the items to render plus any live/streaming payload. Emits: item actions
  (`open-item`). It owns the scroll container and exposes `scrollToBottom()`
  via `defineExpose` so the parent's auto-scroll watchers call
  `listEl.value?.scrollToBottom()`.
- **`components/InputForm.vue`** — the input row. Props: `modelValue` (v-model),
  `busy`, `canSubmit`. Emits: `update:modelValue`, `submit`, `open-picker`.
- **`components/DetailModal.vue`** / **`components/PickerModal.vue`** —
  self-contained modals owning their own `<Teleport to="body">`.
- **`lib/itemModal.ts`** — a normalizer that turns a clicked item (from the list
  or the side panel) into the modal payload, moved out of the page so it is
  unit-tested without mounting a component.
- **`lib/format.ts`** — shared display helpers (e.g. `formatTime`) used by
  several components.
- **`src/utilities.css`** — the shared non-scoped CSS (rendered-content styles,
  a `.no-scrollbar` utility, shared animations and the panel transition),
  extracted from the page's `<style>` blocks and imported once in `main.ts`.

After this, the page component's template is a short list of components with
props and event handlers, and each component is independently readable and
testable.

## Verification
```bash
npm run typecheck   # vue-tsc --noEmit — strict TS on props/emits
npm run lint        # eslint — no-explicit-any, unused imports
npm run build       # vite build — catches template/TS errors
npm test            # unit tests still pass
```
After decomposition the parent template should be noticeably shorter and each
component should be independently readable and testable.
