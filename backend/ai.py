"""Generation on top of retrieval: mind maps, topics, chat answers, quizzes, cheat sheets.

Each function tries the LLM first and falls back to an extractive version built
from the retrieved notes, so the app is fully usable without an API key.
"""
import random
import re

from backend import db, llm, rag

TUTOR_SYSTEM = (
    "You are Prepwise, a calm, encouraging study coach for students. "
    "Answer from the student's notes when they are relevant and cite them as [1], [2]. "
    "If the notes don't cover something, say so briefly and answer from general knowledge. "
    "Prefer short sections, bullet points and one worked example. Never shame the student; "
    "if they sound stressed, give one concrete next step."
)


def _context_block(chunks):
    return "\n\n".join(
        f"[{i + 1}] ({c['document']} — {c['heading'] or 'section'})\n{c['content']}" for i, c in enumerate(chunks)
    )


def _sources(chunks):
    return [
        {"n": i + 1, "document": c["document"], "document_id": c["document_id"], "heading": c["heading"],
         "snippet": c["content"][:220]}
        for i, c in enumerate(chunks)
    ]


# ------------------------------------------------------------------ chat

def answer(student_id, question, history):
    chunks = rag.retrieve(student_id, question, k=5)
    messages = [{"role": "system", "content": TUTOR_SYSTEM}]
    for m in history[-8:]:
        messages.append({"role": m["role"], "content": m["content"]})
    ctx = _context_block(chunks) if chunks else "(no matching notes uploaded)"
    messages.append({"role": "user", "content": f"Notes:\n{ctx}\n\nQuestion: {question}"})
    text = llm.complete(messages, temperature=0.4)
    if text is None:
        text = _extractive_answer(question, chunks)
    text = re.sub(r"【\s*(\d+)\s*(?:†[^】]*)?】", r"[\1]", text)  # some models cite as 【1】
    return text, _sources(chunks)


def _extractive_answer(question, chunks):
    if not chunks:
        return (
            "I couldn't find this in your uploaded notes yet.\n\n"
            "**Next step:** upload the chapter in **Library**, then ask again. I'll answer from your notes "
            "and turn them into a mind map and roadmap.\n\n"
            "*Demo mode — add a Groq API key in .env for full AI answers.*"
        )
    lines = ["Here's what your notes say:\n"]
    for i, c in enumerate(chunks[:3]):
        title = c["heading"] or c["document"]
        lines.append(f"**{title}**")
        for s in rag.best_sentences(c["content"], question, n=2):
            lines.append(f"- {s} [{i + 1}]")
        lines.append("")
    lines.append("*Demo mode — answers are quoted from your notes. Add a Groq API key for full explanations.*")
    return "\n".join(lines)


# ------------------------------------------------------------------ mind maps + topics

MINDMAP_PROMPT = """Turn these study notes into a mind map and a topic list for exam prep.
Return JSON with exactly this shape:
{
 "title": "short title of the material",
 "nodes": [ {"title": "main concept (<=5 words)", "note": "one-line gist", "children": [
             {"title": "sub-concept", "note": "one line", "children": []} ]} ],
 "topics": [ {"title": "exam topic", "description": "one line", "weightage": 1-5,
              "difficulty": 1-3, "est_minutes": 20-90} ]
}
Rules: 4-7 main nodes, 2-5 children each, depth at most 3. weightage = how likely/heavily it is examined.
Topics should be the 4-10 units a student would revise separately.
"""


def build_mindmap(student_id, document_id, focus=""):
    doc = db.row("SELECT id, title, content FROM documents WHERE id=%s AND student_id=%s", (document_id, student_id))
    if not doc:
        return None
    if focus:
        material = _context_block(rag.retrieve(student_id, focus, k=8, document_id=document_id))
    else:
        material = doc["content"][:14000]
    data = llm.complete(
        [{"role": "system", "content": MINDMAP_PROMPT},
         {"role": "user", "content": f"Focus: {focus or 'whole document'}\n\nNotes:\n{material}"}],
        as_json=True, max_tokens=2500,
    )
    if not data or not data.get("nodes"):
        data = _extractive_mindmap(doc, focus)
    data.setdefault("title", doc["title"])
    return data


def _short(s, n=60):
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= n else s[: n - 1].rsplit(" ", 1)[0] + "…"


def _extractive_mindmap(doc, focus):
    sections = rag.document_sections(doc["id"])
    whole = doc["content"].lower()
    nodes, topics = [], []
    for heading, parts in list(sections.items())[:8]:
        body = " ".join(parts)
        sents = rag.best_sentences(body, focus or heading, n=4) or rag.sentences(body)[:4]
        children = []
        for s in sents:
            kw = rag.keywords(s, 3)
            label = " ".join(kw[:3]).title() if kw else _short(s, 30)
            children.append({"title": label, "note": _short(s, 140), "children": []})
        nodes.append({"title": _short(heading, 40), "note": _short(body, 120), "children": children})
        # importance = how often the heading's key terms recur across the whole document
        # (stems so "Deadlocks" also matches "deadlock"), plus explicit exam cues in the text
        terms = rag.keywords(heading, 3) or rag.keywords(body, 2)
        freq = sum(whole.count(t[:6]) for t in terms)
        low = body.lower()
        exam_cues = sum(low.count(c) for c in ("exam", "important", "common", "frequently", "numerical"))
        numeric_cues = sum(low.count(c) for c in ("algorithm", "equals", "matrix", "compute", "formula",
                                                   "calculate", "time", "ratio"))
        words = len(body.split())
        topics.append({
            "title": _short(heading, 60),
            "description": _short(body, 140),
            "weightage": max(1, min(5, round(1.5 + freq / 5 + exam_cues * 1.2))),
            "difficulty": max(1, min(3, 1 + (words > 160) + (numeric_cues >= 3))),
            "est_minutes": max(25, min(90, round(words / 4 / 5) * 5)),
        })
    if len(nodes) == 1 and len(nodes[0]["children"]) < 3:
        kws = rag.keywords(doc["content"], 10)
        nodes[0]["children"] += [{"title": k.title(), "note": "", "children": []} for k in kws[:6]]
    return {"title": doc["title"], "nodes": nodes, "topics": topics}


def _clamp(value, lo, hi, default):
    try:
        return float(max(lo, min(hi, float(value))))
    except (TypeError, ValueError):
        return float(default)


def save_topics(student_id, topics, subject_id=None):
    saved = []
    with db.cursor() as cur:
        for t in topics or []:
            title = _short(str(t.get("title", "")).strip(), 80)
            if not title:
                continue
            cur.execute(
                """INSERT INTO topics (student_id, subject_id, title, description, weightage, difficulty, est_minutes)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (student_id, title) DO UPDATE
                     SET description = EXCLUDED.description, weightage = EXCLUDED.weightage
                   RETURNING id, title""",
                (student_id, subject_id, title, str(t.get("description", ""))[:300],
                 _clamp(t.get("weightage"), 1, 5, 3), _clamp(t.get("difficulty"), 1, 3, 2),
                 int(_clamp(t.get("est_minutes"), 15, 120, 45))),
            )
            saved.append(dict(cur.fetchone()))
    return saved


# ------------------------------------------------------------------ quizzes

QUIZ_PROMPT = """Write {n} multiple-choice questions that test understanding (not trivia) of the topic,
using the notes. Return JSON: {{"questions": [{{"q": "...", "options": ["...","...","...","..."],
"answer": 0-3 index, "why": "one-line explanation"}}]}}"""


def build_quiz(student_id, topic, n=5):
    chunks = rag.topic_chunks(student_id, topic["title"], topic.get("description", ""), k=5)
    data = llm.complete(
        [{"role": "system", "content": QUIZ_PROMPT.format(n=n)},
         {"role": "user", "content": f"Topic: {topic['title']}\n\nNotes:\n{_context_block(chunks) or 'none'}"}],
        as_json=True,
    )
    qs = (data or {}).get("questions") or []
    valid = [q for q in qs if isinstance(q.get("options"), list) and len(q["options"]) == 4
             and isinstance(q.get("answer"), int) and 0 <= q["answer"] < 4]
    return valid[:n] if valid else _cloze_quiz(student_id, topic, chunks, n)


def _cloze_quiz(student_id, topic, chunks, n):
    text = " ".join(c["content"] for c in chunks)
    if not text:
        text = " ".join(c["content"] for c in db.rows(
            "SELECT content FROM chunks WHERE student_id=%s LIMIT 30", (student_id,)))
    pool = rag.keywords(text, 30)
    rnd = random.Random(f"{topic['id']}-{len(text)}")
    questions = []
    for s in rag.sentences(text):
        cands = [k for k in pool if re.search(rf"\b{re.escape(k)}\b", s, re.I)]
        if not cands or len(pool) < 4:
            continue
        key = cands[0]
        blanked = re.sub(rf"\b{re.escape(key)}\b", "_____", s, count=1, flags=re.I)
        options = [key] + rnd.sample([k for k in pool if k != key], 3)
        rnd.shuffle(options)
        questions.append({"q": f"Fill the blank: {blanked}", "options": options,
                          "answer": options.index(key), "why": s})
        pool.remove(key)
        if len(questions) == n:
            break
    if not questions:
        questions = [{
            "q": f"How confident are you explaining “{topic['title']}” without notes?",
            "options": ["I can teach it", "Mostly", "Partly", "Not yet"], "answer": 0,
            "why": "Upload notes for this topic to get real questions.",
        }]
    return questions


# ------------------------------------------------------------------ crisis cheat sheet

def cheat_sheet(student_id, topics):
    """Highest-yield points per topic, for last-minute revision."""
    out = []
    for t in topics:
        chunks = rag.topic_chunks(student_id, t["title"], t.get("description", ""), k=3)
        text = llm.complete(
            [{"role": "system", "content": "Give the 4 highest-yield exam points for this topic as terse bullets "
                                           "(definitions, formulas, one common trap). Max 70 words."},
             {"role": "user", "content": f"Topic: {t['title']}\nNotes:\n{_context_block(chunks) or 'none'}"}],
            max_tokens=250,
        )
        if text:
            points = []
            for line in text.splitlines():
                line = re.sub(r"^[-*•\d.)\s]+", "", line)
                line = re.sub(r"\*\*|__|`", "", line)                      # markdown emphasis
                line = re.sub(r"\(\s*[≈~]?\s*\d+\s*words?\s*\)", "", line)  # "(≈68 words)"
                line = re.sub(r"[   ]", " ", line).strip(" *")  # no-break spaces stop wrapping
                if line:
                    points.append(line)
        else:
            body = " ".join(c["content"] for c in chunks)
            points = [_short(s, 150) for s in rag.best_sentences(body, t["title"], n=4)]
        out.append({"topic_id": t["id"], "title": t["title"], "points": [p for p in points if p][:5]})
    return out
