---
name: remembering
description: How to keep durable memory of the person you are talking to, so they never have to repeat themselves. Read before your first memory update in a conversation.
---

# Remembering

This thread is one person, over weeks. `/workspace` survives between
conversations, so anything you write there you still have next time. Nothing
else carries — your context window is gone by their next message.

## Two stores

| Store | What it is | Read by |
|---|---|---|
| `/workspace/memory/MEMORY.md` | snapshot of the current truth | you, each conversation |
| `memory_facts` (warehouse) | append-only ledger, timestamped | `pm query`, reverse ETL |

MEMORY.md is what you *believe now*: a short markdown file you `read` at the
start of a conversation and `write` back when something changes. The ledger is
what you *observed, and when* — a warehouse table like any other, so it can be
queried or exported. Write both. They answer different questions.

## What to write

| kind | write |
|---|---|
| `identity` | name, who they are acting for ("booking for her mother, 68") |
| `preference` | language mix, register, voice vs text, when to reach them |
| `context` | the ongoing situation this thread is about |
| `commitment` | anything you promised to do |
| `outcome` | what actually happened, with the reference from tool output |

Record an outcome only from tool output — the appointment id, the reference
string, the run that returned `records_succeeded >= 1`. Never a detail you
composed yourself. That is the pm-workflow rule, and it matters more here: a
wrong fact in memory gets repeated back to them for months.

## What never to write

- **Secrets.** No OTPs, card or account numbers, passwords, API keys, tokens.
  Not in MEMORY.md, not in the ledger, not anywhere under `/workspace`.
- **Speculation.** No diagnoses, no guess at what is wrong with them, nothing
  inferred about income, religion, caste or status. Only what they said, or
  what a tool returned.
- **Chatter.** Not "asked about parking". Durable facts only.
- **Anything they asked you to forget.**

## When

The same turn you learn it, before you reply. A container can be reaped between
turns and an unwritten fact is simply lost. Do it silently — never narrate it,
never say "I've saved that", never mention a file. See `talking-to-people`.

## Updating MEMORY.md

`read` it, rewrite the affected line, `write` the whole file back. Newest
statement wins: replace the old line rather than stacking a second one beside
it. When a fact *changed* rather than arrived, date it —
`Prefers Tamil (as of 2026-07-27; was English)`.

Budget: **~60 lines**. Over that, condense **History** first — collapse old
one-liners into one line per month. Keep *Who they are* and *Preferences*
verbatim; those are the lines that stop someone repeating themselves.

## Appending to the ledger

The table is the file
`$PM_PROJECT_DIR/.polymetrics/warehouse/memory_facts.jsonl`, one JSON object
per line, flat scalar fields. There is nothing to create first — appending
makes the table.

| Field | Value |
|---|---|
| `id` | `mem_` plus 6 hex characters, unique per row |
| `kind` | `identity` / `preference` / `context` / `commitment` / `outcome` |
| `key` | `snake_case` fact name — reuse the same key when it changes |
| `value` | the fact, as a short string |
| `observed_at` | ISO 8601, e.g. `2026-07-26T09:14:00Z` |
| `source` | `stated` / `tool` / `inferred` |
| `status` | `active` / `superseded` |
| `supersedes` | id of the row this replaces, or `""` |

```bash
cat >> "$PM_PROJECT_DIR/.polymetrics/warehouse/memory_facts.jsonl" <<'EOF'
{"id":"mem_7a1c04","kind":"identity","key":"patient_name","value":"Asha Verma","observed_at":"2026-07-26T09:14:00Z","source":"stated","status":"active","supersedes":""}
EOF
```

**Append with `>>`, never `>`.** A single `>` truncates the whole ledger. And
never edit a line already in the file — the ledger is history, not state.

## Correcting a fact

Append a new row with the same `key`, and `supersedes` pointing at the old id.
Leave the old line exactly where it is.

```bash
cat >> "$PM_PROJECT_DIR/.polymetrics/warehouse/memory_facts.jsonl" <<'EOF'
{"id":"mem_b93f52","kind":"preference","key":"reply_language","value":"Tamil-English mix","observed_at":"2026-07-27T18:02:00Z","source":"stated","status":"active","supersedes":"mem_2d80aa"}
EOF
```

Reader-side rule: **newest row per key wins.** So the correction takes effect
the moment it lands, and the old row stays as a record of what you believed
before.

## Reading current state

```bash
cd "$PM_PROJECT_DIR" && pm query run --sql "SELECT * FROM memory_facts"
```

`SELECT * FROM <table>` (plus an optional `LIMIT n`) is the **only** query this
build's engine supports — no column lists, no `WHERE`, no `ORDER BY`. They fail
with `only SELECT * FROM <table> [LIMIT n] is supported`. Do not retry
variations; take all the rows and apply the reader-side rule yourself: rows are
in append order, so **for each key, the last row wins** — and if that last row
is a tombstone (empty value), the key is forgotten.

MEMORY.md should already have told you all of this — reach for the query when
you need dates, or when MEMORY.md looks wrong.

## Forget requests

When they ask you to drop something:

1. Remove the line from MEMORY.md.
2. Append a tombstone row for that key: same `key`, `value` set to `""`,
   `"status":"superseded"`, `supersedes` set to the last id for that key.
3. Confirm in one line — "Done, I've dropped that" — and move on.

Do not delete or rewrite the earlier lines. If the key's newest row is a
tombstone, the key is gone, whatever the older rows say — that is the same
last-row-per-key rule from "Reading current state".

## ❌ / ✅

> ❌ "I've noted that in your file and updated your record."
> ✅ (say nothing about it — just answer them)

> ❌ `cat > ".../memory_facts.jsonl"` — truncates the ledger
> ✅ `cat >> ".../memory_facts.jsonl"`

> ❌ Editing `mem_7a1c04` in place to fix the spelling
> ✅ Appending `mem_b93f52` with `"supersedes":"mem_7a1c04"`

> ❌ `"key":"login_otp","value":"483920"`
> ✅ Never written anywhere

> ❌ `"key":"condition","value":"likely angina"` (you are not a clinician)
> ✅ `"key":"reported_symptom","value":"chest pain since morning"`,
>    `"source":"stated"`

> ❌ "Sorry, what was your mother's name again?" when MEMORY.md has it
> ✅ "For Lakshmi again, or someone else this time?"
