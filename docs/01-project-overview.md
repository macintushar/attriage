# Project overview

## What it is

A **WhatsApp agent platform**, not a healthcare app. The backend has no
healthcare-specific code: an "agent" is a row in a database — a system prompt
plus a set of Polymetrics (`pm`) connectors, fronted by its own WhatsApp
number. Swap the prompt and connectors and it's a different business entirely.

## The hero flow (what gets demoed)

Patient intake, end to end, over WhatsApp:

1. A patient messages the WhatsApp number, in Hindi, English, or Tamil, by
   voice note or text.
2. Sarvam (`saaras:v3`) transcribes voice to text.
3. A **Pi agent**, running in a per-session Docker sandbox, holds the
   conversation — powered by `sarvam-105b` — and drives `pm` over bash to read
   and write the customer's systems (patient record, appointment).
4. The agent works out the right specialty, writes the intake record, books
   the appointment, and confirms back to the patient.
5. If the reply is voice, Sarvam (`bulbul:v3`) synthesizes speech.

The pitch is that **none of steps 2–5 are healthcare-specific** — they're the
general shape of "collect structured info from a free-form conversation, then
mutate an external system," which is most of what customer-facing WhatsApp
bots do.

## Why this design, not a menu bot

Nearly every competing WhatsApp healthcare bot (see
[05-competitive-landscape.md](05-competitive-landscape.md)) is a **button/menu
flow**: pick a department, pick a doctor, pick a slot. This project instead
lets a general-purpose coding-agent harness (Pi) hold a real, voice-capable,
multilingual conversation and decide *for itself* what to ask, when it has
enough information, and which backend action to call — bounded by an
allowlist rather than a fixed decision tree. That's a materially harder demo
to get right, and a materially more impressive one when it works.

## Models in use

| Job | Model | Notes |
|---|---|---|
| Agent reasoning | `sarvam-105b` | 128K context, OpenAI-compatible, tool calling |
| Speech → text | `saaras:v3` | Takes WhatsApp ogg/opus directly; 30s cap per request |
| Text → speech | `bulbul:v3` | Emits opus directly, no transcode needed on the way out |

This is a **Sarvam-stack-first** build: every model in the pipeline is Sarvam's,
not a general LLM provider with Sarvam bolted on for one leg.

## System layout

```
control-plane/   TanStack Start app (:3000) — UI, API, WhatsApp, Sarvam, sandboxes, SQLite
sandbox/         Docker image with pi + pm — the security boundary for agent bash
```

The control-plane backend owns the long-lived WhatsApp (Baileys) sockets and
the sandbox reaper as in-process state, so the UI and backend run as one
application without duplicating WhatsApp connections across dev-server
reloads.

> ⚠️ As cloned, `control-plane/` is **empty** — see
> [03-status-and-gotchas.md](03-status-and-gotchas.md) for why and what to do
> about it before anyone else clones this repo.

## Who it's for

The framing in `README.md`/`HANDOFF.md` is generic B2B: any business that
wants a WhatsApp-native intake/booking agent, with healthcare (patient intake)
as the proof-of-concept vertical because it stresses every hard part at once —
multilingual voice, urgency detection, irreversible real-world writes
(booking an appointment), and a customer who is often anxious or in a hurry.
