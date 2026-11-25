import { state, api, $, $$, h, esc, icon, modal, toast, toastError, hm, isoDate, localISO, sameDay, fmtDay, mins, parseDT, KIND_COLORS, withLoading } from "../lib.js";
import { openQuiz } from "./quiz.js";

const START_H = 6, END_H = 24, ROW = 64;
let weekStart = startOfWeek(new Date());
let topics = [];

function startOfWeek(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export function render(view, [sub]) {
  const wk = new URLSearchParams(location.hash.split("?")[1] || "").get("week");   // #/planner?week=YYYY-MM-DD
  if (wk && !isNaN(new Date(wk + "T00:00"))) weekStart = startOfWeek(new Date(wk + "T00:00"));
  const tab = sub === "roadmap" || sub === "crisis" ? "roadmap" : "week";
  view.innerHTML = `
    <div class="page" style="max-width:1280px">
      <div class="page-head"><div class="grow"><h1>Planner</h1><p>Your roadmap to exam day — study blocks, spaced revision, breaks and reminders.</p></div>
        <div class="actions">
          <div class="segmented"><button data-tab="week" class="${tab === "week" ? "active" : ""}">Week</button><button data-tab="roadmap" class="${tab === "roadmap" ? "active" : ""}">Roadmap</button></div>
          <button class="btn crisis" id="crisis-btn">${icon("zap")} Crisis mode</button>
          <button class="btn primary" id="build-btn" data-loading="Planning…">${icon("route")} Build roadmap</button>
        </div></div>
      <div id="assess"></div>
      <div id="tab-body"></div>
    </div>`;
  $$("[data-tab]", view).forEach(b => b.onclick = () => { location.hash = b.dataset.tab === "week" ? "#/planner" : "#/planner/roadmap"; });
  $("#build-btn", view).onclick = (e) => buildStandard(e.currentTarget);
  $("#crisis-btn", view).onclick = crisisModal;
  api("/topics").then(t => { topics = t; }).catch(() => {});
  drawAssess();
  if (tab === "week") drawWeek(); else drawRoadmap();
  if (sub === "crisis") setTimeout(crisisModal, 50);
}

async function drawAssess() {
  const box = $("#assess");
  try {
    const a = await api("/plan/assess");
    if (!box) return;
    if (!a.topics) {
      box.innerHTML = `<div class="banner info">${icon("info")}<span class="txt">Add topics first: upload notes in <b>Library</b> and generate a mind map — topics are extracted automatically.</span><button class="btn sm" onclick="location.hash='#/library'">Open Library</button></div>`;
    } else if (a.recommend_crisis) {
      box.innerHTML = `<div class="banner alert">${icon("alert")}<span class="txt"><b>Time is short.</b> ${esc(a.reason)}</span><button class="btn sm crisis" id="go-crisis">Switch to crisis mode</button></div>`;
      $("#go-crisis").onclick = crisisModal;
    } else if (!a.roadmap) {
      box.innerHTML = `<div class="banner info">${icon("route")}<span class="txt">${esc(a.reason)} Build your roadmap to put every topic on the calendar.</span></div>`;
    } else {
      box.innerHTML = `<div class="banner ok">${icon("checkCircle")}<span class="txt">${esc(a.reason)} ${a.roadmap.mode === "crisis" ? "<b>Crisis plan active.</b>" : ""}</span></div>`;
    }
  } catch { /* ignore */ }
}

async function buildStandard(btn) {
  await withLoading(btn, async () => {
    try {
      const r = await api("/plan/standard", { method: "POST" });
      toast(r.summary.feasible ? "Roadmap ready" : "Roadmap built — some topics don't fit", { body: r.summary.message, kind: r.summary.feasible ? "info" : "error" });
      location.hash = "#/planner/roadmap";
      drawAssess(); if (location.hash === "#/planner/roadmap") drawRoadmap();
    } catch (e) { toastError(e); }
  });
}

function crisisModal() {
  const tomorrow = addDays(new Date(), 1);
  const exam = state.student.exam_date && parseDT(state.student.exam_date + "T09:00") > new Date() ? state.student.exam_date : isoDate(tomorrow);
  const m = modal({
    title: "Crisis mode", width: 540,
    body: `<p class="lead">Short on time? Prepwise re-plans around <b>marks per minute</b>: high-weight, low-mastery topics first, compressed into 25-minute sprints, with a cheat sheet for the rest. It still protects your sleep — tired recall is worse recall.</p>
      <div class="grid-2">
        <div class="field"><label>Exam date</label><input class="input" type="date" name="d" value="${exam}"></div>
        <div class="field"><label>Exam time</label><input class="input" type="time" name="t" value="09:00"></div>
      </div>
      <div class="field"><label>Hours I can study now: <b id="hv">4</b>h</label><input type="range" name="h" min="1" max="10" step="0.5" value="4"></div>`,
    actions: [{ label: "Cancel" }, { label: `${icon("zap")} Re-plan for the exam`, kind: "primary", loading: "Prioritising…", run: async (b) => {
      const exam_at = `${b.querySelector("[name=d]").value}T${b.querySelector("[name=t]").value}:00`;
      await api("/plan/crisis", { method: "POST", body: { hours: +b.querySelector("[name=h]").value, exam_at } });
      toast("Crisis plan ready", { body: "Start with the first sprint. One block at a time." });
      if (location.hash !== "#/planner/roadmap") location.hash = "#/planner/roadmap"; else { drawAssess(); drawRoadmap(); }
    } }],
  });
  const r = $("[name=h]", m.body);
  r.oninput = () => { $("#hv", m.body).textContent = r.value; };
}

// ================================================================== week view
async function drawWeek() {
  const body = $("#tab-body");
  const end = addDays(weekStart, 7);
  const label = `${fmtDay(weekStart, { day: "numeric", month: "short" })} – ${fmtDay(addDays(end, -1), { day: "numeric", month: "short", year: "numeric" })}`;
  body.innerHTML = `
    <div class="cal-head">
      <button class="btn sm" id="today">Today</button>
      <button class="icon-btn" id="prev">${icon("chevL")}</button><button class="icon-btn" id="next">${icon("chevR")}</button>
      <span class="range">${label}</span>
      <span style="flex:1"></span>
      <div class="legend">${["study", "revise", "practice", "break", "exam"].map(k => `<span><i style="background:${KIND_COLORS[k]}"></i>${k[0].toUpperCase() + k.slice(1)}</span>`).join("")}</div>
      <button class="btn sm" id="add-ev">${icon("plus")} Add block</button>
    </div>
    <div class="calendar">
      <div class="cal-days"><div></div>${[...Array(7)].map((_, i) => { const d = addDays(weekStart, i);
        const exam = state.student.exam_date === isoDate(d);
        return `<div class="${sameDay(d, new Date()) ? "today" : ""} ${exam ? "exam-day" : ""}">${d.toLocaleDateString(undefined, { weekday: "short" })}${exam ? " · Exam" : ""}<b>${d.getDate()}</b></div>`; }).join("")}</div>
      <div class="cal-scroll" id="cal-scroll"><div class="cal-grid">
        <div class="cal-hours">${[...Array(END_H - START_H)].map((_, i) => `<div>${i ? `${String(START_H + i).padStart(2, "0")}:00` : ""}</div>`).join("")}</div>
        ${[...Array(7)].map((_, i) => `<div class="cal-col ${i > 4 ? "weekend" : ""}" data-day="${i}" style="height:${(END_H - START_H) * ROW}px"></div>`).join("")}
      </div></div>
    </div>`;
  $("#today").onclick = () => { weekStart = startOfWeek(new Date()); drawWeek(); };
  $("#prev").onclick = () => { weekStart = addDays(weekStart, -7); drawWeek(); };
  $("#next").onclick = () => { weekStart = addDays(weekStart, 7); drawWeek(); };
  $("#add-ev").onclick = () => eventModal(null, new Date());
  $$(".cal-col").forEach(col => col.onclick = (e) => {
    if (e.target !== col) return;
    const day = addDays(weekStart, +col.dataset.day);
    const minsFromTop = Math.floor((e.offsetY / ROW) * 60 / 15) * 15;
    day.setHours(START_H, minsFromTop, 0, 0);
    eventModal(null, day);
  });

  const scroll = $("#cal-scroll");
  const now = new Date();
  const studyH = parseInt(String(state.student.study_start || "17").slice(0, 2), 10);
  const anchor = now.getHours() >= START_H && now.getHours() < studyH ? now.getHours() - 1 : studyH - 1;
  scroll.scrollTop = Math.max(0, (anchor - START_H) * ROW);

  let events = [];
  try { events = await api(`/events?start=${localISO(weekStart)}&end=${localISO(end)}`); } catch (e) { return toastError(e); }
  for (const ev of events) {
    const s = parseDT(ev.start_at), e = parseDT(ev.end_at);
    const dayIdx = Math.floor((new Date(s).setHours(0, 0, 0, 0) - weekStart) / 864e5);
    if (dayIdx < 0 || dayIdx > 6) continue;
    const top = ((s.getHours() + s.getMinutes() / 60) - START_H) * ROW;
    const endH = sameDay(s, e) ? e.getHours() + e.getMinutes() / 60 : END_H;
    const height = Math.max(16, (endH - (s.getHours() + s.getMinutes() / 60)) * ROW - 2);
    if (top + height < 0) continue;
    const el = h(`<div class="ev ${ev.kind} ${ev.status}" style="top:${Math.max(0, top)}px;height:${height}px" title="${esc(ev.title)}">
      <div class="tt">${esc(ev.title)}</div>${height > 30 ? `<div class="tm">${hm(s)} – ${hm(e)}</div>` : ""}</div>`);
    el.onclick = () => eventDetail(ev);
    $(`.cal-col[data-day="${dayIdx}"]`).appendChild(el);
  }
  // current time indicator
  const ti = Math.floor((new Date().setHours(0, 0, 0, 0) - weekStart) / 864e5);
  if (ti >= 0 && ti < 7 && now.getHours() >= START_H) {
    $(`.cal-col[data-day="${ti}"]`).appendChild(h(`<div class="now-line" style="top:${(now.getHours() + now.getMinutes() / 60 - START_H) * ROW}px"></div>`));
  }
}

function eventDetail(ev) {
  const t = topics.find(x => x.id === ev.topic_id);
  const s = parseDT(ev.start_at), e = parseDT(ev.end_at);
  const actions = [{ label: `${icon("trash")}`, kind: "ghost danger", run: async () => { await api(`/events/${ev.id}`, { method: "DELETE" }); refresh(); } },
    { label: "Edit", run: () => { setTimeout(() => eventModal(ev), 0); } }];
  if (t) actions.push({ label: `${icon("quiz")} Quiz`, run: () => { setTimeout(() => openQuiz(t.id, refresh), 0); } });
  if (ev.status === "planned" && !["exam", "break"].includes(ev.kind)) {
    actions.push({ label: "Skip", run: async () => { await api(`/events/${ev.id}/skip`, { method: "POST" }); refresh(); } });
    actions.push({ label: `${icon("check")} Mark done`, kind: "primary", run: async () => {
      const r = await api(`/events/${ev.id}/complete`, { method: "POST" });
      toast("Nice work!", { body: r.mastery != null ? `${t?.title || "Topic"} mastery is now ${Math.round(r.mastery)}%.` : "Block completed." });
      refresh();
    } });
  }
  modal({ title: ev.title, width: 460, actions, body: `
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <span class="pill" style="background:var(--${ev.kind}-bg);color:${KIND_COLORS[ev.kind]}">${ev.kind}</span>
      ${ev.phase ? `<span class="pill">${esc(ev.phase)}</span>` : ""}
      <span class="pill ${ev.status === "done" ? "good" : ev.status === "skipped" ? "bad" : ""}">${ev.status}</span></div>
    <div style="display:flex;gap:8px;align-items:center;color:var(--text-2)">${icon("clock")} ${fmtDay(s)} · ${hm(s)} – ${hm(e)} (${mins(Math.round((e - s) / 6e4))})</div>
    ${t ? `<div class="panel" style="padding:12px 14px"><div style="display:flex;justify-content:space-between"><b>${esc(t.title)}</b><span class="muted">weight ${t.weightage}/5</span></div>
      <div class="tbar" style="grid-template-columns:1fr 50px;margin-top:8px"><div class="track"><div class="fill" style="width:${t.mastery}%"></div></div><div class="val">${Math.round(t.mastery)}%</div></div>
      ${t.description ? `<p class="muted" style="margin:8px 0 0;font-size:12px">${esc(t.description)}</p>` : ""}</div>` : ""}
    ${ev.kind === "break" ? `<p class="lead">Stand up, drink water, rest your eyes (look 20 ft away for 20 s).</p>` : ""}
    ${ev.notes ? `<p class="lead">${esc(ev.notes)}</p>` : ""}` });
}

function eventModal(ev, startDate) {
  const s = ev ? parseDT(ev.start_at) : startDate;
  const e = ev ? parseDT(ev.end_at) : new Date(s.getTime() + 50 * 6e4);
  const tVal = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  modal({
    title: ev ? "Edit block" : "Add block", width: 500,
    body: `<div class="field"><label>Title</label><input class="input" name="title" value="${esc(ev?.title || "")}" placeholder="e.g. Solve 5 PYQs"></div>
      <div class="grid-2"><div class="field"><label>Type</label><select class="select" name="kind">${["study", "revise", "practice", "break", "reminder", "exam"].map(k => `<option ${ev?.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select></div>
        <div class="field"><label>Topic</label><select class="select" name="topic"><option value="">—</option>${topics.map(t => `<option value="${t.id}" ${ev?.topic_id === t.id ? "selected" : ""}>${esc(t.title)}</option>`).join("")}</select></div></div>
      <div class="grid-3"><div class="field"><label>Date</label><input class="input" type="date" name="d" value="${isoDate(s)}"></div>
        <div class="field"><label>Start</label><input class="input" type="time" name="s" value="${tVal(s)}"></div>
        <div class="field"><label>End</label><input class="input" type="time" name="e" value="${tVal(e)}"></div></div>
      <div class="field"><label>Remind me</label><select class="select" name="r">${[0, 5, 10, 15, 30, 60].map(m => `<option value="${m}" ${(ev?.remind_before ?? 10) === m ? "selected" : ""}>${m ? `${m} min before` : "At start"}</option>`).join("")}</select></div>`,
    actions: [{ label: "Cancel" }, { label: ev ? "Save" : "Add to calendar", kind: "primary", run: async (b) => {
      const v = (n) => b.querySelector(`[name=${n}]`).value;
      const body = { title: v("title") || "Study block", kind: v("kind"), topic_id: v("topic") ? +v("topic") : null,
        start_at: `${v("d")}T${v("s")}:00`, end_at: `${v("d")}T${v("e")}:00`, remind_before: +v("r") };
      await api(ev ? `/events/${ev.id}` : "/events", { method: ev ? "PUT" : "POST", body });
      refresh();
    } }],
  });
}

function refresh() {
  api("/topics").then(t => { topics = t; }).catch(() => {});
  if (location.hash.includes("roadmap")) drawRoadmap(); else drawWeek();
}

// ================================================================== roadmap view
async function drawRoadmap() {
  const body = $("#tab-body");
  body.innerHTML = `<div class="skeleton" style="height:90px;margin-bottom:12px"></div><div class="skeleton" style="height:300px"></div>`;
  let r;
  try { r = await api("/plan/roadmap"); } catch (e) { return toastError(e); }
  if (!r) {
    body.innerHTML = `<div class="empty"><div class="big-ico">${icon("route")}</div><h3>No roadmap yet</h3>
      <p>Prepwise spreads every topic until your exam, schedules spaced revision (+1, +3, +7 days) and keeps the last day for full revision.</p>
      <button class="btn primary" id="b2" data-loading="Planning…">${icon("route")} Build roadmap</button></div>`;
    $("#b2").onclick = (e) => buildStandard(e.currentTarget);
    return;
  }
  const s = r.summary;
  const events = r.events.filter(e => e.kind !== "break");
  const done = events.filter(e => e.status === "done").length;
  const days = {};
  events.forEach(e => { const k = isoDate(parseDT(e.start_at)); (days[k] ||= []).push(e); });
  const studyMin = events.filter(e => !["exam", "reminder"].includes(e.kind)).reduce((a, e) => a + (parseDT(e.end_at) - parseDT(e.start_at)) / 6e4, 0);

  let html = `<div class="road-summary">
    <div class="kpi"><div class="k">${icon(r.mode === "crisis" ? "zap" : "route")} Mode</div><div class="v" style="font-size:20px">${r.mode === "crisis" ? "Crisis" : "Full roadmap"}</div><div class="d">created ${fmtDay(r.created_at)}</div></div>
    <div class="kpi"><div class="k">${icon("clock")} Planned study</div><div class="v">${Math.round(studyMin / 60 * 10) / 10}<small>h</small></div><div class="d">${Object.keys(days).length} days</div></div>
    <div class="kpi"><div class="k">${icon("checkCircle")} Completed</div><div class="v">${done}<small>/ ${events.length}</small></div><div class="d">blocks done</div></div>
    <div class="kpi"><div class="k">${icon("target")} ${r.mode === "crisis" ? "Exam weight covered" : "Status"}</div>
      <div class="v" style="font-size:${r.mode === "crisis" ? 26 : 18}px">${r.mode === "crisis" ? `${s.weight_coverage}<small>%</small>` : s.feasible ? "On track" : "Over capacity"}</div><div class="d">${r.mode === "crisis" ? `${mins(s.focus_minutes)} focus time` : s.feasible ? "all topics fit" : `${s.unfinished.length} topics don't fit`}</div></div>
  </div>`;
  html += `<div class="banner ${r.mode === "crisis" ? "alert" : s.feasible ? "info" : "alert"}">${icon(r.mode === "crisis" ? "zap" : "info")}<span class="txt">${esc(s.message)}</span>
    ${r.mode === "standard" && !s.feasible ? `<button class="btn sm crisis" id="rc">Try crisis mode</button>` : ""}</div>`;

  if (r.mode === "crisis" && s.triage) {
    const col = (k, label, cls, ic) => `<div class="triage-col"><h4><span class="pill ${cls}">${icon(ic)} ${label}</span><span class="muted">${s.triage[k].length}</span></h4>
      <ul>${s.triage[k].map(t => `<li>${esc(t.title)}<span>${k === "skip" ? `w${t.weightage}` : mins(t.minutes)}</span></li>`).join("") || `<li class="muted">—</li>`}</ul></div>`;
    html += `<div class="triage">${col("must", "Must do", "bad", "flame")}${col("should", "Should do", "warn", "target")}${col("skim", "Skim only", "blue", "eye")}${col("skip", "Skip", "", "close")}</div>`;
    if (s.cheat_sheet?.length) {
      html += `<div class="panel" style="margin-bottom:18px"><div class="panel-head"><h3>${icon("bulb")} Cheat sheet</h3><span class="sub">high-yield points from your notes</span><button class="btn sm" id="cs-note">${icon("notes")} Save to notes</button></div>
        <div class="panel-body"><div class="cheats">${s.cheat_sheet.map(c => `<div class="cheat"><h4>${esc(c.title)}</h4><ul>${c.points.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>`).join("")}</div></div></div>`;
    }
  }
  if (r.mode === "standard" && s.daily_load?.length) {
    const max = Math.max(...s.daily_load.map(d => d.minutes), 60);
    html += `<div class="panel" style="margin-bottom:18px"><div class="panel-head"><h3>Daily load</h3><span class="sub">minutes of focused study per day · capacity ${state.student.daily_hours}h</span></div>
      <div class="panel-body"><div class="chart" id="load-chart" style="display:flex;align-items:flex-end;gap:4px;height:90px">${s.daily_load.map(d => `
        <div title="${fmtDay(d.date)} · ${mins(d.minutes)}" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end">
          <div style="width:100%;max-width:26px;height:${Math.max(2, d.minutes / max * 70)}px;background:var(--accent);border-radius:4px 4px 0 0"></div>
          <span style="font-size:9.5px;color:var(--muted)">${parseDT(d.date).getDate()}</span></div>`).join("")}</div></div></div>`;
  }

  html += `<div class="panel"><div class="panel-head"><h3>Timeline to exam</h3><span class="sub">${events.length} blocks</span></div><div class="panel-body"><div class="timeline">`;
  for (const [day, list] of Object.entries(days)) {
    const d = parseDT(day);
    html += `<div class="tl-day"><div class="tl-date"><b>${d.toLocaleDateString(undefined, { weekday: "long" })}</b><span>${d.toLocaleDateString(undefined, { day: "numeric", month: "long" })}${sameDay(d, new Date()) ? " · Today" : ""}</span></div>
      <div class="tl-items">${list.map(e => `<div class="tl-item ${e.status}" data-ev="${e.id}" style="cursor:pointer">
        <span class="kind-dot" style="background:${KIND_COLORS[e.kind]}"></span><span class="time">${hm(e.start_at)}–${hm(e.end_at)}</span>
        <span class="ttl">${esc(e.title)}</span>${e.mastery != null ? `<span class="muted" style="font-size:11px">${Math.round(e.mastery)}%</span>` : ""}
        ${e.status === "done" ? `<span class="pill good">${icon("check")} done</span>` : e.status === "skipped" ? `<span class="pill bad">skipped</span>` : ""}</div>`).join("")}</div></div>`;
  }
  html += `</div></div></div>`;
  body.innerHTML = html;
  $("#rc")?.addEventListener("click", crisisModal);
  $("#cs-note")?.addEventListener("click", async () => {
    const content = s.cheat_sheet.map(c => `## ${c.title}\n${c.points.map(p => `- ${p}`).join("\n")}`).join("\n\n");
    const n = await api("/notes", { method: "POST", body: { title: "Crisis cheat sheet", icon: "⚡", content, tags: ["cheatsheet"] } });
    toast("Saved to Notes", { actions: [{ label: "Open", run: () => { location.hash = `#/notes/${n.id}`; } }] });
  });
  $$("[data-ev]", body).forEach(el => el.onclick = () => eventDetail(r.events.find(e => e.id === +el.dataset.ev)));
}
