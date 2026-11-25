import { api, $, $$, h, esc, icon, md, debounce, toastError, confirmDialog, relDay, hm } from "../lib.js";

const EMOJIS = ["📄", "📘", "📗", "📕", "🧠", "🎯", "🧪", "📐", "💡", "🗂️", "📝", "⭐", "🔥", "🧮", "🌍", "💻", "⚙️", "📊", "🧬", "⚡", "🗓️", "✅", "❓", "📌"];
let notes = [], subjects = [], current = null, mode = "read";
const openNodes = new Set(JSON.parse(localStorage.getItem("prepwise.openNotes") || "[]"));

export function render(view, [id]) {
  view.style.overflow = "hidden";
  view.innerHTML = `
    <div class="notes-layout">
      <aside class="notes-side">
        <div class="search-mini">${icon("search")}<input class="input" placeholder="Filter pages" id="nfilter"></div>
        <button class="btn" id="new-page" style="justify-content:center">${icon("plus")} New page</button>
        <div id="tree"></div>
      </aside>
      <section class="editor" id="editor"></section>
    </div>`;
  $("#new-page", view).onclick = () => createPage(null);
  $("#nfilter", view).oninput = drawTree;
  load(id ? +id : null);
  return () => { view.style.overflow = ""; };
}

async function load(openId) {
  try { [notes, subjects] = await Promise.all([api("/notes"), api("/subjects")]); } catch (e) { return toastError(e); }
  drawTree();
  const target = openId || notes.find(n => n.pinned)?.id || notes[0]?.id;
  if (target) openNote(target); else drawEmpty();
}

function drawEmpty() {
  $("#editor").innerHTML = `<div class="page" style="padding-top:60px"><div class="empty"><div class="big-ico">${icon("notes")}</div>
    <h3>Your notes, arranged your way</h3><p>Create pages, nest them inside each other, tag them, and drag to reorder.</p>
    <button class="btn primary" id="first-page">${icon("plus")} Create first page</button></div></div>`;
  $("#first-page").onclick = () => createPage(null);
}

async function createPage(parentId) {
  try {
    const n = await api("/notes", { method: "POST", body: { title: "Untitled", parent_id: parentId } });
    if (parentId) { openNodes.add(parentId); saveOpen(); }
    notes.push(n);
    history.replaceState(null, "", `#/notes/${n.id}`);
    drawTree(); openNote(n.id, true);
  } catch (e) { toastError(e); }
}
const saveOpen = () => localStorage.setItem("prepwise.openNotes", JSON.stringify([...openNodes]));

// ------------------------------------------------------------------ tree
function drawTree() {
  const q = ($("#nfilter")?.value || "").toLowerCase();
  const tree = $("#tree");
  if (!tree) return;
  const kids = (pid) => notes.filter(n => (n.parent_id || null) === pid).sort((a, b) => a.position - b.position);
  const item = (n, depth) => {
    const children = kids(n.id);
    const open = openNodes.has(n.id);
    return `<div class="tree-item ${current?.id === n.id ? "active" : ""} ${open ? "open" : ""}" draggable="true" data-id="${n.id}" style="padding-left:${6 + depth * 14}px">
        <span class="caret" data-toggle="${n.id}" style="${children.length ? "" : "visibility:hidden"}">${icon("caretR")}</span>
        <span class="emoji">${n.icon || "📄"}</span><span class="t">${esc(n.title || "Untitled")}</span>
        <span class="add" data-add="${n.id}" title="Add sub-page">${icon("plus")}</span></div>
      ${open ? children.map(c => item(c, depth + 1)).join("") : ""}`;
  };
  let html = "";
  if (q) {
    const hits = notes.filter(n => (n.title || "").toLowerCase().includes(q) || n.tags.some(t => t.toLowerCase().includes(q)));
    html = `<div class="tree-label">Results</div>` + (hits.map(n => item({ ...n }, 0)).join("") || `<div class="muted" style="padding:6px 8px">No pages</div>`);
  } else {
    const pinned = notes.filter(n => n.pinned);
    if (pinned.length) html += `<div class="tree-label">Pinned</div>` + pinned.map(n => `<div class="tree-item" data-id="${n.id}" style="padding-left:6px"><span class="caret" style="visibility:hidden"></span><span class="emoji">${n.icon || "📄"}</span><span class="t">${esc(n.title)}</span></div>`).join("");
    html += `<div class="tree-label">Pages</div>` + (kids(null).map(n => item(n, 0)).join("") || `<div class="muted" style="padding:6px 8px">No pages yet</div>`);
  }
  tree.innerHTML = html;

  $$(".tree-item", tree).forEach(el => {
    const id = +el.dataset.id;
    el.onclick = (e) => {
      if (e.target.closest("[data-toggle]")) { openNodes.has(id) ? openNodes.delete(id) : openNodes.add(id); saveOpen(); return drawTree(); }
      if (e.target.closest("[data-add]")) return createPage(id);
      history.replaceState(null, "", `#/notes/${id}`);
      openNote(id);
    };
    // drag: drop on the top edge = place before, on the middle = nest inside
    el.ondragstart = (e) => { e.dataTransfer.setData("text/plain", id); e.dataTransfer.effectAllowed = "move"; };
    el.ondragover = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const before = e.clientY - r.top < r.height * 0.3;
      el.classList.toggle("drop-before", before); el.classList.toggle("drop-in", !before);
    };
    el.ondragleave = () => el.classList.remove("drop-before", "drop-in");
    el.ondrop = async (e) => {
      e.preventDefault();
      const before = el.classList.contains("drop-before");
      el.classList.remove("drop-before", "drop-in");
      const dragged = +e.dataTransfer.getData("text/plain");
      if (!dragged || dragged === id) return;
      const target = notes.find(n => n.id === id);
      const parent = before ? (target.parent_id || null) : id;
      const siblings = notes.filter(n => (n.parent_id || null) === parent && n.id !== dragged).sort((a, b) => a.position - b.position).map(n => n.id);
      if (before) siblings.splice(siblings.indexOf(id), 0, dragged); else siblings.push(dragged);
      try {
        await api(`/notes/${dragged}/move`, { method: "POST", body: { parent_id: parent, ordered_ids: siblings } });
        if (!before) { openNodes.add(id); saveOpen(); }
        notes = await api("/notes"); drawTree();
      } catch (err) { toastError(err); }
    };
  });
}

// ------------------------------------------------------------------ editor
async function openNote(id, focusTitle = false) {
  let n;
  try { n = await api(`/notes/${id}`); } catch (e) { return toastError(e); }
  current = n;
  mode = focusTitle || !n.content.trim() ? "write" : "read";
  drawTree();
  const crumbs = [];
  let p = n.parent_id;
  while (p) { const pn = notes.find(x => x.id === p); if (!pn) break; crumbs.unshift(`${pn.icon || "📄"} ${esc(pn.title)}`); p = pn.parent_id; }
  crumbs.push(`${n.icon || "📄"} ${esc(n.title)}`);

  const ed = $("#editor");
  ed.innerHTML = `
    <div class="editor-bar">
      <span class="crumbs">${crumbs.join(" <span class='muted'>/</span> ")}</span>
      <span class="save-state" id="save-state">Edited ${relDay(n.updated_at)} ${hm(n.updated_at)}</span>
      <div class="segmented"><button data-mode="write" class="${mode === "write" ? "active" : ""}">Write</button><button data-mode="read" class="${mode === "read" ? "active" : ""}">Read</button></div>
      <button class="icon-btn" id="pin" title="${n.pinned ? "Unpin" : "Pin"}" style="${n.pinned ? "color:var(--accent)" : ""}">${icon("pin")}</button>
      <button class="icon-btn" id="del" title="Delete page">${icon("trash")}</button>
    </div>
    <div class="editor-inner">
      <button class="note-icon" id="emoji">${n.icon || "📄"}</button>
      <input class="note-title" id="ntitle" value="${esc(n.title)}" placeholder="Untitled">
      <div class="note-props">
        <span>Subject</span><div class="val"><select id="nsubject"><option value="">— none —</option>${subjects.map(s => `<option value="${s.id}" ${s.id === n.subject_id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}<option value="__new">+ New subject…</option></select></div>
        <span>Tags</span><div class="val" id="ntags">${n.tags.map(t => `<span class="tag">#${esc(t)}<button data-rm="${esc(t)}">×</button></span>`).join("")}<input id="tagin" placeholder="Add tag" style="width:80px"></div>
        <span>Created</span><div class="val">${new Date(n.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</div>
      </div>
      <div id="nbody"></div>
    </div>`;

  const state = { title: n.title, content: n.content, tags: [...n.tags] };
  const saveEl = $("#save-state");
  const save = debounce(async (fields) => {
    try {
      await api(`/notes/${n.id}`, { method: "PATCH", body: fields });
      saveEl.textContent = "Saved";
      const ln = notes.find(x => x.id === n.id); if (ln) Object.assign(ln, fields); drawTree();
    } catch (e) { saveEl.textContent = "Not saved"; toastError(e); }
  }, 600);
  const queue = (fields) => { saveEl.textContent = "Saving…"; save({ title: state.title, content: state.content, tags: state.tags, ...fields }); };

  const body = $("#nbody");
  const drawBody = () => {
    if (mode === "write") {
      body.innerHTML = `<textarea class="note-body" placeholder="Start writing… Markdown works: # heading, - list, - [ ] task, **bold**, > quote"></textarea>`;
      const ta = $("textarea", body);
      ta.value = state.content;
      const grow = () => { ta.style.height = "auto"; ta.style.height = Math.max(420, ta.scrollHeight) + "px"; };
      ta.oninput = () => { state.content = ta.value; grow(); queue({}); };
      ta.onkeydown = (e) => {
        // continue lists on Enter, like a block editor
        if (e.key === "Enter" && !e.shiftKey) {
          const before = ta.value.slice(0, ta.selectionStart);
          const line = before.split("\n").pop();
          const m = line.match(/^(\s*)([-*]\s(\[[ x]\]\s)?|\d+\.\s)/);
          if (m) {
            e.preventDefault();
            if (line.trim() === m[2].trim()) { // empty item ends the list
              ta.setRangeText("", ta.selectionStart - line.length, ta.selectionStart, "end");
            } else {
              let marker = m[2].replace("[x]", "[ ]");
              if (/^\d+/.test(marker)) marker = `${parseInt(marker) + 1}. `;
              ta.setRangeText(`\n${m[1]}${marker}`, ta.selectionStart, ta.selectionEnd, "end");
            }
            ta.dispatchEvent(new Event("input"));
          }
        }
        if (e.key === "Tab") { e.preventDefault(); ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end"); }
      };
      requestAnimationFrame(grow);
    } else {
      body.innerHTML = `<div class="md" style="font-size:14px;cursor:text;min-height:300px">${md(state.content) || `<p class="muted">Empty page. Click to start writing.</p>`}</div>`;
      // checklists are tickable while reading; clicking anywhere else starts editing
      $$("li.task input", body).forEach((cb, i) => {
        cb.disabled = false;
        cb.onclick = (e) => {
          e.stopPropagation();
          let k = -1;
          state.content = state.content.replace(/^(\s*[-*+]\s+)\[( |x|X)\]/gm, (m, pre, v) => (++k === i ? `${pre}[${v === " " ? "x" : " "}]` : m));
          queue({}); drawBody();
        };
      });
      $(".md", body).onclick = (e) => {
        if (e.target.closest("a, input")) return;
        mode = "write"; $$("[data-mode]").forEach(x => x.classList.toggle("active", x.dataset.mode === "write"));
        drawBody(); $("#nbody textarea")?.focus();
      };
    }
  };
  drawBody();

  $$("[data-mode]").forEach(b => b.onclick = () => {
    mode = b.dataset.mode;
    $$("[data-mode]").forEach(x => x.classList.toggle("active", x === b)); drawBody();
  });
  const titleIn = $("#ntitle");
  titleIn.oninput = () => { state.title = titleIn.value || "Untitled"; queue({}); };
  titleIn.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("#nbody textarea")?.focus(); } };
  if (focusTitle) { titleIn.select(); titleIn.focus(); }

  $("#emoji").onclick = (e) => {
    $(".emoji-pop")?.remove();
    const r = e.currentTarget.getBoundingClientRect();
    const pop = h(`<div class="emoji-pop" style="left:${r.left}px;top:${r.bottom + 6}px">${EMOJIS.map(x => `<button>${x}</button>`).join("")}</div>`);
    document.body.appendChild(pop);
    $$("button", pop).forEach(b => b.onclick = () => { $("#emoji").textContent = b.textContent; queue({ icon: b.textContent }); pop.remove(); });
    setTimeout(() => document.addEventListener("mousedown", function off(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener("mousedown", off); } }), 0);
  };
  $("#nsubject").onchange = async (e) => {
    let v = e.target.value;
    if (v === "__new") {
      const name = prompt("New subject name");
      if (!name) { e.target.value = n.subject_id || ""; return; }
      const s = await api("/subjects", { method: "POST", body: { name } });
      subjects.push(s); v = s.id;
      e.target.insertBefore(h(`<option value="${s.id}">${esc(s.name)}</option>`), e.target.lastElementChild);
      e.target.value = s.id;
    }
    queue({ subject_id: v ? +v : null });
  };
  const drawTags = () => {
    $$("#ntags .tag").forEach(t => t.remove());
    const tin = $("#tagin");
    state.tags.forEach(t => tin.before(h(`<span class="tag">#${esc(t)}<button data-rm="${esc(t)}">×</button></span>`)));
    $$("[data-rm]").forEach(b => b.onclick = () => { state.tags = state.tags.filter(t => t !== b.dataset.rm); drawTags(); queue({}); });
  };
  drawTags();
  $("#tagin").onkeydown = (e) => {
    if (e.key === "Enter" && e.target.value.trim()) {
      const t = e.target.value.trim().replace(/^#/, "").toLowerCase();
      if (!state.tags.includes(t)) state.tags.push(t);
      e.target.value = ""; drawTags(); queue({});
    }
  };
  $("#pin").onclick = async () => {
    await api(`/notes/${n.id}`, { method: "PATCH", body: { pinned: !n.pinned } });
    notes = await api("/notes"); openNote(n.id);
  };
  $("#del").onclick = async () => {
    if (!(await confirmDialog("Delete page?", `“${n.title}” and its sub-pages will be deleted.`))) return;
    await api(`/notes/${n.id}`, { method: "DELETE" });
    current = null; notes = await api("/notes");
    history.replaceState(null, "", "#/notes");
    drawTree(); notes.length ? openNote(notes[0].id) : drawEmpty();
  };
}
