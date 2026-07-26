# Hospital records (`hms`)

The hospital's system of record. Use `hms` for anything the hospital must know
about after the conversation ends: who the patient is, and when they are seen.

Run `hms help` for the full list. The path through a normal intake is three
commands:

```bash
hms find-patient                        # already registered? (uses this patient)
hms new-patient --name "Priya S" --language ta
hms doctors cardiology                  # pick a doctor for the specialty
hms book --patient pat-a1b2c3 --doctor doc-002 --at 2026-07-28T10:30:00+05:30 \
         --reason "chest pain, 3 days"
```

Every command prints JSON. Check `.ok` before you trust the rest:

```bash
hms book --patient pat-a1b2c3 --doctor doc-002 --at 2026-07-28T10:30:00+05:30 | jq -r '
  if .ok then "booked \(.appointment.id) with \(.doctor.name) in \(.doctor.room)"
  else "failed: \(.error)" end'
```

**You never pass a phone number.** `hms` already knows who you are talking to —
it takes their contact identity from the channel and fills it in for you, both
for `find-patient` and for `new-patient`. This is deliberate: an agent asked for
a number it had not been given wrote an invented one onto a patient record, so
the decision was taken away from you. Any `--phone` you pass is overridden.

If the patient asks for the record to be under a *different* number, say you
will pass that to the desk; do not try to force it here.

Rules that matter:

- **A department with no doctors is an error, not an empty list.** `hms doctors
  <department>` returns `ok: false` with `available_departments` when nothing
  matches. Pick from that list — do not retry with a different spelling.
  Spelling is already handled: `orthopaedics`, `ortho`, `joint pain` and
  `back pain` all reach orthopedics.
- **Look before you create.** `find-patient` first. `new-patient` is idempotent
  on phone number and returns `created: false` for a patient who already exists,
  so a double call is safe — but you still want the existing record's `id`.
- **Confirm before booking.** Say the doctor, the department and the time back
  to the person and get a yes before you call `hms book`. Creating a patient is
  cheap; a booking is a real slot.
- **`--at` is ISO 8601 with an offset.** Resolve "tomorrow morning" to an actual
  timestamp yourself; the HMS does not parse natural language.
- **Confirm with what they can act on**: the doctor's name, the department, the
  day and time, and the room. In a *typed* reply add the appointment id too.
  Never read an id like `apt-0115ea` aloud in a voice reply — spoken, it is
  noise, and it costs you one of the two or three sentences a voice note gets.
  The desk can find them by name and phone number.
- If `hms health` fails, the hospital system is down: tell the person you could
  not complete the booking and do not claim one was made.
