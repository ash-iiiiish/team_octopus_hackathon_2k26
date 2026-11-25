"""Prepwise API + static frontend.

Run:  uvicorn app:app --reload      (see README.md)
"""
import re
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend import ai, db, planner, progress, rag
from backend.config import APP_NAME, APP_VERSION, LLM_ENABLED, MAX_UPLOAD_BYTES, STATIC_DIR

app = FastAPI(title=APP_NAME, version=APP_VERSION)


@app.on_event("startup")
def startup():
    db.init_pool()


def student_id(x_student_id: Optional[int] = Header(default=None)) -> int:
    if not x_student_id or not db.row("SELECT 1 FROM students WHERE id=%s", (x_student_id,)):
        raise HTTPException(401, "Unknown student")
    return x_student_id


def owned(table, item_id, sid):
    item = db.row(f"SELECT * FROM {table} WHERE id=%s AND student_id=%s", (item_id, sid))
    if not item:
        raise HTTPException(404, f"{table[:-1].capitalize()} not found")
    return item


# ================================================================= status / students

@app.get("/api/status")
def status():
    return {"app": APP_NAME, "version": APP_VERSION, "llm": LLM_ENABLED}


class StudentIn(BaseModel):
    name: str
    email: Optional[str] = None
    exam_name: Optional[str] = "Final exam"
    exam_date: Optional[date] = None
    daily_hours: float = 3
    study_start: time = time(17, 0)
    sleep_time: time = time(23, 0)


@app.get("/api/students")
def list_students():
    return db.rows("SELECT id, name, email, exam_date FROM students ORDER BY id")


@app.post("/api/students")
def create_student(body: StudentIn):
    return db.row(
        """INSERT INTO students (name, email, exam_name, exam_date, daily_hours, study_start, sleep_time)
           VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
        (body.name.strip() or "Student", body.email, body.exam_name, body.exam_date, body.daily_hours,
         body.study_start, body.sleep_time),
    )


@app.get("/api/me")
def me(sid: int = Depends(student_id)):
    return db.row("SELECT * FROM students WHERE id=%s", (sid,))


@app.put("/api/me")
def update_me(body: StudentIn, sid: int = Depends(student_id)):
    if not 0.5 <= body.daily_hours <= 14:
        raise HTTPException(400, "Daily hours must be between 0.5 and 14")
    return db.row(
        """UPDATE students SET name=%s, email=%s, exam_name=%s, exam_date=%s, daily_hours=%s,
           study_start=%s, sleep_time=%s WHERE id=%s RETURNING *""",
        (body.name, body.email, body.exam_name, body.exam_date, body.daily_hours, body.study_start,
         body.sleep_time, sid),
    )


# ================================================================= subjects / topics

class SubjectIn(BaseModel):
    name: str
    color: str = "#3D6BF5"


@app.get("/api/subjects")
def list_subjects(sid: int = Depends(student_id)):
    return db.rows("SELECT * FROM subjects WHERE student_id=%s ORDER BY name", (sid,))


@app.post("/api/subjects")
def create_subject(body: SubjectIn, sid: int = Depends(student_id)):
    return db.row(
        """INSERT INTO subjects (student_id, name, color) VALUES (%s,%s,%s)
           ON CONFLICT (student_id, name) DO UPDATE SET color=EXCLUDED.color RETURNING *""",
        (sid, body.name.strip(), body.color),
    )


class TopicIn(BaseModel):
    title: str
    description: str = ""
    subject_id: Optional[int] = None
    weightage: float = 3
    difficulty: float = 2
    est_minutes: int = 45
    mastery: Optional[float] = None


@app.get("/api/topics")
def list_topics(sid: int = Depends(student_id)):
    return db.rows(
        """SELECT t.*, s.name AS subject, s.color AS subject_color FROM topics t
           LEFT JOIN subjects s ON s.id=t.subject_id WHERE t.student_id=%s
           ORDER BY t.weightage DESC, t.title""", (sid,))


@app.post("/api/topics")
def create_topic(body: TopicIn, sid: int = Depends(student_id)):
    try:
        t = db.row(
            """INSERT INTO topics (student_id, subject_id, title, description, weightage, difficulty, est_minutes, mastery)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
            (sid, body.subject_id, body.title.strip(), body.description, body.weightage, body.difficulty,
             body.est_minutes, body.mastery or 0),
        )
    except Exception as exc:
        if "unique" in str(exc).lower():
            raise HTTPException(409, "A topic with this title already exists")
        raise
    db.run("INSERT INTO mastery_history (topic_id, mastery, source) VALUES (%s,%s,'initial')", (t["id"], t["mastery"]))
    return t


@app.put("/api/topics/{tid}")
def update_topic(tid: int, body: TopicIn, sid: int = Depends(student_id)):
    old = owned("topics", tid, sid)
    t = db.row(
        """UPDATE topics SET title=%s, description=%s, subject_id=%s, weightage=%s, difficulty=%s, est_minutes=%s
           WHERE id=%s RETURNING *""",
        (body.title, body.description, body.subject_id, body.weightage, body.difficulty, body.est_minutes, tid),
    )
    if body.mastery is not None and abs(body.mastery - old["mastery"]) > 0.05:
        progress.set_mastery(tid, body.mastery, "self-rated")
    return t


@app.delete("/api/topics/{tid}")
def delete_topic(tid: int, sid: int = Depends(student_id)):
    owned("topics", tid, sid)
    db.run("DELETE FROM topics WHERE id=%s", (tid,))
    return {"ok": True}


@app.post("/api/topics/{tid}/quiz")
def topic_quiz(tid: int, sid: int = Depends(student_id)):
    return {"topic": (t := owned("topics", tid, sid)), "questions": ai.build_quiz(sid, t)}


class QuizResult(BaseModel):
    score: int
    total: int


@app.post("/api/topics/{tid}/quiz/submit")
def submit_quiz(tid: int, body: QuizResult, sid: int = Depends(student_id)):
    if body.total <= 0 or not 0 <= body.score <= body.total:
        raise HTTPException(400, "Invalid score")
    return {"mastery": progress.after_quiz(sid, tid, body.score, body.total)}


# ================================================================= library (RAG corpus)

@app.get("/api/documents")
def list_documents(sid: int = Depends(student_id)):
    return db.rows(
        """SELECT d.id, d.title, d.filename, d.kind, d.size_bytes, d.created_at, d.subject_id,
                  (SELECT count(*) FROM chunks c WHERE c.document_id=d.id) AS chunks,
                  (SELECT count(*) FROM mindmaps m WHERE m.document_id=d.id) AS mindmaps
           FROM documents d WHERE d.student_id=%s ORDER BY d.created_at DESC""", (sid,))


@app.post("/api/documents")
async def upload_document(
    file: Optional[UploadFile] = File(default=None),
    text: Optional[str] = Form(default=None),
    title: Optional[str] = Form(default=None),
    subject_id: Optional[int] = Form(default=None),
    sid: int = Depends(student_id),
):
    if file is not None and file.filename:
        data = await file.read()
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "File too large (max 15 MB)")
        name = file.filename
        if not re.search(r"\.(pdf|txt|md|markdown)$", name, re.I):
            raise HTTPException(415, "Upload a PDF, .txt or .md file")
        try:
            content = rag.extract_text(name, data)
        except Exception:
            raise HTTPException(422, "Couldn't read that file")
        kind = "pdf" if name.lower().endswith(".pdf") else "text"
    elif text and text.strip():
        name, content, kind = None, text, "pasted"
    else:
        raise HTTPException(400, "Provide a file or some text")
    if len(content.strip()) < 50:
        raise HTTPException(422, "Not enough readable text (scanned PDFs need OCR first)")
    doc_title = (title or (Path(name).stem if name else content.strip().split("\n")[0][:60])).strip("# ").strip()
    doc_id = rag.ingest(sid, doc_title or "Untitled notes", name, kind, content, subject_id)
    return db.row("SELECT id, title, kind, created_at, (SELECT count(*) FROM chunks WHERE document_id=%s) AS chunks "
                  "FROM documents WHERE id=%s", (doc_id, doc_id))


@app.get("/api/documents/{did}")
def get_document(did: int, sid: int = Depends(student_id)):
    return owned("documents", did, sid)


@app.delete("/api/documents/{did}")
def delete_document(did: int, sid: int = Depends(student_id)):
    owned("documents", did, sid)
    db.run("DELETE FROM documents WHERE id=%s", (did,))
    return {"ok": True}


# ================================================================= mind maps

class MindmapIn(BaseModel):
    document_id: int
    focus: str = ""
    extract_topics: bool = True


@app.get("/api/mindmaps")
def list_mindmaps(sid: int = Depends(student_id)):
    return db.rows("""SELECT m.id, m.title, m.document_id, m.created_at, d.title AS document
                      FROM mindmaps m LEFT JOIN documents d ON d.id=m.document_id
                      WHERE m.student_id=%s ORDER BY m.created_at DESC""", (sid,))


@app.post("/api/mindmaps")
def create_mindmap(body: MindmapIn, sid: int = Depends(student_id)):
    doc = owned("documents", body.document_id, sid)
    data = ai.build_mindmap(sid, body.document_id, body.focus.strip())
    topics = data.pop("topics", []) if data else []
    saved = ai.save_topics(sid, topics, doc["subject_id"]) if body.extract_topics else []
    for t in saved:
        if not db.row("SELECT 1 FROM mastery_history WHERE topic_id=%s", (t["id"],)):
            db.run("INSERT INTO mastery_history (topic_id, mastery, source) VALUES (%s,0,'initial')", (t["id"],))
    title = (body.focus.strip().capitalize() + " — " if body.focus.strip() else "") + data["title"]
    m = db.row("INSERT INTO mindmaps (student_id, document_id, title, data) VALUES (%s,%s,%s,%s) RETURNING *",
               (sid, body.document_id, title[:120], db.Json(data)))
    m["topics_added"] = saved
    return m


@app.get("/api/mindmaps/{mid}")
def get_mindmap(mid: int, sid: int = Depends(student_id)):
    return owned("mindmaps", mid, sid)


@app.delete("/api/mindmaps/{mid}")
def delete_mindmap(mid: int, sid: int = Depends(student_id)):
    owned("mindmaps", mid, sid)
    db.run("DELETE FROM mindmaps WHERE id=%s", (mid,))
    return {"ok": True}


@app.post("/api/mindmaps/{mid}/to-note")
def mindmap_to_note(mid: int, sid: int = Depends(student_id)):
    m = owned("mindmaps", mid, sid)

    def lines(nodes, depth=0):
        out = []
        for n in nodes:
            if depth == 0:
                out.append(f"\n## {n['title']}")
                if n.get("note"):
                    out.append(f"> {n['note']}")
            else:
                note = f" — {n['note']}" if n.get("note") else ""
                out.append(f"{'  ' * (depth - 1)}- **{n['title']}**{note}")
            out += lines(n.get("children") or [], depth + 1)
        return out

    content = "\n".join(lines(m["data"].get("nodes", []))).strip()
    return db.row("""INSERT INTO notes (student_id, title, icon, content, tags) VALUES (%s,%s,'🧠',%s,%s)
                     RETURNING *""", (sid, m["title"][:120], content, ["mindmap"]))


# ================================================================= notes (Notion-style)

class NoteIn(BaseModel):
    title: Optional[str] = None
    icon: Optional[str] = None
    content: Optional[str] = None
    tags: Optional[list[str]] = None
    parent_id: Optional[int] = None
    subject_id: Optional[int] = None
    pinned: Optional[bool] = None


@app.get("/api/notes")
def list_notes(sid: int = Depends(student_id)):
    return db.rows("""SELECT id, parent_id, subject_id, title, icon, tags, pinned, position, created_at, updated_at,
                             substr(content, 1, 160) AS preview
                      FROM notes WHERE student_id=%s ORDER BY position, created_at""", (sid,))


@app.get("/api/notes/{nid}")
def get_note(nid: int, sid: int = Depends(student_id)):
    return owned("notes", nid, sid)


@app.post("/api/notes")
def create_note(body: NoteIn, sid: int = Depends(student_id)):
    if body.parent_id:
        owned("notes", body.parent_id, sid)
    pos = db.row("SELECT coalesce(max(position),0)+1 AS p FROM notes WHERE student_id=%s", (sid,))["p"]
    return db.row(
        """INSERT INTO notes (student_id, parent_id, subject_id, title, icon, content, tags, position)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
        (sid, body.parent_id, body.subject_id, body.title or "Untitled", body.icon or "", body.content or "",
         body.tags or [], pos),
    )


@app.patch("/api/notes/{nid}")
def update_note(nid: int, body: NoteIn, sid: int = Depends(student_id)):
    owned("notes", nid, sid)
    fields = body.model_dump(exclude_unset=True)
    if "parent_id" in fields and fields["parent_id"]:
        # refuse to nest a page inside itself or one of its descendants
        p = fields["parent_id"]
        while p:
            if p == nid:
                raise HTTPException(400, "Can't move a page inside itself")
            p = owned("notes", p, sid)["parent_id"]
    if not fields:
        return owned("notes", nid, sid)
    sets = ", ".join(f"{k}=%s" for k in fields)
    return db.row(f"UPDATE notes SET {sets}, updated_at=datetime('now','localtime') WHERE id=%s RETURNING *", (*fields.values(), nid))


class MoveIn(BaseModel):
    parent_id: Optional[int] = None
    ordered_ids: list[int]


@app.post("/api/notes/{nid}/move")
def move_note(nid: int, body: MoveIn, sid: int = Depends(student_id)):
    update_note(nid, NoteIn(parent_id=body.parent_id), sid)
    if body.parent_id is None:
        db.run("UPDATE notes SET parent_id=NULL WHERE id=%s", (nid,))
    with db.cursor() as cur:
        for i, oid in enumerate(body.ordered_ids):
            cur.execute("UPDATE notes SET position=%s WHERE id=%s AND student_id=%s", (i, oid, sid))
    return {"ok": True}


@app.delete("/api/notes/{nid}")
def delete_note(nid: int, sid: int = Depends(student_id)):
    owned("notes", nid, sid)
    db.run("DELETE FROM notes WHERE id=%s", (nid,))
    return {"ok": True}


# ================================================================= chats

class ChatMsg(BaseModel):
    content: str


@app.get("/api/chats")
def list_chats(sid: int = Depends(student_id)):
    return db.rows("SELECT * FROM chats WHERE student_id=%s ORDER BY updated_at DESC", (sid,))


@app.post("/api/chats")
def create_chat(sid: int = Depends(student_id)):
    return db.row("INSERT INTO chats (student_id) VALUES (%s) RETURNING *", (sid,))


@app.get("/api/chats/{cid}")
def get_chat(cid: int, sid: int = Depends(student_id)):
    chat = owned("chats", cid, sid)
    chat["messages"] = db.rows("SELECT * FROM messages WHERE chat_id=%s ORDER BY id", (cid,))
    return chat


class RenameIn(BaseModel):
    title: str


@app.patch("/api/chats/{cid}")
def rename_chat(cid: int, body: RenameIn, sid: int = Depends(student_id)):
    owned("chats", cid, sid)
    return db.row("UPDATE chats SET title=%s WHERE id=%s RETURNING *", (body.title[:80], cid))


@app.delete("/api/chats/{cid}")
def delete_chat(cid: int, sid: int = Depends(student_id)):
    owned("chats", cid, sid)
    db.run("DELETE FROM chats WHERE id=%s", (cid,))
    return {"ok": True}


HELP = """**Commands**
- `/mindmap [focus]` — mind map from your latest notes (optionally on one concept)
- `/roadmap` — full timeline until your exam
- `/crisis [hours]` — exam is close? a high-yield plan for the time you have
- `/quiz [topic]` — quick quiz that updates your mastery
- `/progress` — your readiness snapshot

Or just ask anything — I answer from your uploaded notes first."""


def _slash(sid, text):
    cmd, _, arg = text[1:].partition(" ")
    cmd, arg = cmd.lower(), arg.strip()
    if cmd == "help":
        return HELP, {}
    if cmd == "mindmap":
        doc = db.row("SELECT id FROM documents WHERE student_id=%s ORDER BY created_at DESC LIMIT 1", (sid,))
        if not doc:
            return "Upload notes in **Library** first — then I can map them.", {"action": "library"}
        m = create_mindmap(MindmapIn(document_id=doc["id"], focus=arg), sid)
        added = len(m["topics_added"])
        return (f"Mind map ready: **{m['title']}**." + (f" I also added {added} topics to your syllabus." if added else ""),
                {"action": "mindmap", "id": m["id"]})
    if cmd == "roadmap":
        res = make_standard_plan(sid)
        return f"Roadmap built. {res['summary']['message']}", {"action": "planner", "roadmap": res["roadmap_id"]}
    if cmd == "crisis":
        hours = float(re.findall(r"[\d.]+", arg)[0]) if re.findall(r"[\d.]+", arg) else 4
        res = make_crisis_plan(CrisisIn(hours=hours), sid)
        t = res["summary"]["triage"]
        must = ", ".join(x["title"] for x in t["must"][:4]) or "—"
        return (f"Crisis plan is on your calendar. {res['summary']['message']}\n\n"
                f"**Must do:** {must}\n\n**Skim only:** {len(t['skim'])} · **Skip:** {len(t['skip'])}\n\n"
                "You've got this — one sprint at a time.", {"action": "planner", "roadmap": res["roadmap_id"]})
    if cmd == "quiz":
        t = db.row("""SELECT * FROM topics WHERE student_id=%s AND (%s='' OR title LIKE %s)
                      ORDER BY mastery ASC, weightage DESC LIMIT 1""", (sid, arg, f"%{arg}%"))
        if not t:
            return "No matching topic yet. Generate a mind map or add topics in **Progress → Syllabus**.", {}
        return f"Quiz on **{t['title']}** (current mastery {round(t['mastery'])}%).", {"action": "quiz", "id": t["id"]}
    if cmd == "progress":
        r = progress.report(sid)["kpis"]
        return (f"**Readiness:** {r['readiness']}% · **This week:** {r['week_minutes'] // 60}h {r['week_minutes'] % 60}m · "
                f"**Streak:** {r['streak']} days" + (f" · **Exam in:** {r['days_left']} days" if r['days_left'] is not None else ""),
                {"action": "progress"})
    return f"Unknown command `/{cmd}`.\n\n{HELP}", {}


@app.post("/api/chats/{cid}/messages")
def send_message(cid: int, body: ChatMsg, sid: int = Depends(student_id)):
    chat = owned("chats", cid, sid)
    text = body.content.strip()
    if not text:
        raise HTTPException(400, "Empty message")
    history = db.rows("SELECT role, content FROM messages WHERE chat_id=%s ORDER BY id", (cid,))
    user_msg = db.row("INSERT INTO messages (chat_id, role, content) VALUES (%s,'user',%s) RETURNING *", (cid, text))
    try:
        if text.startswith("/"):
            reply, meta = _slash(sid, text)
        else:
            reply, sources = ai.answer(sid, text, history)
            meta = {"sources": sources}
    except HTTPException as exc:
        reply, meta = f"⚠️ {exc.detail}", {}
    except ValueError as exc:
        reply, meta = f"⚠️ {exc}", {}
    bot = db.row("INSERT INTO messages (chat_id, role, content, meta) VALUES (%s,'assistant',%s,%s) RETURNING *",
                 (cid, reply, db.Json(meta)))
    title = chat["title"]
    if title == "New chat":
        names = {"progress": "Progress snapshot", "roadmap": "Roadmap to exam", "mindmap": "Mind map",
                 "crisis": "Crisis plan", "quiz": "Quiz", "help": "Commands"}
        if text.startswith("/"):
            cmd, _, arg = text[1:].partition(" ")
            title = f"{names.get(cmd.lower(), cmd)}{': ' + arg.strip() if arg.strip() else ''}"[:48]
        else:
            title = text[:48]
    db.run("UPDATE chats SET updated_at=datetime('now','localtime'), title=%s WHERE id=%s", (title, cid))
    return {"user": user_msg, "assistant": bot, "title": title}


# ================================================================= planner / calendar

def _student_and_topics(sid):
    s = db.row("SELECT * FROM students WHERE id=%s", (sid,))
    topics = db.rows("SELECT * FROM topics WHERE student_id=%s", (sid,))
    return s, topics


def _save_roadmap(sid, mode, exam_date, summary, events):
    now = datetime.now()
    with db.cursor() as cur:
        # replace the previous plan's future, unfinished blocks; keep history
        cur.execute("""DELETE FROM events WHERE student_id=%s AND roadmap_id IS NOT NULL
                       AND status='planned' AND start_at >= %s""", (sid, now))
        cur.execute("UPDATE roadmaps SET active=0 WHERE student_id=%s", (sid,))
        cur.execute("INSERT INTO roadmaps (student_id, mode, exam_date, summary) VALUES (%s,%s,%s,%s) RETURNING id",
                    (sid, mode, exam_date, db.Json(summary)))
        rid = cur.fetchone()["id"]
        for e in events:
            cur.execute("""INSERT INTO events (student_id, roadmap_id, topic_id, title, kind, phase, start_at, end_at,
                           remind_before) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (sid, rid, e["topic_id"], e["title"], e["kind"], e["phase"], e["start_at"], e["end_at"],
                         0 if e["kind"] == "break" else 10))
    return rid


@app.get("/api/plan/assess")
def plan_assess(sid: int = Depends(student_id)):
    s, topics = _student_and_topics(sid)
    result = planner.assess(s, topics)
    result["roadmap"] = db.row("SELECT * FROM roadmaps WHERE student_id=%s AND active=1 ORDER BY id DESC LIMIT 1", (sid,))
    result["topics"] = len(topics)
    return result


@app.post("/api/plan/standard")
def make_standard_plan(sid: int = Depends(student_id)):
    s, topics = _student_and_topics(sid)
    if not s["exam_date"]:
        raise HTTPException(400, "Set your exam date in Settings first")
    if not topics:
        raise HTTPException(400, "No topics yet — generate a mind map from your notes or add topics")
    try:
        events, summary = planner.standard_plan(s, topics)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    rid = _save_roadmap(sid, "standard", s["exam_date"], summary, events)
    return {"roadmap_id": rid, "summary": summary, "events": len(events)}


class CrisisIn(BaseModel):
    hours: float = 4
    exam_at: Optional[datetime] = None


@app.post("/api/plan/crisis")
def make_crisis_plan(body: CrisisIn, sid: int = Depends(student_id)):
    s, topics = _student_and_topics(sid)
    if not topics:
        raise HTTPException(400, "No topics yet — generate a mind map from your notes or add topics")
    exam_at = body.exam_at
    if exam_at is None:
        day = s["exam_date"] if s["exam_date"] and s["exam_date"] > date.today() else date.today() + timedelta(days=1)
        exam_at = datetime.combine(day, time(9, 0))
    exam_at = exam_at.replace(tzinfo=None)
    if exam_at <= datetime.now():
        raise HTTPException(400, "Exam time must be in the future")
    events, summary = planner.crisis_plan(s, topics, max(0.5, min(14, body.hours)), exam_at)
    summary["cheat_sheet"] = ai.cheat_sheet(sid, [t for t in topics if t["id"] in
                                                 {x["id"] for x in summary["triage"]["must"] + summary["triage"]["skim"]}][:8])
    rid = _save_roadmap(sid, "crisis", exam_at.date(), summary, events)
    return {"roadmap_id": rid, "summary": summary, "events": len(events)}


@app.get("/api/plan/roadmap")
def active_roadmap(sid: int = Depends(student_id)):
    r = db.row("SELECT * FROM roadmaps WHERE student_id=%s AND active=1 ORDER BY id DESC LIMIT 1", (sid,))
    if not r:
        return None
    r["events"] = db.rows("""SELECT e.*, t.mastery FROM events e LEFT JOIN topics t ON t.id=e.topic_id
                             WHERE e.roadmap_id=%s AND e.kind<>'break' ORDER BY e.start_at""", (r["id"],))
    return r


class EventIn(BaseModel):
    title: str
    kind: str = "study"
    start_at: datetime
    end_at: datetime
    topic_id: Optional[int] = None
    remind_before: int = 10
    notes: str = ""


@app.get("/api/events")
def list_events(start: datetime, end: datetime, sid: int = Depends(student_id)):
    return db.rows("""SELECT e.*, t.title AS topic FROM events e LEFT JOIN topics t ON t.id=e.topic_id
                      WHERE e.student_id=%s AND e.start_at < %s AND e.end_at > %s ORDER BY e.start_at""",
                   (sid, end.replace(tzinfo=None), start.replace(tzinfo=None)))


@app.post("/api/events")
def create_event(body: EventIn, sid: int = Depends(student_id)):
    if body.end_at <= body.start_at:
        raise HTTPException(400, "End must be after start")
    return db.row("""INSERT INTO events (student_id, topic_id, title, kind, start_at, end_at, remind_before, notes)
                     VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                  (sid, body.topic_id, body.title, body.kind, body.start_at.replace(tzinfo=None),
                   body.end_at.replace(tzinfo=None), body.remind_before, body.notes))


@app.put("/api/events/{eid}")
def update_event(eid: int, body: EventIn, sid: int = Depends(student_id)):
    owned("events", eid, sid)
    if body.end_at <= body.start_at:
        raise HTTPException(400, "End must be after start")
    return db.row("""UPDATE events SET title=%s, kind=%s, start_at=%s, end_at=%s, topic_id=%s, remind_before=%s, notes=%s
                     WHERE id=%s RETURNING *""",
                  (body.title, body.kind, body.start_at.replace(tzinfo=None), body.end_at.replace(tzinfo=None),
                   body.topic_id, body.remind_before, body.notes, eid))


@app.post("/api/events/{eid}/complete")
def complete_event(eid: int, sid: int = Depends(student_id)):
    e = owned("events", eid, sid)
    if e["status"] == "done":
        return {"mastery": None, "already": True}
    return {"mastery": progress.after_session(sid, e)}


@app.post("/api/events/{eid}/skip")
def skip_event(eid: int, sid: int = Depends(student_id)):
    owned("events", eid, sid)
    db.run("UPDATE events SET status='skipped' WHERE id=%s", (eid,))
    return {"ok": True}


@app.delete("/api/events/{eid}")
def delete_event(eid: int, sid: int = Depends(student_id)):
    owned("events", eid, sid)
    db.run("DELETE FROM events WHERE id=%s", (eid,))
    return {"ok": True}


@app.get("/api/reminders")
def reminders(sid: int = Depends(student_id)):
    """Events whose reminder window is open now (the browser polls this every minute)."""
    now = datetime.now()
    return db.rows("""SELECT * FROM events WHERE student_id=%s AND status='planned'
                      AND datetime(start_at, '-' || remind_before || ' minutes') <= %s
                      AND start_at > datetime(%s, '-2 minutes')
                      ORDER BY start_at""", (sid, now, now))


# ================================================================= report / search

@app.get("/api/report")
def get_report(sid: int = Depends(student_id)):
    return progress.report(sid)


@app.get("/api/search")
def search(q: str = "", sid: int = Depends(student_id)):
    like = f"%{q.strip()}%"
    res = {
        "chats": db.rows("""SELECT DISTINCT c.id, c.title, c.updated_at FROM chats c
                            LEFT JOIN messages m ON m.chat_id=c.id
                            WHERE c.student_id=%s AND (c.title LIKE %s OR m.content LIKE %s)
                            ORDER BY c.updated_at DESC LIMIT 20""", (sid, like, like)),
        "notes": db.rows("""SELECT id, title, icon, updated_at, substr(content,1,120) AS preview FROM notes
                            WHERE student_id=%s AND (title LIKE %s OR content LIKE %s OR EXISTS (SELECT 1 FROM json_each(tags) WHERE value = %s))
                            ORDER BY updated_at DESC LIMIT 20""", (sid, like, like, q.strip())),
        "files": db.rows("""SELECT id, title, kind, size_bytes, created_at FROM documents
                            WHERE student_id=%s AND (title LIKE %s OR content LIKE %s)
                            ORDER BY created_at DESC LIMIT 20""", (sid, like, like)),
        "mindmaps": db.rows("""SELECT id, title, created_at FROM mindmaps WHERE student_id=%s AND title LIKE %s
                               ORDER BY created_at DESC LIMIT 20""", (sid, like)),
        "topics": db.rows("""SELECT id, title, mastery, weightage FROM topics WHERE student_id=%s AND title LIKE %s
                             ORDER BY weightage DESC LIMIT 20""", (sid, like)),
    }
    if q.strip():
        res["passages"] = [{"document_id": c["document_id"], "document": c["document"], "heading": c["heading"],
                            "snippet": c["content"][:200]} for c in rag.retrieve(sid, q, k=5)]
    return res


# ================================================================= demo data

@app.post("/api/demo")
def seed_demo(sid: int = Depends(student_id)):
    """Load sample OS notes, build a mind map + topics, and some history so every screen has data."""
    if db.row("SELECT 1 FROM documents WHERE student_id=%s AND title='Operating Systems — Unit Notes'", (sid,)):
        raise HTTPException(409, "Demo data is already loaded")
    subj = create_subject(SubjectIn(name="Operating Systems", color="#3D6BF5"), sid)
    text = (Path(__file__).parent / "backend" / "sample_notes.md").read_text()
    doc_id = rag.ingest(sid, "Operating Systems — Unit Notes", "os-unit-notes.md", "text", text, subj["id"])
    m = create_mindmap(MindmapIn(document_id=doc_id), sid)

    # two weeks of believable history: sessions, quizzes and rising mastery
    import random
    rnd = random.Random(sid)
    topics = db.rows("SELECT * FROM topics WHERE student_id=%s ORDER BY weightage DESC", (sid,))
    now = datetime.now()
    with db.cursor() as cur:
        for t in topics:
            target = rnd.choice([18, 32, 45, 58, 72, 84])
            steps = rnd.randint(2, 4)
            cur.execute("DELETE FROM mastery_history WHERE topic_id=%s", (t["id"],))
            cur.execute("UPDATE topics SET last_studied=%s WHERE id=%s", (now - timedelta(days=rnd.randint(0, 9)), t["id"]))
            for k in range(steps):
                when = now - timedelta(days=13 - k * (12 // steps), hours=rnd.randint(0, 5))
                val = round(target * (k + 1) / steps, 1)
                cur.execute("INSERT INTO mastery_history (topic_id, mastery, source, recorded_at) VALUES (%s,%s,'demo',%s)",
                            (t["id"], val, when))
                cur.execute("""INSERT INTO study_sessions (student_id, topic_id, minutes, kind, created_at)
                               VALUES (%s,%s,%s,'study',%s)""", (sid, t["id"], rnd.choice([25, 40, 50]),
                                                                  when.replace(hour=rnd.choice([17, 18, 20, 21]))))
                if k == steps - 1:
                    cur.execute("""INSERT INTO quiz_attempts (student_id, topic_id, score, total, created_at)
                                   VALUES (%s,%s,%s,5,%s)""", (sid, t["id"], max(0, min(5, round(target / 20))), when))
            cur.execute("UPDATE topics SET mastery=%s, times_studied=%s WHERE id=%s", (target, steps, t["id"]))
        cur.execute("""INSERT INTO notes (student_id, subject_id, title, icon, content, tags, pinned, position) VALUES
            (%s,%s,'Exam strategy','🎯',%s,'["strategy"]',1,0)""",
                    (sid, subj["id"],
                     "## Before the exam\n- [x] Collect previous year papers\n- [ ] Solve 2 Banker's algorithm numericals\n"
                     "- [ ] Revise page replacement with a reference string\n\n## In the hall\n1. Read all questions first\n"
                     "2. Start with numericals you're sure of\n3. Leave 10 minutes to review\n\n> Sleep beats cramming."))
    mm_note = mindmap_to_note(m["id"], sid)
    db.run("UPDATE notes SET subject_id=%s, icon='📘' WHERE id=%s", (subj["id"], mm_note["id"]))
    return {"document_id": doc_id, "mindmap_id": m["id"], "topics": len(topics)}


# ================================================================= frontend

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")
