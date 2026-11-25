import { state, api, $, esc, icon, toast, toastError } from "../lib.js";

export function render(view) {
  const s = state.student;
  const notif = "Notification" in window ? Notification.permission : "unsupported";
  view.innerHTML = `<div class="page" style="max-width:760px">
    <div class="page-head"><div class="grow"><h1>Settings</h1><p>Your exam and routine. The planner uses these for every roadmap.</p></div></div>
    <form class="panel" id="sf"><div class="panel-head"><h3>Profile & exam</h3></div><div class="panel-body" style="display:flex;flex-direction:column;gap:14px">
      <div class="grid-2"><div class="field"><label>Name</label><input class="input" name="name" value="${esc(s.name)}" required></div>
        <div class="field"><label>Email</label><input class="input" name="email" type="email" value="${esc(s.email || "")}"></div></div>
      <div class="grid-2"><div class="field"><label>Exam name</label><input class="input" name="exam_name" value="${esc(s.exam_name || "")}"></div>
        <div class="field"><label>Exam date</label><input class="input" name="exam_date" type="date" value="${s.exam_date || ""}"></div></div>
      <div class="grid-3">
        <div class="field"><label>Study hours / day</label><input class="input" name="daily_hours" type="number" step="0.5" min="0.5" max="14" value="${s.daily_hours}"><span class="hint">Pick what you can actually keep.</span></div>
        <div class="field"><label>Usually start at</label><input class="input" name="study_start" type="time" value="${String(s.study_start).slice(0, 5)}"></div>
        <div class="field"><label>Sleep by</label><input class="input" name="sleep_time" type="time" value="${String(s.sleep_time).slice(0, 5)}"><span class="hint">Plans never run past this.</span></div>
      </div>
      <div style="display:flex;justify-content:flex-end"><button class="btn primary">Save changes</button></div>
    </div></form>
    <div class="panel" style="margin-top:12px"><div class="panel-head"><h3>Reminders</h3></div><div class="panel-body">
      <div class="list-row" style="padding:0"><div class="file-ico blue">${icon("bell")}</div><div class="row-main"><div class="row-title">Desktop notifications</div>
        <div class="row-meta">${notif === "granted" ? "On — you'll be nudged before each study block and break." : notif === "denied" ? "Blocked in your browser settings." : "Get a nudge 10 minutes before each block, even in another tab."}</div></div>
        ${notif === "default" ? `<button class="btn sm primary" id="notif">Enable</button>` : `<span class="pill ${notif === "granted" ? "good" : ""}">${notif}</span>`}</div>
    </div></div>
    <div class="panel" style="margin-top:12px"><div class="panel-head"><h3>AI engine</h3></div><div class="panel-body">
      <div class="list-row" style="padding:0"><div class="file-ico ${state.status.llm ? "blue" : ""}">${icon("sparkle")}</div><div class="row-main">
        <div class="row-title">${state.status.llm ? "Live — Groq" : "Demo mode"}</div>
        <div class="row-meta">${state.status.llm ? "Answers, mind maps, quizzes and cheat sheets are generated from your notes." : "Everything works offline using extractive answers from your notes. Add <code>GROQ_API_KEY</code> to <code>.env</code> and restart for full AI."}</div></div></div>
    </div></div>
  </div>`;
  $("#sf", view).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      state.student = await api("/me", { method: "PUT", body: {
        name: f.get("name"), email: f.get("email") || null, exam_name: f.get("exam_name"), exam_date: f.get("exam_date") || null,
        daily_hours: +f.get("daily_hours"), study_start: f.get("study_start"), sleep_time: f.get("sleep_time") } });
      $(".user-name").firstChild.textContent = state.student.name + " ";
      toast("Saved", { body: "Rebuild your roadmap to apply the new schedule.", actions: [{ label: "Open planner", run: () => { location.hash = "#/planner"; } }] });
    } catch (err) { toastError(err); }
  };
  $("#notif", view)?.addEventListener("click", async () => { await Notification.requestPermission(); render(view); });
}
