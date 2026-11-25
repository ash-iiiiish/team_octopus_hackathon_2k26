// Shared helpers: API client, icons, markdown, dates, toasts, modals.

export const state = { student: null, status: null, chats: [], topics: [] };

// ------------------------------------------------------------------ API
export async function api(path, { method = "GET", body, form } = {}) {
  const headers = {};
  if (state.student) headers["X-Student-Id"] = state.student.id;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) {
    const detail = data?.detail;
    const msg = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map(d => d.msg).join(", ") : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

// ------------------------------------------------------------------ DOM
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function h(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

export async function withLoading(btn, fn) {
  const old = btn.innerHTML;
  btn.classList.add("loading");
  btn.innerHTML = `<span class="spin"></span>${btn.dataset.loading || "Working…"}`;
  try { return await fn(); } finally { btn.classList.remove("loading"); btn.innerHTML = old; }
}

// ------------------------------------------------------------------ icons (1.6px stroke line set)
const P = {
  logo: '<path d="M4 4h9l7 7v9h-9l-7-7z" fill="currentColor" stroke="none"/><path d="M9.5 9.5h5v5" stroke="#fff" stroke-width="2"/>',
  sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9.5 4.5v15"/>',
  edit: '<path d="M12 20h8"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  notes: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  library: '<path d="M4 19.5V5a2 2 0 0 1 2-2h12v15H6.5A2.5 2.5 0 0 0 4 20.5 2.5 2.5 0 0 0 6.5 23H18"/><path d="M8 7h6"/>',
  mindmap: '<circle cx="12" cy="12" r="2.5"/><circle cx="4.5" cy="6" r="1.8"/><circle cx="19.5" cy="6" r="1.8"/><circle cx="4.5" cy="18" r="1.8"/><circle cx="19.5" cy="18" r="1.8"/><path d="m6 7.2 4 3M18 7.2l-4 3M6 16.8l4-3M18 16.8l-4-3"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
  caret: '<path d="m6 9 6 6 6-6" stroke-width="2.4"/>',
  caretR: '<path d="m9 6 6 6-6 6" stroke-width="2.4"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  filter: '<path d="M3 6h18M7 12h10M10 18h4"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-4-.9L3 20l1.1-4A8.4 8.4 0 1 1 21 11.5z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M8.5 15.5h7M8.5 12h4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  paperclip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  tools: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7" stroke-width="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  check: '<path d="M20 6 9 17l-5-5" stroke-width="2"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  verified: '<path d="M12 2 14.6 4.3 18 4l.7 3.4L21.5 9.5 20 12.6l1.5 3-2.8 2.1L18 21l-3.4-.3L12 23l-2.6-2.3L6 21l-.7-3.3-2.8-2.1 1.5-3.1-1.5-3 2.8-2.1L6 4l3.4.3z" fill="currentColor" stroke="none"/><path d="m8.5 12.5 2.3 2.2 4.7-5" stroke="#fff" stroke-width="2"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.3.3 1.3 1.2 2.5 2.5 2.8z"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  brain: '<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24A2.5 2.5 0 0 0 14.5 2Z"/>',
  quiz: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
  pin: '<path d="M12 17v5M9 10.8V4h6v6.8l3 3.2H6z"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>',
  fit: '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>',
  alert: '<path d="m10.3 3.9-8.2 14A2 2 0 0 0 3.8 21h16.4a2 2 0 0 0 1.7-3.1l-8.2-14a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  bulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  chevL: '<path d="m15 18-6-6 6-6" stroke-width="2"/>',
  chevR: '<path d="m9 18 6-6-6-6" stroke-width="2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};
export function icon(name, cls = "") {
  return `<svg class="${cls}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ""}</svg>`;
}

// ------------------------------------------------------------------ markdown (small, safe subset)
function inline(s) {
  return esc(s)
    .replace(/&lt;br\s*\/?&gt;/gi, "<br>")   // models often put <br> inside table cells
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, "$1<em>$2</em>")
    .replace(/\[(\d{1,2})\]/g, '<span class="cite">$1</span>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

export function md(src = "") {
  const lines = src.replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    if (/^```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`); continue;
    }
    if (/^#{1,3}\s/.test(line)) {
      const n = line.match(/^#+/)[0].length; out.push(`<h${n}>${inline(line.slice(n).trim())}</h${n}>`); i++; continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map(c => inline(c.trim()));
      const head = cells(line); i += 2;
      const body = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) body.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${md(buf.join("\n"))}</blockquote>`); continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        const raw = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, "");
        const task = raw.match(/^\[( |x|X)\]\s*(.*)$/);
        const depth = Math.floor((lines[i].match(/^\s*/)[0].length) / 2);
        const style = depth ? ` style="margin-left:${depth * 18}px"` : "";
        items.push(task
          ? `<li class="task${task[1] !== " " ? " done" : ""}"${style}><input type="checkbox" disabled ${task[1] !== " " ? "checked" : ""}><span>${inline(task[2])}</span></li>`
          : `<li${style}>${inline(raw)}</li>`);
        i++;
      }
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`); continue;
    }
    if (!line.trim()) { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|>|\s*([-*+]|\d+[.)])\s+|\|)/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) buf.push(lines[i++]);
    out.push(`<p>${buf.map(inline).join("<br>")}</p>`);
  }
  return out.join("");
}

// ------------------------------------------------------------------ dates
const pad = (n) => String(n).padStart(2, "0");
export const parseDT = (s) => (s instanceof Date ? s : new Date(String(s).replace(" ", "T")));
export const hm = (d) => { d = parseDT(d); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localISO = (d) => `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
export const sameDay = (a, b) => isoDate(a) === isoDate(b);
export function relDay(s) {
  const d = parseDT(s), now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return "Today";
  if (sameDay(d, y)) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
export const whenLabel = (s) => `${relDay(s)} · ${hm(s)}`;
export const fmtDay = (d, opts = { weekday: "short", day: "numeric", month: "short" }) => parseDT(d).toLocaleDateString(undefined, opts);
export const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);
export const bytes = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

// ------------------------------------------------------------------ toasts
export function toast(title, { body = "", kind = "info", actions = [], timeout = 4200 } = {}) {
  const box = $("#toasts");
  const ico = kind === "error" ? "alert" : kind === "reminder" ? "bell" : "checkCircle";
  const el = h(`<div class="toast ${kind}">${icon(ico)}<div class="tb"><b>${esc(title)}</b>${body ? esc(body) : ""}
    ${actions.length ? `<div class="ta">${actions.map((a, i) => `<button data-i="${i}">${esc(a.label)}</button>`).join("")}</div>` : ""}</div></div>`);
  const close = () => el.remove();
  el.querySelectorAll("[data-i]").forEach(b => b.onclick = () => { actions[+b.dataset.i].run(); close(); });
  box.appendChild(el);
  if (timeout) setTimeout(close, timeout);
  return close;
}
export const toastError = (e) => toast(e.message || String(e), { kind: "error" });

// ------------------------------------------------------------------ modal
export function modal({ title, body, actions = [], width, onClose } = {}) {
  const ov = h(`<div class="overlay"><div class="modal" role="dialog" aria-modal="true" ${width ? `style="width:min(${width}px,calc(100vw - 32px))"` : ""}>
      <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${icon("close")}</button></div>
      <div class="modal-body"></div>
      ${actions.length ? `<div class="modal-foot"></div>` : ""}</div></div>`);
  const bodyEl = $(".modal-body", ov);
  if (typeof body === "string") bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(); });
  $("[data-close]", ov).onclick = close;
  const foot = $(".modal-foot", ov);
  actions.forEach(a => {
    const b = h(`<button class="btn ${a.kind || ""}">${a.label}</button>`);
    if (a.loading) b.dataset.loading = a.loading;
    b.onclick = async () => {
      try { const r = a.loading ? await withLoading(b, () => a.run(bodyEl, close)) : await a.run?.(bodyEl, close); if (r !== false && !a.keepOpen) close(); }
      catch (e) { toastError(e); }
    };
    foot.appendChild(b);
  });
  document.body.appendChild(ov);
  setTimeout(() => $("input, textarea, select", bodyEl)?.focus(), 30);
  return { el: ov, body: bodyEl, close };
}

export function confirmDialog(title, text, label = "Delete") {
  return new Promise((resolve) => {
    let ok = false;
    modal({ title, body: `<p class="lead">${esc(text)}</p>`, onClose: () => resolve(ok),
      actions: [{ label: "Cancel" }, { label, kind: "primary", run: () => { ok = true; } }] });
  });
}

export const KIND_COLORS = { study: "var(--study)", revise: "var(--revise)", practice: "var(--practice)", break: "var(--break)", exam: "var(--exam)", reminder: "var(--reminder)" };
