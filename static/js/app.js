import { state, api, $, $$, h, esc, icon, toast, toastError, modal, relDay, whenLabel, bytes, hm, debounce, withLoading, localISO } from "./lib.js";
import * as chatView from "./views/chat.js";
import * as notesView from "./views/notes.js";
import * as libraryView from "./views/library.js";
import * as mindmapView from "./views/mindmaps.js";
import * as plannerView from "./views/planner.js";
import * as progressView from "./views/progress.js";
import * as settingsView from "./views/settings.js";

const ROUTES = [
  { re: /^\/?$/, view: chatView, nav: "new" },
  { re: /^\/chat\/(\d+)$/, view: chatView, nav: "chat" },
  { re: /^\/notes(?:\/(\d+))?$/, view: notesView, nav: "notes" },
  { re: /^\/library$/, view: libraryView, nav: "library" },
  { re: /^\/mindmaps(?:\/(\d+))?$/, view: mindmapView, nav: "mindmaps" },
  { re: /^\/planner(?:\/(\w+))?$/, view: plannerView, nav: "planner" },
  { re: /^\/progress$/, view: progressView, nav: "progress" },
  { re: /^\/settings$/, view: settingsView, nav: "settings" },
];

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl";
const kbd = (...keys) => `<span class="kbd">${keys.map(k => `<span>${k}</span>`).join("")}</span>`;
let cleanup = null;

// ================================================================== boot
async function boot() {
  try { state.status = await api("/status"); } catch { state.status = { llm: false, version: "1.0" }; }
  const as = new URLSearchParams(location.search).get("as");   // ?as=<id> switches student (demos)
  if (as) { localStorage.setItem("prepwise.student", as); history.replaceState(null, "", "/" + location.hash); }
  const saved = localStorage.getItem("prepwise.student");
  if (saved) {
    state.student = { id: +saved };
    try { state.student = await api("/me"); } catch { state.student = null; }
  }
  if (!state.student) return onboarding();
  renderShell();
  window.addEventListener("hashchange", route);
  route();
  startReminders();
}

// ================================================================== onboarding
async function onboarding() {
  let existing = [];
  try { existing = await api("/students"); } catch { /* db may be empty */ }
  const in14 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  $("#root").innerHTML = `
    <div class="onboard"><div class="card">
      <div style="display:flex;align-items:center;gap:10px">${icon("logo", "brand-logo")}<b style="font-size:17px">Prepwise</b></div>
      <h1>Your calm study space.</h1>
      <p>Notes become mind maps, a roadmap runs to your exam, and your progress stays visible — so there's no last-night panic.</p>
      <form id="ob">
        <div class="field"><label>Your name</label><input class="input" name="name" required placeholder="e.g. Aarav Sharma"></div>
        <div class="field"><label>Email <span class="muted">(optional)</span></label><input class="input" name="email" type="email" placeholder="you@college.edu"></div>
        <div class="grid-2">
          <div class="field"><label>Exam date</label><input class="input" name="exam_date" type="date" value="${in14}"></div>
          <div class="field"><label>Hours per day</label><input class="input" name="daily_hours" type="number" min="0.5" max="14" step="0.5" value="3"></div>
        </div>
        <label style="display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--text-2)">
          <input type="checkbox" name="demo" checked style="accent-color:var(--accent)"> Load sample Operating Systems notes to explore
        </label>
        <button class="btn primary" style="height:38px;justify-content:center" data-loading="Setting up…">Start studying</button>
      </form>
      ${existing.length ? `<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
        <div class="muted" style="font-size:12px;margin-bottom:8px">Or continue as</div>
        ${existing.map(s => `<button class="list-row" style="width:100%" data-sid="${s.id}"><div class="avatar">${esc(initials(s.name))}</div>
          <div class="row-main" style="text-align:left"><div class="row-title">${esc(s.name)}</div><div class="row-meta">${esc(s.email || "")}</div></div>${icon("chevR")}</button>`).join("")}
      </div>` : ""}
    </div></div>`;
  $$("[data-sid]").forEach(b => b.onclick = () => { localStorage.setItem("prepwise.student", b.dataset.sid); location.hash = "#/"; location.reload(); });
  $("#ob").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector("button");
    await withLoading(btn, async () => {
      try {
        state.student = await api("/students", { method: "POST", body: {
          name: f.get("name"), email: f.get("email") || null, exam_date: f.get("exam_date") || null, daily_hours: +f.get("daily_hours") || 3,
        } });
        localStorage.setItem("prepwise.student", state.student.id);
        if (f.get("demo")) { await api("/demo", { method: "POST" }); await api("/plan/standard", { method: "POST" }).catch(() => {}); }
        location.hash = "#/"; location.reload();
      } catch (err) { toastError(err); }
    });
  };
}

const initials = (n = "") => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "S";

// ================================================================== shell
function renderShell() {
  const s = state.student;
  $("#root").innerHTML = `
  <div class="app ${localStorage.getItem("prepwise.collapsed") === "1" ? "collapsed" : ""}" id="app">
    <aside class="sidebar card">
      <div class="brand">${icon("logo", "brand-logo")}<span class="brand-name">Prepwise</span>
        <button class="icon-btn" id="collapse" title="Toggle sidebar">${icon("sidebar")}</button></div>
      <div class="side-section">Chats <span class="count" id="chat-count">0</span></div>
      <nav class="nav">
        <button class="nav-item" data-nav="new">${icon("edit")}<span class="label">New chat</span>${kbd(MOD, "J")}</button>
        <button class="nav-item" data-nav="search">${icon("search")}<span class="label">Search everything</span>${kbd(MOD, "K")}</button>
      </nav>
      <div class="side-divider"></div>
      <nav class="nav">
        <button class="nav-item" data-nav="notes">${icon("notes")}<span class="label">Notes</span></button>
        <button class="nav-item" data-nav="library">${icon("library")}<span class="label">Library</span></button>
        <button class="nav-item" data-nav="mindmaps">${icon("mindmap")}<span class="label">Mind maps</span></button>
        <button class="nav-item" data-nav="planner">${icon("calendar")}<span class="label">Planner</span><span class="badge" id="today-badge"></span></button>
        <button class="nav-item" data-nav="progress">${icon("chart")}<span class="label">Progress</span></button>
      </nav>
      <div class="history" id="history"></div>
      <div class="side-footer">
        <button class="nav-item" data-nav="settings">${icon("settings")}<span class="label">Settings</span></button>
        <button class="nav-item" data-nav="help">${icon("quiz")}<span class="label">Help & commands</span><span class="badge">5</span></button>
        <div class="user-card">
          <div class="avatar">${esc(initials(s.name))}</div>
          <div class="user-meta"><div class="user-name">${esc(s.name)} ${icon("verified")}</div><div class="user-mail">${esc(s.email || "Exam: " + (s.exam_date || "not set"))}</div></div>
          <button class="icon-btn" id="user-menu" title="Account">${icon("more")}</button>
        </div>
      </div>
    </aside>
    <main class="main card">
      <div class="topbar">
        <button class="icon-btn mobile-only" id="mobile-nav">${icon("menu")}</button>
        <span class="version">Prepwise AI v${esc(state.status.version)}</span>
        <span class="spacer"></span>
        <span class="mode-pill ${state.status.llm ? "" : "demo"}" title="${state.status.llm ? "Connected to Groq" : "Add GROQ_API_KEY to .env for full AI"}"><i></i>${state.status.llm ? "AI live" : "Demo mode"}</span>
      </div>
      <div class="view" id="view"></div>
    </main>
  </div>`;

  $$("[data-nav]").forEach(b => b.onclick = () => {
    $("#app").classList.remove("mobile-nav");
    const n = b.dataset.nav;
    if (n === "search") return openSearch();
    if (n === "help") return openHelp();
    if (n === "new") return newChat();
    location.hash = `#/${n}`;
  });
  $("#collapse").onclick = () => {
    const c = $("#app").classList.toggle("collapsed");
    localStorage.setItem("prepwise.collapsed", c ? "1" : "0");
  };
  $("#mobile-nav").onclick = () => $("#app").classList.toggle("mobile-nav");
  $("#user-menu").onclick = () => modal({
    title: "Account",
    body: `<p class="lead">Signed in as <b>${esc(s.name)}</b>. Each student has their own notes, roadmap and progress graph.</p>`,
    actions: [
      { label: `${icon("logout")} Switch student`, run: () => { localStorage.removeItem("prepwise.student"); location.hash = ""; location.reload(); } },
      { label: "Settings", kind: "primary", run: () => { location.hash = "#/settings"; } },
    ],
  });

  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === "k" || e.key === "f")) { e.preventDefault(); openSearch(); }
    if (mod && e.key === "j") { e.preventDefault(); newChat(); }
  });
  refreshSidebar();
}

export async function refreshSidebar() {
  try { state.chats = await api("/chats"); } catch (e) { return; }
  $("#chat-count").textContent = state.chats.length;
  const groups = { Today: [], Yesterday: [], Earlier: [] };
  state.chats.forEach(c => { const r = relDay(c.updated_at); (groups[r] || groups.Earlier).push(c); });
  const openState = JSON.parse(localStorage.getItem("prepwise.groups") || "{}");
  const active = location.hash.match(/chat\/(\d+)/)?.[1];
  $("#history").innerHTML = Object.entries(groups).map(([name, list]) => `
    <div class="group ${openState[name] === false || (!list.length && openState[name] !== true) ? "closed" : ""}" data-g="${name}">
      <button class="group-head">${icon("caret")}${name}</button>
      <div class="group-items">${list.length ? list.map(c => `
        <button class="history-item ${String(c.id) === active ? "active" : ""}" data-chat="${c.id}"><span>${esc(c.title)}</span>
          <i class="del" data-del="${c.id}" title="Delete">${icon("close")}</i></button>`).join("") : `<div class="history-empty">No chats</div>`}
      </div></div>`).join("");
  $$(".group-head").forEach(b => b.onclick = () => {
    const g = b.parentElement; g.classList.toggle("closed");
    openState[g.dataset.g] = !g.classList.contains("closed");
    localStorage.setItem("prepwise.groups", JSON.stringify(openState));
  });
  $$("[data-chat]").forEach(b => b.onclick = (e) => {
    if (e.target.closest("[data-del]")) return;
    location.hash = `#/chat/${b.dataset.chat}`;
  });
  $$("[data-del]").forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    await api(`/chats/${b.dataset.del}`, { method: "DELETE" });
    if (location.hash === `#/chat/${b.dataset.del}`) location.hash = "#/";
    refreshSidebar();
  });
  refreshTodayBadge();
}

async function refreshTodayBadge() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  try {
    const evs = await api(`/events?start=${localISO(start)}&end=${localISO(end)}`);
    const left = evs.filter(e => e.status === "planned" && !["break", "exam"].includes(e.kind) && new Date(e.end_at) > new Date()).length;
    $("#today-badge").textContent = left || "";
    $("#today-badge").title = left ? `${left} study blocks left today` : "";
  } catch { /* ignore */ }
}

function newChat() { location.hash = "#/"; if (location.hash === "#/") route(); }

// ================================================================== router
function route() {
  const path = location.hash.replace(/^#/, "").split("?")[0] || "/";
  const match = ROUTES.map(r => ({ r, m: path.match(r.re) })).find(x => x.m) || { r: ROUTES[0], m: [] };
  $$("[data-nav]").forEach(b => b.classList.toggle("active", b.dataset.nav === match.r.nav));
  $$(".history-item").forEach(b => b.classList.toggle("active", path === `/chat/${b.dataset.chat}`));
  cleanup?.();
  const view = $("#view");
  view.innerHTML = "";
  view.scrollTop = 0;
  cleanup = match.r.view.render(view, match.m.slice(1), { refreshSidebar, openSearch }) || null;
}

// ================================================================== search (⌘K)
function openSearch() {
  if ($(".search-modal")) return;
  const ov = h(`<div class="overlay"><div class="modal search-modal" role="dialog" aria-label="Search">
    <div class="search-box">${icon("search")}<input placeholder="Search everything..." autocomplete="off">
      <button class="icon-btn" title="Filters" data-filter>${icon("filter")}</button><button class="icon-btn" data-close>${icon("close")}</button></div>
    <div class="tabs" id="sr-tabs"></div>
    <div class="search-results" id="sr"></div>
    <div class="search-foot">Prepwise AI v${esc(state.status.version)} · ↑↓ to move · Enter to open</div>
  </div></div>`);
  document.body.appendChild(ov);
  const input = $("input", ov);
  let tab = "all", data = null, sel = 0;
  const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); };
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(); });
  $("[data-close]", ov).onclick = close;
  $("[data-filter]", ov).onclick = () => { tab = tab === "all" ? "notes" : "all"; draw(); };

  const TABS = [["all", "All", null], ["chats", "Chats", "chat"], ["notes", "Notes", "notes"], ["files", "Files", "file"], ["topics", "Topics", "target"]];
  const go = (url) => { close(); location.hash = url; };

  function draw() {
    if (!data) return;
    $("#sr-tabs", ov).innerHTML = TABS.map(([k, label, ic]) => {
      const n = k === "all" ? null : (data[k]?.length ?? 0) + (k === "files" ? data.mindmaps.length : 0);
      return `<button class="tab ${tab === k ? "active" : ""}" data-tab="${k}">${ic ? icon(ic) : ""}${label}${n !== null ? `<span class="n">${n}</span>` : ""}</button>`;
    }).join("");
    $$("[data-tab]", ov).forEach(b => b.onclick = () => { tab = b.dataset.tab; sel = 0; draw(); });

    const recent = [
      ...data.chats.map(c => ({ t: c.title, when: c.updated_at, url: `#/chat/${c.id}`, type: "chats" })),
      ...data.notes.map(n => ({ t: `${n.icon || "📄"} ${n.title}`, when: n.updated_at, url: `#/notes/${n.id}`, type: "notes" })),
    ].sort((a, b) => new Date(b.when) - new Date(a.when));
    const files = [
      ...data.files.map(f => ({ t: f.title, meta: `${f.kind === "pdf" ? "PDF" : "Notes"} · ${bytes(f.size_bytes)} · ${relDay(f.created_at)}`, url: "#/library", ic: f.kind === "pdf" ? "pdf" : "file" })),
      ...data.mindmaps.map(m => ({ t: m.title, meta: `Mind map · ${relDay(m.created_at)}`, url: `#/mindmaps/${m.id}`, ic: "mindmap" })),
    ];
    const topics = data.topics.map(t => ({ t: t.title, meta: `Mastery ${Math.round(t.mastery)}% · weight ${t.weightage}/5`, url: "#/progress", ic: "target" }));

    let html = "";
    const rows = [];
    const rowList = (items) => items.map(it => { rows.push(it.url); return `<div class="sr-row" data-url="${it.url}"><span class="t">${esc(it.t)}</span><span class="when">${whenLabel(it.when)}</span><span class="more">${icon("more")}</span></div>`; }).join("");
    const fileList = (items) => items.map(it => { rows.push(it.url); return `<div class="sr-file" data-url="${it.url}"><div class="file-ico">${icon(it.ic)}</div><div><b>${esc(it.t)}</b><span>${esc(it.meta)}</span></div></div>`; }).join("");

    if (tab === "all") {
      if (recent.length) html += `<div class="sr-label">Recent activity</div>${rowList(recent.slice(0, 8))}`;
      if (data.passages?.length) {
        html += `<div class="sr-label">In your notes</div>` + data.passages.map(p => { rows.push("#/library"); return `<div class="sr-file" data-url="#/library"><div class="file-ico">${icon("library")}</div><div><b>${esc(p.heading || p.document)}</b><span>${esc(p.snippet.slice(0, 90))}…</span></div></div>`; }).join("");
      }
      if (files.length) html += `<div class="sr-label">Files</div>${fileList(files.slice(0, 4))}`;
      if (topics.length && input.value) html += `<div class="sr-label">Topics</div>${fileList(topics.slice(0, 4))}`;
    } else if (tab === "chats") html += rowList(recent.filter(r => r.type === "chats"));
    else if (tab === "notes") html += rowList(recent.filter(r => r.type === "notes"));
    else if (tab === "files") html += fileList(files);
    else html += fileList(topics);
    $("#sr", ov).innerHTML = html || `<div class="muted" style="padding:24px 4px;text-align:center">Nothing found${input.value ? ` for “${esc(input.value)}”` : ""}.</div>`;
    const els = $$("[data-url]", ov);
    els.forEach((el, i) => { el.classList.toggle("sel", i === sel); el.onclick = () => go(el.dataset.url); });
    ov._rows = els;
  }
  const load = debounce(async () => { try { data = await api(`/search?q=${encodeURIComponent(input.value)}`); sel = 0; draw(); } catch (e) { toastError(e); } }, 160);
  input.oninput = load;
  const onKey = (e) => {
    if (e.key === "Escape") close();
    const els = ov._rows || [];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); sel = Math.max(0, Math.min(els.length - 1, sel + (e.key === "ArrowDown" ? 1 : -1)));
      els.forEach((el, i) => el.classList.toggle("sel", i === sel)); els[sel]?.scrollIntoView({ block: "nearest" });
    }
    if (e.key === "Enter" && els[sel]) go(els[sel].dataset.url);
  };
  document.addEventListener("keydown", onKey);
  input.focus();
  load();
}

function openHelp() {
  modal({ title: "Help & commands", width: 520, body: `
    <div class="md">
      <p>Prepwise is a study space: <b>chat</b> that answers from your own notes, <b>notes</b> you can arrange like pages, a <b>planner</b> that schedules everything until your exam, and a <b>progress</b> graph.</p>
      <h3>Slash commands in chat</h3>
      <ul><li><code>/mindmap [focus]</code> — mind map from your latest upload</li><li><code>/roadmap</code> — full timeline to your exam</li>
      <li><code>/crisis [hours]</code> — exam is close: a high-yield plan for the time you have</li><li><code>/quiz [topic]</code> — quick quiz that updates mastery</li><li><code>/progress</code> — readiness snapshot</li></ul>
      <h3>Shortcuts</h3>
      <ul><li><code>${MOD} K</code> search everything</li><li><code>${MOD} J</code> new chat</li></ul>
      <h3>Healthy studying</h3>
      <p>Plans include breaks and never run past your sleep time. Reminders arrive 10 minutes before each block — allow notifications in Settings.</p>
    </div>` });
}

// ================================================================== reminders
const notified = new Set(JSON.parse(sessionStorage.getItem("prepwise.notified") || "[]"));
function startReminders() {
  const tick = async () => {
    let due = [];
    try { due = await api("/reminders"); } catch { return; }
    for (const ev of due) {
      if (notified.has(ev.id)) continue;
      notified.add(ev.id);
      sessionStorage.setItem("prepwise.notified", JSON.stringify([...notified]));
      const title = ev.kind === "break" ? "Break time" : ev.kind === "exam" ? "Exam soon — you've prepared for this" : `Up next at ${hm(ev.start_at)}`;
      const body = ev.kind === "break" ? "Stand up, drink water, look away from the screen." : ev.title;
      toast(title, { body, kind: "reminder", timeout: 0, actions: [
        { label: "Open planner", run: () => { location.hash = "#/planner"; } },
        { label: "Dismiss", run: () => {} },
      ] });
      if ("Notification" in window && Notification.permission === "granted") new Notification(`Prepwise · ${title}`, { body });
    }
    refreshTodayBadge();
  };
  tick();
  setInterval(tick, 60_000);
}

boot();
