import { api, $, $$, h, esc, icon, modal, toast, toastError, confirmDialog, fmtDay, mins, parseDT, debounce } from "../lib.js";
import { openQuiz } from "./quiz.js";

const STATUS = {
  strong: ["Strong", "good"], okay: ["Okay", "warn"], weak: ["Needs work", "bad"], fading: ["Fading", "violet"],
};

export function render(view) {
  view.innerHTML = `<div class="page" style="max-width:1280px">
    <div class="page-head"><div class="grow"><h1>Progress</h1><p>Your exam readiness, where you're improving, and where to spend the next hour.</p></div>
      <div class="actions"><button class="btn" id="add-topic">${icon("plus")} Add topic</button></div></div>
    <div id="report"><div class="kpis">${'<div class="skeleton" style="height:92px"></div>'.repeat(6)}</div><div class="skeleton" style="height:280px"></div></div>
  </div>`;
  $("#add-topic", view).onclick = () => topicModal();
  draw();
}

async function draw() {
  let r, subjects;
  try { [r, subjects] = await Promise.all([api("/report"), api("/subjects")]); } catch (e) { return toastError(e); }
  const box = $("#report");
  if (!box) return;
  const k = r.kpis;
  const kpi = (ic, label, v, unit, d) => `<div class="kpi"><div class="k">${icon(ic)} ${label}</div><div class="v">${v ?? "—"}${v != null && unit ? `<small>${unit}</small>` : ""}</div><div class="d">${d}</div></div>`;
  box.innerHTML = `
    <div class="kpis">
      ${kpi("target", "Readiness", Math.round(k.readiness), "%", "weighted by exam importance")}
      ${kpi("calendar", "Exam in", k.days_left, k.days_left === 1 ? "day" : "days", k.forecast != null ? `forecast ${Math.round(k.forecast)}% by then` : "set exam date")}
      ${kpi("clock", "This week", Math.round(k.week_minutes / 6) / 10, "h", "focused study")}
      ${kpi("flame", "Streak", k.streak, k.streak === 1 ? "day" : "days", "consecutive study days")}
      ${kpi("checkCircle", "Plan adherence", k.adherence, "%", "planned blocks completed")}
      ${kpi("quiz", "Quiz accuracy", k.quiz_avg, "%", "last 20 quizzes")}
    </div>
    <div class="charts">
      <div class="panel"><div class="panel-head"><h3>Readiness over time</h3><span class="sub">last 30 days</span></div><div class="panel-body"><div class="chart" id="c-ready"></div></div></div>
      <div class="panel"><div class="panel-head"><h3>Study time</h3><span class="sub">minutes per day · last 14 days</span></div><div class="panel-body"><div class="chart" id="c-mins"></div></div></div>
    </div>
    <div class="charts" style="grid-template-columns:1.4fr 1fr">
      <div class="panel"><div class="panel-head"><h3>Topic mastery</h3><span class="sub">sorted by exam weight</span></div>
        <div class="panel-body"><div class="topic-bars">${r.topics.map(t => `
          <div class="tbar" title="${esc(t.title)} · ${Math.round(t.mastery)}% · weight ${t.weightage}/5${t.days_since != null ? ` · studied ${t.days_since}d ago` : ""}">
            <span class="name">${esc(t.title)}<small>w${t.weightage}</small></span>
            <span class="track"><span class="fill ${t.status}" style="width:${Math.max(1.5, t.mastery)}%"></span></span>
            <span class="val"><b>${Math.round(t.mastery)}%</b><span class="pill ${STATUS[t.status][1]}">${STATUS[t.status][0]}</span></span></div>`).join("") || `<p class="muted">No topics yet.</p>`}</div></div></div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="panel"><div class="panel-head"><h3>What to do next</h3></div><div class="panel-body"><div class="insights">${r.insights.map(i => `<div class="insight">${icon("bulb")}<span>${esc(i)}</span></div>`).join("")}</div></div></div>
        <div class="panel"><div class="panel-head"><h3>Subjects</h3></div><div class="panel-body">${r.subjects.map(s => `
          <div class="tbar" style="grid-template-columns:1fr 1.2fr 44px;margin-bottom:8px"><span class="name">${esc(s.name)} <small>${s.topics} topics</small></span>
          <span class="track"><span class="fill" style="width:${Math.max(1.5, s.readiness)}%"></span></span><span class="val"><b>${Math.round(s.readiness)}%</b></span></div>`).join("") || `<p class="muted">—</p>`}</div></div>
      </div>
    </div>
    <div class="panel"><div class="panel-head"><h3>Syllabus</h3><span class="sub">edit weightage, difficulty and your own confidence — the roadmap uses these</span></div>
      <div class="panel-body" style="overflow-x:auto"><table class="syllabus"><thead><tr><th>Topic</th><th>Subject</th><th>Weight (1–5)</th><th>Difficulty (1–3)</th><th>Est. min</th><th>Mastery</th><th></th></tr></thead>
      <tbody id="syl"></tbody></table></div></div>`;

  lineChart($("#c-ready"), r.timeline.map(d => ({ x: d.date, y: d.readiness })), { max: 100, unit: "%", label: "Readiness" });
  barChart($("#c-mins"), r.minutes_14.map(d => ({ x: d.date, y: d.minutes })));
  drawSyllabus(subjects);
}

async function drawSyllabus(subjects) {
  const topics = await api("/topics");
  const tb = $("#syl");
  tb.innerHTML = topics.map(t => `<tr data-id="${t.id}">
    <td style="font-weight:500;max-width:260px">${esc(t.title)}</td>
    <td><span class="muted">${esc(t.subject || "—")}</span></td>
    <td><input type="number" min="1" max="5" step="0.5" data-f="weightage" value="${t.weightage}"></td>
    <td><input type="number" min="1" max="3" step="0.5" data-f="difficulty" value="${t.difficulty}"></td>
    <td><input type="number" min="10" max="240" step="5" data-f="est_minutes" value="${t.est_minutes}"></td>
    <td><div class="mastery-cell"><input type="range" min="0" max="100" data-f="mastery" value="${Math.round(t.mastery)}"><b>${Math.round(t.mastery)}%</b></div></td>
    <td style="white-space:nowrap"><button class="btn sm" data-quiz="${t.id}">${icon("quiz")} Quiz</button> <button class="icon-btn" data-del="${t.id}">${icon("trash")}</button></td></tr>`).join("")
    || `<tr><td colspan="7" class="muted" style="padding:20px;text-align:center">No topics. Generate a mind map from your notes, or add topics manually.</td></tr>`;
  $$("tr[data-id]", tb).forEach(tr => {
    const t = topics.find(x => x.id === +tr.dataset.id);
    const save = debounce(async () => {
      const body = { title: t.title, description: t.description, subject_id: t.subject_id };
      $$("[data-f]", tr).forEach(i => { body[i.dataset.f] = +i.value; });
      try { await api(`/topics/${t.id}`, { method: "PUT", body }); toast("Saved", { body: "Rebuild your roadmap to apply changes.", timeout: 1800 }); }
      catch (e) { toastError(e); }
    }, 700);
    $$("[data-f]", tr).forEach(i => i.oninput = () => { if (i.type === "range") i.nextElementSibling.textContent = `${i.value}%`; save(); });
  });
  $$("[data-quiz]", tb).forEach(b => b.onclick = () => openQuiz(+b.dataset.quiz, () => draw()));
  $$("[data-del]", tb).forEach(b => b.onclick = async () => {
    if (!(await confirmDialog("Delete topic?", "It will be removed from your roadmap and progress."))) return;
    await api(`/topics/${b.dataset.del}`, { method: "DELETE" }); draw();
  });
}

function topicModal() {
  modal({ title: "Add topic", width: 500, body: `
    <div class="field"><label>Title</label><input class="input" name="title" placeholder="e.g. Normalization (1NF–BCNF)"></div>
    <div class="field"><label>Description</label><input class="input" name="description" placeholder="optional"></div>
    <div class="grid-3"><div class="field"><label>Weight 1–5</label><input class="input" type="number" name="weightage" min="1" max="5" value="3"></div>
      <div class="field"><label>Difficulty 1–3</label><input class="input" type="number" name="difficulty" min="1" max="3" value="2"></div>
      <div class="field"><label>Minutes</label><input class="input" type="number" name="est_minutes" min="10" max="240" step="5" value="45"></div></div>
    <div class="field"><label>Current confidence: <b id="mv">0</b>%</label><input type="range" name="mastery" min="0" max="100" value="0" oninput="document.getElementById('mv').textContent=this.value"></div>`,
    actions: [{ label: "Cancel" }, { label: "Add topic", kind: "primary", run: async (b) => {
      const v = (n) => b.querySelector(`[name=${n}]`).value;
      if (!v("title").trim()) throw new Error("Give the topic a title");
      await api("/topics", { method: "POST", body: { title: v("title"), description: v("description"), weightage: +v("weightage"), difficulty: +v("difficulty"), est_minutes: +v("est_minutes"), mastery: +v("mastery") } });
      draw();
    } }] });
}

// ------------------------------------------------------------------ charts (SVG, single series, hover tooltips)
function frame(el, height) {
  const w = el.clientWidth || 600;
  return { w, h: height, pad: { l: 34, r: 12, t: 10, b: 24 } };
}

function lineChart(el, data, { max, unit, label }) {
  const { w, h: H, pad } = frame(el, 220);
  const iw = w - pad.l - pad.r, ih = H - pad.t - pad.b;
  const x = (i) => pad.l + (i / Math.max(1, data.length - 1)) * iw;
  const y = (v) => pad.t + ih - (v / max) * ih;
  const pts = data.map((d, i) => `${x(i)},${y(d.y)}`).join(" ");
  const ticks = [0, 25, 50, 75, 100];
  const last = data.length - 1;
  const xt = data.map((d, i) => i).filter(i => (i % 7 === 0 && last - i >= 4) || i === last);
  el.innerHTML = `<svg viewBox="0 0 ${w} ${H}" height="${H}" role="img" aria-label="${label} over the last 30 days">
    <defs><linearGradient id="lg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#3D6BF5" stop-opacity=".16"/><stop offset="1" stop-color="#3D6BF5" stop-opacity="0"/></linearGradient></defs>
    <g class="grid">${ticks.map(t => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`).join("")}</g>
    <g class="axis">${ticks.map(t => `<text x="${pad.l - 8}" y="${y(t)}" text-anchor="end" dominant-baseline="central">${t}${unit}</text>`).join("")}
      ${xt.map(i => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${fmtDay(data[i].x, { day: "numeric", month: "short" })}</text>`).join("")}</g>
    <polygon points="${pad.l},${y(0)} ${pts} ${x(data.length - 1)},${y(0)}" fill="url(#lg)"/>
    <polyline points="${pts}" fill="none" stroke="#3D6BF5" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(data.length - 1)}" cy="${y(data[data.length - 1].y)}" r="4" fill="#3D6BF5" stroke="#fff" stroke-width="2"/>
    <line class="xh" y1="${pad.t}" y2="${pad.t + ih}" stroke="#C3C7CF" stroke-dasharray="3 3" visibility="hidden"/>
    <circle class="dot" r="4.5" fill="#3D6BF5" stroke="#fff" stroke-width="2" visibility="hidden"/>
    <rect x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent"/></svg>
    <div class="chart-tip hidden"></div>`;
  const svg = $("svg", el), tip = $(".chart-tip", el), xh = $(".xh", el), dot = $(".dot", el);
  svg.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    const px = (e.clientX - r.left) * (w / r.width);
    const i = Math.max(0, Math.min(data.length - 1, Math.round((px - pad.l) / iw * (data.length - 1))));
    const d = data[i];
    xh.setAttribute("x1", x(i)); xh.setAttribute("x2", x(i)); xh.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(d.y)); dot.setAttribute("visibility", "visible");
    tip.classList.remove("hidden");
    tip.innerHTML = `<b>${Math.round(d.y)}${unit}</b>${fmtDay(d.x)}`;
    tip.style.left = `${x(i) * r.width / w}px`; tip.style.top = `${y(d.y) * r.height / H}px`;
  });
  svg.addEventListener("pointerleave", () => { tip.classList.add("hidden"); xh.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); });
}

function barChart(el, data) {
  const { w, h: H, pad } = frame(el, 220);
  const iw = w - pad.l - pad.r, ih = H - pad.t - pad.b;
  const maxV = Math.max(60, ...data.map(d => d.y));
  const nice = Math.ceil(maxV / 30) * 30;
  const y = (v) => pad.t + ih - (v / nice) * ih;
  const slot = iw / data.length, bw = Math.min(22, slot - 4);
  const ticks = [0, nice / 2, nice];
  el.innerHTML = `<svg viewBox="0 0 ${w} ${H}" height="${H}" role="img" aria-label="Study minutes per day">
    <g class="grid">${ticks.map(t => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`).join("")}</g>
    <g class="axis">${ticks.map(t => `<text x="${pad.l - 8}" y="${y(t)}" text-anchor="end" dominant-baseline="central">${t}</text>`).join("")}
      ${data.map((d, i) => i % 2 === 1 ? "" : `<text x="${pad.l + slot * i + slot / 2}" y="${H - 6}" text-anchor="middle">${parseDT(d.x).getDate()}</text>`).join("")}</g>
    ${data.map((d, i) => {
      const bh = Math.max(d.y ? 3 : 0, ih - (y(d.y) - pad.t)); const bx = pad.l + slot * i + (slot - bw) / 2; const r = Math.min(4, bh);
      return `<g class="bar" data-i="${i}"><rect x="${pad.l + slot * i}" y="${pad.t}" width="${slot}" height="${ih}" fill="transparent"/>
        ${bh ? `<path d="M${bx},${y(0)} v${-(bh - r)} q0,-${r} ${r},-${r} h${bw - 2 * r} q${r},0 ${r},${r} v${bh - r} z" fill="${i === data.length - 1 ? "#3D6BF5" : "#9DB4F9"}"/>` : ""}</g>`;
    }).join("")}
    <line x1="${pad.l}" x2="${w - pad.r}" y1="${y(0)}" y2="${y(0)}" stroke="#E1E3E8"/></svg>
    <div class="chart-tip hidden"></div>`;
  const svg = $("svg", el), tip = $(".chart-tip", el);
  $$(".bar", el).forEach(g => {
    g.onpointerenter = () => {
      const d = data[+g.dataset.i]; const r = svg.getBoundingClientRect();
      tip.classList.remove("hidden"); tip.innerHTML = `<b>${mins(d.y)}</b>${fmtDay(d.x)}`;
      tip.style.left = `${(pad.l + slot * +g.dataset.i + slot / 2) * r.width / w}px`; tip.style.top = `${y(d.y) * r.height / H}px`;
    };
    g.onpointerleave = () => tip.classList.add("hidden");
  });
}
