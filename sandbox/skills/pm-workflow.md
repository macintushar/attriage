---
name: pm-workflow
description: How to read from and write to external systems with the `pm` CLI.
---

# Using `pm`

`pm` is a local-first ETL / reverse-ETL CLI. It is already installed, and a
project has already been initialised at `$PM_PROJECT_DIR` (`/workspace/project`).
**Run every `pm` command from that directory.**

Everything you do goes through three ideas:

- **Connectors** — integrations (`pm connectors list`). Each declares read
  streams and, if its API supports mutations, reverse-ETL **write actions**.
- **The warehouse** — local tables. In this build the warehouse is plain JSONL:
  a table named `foo` is literally the file
  `$PM_PROJECT_DIR/.polymetrics/warehouse/foo.jsonl`, one JSON object per line.
- **Reverse ETL** — the only way to write to an external system. It reads a
  warehouse table, maps its fields onto a connector's write action, and executes.

## Output conventions

Add `--json` to any command for a machine-readable envelope:
`{"api_version": "polymetrics.ai/v1", "kind": "<Type>", ...}`. Parse it with
`jq`. Exit codes are stable and worth branching on:

| Code | Meaning |
|---|---|
| 0 | success |
| 2 | usage error — you got the flags wrong |
| 3 | validation — your data or mapping is wrong |
| 4 | auth — the credential is missing or rejected |
| 7 | policy / approval required |

## Before you write: inspect

Never guess field names or action names. Ask the connector.

You were told which connector you may use in your system prompt. Substitute that
name — it is a bare word like `outbox`, never a flag. Inspect it:

```bash
pm connectors inspect outbox          # human manual, lists write actions
pm connectors inspect outbox --json | jq .
```

`inspect` and `catalog` are different subcommands and their flags do **not**
mix. `--capability` belongs to `catalog` only, and `catalog` takes no connector
name:

```bash
pm connectors catalog --capability write --json   # which connectors can write at all
```

> `pm connectors inspect --capability write` is not a valid command. It fails
> with `error: connector "--capability" not found`, because `inspect` reads its
> first argument as a connector name. If you see that error, you used the wrong
> subcommand — switch to `catalog`, or pass your actual connector name to
> `inspect`. Do not retry it unchanged.

Most connectors are **read-only** (`capabilities.write=false`). If the one you
need cannot write, say so plainly rather than inventing a workaround.

## Writing a record — the full recipe

Say you have collected details in conversation and need to push them out.

**1. Stage the record as a warehouse table.** Because the warehouse is JSONL,
you create a table by writing a file. One JSON object per line, no wrapping
array, no trailing comma. Use flat scalar fields.

```bash
cat > "$PM_PROJECT_DIR/.polymetrics/warehouse/patient_intake.jsonl" <<'EOF'
{"id":"pat_001","name":"Asha Verma","age":34,"phone":"+919876501234","specialty":"cardiology"}
EOF
```

Verify it before going further:

```bash
cd "$PM_PROJECT_DIR" && pm query run --sql "SELECT * FROM patient_intake"
```

**2. Plan the write.** `--map <source_field>:<destination_field>` maps your
table's columns onto the action's fields, and is repeatable. **At least one
`--map` is required** — without it the plan fails with
`error: at least one field mapping is required`. Map every field the action
needs, using the names you confirmed in step 0.

```bash
pm reverse plan intake_to_hms \
  --source-table patient_intake \
  --destination <connector>:<credential> \
  --action <action_name> \
  --map id:external_id --map name:name --map specialty:specialty
```

Plan output prints a **plan id** and an **approval token**.

> The approval token appears **only in human-readable output**. `--json`
> redacts it (you get `"approval_required": true` and no token). So run the
> plan step *without* `--json` when you need the token, and read it off stdout.

**3. Preview.** Always look before you execute. This shows the mapped sample
rows, the destination, the action, and the record count.

```bash
pm reverse preview <plan-id> --json | jq .
```

Check the record count and the sample values are what you intended. If the
mapping is wrong, create a new plan — do not try to edit one.

**4. Execute.**

```bash
pm reverse run <plan-id> --approve <token> --json
pm reverse status <run-id> --json
```

The run returns `records_succeeded` / `records_failed` counts, not the created
remote records. If you need to confirm what landed, read it back with an ETL
read or a connector stream.

**A plan is not a write.** `plan` and `preview` change nothing anywhere — a plan
sits at `status: planned` until you run it. Step 4 is the only step that writes.
If you stop after `preview`, nothing has happened, no matter how correct the
preview looked.

## Rules

- **Approval tokens are single-use.** A replay fails. Never reuse one, never
  cache one, never guess one.
- **Only write actions you were explicitly configured to perform.** If the task
  seems to need an action outside that set, stop and explain rather than
  reaching for it.
- **Confirm before irreversible writes.** Reverse ETL mutates real external
  systems — it books real appointments, creates real records, and notifies real
  people. Read the details back to the user and get agreement first.
- **Never report a result you did not observe in tool output.** Only say a
  record was created or an appointment was booked after `pm reverse run` has
  actually returned `records_succeeded >= 1`. Never state a confirmation detail
  — a doctor's name, a date, a time, a location, a reference number — that you
  did not read from tool output. Inventing one is worse than failing: the user
  acts on it, arrives, and finds nothing.
- **If you cannot look something up, say so.** When you have no connector that
  can *read* the data you need (check `capabilities.read`), you cannot confirm
  or choose it. Tell the user plainly what you recorded, what still needs a
  human, and stop. Do not fill the gap with a plausible-sounding answer.
- **When you are stuck, stop in one message.** Say what you did, what you could
  not do, and what happens next — then end the turn. Do not re-check the
  connector list you have already checked, and never repeat a sentence you have
  already written. Looking for a connector that was not there the first time
  wastes the turn; two or three sentences to the user is the whole job.
- **Never put secret values in command arguments**, in files under
  `/workspace`, or in anything you say. Credentials are injected from the
  environment and referenced by name only.
- **One record at a time** is fine and usually clearer. Do not batch unrelated
  records into one plan.
- If a step fails, read the error, fix the actual cause, and retry that step.
  Do not fall back to inventing data.
- **Never run the same command twice after it has failed.** Change it or stop.
  If two different attempts at the same step both fail, stop retrying, tell the
  user plainly that you could not complete that step, and say what failed. A
  clear "I couldn't book that" is useful; an endless retry loop times the turn
  out and leaves the user with silence.

## Per-connector reference

Generated, connector-specific guides live in `/workspace/skills/` (also at
`$PM_SKILLS_DIR`). Consult the one for your connector before planning a write.
