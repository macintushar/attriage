/**
 * Mock hospital management system.
 *
 * Stands in for the HIS the agent would really write to. It is deliberately
 * dumb: a JSON file on disk, no auth, no validation beyond required fields.
 * Its only job is to prove the loop — the agent, from its sandbox bash tool,
 * creates a patient and books an appointment, and the record is there
 * afterwards for anyone to look at.
 *
 *   bun run mock-hms/server.ts        # :8081, data in mock-hms/data.json
 */
const PORT = Number(process.env.HMS_PORT ?? 8081);
const DB_PATH = new URL("./data.json", import.meta.url).pathname;

type Patient = {
  id: string;
  name: string;
  phone: string;
  dob?: string;
  age?: string;
  sex?: string;
  language?: string;
  notes?: string;
  created_at: string;
};

type Appointment = {
  id: string;
  patient_id: string;
  doctor_id: string;
  department: string;
  scheduled_at: string;
  reason?: string;
  status: "booked" | "cancelled";
  created_at: string;
};

type Doctor = { id: string; name: string; department: string; room: string };

type DB = {
  patients: Patient[];
  appointments: Appointment[];
  doctors: Doctor[];
};

// Fixed roster: the agent picks a specialty, so it needs something to pick from.
const DOCTORS: Doctor[] = [
  {
    id: "doc-001",
    name: "Dr. Anita Rao",
    department: "general medicine",
    room: "A-102",
  },
  {
    id: "doc-002",
    name: "Dr. Vikram Iyer",
    department: "cardiology",
    room: "B-204",
  },
  {
    id: "doc-003",
    name: "Dr. Meera Nair",
    department: "pediatrics",
    room: "C-011",
  },
  {
    id: "doc-004",
    name: "Dr. Sanjay Gupta",
    department: "orthopedics",
    room: "B-115",
  },
  {
    id: "doc-005",
    name: "Dr. Fatima Sheikh",
    department: "dermatology",
    room: "A-330",
  },
  {
    id: "doc-006",
    name: "Dr. Ravi Krishnan",
    department: "ent",
    room: "C-208",
  },
];

/**
 * Department names an agent might reasonably produce, mapped to the roster's.
 *
 * The roster is spelled American; a model trained on Indian and British medical
 * usage writes "orthopaedics" and "paediatrics". Both are correct, and neither
 * is worth failing a booking over. The plain-language entries are here for the
 * same reason: "skin doctor" is what a patient says, so it is what the agent
 * relays.
 */
const DEPARTMENT_ALIASES: Record<string, string> = {
  orthopaedics: "orthopedics",
  ortho: "orthopedics",
  bone: "orthopedics",
  bones: "orthopedics",
  joint: "orthopedics",
  joints: "orthopedics",
  back: "orthopedics",
  spine: "orthopedics",
  knee: "orthopedics",
  shoulder: "orthopedics",
  fracture: "orthopedics",
  paediatrics: "pediatrics",
  paeds: "pediatrics",
  peds: "pediatrics",
  child: "pediatrics",
  children: "pediatrics",
  skin: "dermatology",
  derm: "dermatology",
  rash: "dermatology",
  // Deliberately absent: "chest". Chest pain is cardiology, chest congestion is
  // not, and guessing here would quietly overrule the agent's triage — which is
  // the one judgement the prompt says belongs to the agent.
  ear: "ent",
  nose: "ent",
  throat: "ent",
  hearing: "ent",
  heart: "cardiology",
  cardiac: "cardiology",
  cardio: "cardiology",
  "ear nose throat": "ent",
  otolaryngology: "ent",
  general: "general medicine",
  medicine: "general medicine",
  physician: "general medicine",
  internal: "general medicine",
  "internal medicine": "general medicine",
};

/** Lowercase, strip punctuation, and fold the ae/oe digraphs to their US form. */
const normalizeDept = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/ae|oe/g, "e")
    .trim();

function departmentMatches(query: string, department: string): boolean {
  const q = normalizeDept(query);
  if (!q) return false;
  const target = normalizeDept(department);
  if (target.includes(q) || q.includes(target)) return true;

  // Whole phrase first, then word by word, so "skin doctor" and "joint pain"
  // resolve the same way "skin" and "joint" do. Patients describe a body part,
  // not a department, and the agent passes that description straight through.
  const candidates = [q, ...q.split(" ")].filter(Boolean);
  return candidates.some(
    (c) => DEPARTMENT_ALIASES[c] && normalizeDept(DEPARTMENT_ALIASES[c]!) === target,
  );
}

async function load(): Promise<DB> {
  const f = Bun.file(DB_PATH);
  if (!(await f.exists()))
    return { patients: [], appointments: [], doctors: DOCTORS };
  const db = (await f.json()) as DB;
  db.doctors = DOCTORS; // roster lives in code, not in the mutable store
  return db;
}

async function save(db: DB) {
  await Bun.write(DB_PATH, JSON.stringify(db, null, 2));
}

const id = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2) + "\n", {
    status,
    headers: { "content-type": "application/json" },
  });
const bad = (message: string) => json({ ok: false, error: message }, 400);

const esc = (s: unknown) =>
  String(s ?? "—").replace(
    /[<>&]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!,
  );

function table(caption: string, cols: string[], rows: string[][]) {
  const head = cols.map((c) => `<th>${esc(c)}</th>`).join("");
  const body = rows.length
    ? rows
        .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
        .join("")
    : `<tr><td class="empty" colspan="${cols.length}">nothing yet</td></tr>`;
  return `<h2>${esc(caption)} <span class="count">${rows.length}</span></h2>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function dashboard(db: DB) {
  const byId = new Map(db.patients.map((p) => [p.id, p]));
  const docs = new Map(db.doctors.map((d) => [d.id, d]));
  return `<!doctype html><meta charset="utf-8"><title>Mock HMS</title>
<meta http-equiv="refresh" content="2">
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 2rem auto; max-width: 68rem; padding: 0 1rem; }
  h1 { font-size: 1.25rem; margin-bottom: .25rem; }
  .sub { opacity: .6; margin-top: 0; }
  h2 { font-size: .95rem; margin: 2rem 0 .5rem; text-transform: uppercase; letter-spacing: .05em; }
  .count { opacity: .5; font-weight: normal; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
  th { font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; opacity: .6; font-weight: 600; }
  td { font-variant-numeric: tabular-nums; }
  .empty { opacity: .45; font-style: italic; }
  code { font-size: .85em; opacity: .75; }
</style>
<h1>Hospital management system</h1>

${table(
  "Appointments",
  ["id", "patient", "doctor", "department", "scheduled", "reason", "status"],
  [...db.appointments]
    .reverse()
    .map((a) => [
      a.id,
      byId.get(a.patient_id)?.name ?? a.patient_id,
      docs.get(a.doctor_id)?.name ?? a.doctor_id,
      a.department,
      a.scheduled_at,
      a.reason ?? "—",
      a.status,
    ]),
)}
${table(
  "Patients",
  ["id", "name", "phone", "age", "sex", "language", "notes", "registered"],
  [...db.patients]
    .reverse()
    .map((p) => [
      p.id,
      p.name,
      p.phone,
      p.age ?? p.dob ?? "—",
      p.sex ?? "—",
      p.language ?? "—",
      p.notes ?? "—",
      p.created_at,
    ]),
)}
${table(
  "Doctors",
  ["id", "name", "department", "room"],
  db.doctors.map((d) => [d.id, d.name, d.department, d.room]),
)}`;
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const { pathname, searchParams } = new URL(req.url);
    const db = await load();

    if (pathname === "/health") return json({ ok: true, service: "mock-hms" });

    // The front desk view: open it in a browser while the agent works and it
    // repaints every 2s, so a record appearing is something you can watch.
    if (pathname === "/" && req.method === "GET")
      return new Response(dashboard(db), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });

    if (pathname === "/doctors" && req.method === "GET") {
      const dept = searchParams.get("department");
      if (!dept) return json({ ok: true, doctors: db.doctors });

      const rows = db.doctors.filter((d) => departmentMatches(dept, d.department));
      // An empty list with `"ok": true` is the worst possible answer here: the
      // agent asked a reasonable question, got a success, and has nothing to act
      // on. Observed for real — a turn died looping on `hms doctors
      // orthopaedics` against a roster spelled "orthopedics". Say what went
      // wrong and what the valid answers are, and it self-corrects in one step.
      if (rows.length === 0) {
        return json(
          {
            ok: false,
            error: `no doctors in department "${dept}"`,
            available_departments: [
              ...new Set(db.doctors.map((d) => d.department)),
            ].sort(),
          },
          404,
        );
      }
      return json({ ok: true, doctors: rows });
    }

    if (pathname === "/patients" && req.method === "GET") {
      const q = searchParams.get("phone");
      const rows = q ? db.patients.filter((p) => p.phone === q) : db.patients;
      return json({ ok: true, patients: rows });
    }

    if (pathname === "/patients" && req.method === "POST") {
      const b = (await req.json()) as Partial<Patient>;
      if (!b.name || !b.phone) return bad("name and phone are required");

      // Idempotent on phone: a patient who messages twice is one patient.
      const existing = db.patients.find((p) => p.phone === b.phone);
      if (existing)
        return json({ ok: true, patient: existing, created: false });

      const patient: Patient = {
        id: id("pat"),
        name: b.name,
        phone: b.phone,
        dob: b.dob,
        age: b.age,
        sex: b.sex,
        language: b.language,
        notes: b.notes,
        created_at: new Date().toISOString(),
      };
      db.patients.push(patient);
      await save(db);
      return json({ ok: true, patient, created: true }, 201);
    }

    if (pathname === "/appointments" && req.method === "GET") {
      const pid = searchParams.get("patient_id");
      const rows = pid
        ? db.appointments.filter((a) => a.patient_id === pid)
        : db.appointments;
      return json({ ok: true, appointments: rows });
    }

    if (pathname === "/appointments" && req.method === "POST") {
      const b = (await req.json()) as Partial<Appointment>;
      if (!b.patient_id || !b.doctor_id || !b.scheduled_at)
        return bad("patient_id, doctor_id and scheduled_at are required");

      // An appointment in the past is always a mistake, and the specific
      // mistake it catches is a model that does not know today's date: one
      // booked December 2024 and told the patient it was tomorrow. The server
      // is the only party here with a reliable clock.
      const when = new Date(b.scheduled_at);
      if (Number.isNaN(when.getTime()))
        return bad(
          `scheduled_at "${b.scheduled_at}" is not a valid timestamp; use ISO 8601 like 2026-07-27T11:00:00+05:30`,
        );
      if (when.getTime() < Date.now() - 60_000)
        return bad(
          `scheduled_at ${when.toISOString()} is in the past (it is now ${new Date().toISOString()}); check what today's date is and book a future slot`,
        );

      // Accept a doctor's name as well as an id. Having just read a roster that
      // shows both, an agent reaches for the human-readable one — observed
      // booking against "Dr. Sanjay Gupta" and failing five times. The name is
      // unambiguous here, so refusing it buys nothing.
      const wanted = String(b.doctor_id ?? "").toLowerCase().trim();
      const doctor =
        db.doctors.find((d) => d.id.toLowerCase() === wanted) ??
        db.doctors.find((d) => d.name.toLowerCase() === wanted) ??
        db.doctors.find((d) => d.name.toLowerCase().includes(wanted) && wanted.length > 3);
      if (!doctor)
        return bad(
          `no doctor matching "${b.doctor_id}". Use an id or full name from \`hms doctors\`: ` +
            db.doctors.map((d) => `${d.id} (${d.name})`).join(", "),
        );
      if (!db.patients.some((p) => p.id === b.patient_id))
        return bad(`unknown patient_id ${b.patient_id}`);

      const appointment: Appointment = {
        id: id("apt"),
        patient_id: b.patient_id,
        doctor_id: b.doctor_id,
        department: doctor.department,
        scheduled_at: b.scheduled_at,
        reason: b.reason,
        status: "booked",
        created_at: new Date().toISOString(),
      };
      db.appointments.push(appointment);
      await save(db);
      return json({ ok: true, appointment, doctor }, 201);
    }

    return json(
      { ok: false, error: `no route for ${req.method} ${pathname}` },
      404,
    );
  },
});

console.log(
  `mock-hms listening on http://localhost:${server.port} (store: ${DB_PATH})`,
);
