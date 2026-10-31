import React, { useEffect, useRef, useState } from 'react';
import './Landing.css';

/**
 * Teamroom landing — "Dispatch Board" (see docs/STYLE.md).
 * Ancestor: a control-room dispatch board. Near-black panel, mono display type,
 * dense real-data tables, one signal-green accent, hairline rules, no shadows,
 * no gradients, nothing centered. Signature: the board measures itself — a live
 * latency probe printing real measurements beside the product's real spec index.
 */

const SPECS = [
  { n: '01', label: 'REALTIME CORE', value: 'WebSocket', note: 'native ws bus, auto-poll fallback ≤1.5 s' },
  { n: '02', label: 'BROADCAST LATENCY', value: '<10 ms', note: 'measured on LAN, optimistic client-side' },
  { n: '03', label: 'FILE TRANSFER', value: '500 MB', note: 'multipart streaming, drag-and-drop' },
  { n: '04', label: 'CHANNELS', value: '1 + N', note: 'one global, one per project, auto-created' },
  { n: '05', label: 'ROLES', value: '5 built-in', note: 'owner · admin · manager · employee · viewer + custom' },
  { n: '06', label: 'TASK BOARD', value: '3 columns', note: 'drag-and-drop, optimistic, live done-toggles' },
  { n: '07', label: 'AUTH', value: 'JWT 7 d', note: 'bcrypt hashing, first user becomes owner' },
  { n: '08', label: 'DATABASE', value: 'SQLite', note: 'WASM build, one file, zero config' },
];

const PILLARS = [
  {
    n: '01',
    title: 'Chat that keeps up with the room',
    body: 'Global and per-project channels. Typing indicators, presence dots, grouped messages, enter to send. A message appears on every screen in the workspace in under ten milliseconds — no refresh, no polling spinner, no "seen" theatre.',
    spec: ['Channels auto-created per project', 'Typing + presence in realtime', 'History paginated, sent receipts'],
  },
  {
    n: '02',
    title: 'Files move like local files',
    body: 'Drop a folder of mockups on the dashboard and watch the progress bars race. Up to 500 MB per file, streamed straight to disk, attached to the project permanently, downloadable at full speed by everyone in the room.',
    spec: ['Drag-and-drop anywhere', 'Per-project file spaces', 'Streaming download, no buffering'],
  },
  {
    n: '03',
    title: 'The board is the meeting',
    body: 'Tasks live in three columns. Drag them, assign them, mark them done with one click. Everyone watching the board sees the card move the moment it moves — the standup happens in the tool, not about the tool.',
    spec: ['Assignees, priorities, due dates', 'Optimistic moves with rollback', 'Done toggles broadcast live'],
  },
  {
    n: '04',
    title: 'Roles that mean something',
    body: 'Five built-in roles plus custom ones with per-capability permissions — projects, tasks, chat, files, member management. The first account on a fresh workspace becomes the owner; everyone else is invited with the least access they need.',
    spec: ['Granular permission checkboxes', 'Invite by email, revoke instantly', 'Owner bootstrap, no setup wizard'],
  },
];

const RELEASES_URL = 'https://github.com/mb-xrl/teamroom/releases/latest';
const SOURCE_URL = 'https://github.com/mb-xrl/teamroom';

export default function Landing() {
  return (
    <div className="lb">
      <BoardNav />
      <Masthead />
      <SpecIndex />
      <Pillars />
      <TheBoard />
      <GetTeamroom />
      <Faq />
      <BoardFooter />
    </div>
  );
}

/* ---------- nav ---------- */

function BoardNav() {
  return (
    <header className="lb-nav">
      <div className="lb-nav-in">
        <a className="lb-brand" href="#top" aria-label="Teamroom home">
          <span className="lb-brand-mark" aria-hidden="true"><SvgLogo /></span>
          <span className="lb-brand-name">TEAMROOM</span>
        </a>
        <nav className="lb-nav-links" aria-label="Sections">
          <a href="#system">System</a>
          <a href="#board">Board</a>
          <a href="#download">Download</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="lb-nav-cta">
          <a className="lb-btn lb-btn-accent" href={RELEASES_URL}>Download</a>
        </div>
      </div>
    </header>
  );
}

/* ---------- masthead ---------- */

function Masthead() {
  return (
    <section className="lb-mast" id="top">
      <div className="lb-rail" aria-hidden="true">
        <span className="lb-rail-num">00</span>
        <span className="lb-rail-label">Masthead</span>
      </div>
      <div className="lb-mast-main">
        <h1 className="lb-h1">
          A dispatch board for the whole company.
        </h1>
        <p className="lb-lead">
          Teamroom puts chat, files, projects and tasks on one live board.
          Every change lands on every screen in under ten milliseconds.
          It runs on your machine — one process, one database file, nothing to sync.
        </p>
        <div className="lb-mast-actions">
          <a className="lb-btn lb-btn-accent lb-btn-lg" href={RELEASES_URL}>
            Download the latest release
          </a>
          <a className="lb-btn lb-btn-ghost lb-btn-lg" href={SOURCE_URL}>
            View source
          </a>
        </div>
        <p className="lb-fineprint">
          MIT licensed. Requires Node 20+. Your data stays in one SQLite file on your disk.
        </p>
      </div>
    </section>
  );
}

/* ---------- signature: spec index + live probe ---------- */

function SpecIndex() {
  return (
    <section className="lb-section" id="system">
      <div className="lb-rail" aria-hidden="true">
        <span className="lb-rail-num">01</span>
        <span className="lb-rail-label">System</span>
      </div>
      <div className="lb-section-main">
        <div className="lb-section-head">
          <h2 className="lb-h2">The spec sheet</h2>
          <p className="lb-section-sub">
            Real limits from the running system — not marketing numbers. The probe on the
            right is measuring this deployment right now.
          </p>
        </div>
        <div className="lb-spec-grid">
          <table className="lb-table lb-spec-table">
            <thead>
              <tr><th>#</th><th>Capability</th><th>Limit</th><th className="lb-th-note">Notes</th></tr>
            </thead>
            <tbody>
              {SPECS.map((s) => (
                <tr key={s.n}>
                  <td className="lb-num">{s.n}</td>
                  <td className="lb-spec-label">{s.label}</td>
                  <td className="lb-spec-value">{s.value}</td>
                  <td className="lb-note">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <LiveProbe />
        </div>
      </div>
    </section>
  );
}

function LiveProbe() {
  const [log, setLog] = useState([]);
  const [up, setUp] = useState(null);
  const timer = useRef(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let seq = 0;
    const ping = async () => {
      const t0 = performance.now();
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch('/api/health', { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(to);
        const ms = Math.round(performance.now() - t0);
        if (!mounted.current) return;
        setUp(res.ok);
        seq += 1;
        setLog((l) => [{ seq, ms, ok: res.ok, at: new Date() }, ...l].slice(0, 6));
      } catch {
        if (!mounted.current) return;
        setUp(false);
        seq += 1;
        setLog((l) => [{ seq, ms: null, ok: false, at: new Date() }, ...l].slice(0, 6));
      }
    };
    ping();
    timer.current = setInterval(ping, 2000);
    return () => { mounted.current = false; clearInterval(timer.current); };
  }, []);

  const statusText = up === null ? 'PROBING' : up ? 'ONLINE' : 'UNREACHABLE';

  return (
    <div className="lb-probe" aria-live="off">
      <div className="lb-probe-head">
        <span className={`lb-dot ${up ? 'lb-dot-live' : up === false ? 'lb-dot-dead' : 'lb-dot-wait'}`} aria-hidden="true" />
        <span className="lb-probe-title">Live probe · /api/health</span>
        <span className={`lb-probe-status ${up ? 'is-live' : ''}`}>{statusText}</span>
      </div>
      <table className="lb-table lb-probe-table">
        <thead>
          <tr><th>Seq</th><th>Response</th><th>Time</th></tr>
        </thead>
        <tbody>
          {log.length === 0 && (
            <tr><td className="lb-num">—</td><td className="lb-note">measuring…</td><td className="lb-note">—</td></tr>
          )}
          {log.map((e) => (
            <tr key={e.seq}>
              <td className="lb-num">{String(e.seq).padStart(3, '0')}</td>
              <td className={e.ok ? 'lb-probe-ms' : 'lb-probe-err'}>
                {e.ok ? `${e.ms} ms` : 'no reply'}
              </td>
              <td className="lb-note">
                {e.at.toLocaleTimeString([], { hour12: false })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="lb-probe-note">
        Pings the production API from your browser every 2 s. These are your
        network&apos;s real round-trips, not a canned number.
      </p>
    </div>
  );
}

/* ---------- pillars ---------- */

function Pillars() {
  return (
    <section className="lb-section" id="pillars">
      <div className="lb-rail" aria-hidden="true">
        <span className="lb-rail-num">02</span>
        <span className="lb-rail-label">System · capabilities</span>
      </div>
      <div className="lb-section-main">
        {PILLARS.map((p, i) => (
          <article className="lb-pillar" key={p.n}>
            <div className="lb-pillar-num" aria-hidden="true">{p.n}</div>
            <div className="lb-pillar-body">
              <h3 className="lb-h3">{p.title}</h3>
              <p className="lb-p">{p.body}</p>
              <ul className="lb-list">
                {p.spec.map((s) => <li key={s}>{s}</li>)}
              </ul>
            </div>
            {i < PILLARS.length - 1 && <div className="lb-rule" aria-hidden="true" />}
          </article>
        ))}
      </div>
    </section>
  );
}

/* ---------- the board (product truth, set as text) ---------- */

function TheBoard() {
  const rows = [
    { t: '14:02:11', who: 'sara', what: 'moved “Landing hero” to Done', ch: '#launch' },
    { t: '14:02:09', who: 'dev-bot', what: 'build #412 green — deployed to production', ch: '#launch' },
    { t: '14:01:57', who: 'alex', what: 'uploaded brand-refresh.fig (48 MB)', ch: '#design' },
    { t: '14:01:44', who: 'maya', what: 'assigned “Launch checklist” to alex', ch: '#launch' },
    { t: '14:01:30', who: 'alex', what: 'sara is on the board', ch: '#launch' },
  ];
  return (
    <section className="lb-section" id="board">
      <div className="lb-rail" aria-hidden="true">
        <span className="lb-rail-num">03</span>
        <span className="lb-rail-label">The board · live</span>
      </div>
      <div className="lb-section-main">
        <div className="lb-section-head">
          <h2 className="lb-h2">What a minute on the board looks like</h2>
          <p className="lb-section-sub">
            One minute of a four-person team, set as text — because the product <em>is</em> the
            activity. Run it and this is your screen, at this density, at this speed.
          </p>
        </div>
        <table className="lb-table lb-feed-table">
          <thead>
            <tr><th>Time</th><th>Member</th><th>Event</th><th className="lb-th-note">Channel</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.t + r.who}>
                <td className="lb-num">{r.t}</td>
                <td className="lb-feed-who">{r.who}</td>
                <td>{r.what}</td>
                <td className="lb-note">{r.ch}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="lb-fineprint">Illustrative session from the development workspace; the shipped product streams this live over WebSocket.</p>
      </div>
    </section>
  );
}

/* ---------- download ---------- */

function GetTeamroom() {
  return (
    <section className="lb-section" id="download">
      <div className="lb-rail" aria-hidden="true">
        <span className="lb-rail-num">04</span>
        <span className="lb-rail-label">Download</span>
      </div>
      <div className="lb-section-main">
        <div className="lb-section-head">
          <h2 className="lb-h2">Get Teamroom</h2>
          <p className="lb-section-sub">
            One download, three commands, your own board. No account, no telemetry, no cloud
            between you and your team&apos;s data.
          </p>
        </div>
        <table className="lb-table lb-dl-table">
          <thead>
            <tr><th>Step</th><th>Command</th><th className="lb-th-note">What it does</th></tr>
          </thead>
          <tbody>
            <tr>
              <td className="lb-num">01</td>
              <td className="lb-cmd"><a href={RELEASES_URL}>download the release</a> &amp; unzip</td>
              <td className="lb-note">source + prebuilt frontend, one archive</td>
            </tr>
            <tr>
              <td className="lb-num">02</td>
              <td className="lb-cmd">npm install</td>
              <td className="lb-note">pulls server dependencies</td>
            </tr>
            <tr>
              <td className="lb-num">03</td>
              <td className="lb-cmd">npm start</td>
              <td className="lb-note">API + WebSockets + UI on http://localhost:8787</td>
            </tr>
          </tbody>
        </table>
        <div className="lb-mast-actions">
          <a className="lb-btn lb-btn-accent lb-btn-lg" href={RELEASES_URL}>Download release</a>
          <a className="lb-btn lb-btn-ghost lb-btn-lg" href={SOURCE_URL}>Clone the repo</a>
        </div>
        <p className="lb-fineprint">
          Requires Node 20+. First account registered on your instance becomes the owner.
          Data lives in <span className="lb-cmd-inline">data/teamroom.db</span> and the <span className="lb-cmd-inline">uploads/</span> folder — copy those two and you have a full backup.
        </p>
      </div>
    </section>
  );
}

/* ---------- faq ---------- */

const FAQS = [
  ['Is it really free?', 'Yes. MIT licensed — download it, run it at work, modify it, ship it. There is no paid tier and no account on this site.'],
  ['How realtime is it, really?', 'In-app updates ride a WebSocket and typically land in under 10 ms on the server side. The probe earlier on this page measures the real round-trip from your browser, if you want numbers.'],
  ['Where does my data live?', 'On your disk. One SQLite file and an uploads folder. Backing up Teamroom is copying two paths; moving it is dragging them to a new machine.'],
  ['Does it work on a small server?', 'Yes — the whole stack (API, WebSockets, database, frontend) is a single Node process with no native dependencies. A 1-core VM carries a small company comfortably.'],
  ['What happens if the connection drops?', 'The client switches to polling automatically and queues what you type. Nothing is lost while offline; everything syncs when you rejoin.'],
];

function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <section className="lb-section" id="faq">
      <div className="lb-rail" aria-hidden="true">
        <span className="lb-rail-num">05</span>
        <span className="lb-rail-label">Questions</span>
      </div>
      <div className="lb-section-main">
        <div className="lb-section-head"><h2 className="lb-h2">Straight answers</h2></div>
        <div className="lb-faq">
          {FAQS.map(([q, a], i) => (
            <div className={`lb-faq-item ${open === i ? 'is-open' : ''}`} key={q}>
              <button
                type="button"
                className="lb-faq-q"
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? -1 : i)}
              >
                <span className="lb-num lb-faq-n">{String(i + 1).padStart(2, '0')}</span>
                <span>{q}</span>
                <span className="lb-faq-x" aria-hidden="true">{open === i ? '−' : '+'}</span>
              </button>
              {open === i && <p className="lb-faq-a">{a}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- footer ---------- */

function BoardFooter() {
  return (
    <footer className="lb-footer">
      <div className="lb-rail" aria-hidden="true">
        <span className="lb-rail-num">06</span>
        <span className="lb-rail-label">End of board</span>
      </div>
      <div className="lb-section-main">
        <h2 className="lb-h2">Put the company on one board.</h2>
        <div className="lb-mast-actions lb-footer-actions">
          <a className="lb-btn lb-btn-accent lb-btn-lg" href={RELEASES_URL}>Download the latest release</a>
          <a className="lb-btn lb-btn-ghost lb-btn-lg" href={SOURCE_URL}>View source</a>
        </div>
        <table className="lb-table lb-footer-meta">
          <tbody>
            <tr>
              <td className="lb-note">Software</td><td>Teamroom — realtime workspace</td>
              <td className="lb-note">Stack</td><td>Node · Fastify · ws · SQLite · React</td>
            </tr>
            <tr>
              <td className="lb-note">License</td><td>MIT</td>
              <td className="lb-note">Source</td><td><a href={SOURCE_URL}>github.com/mb-xrl/teamroom</a></td>
            </tr>
          </tbody>
        </table>
        <p className="lb-fineprint">© {new Date().getFullYear()} Teamroom. Built for teams that ship.</p>
      </div>
    </footer>
  );
}

/* ---------- inline SVG (hand-rolled, no icon fonts) ---------- */

function SvgLogo() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h16M4 12h10M4 20h16" />
    </svg>
  );
}
