---
name: structural-goal-testing
description: "Use when writing or reviewing tests that assert on data that grows, shrinks, or changes over time (counts, exact totals, hard-coded sizes of living data sets). Covers replacing brittle count assertions with structural/goal checks: assert shape, invariants, and intent rather than specific numbers, so tests stay green as the data evolves."
argument-hint: "Describe the test or data set you are asserting on, and the brittle count/quantity assertion you want to make robust."
---

# Structural / Goal Testing (not brittle counts)

Use this skill when a test asserts on **living data** — data that grows, shrinks,
or changes as the product evolves (sample questions, corpus entries, config
lists, fixture sets, generated content). The failure mode is a **brittle count
test**: it hard-codes a number (e.g. `expect(all.length).toBeGreaterThanOrEqual(25)`)
that silently breaks the moment someone adds, removes, or comments out an item.

## The principle
**Test the structure and the goal, not the count.** Ask: *what invariant must
always hold regardless of how many items exist?* Assert that, and only that.
A test should fail when the *contract* is violated, not when the *data volume*
changes.

## Brittle patterns to avoid
- `expect(list.length).toBeGreaterThanOrEqual(N)` — breaks when the set shrinks
  below `N` for a legitimate reason.
- `expect(list.length).toBe(N)` — breaks the moment an item is added.
- Asserting an exact total across a growing set (`flatMap(...).length >= 25`).
- Asserting a minimum per-group count (`g.questions.length >= 5`) when a group
  legitimately has fewer.

These couple the test to the *current* size of the data, which is not a contract.

## Structural / goal checks to prefer
- **Shape**: every item has the required fields with the right types.
- **Invariant**: every item is non-empty, trimmed, unique, well-formed, etc.
- **Fixed contract**: things that are genuinely fixed (e.g. "one group per corpus
  folder", "the 5 known folders") can still be asserted exactly — that is a
  contract, not a growing set.
- **Goal**: "every corpus folder offers at least one quick-start" → `> 0`, not
  `>= 5`. "every question is a meaningful non-empty string" → check each item,
  not the total.

## Decision guide
| The thing being asserted | Brittle (avoid) | Robust (prefer) |
|---|---|---|
| Total size of a growing set | `length >= 25` | drop it, or assert `> 0` |
| Per-group minimum | `>= 5` per group | `> 0` per group |
| Fixed set of known folders | — | `toEqual([...])` (a real contract) |
| Every item well-formed | — | loop and assert each item's shape |
| Every item non-empty | — | loop and assert `trim().length > 0` |

## Worked example
A `sampleQuestions` test asserted `all.length >= 25` and `g.questions.length >= 5`.
When 3 questions were commented out (23 total; two groups at 4), the tests broke
even though the data was still valid. The fix:

- Removed the brittle `all.length >= 25` total.
- Changed `g.questions.length >= 5` → `g.questions.length > 0` (the goal: every
  corpus folder offers at least one quick-start).
- Kept the exact `toEqual(['products','faq','policies','loyalty','support'])`
  folder check — that is a fixed contract, not a growing set.
- Kept the per-question quality loop (non-empty, trimmed, meaningful length).

Now the test stays green as the question set grows or shrinks, and still fails if
a group is emptied or a question becomes malformed.

## Rules
1. **Never assert a hard-coded size on living data.** If the number is not a
   fixed contract, don't assert it.
2. **Assert the invariant, not the volume.** What must always be true?
3. **Keep exact assertions only for true contracts** (fixed folder names, fixed
   schema, fixed enum values).
4. **Loop over items to check shape/quality** instead of summing them into one
   count.
5. **When a count test breaks, ask "is the data wrong or is the test wrong?"**
   If the data is still valid, fix the test to check structure/goal — do not
   bump the number to match the new size (that just re-brittles it).

## Verification
```bash
npm test   # the affected suite passes and stays green as the data evolves
```
A good structural test fails only when the *contract* is broken, not when the
data volume changes.
