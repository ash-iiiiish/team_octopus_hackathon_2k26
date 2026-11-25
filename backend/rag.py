"""Ingestion and retrieval over the student's own notes.

Chunks live in SQLite with an FTS5 index (Porter stemming, BM25 ranking with
headings weighted higher). No vector DB or embedding model is needed to run the project.
"""
import io
import re
from collections import Counter

from backend import db

STOPWORDS = set("""
a about above after again against all also am an and any are as at be because been before being below
between both but by can could did do does doing down during each few for from further had has have
having he her here hers herself him himself his how i if in into is it its itself just me more most my
myself no nor not now of off on once only or other our ours ourselves out over own same she should so
some such than that the their theirs them themselves then there these they this those through to too
under until up very was we were what when where which while who whom why will with would you your
yours yourself yourselves use used using one two may many must way well thus therefore however etc eg
ie called known example examples also following given within without per every
""".split())

WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9\-]{1,}")
SENT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9(])")


# ---------------------------------------------------------------- extraction

def extract_text(filename: str, data: bytes) -> str:
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        return "\n\n".join((page.extract_text() or "") for page in reader.pages)
    for enc in ("utf-8", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return ""


def clean(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\t", " ")
    text = re.sub(r"[  ]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def is_heading(line: str) -> bool:
    s = line.strip()
    if not s or len(s) > 80:
        return False
    if s.startswith("#"):
        return True
    if s.endswith(":") and len(s.split()) <= 8:
        return True
    if re.match(r"^(\d+(\.\d+)*[.)]?|[IVX]+\.|Unit|Chapter|Module)\s+\S", s) and not s.endswith("."):
        return len(s.split()) <= 10
    words = s.split()
    if len(words) <= 7 and not s.endswith((".", ",", ";")) and (s.isupper() or s.istitle()):
        return True
    return False


def heading_text(line: str) -> str:
    s = line.strip().lstrip("#").strip().rstrip(":").strip()
    s = re.sub(r"^(\d+(\.\d+)*[.)]?|[IVX]+\.)\s+", "", s)
    return s[:80]


def chunk_text(text: str, target=900):
    """Split into ~target-char chunks that remember the nearest heading."""
    chunks, buf, heading = [], [], ""

    def flush():
        body = " ".join(buf).strip()
        if len(body) > 40:
            chunks.append((heading, body))
        buf.clear()

    for para in re.split(r"\n\s*\n|\n(?=\s*#)", text):
        lines = [l for l in para.split("\n") if l.strip()]
        if not lines:
            continue
        if is_heading(lines[0]):
            flush()
            heading = heading_text(lines[0])
            lines = lines[1:]
        for line in lines:
            if is_heading(line) and len(lines) > 1:
                flush()
                heading = heading_text(line)
                continue
            buf.append(line.strip())
            if sum(len(b) for b in buf) >= target:
                flush()
    flush()
    return chunks


# ---------------------------------------------------------------- storage

def ingest(student_id, title, filename, kind, text, subject_id=None):
    text = clean(text)
    with db.cursor() as cur:
        cur.execute(
            """INSERT INTO documents (student_id, subject_id, title, filename, kind, size_bytes, content)
               VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (student_id, subject_id, title, filename, kind, len(text.encode()), text),
        )
        doc_id = cur.fetchone()["id"]
        for i, (heading, body) in enumerate(chunk_text(text)):
            cur.execute(
                "INSERT INTO chunks (document_id, student_id, idx, heading, content) VALUES (%s,%s,%s,%s,%s)",
                (doc_id, student_id, i, heading, body),
            )
    return doc_id


def keywords(text: str, n=12):
    words = [w.lower() for w in WORD_RE.findall(text)]
    counts = Counter(w for w in words if w not in STOPWORDS and len(w) > 2)
    return [w for w, _ in counts.most_common(n)]


def _terms(query: str):
    terms = [w.lower() for w in WORD_RE.findall(query) if w.lower() not in STOPWORDS]
    terms = [re.sub(r"[^a-z0-9]", "", t) for t in terms]
    return [t for t in dict.fromkeys(terms) if len(t) > 1][:16]


def _fts_query(query: str):
    """OR of quoted terms, so any matching word counts and BM25 ranks the best passages."""
    return " OR ".join(f'"{t}"' for t in _terms(query))


def retrieve(student_id, query, k=6, document_id=None):
    """Top-k chunks for a query (SQLite FTS5, BM25 with headings weighted 2x).
    Falls back to the document's first chunks when nothing matches."""
    fts = _fts_query(query)
    doc_filter = "AND c.document_id = %s" if document_id else ""
    params_doc = [document_id] if document_id else []
    hits = []
    if fts:
        hits = db.rows(
            f"""SELECT c.id, c.document_id, c.heading, c.content, d.title AS document,
                       -bm25(chunks_fts, 2.0, 1.0) AS score
                FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
                JOIN documents d ON d.id = c.document_id
                WHERE chunks_fts MATCH %s AND c.student_id = %s {doc_filter}
                ORDER BY score DESC LIMIT %s""",
            [fts, student_id, *params_doc, k],
        )
    if not hits and document_id:
        hits = db.rows(
            """SELECT c.id, c.document_id, c.heading, c.content, d.title AS document, 0 AS score
               FROM chunks c JOIN documents d ON d.id = c.document_id
               WHERE c.document_id = %s ORDER BY c.idx LIMIT %s""",
            (document_id, k),
        )
    return hits


def topic_chunks(student_id, title, description="", k=4):
    """Passages for a syllabus topic: its own section first (heading match), then search."""
    own = db.rows(
        """SELECT c.id, c.document_id, c.heading, c.content, d.title AS document, 1 AS score
           FROM chunks c JOIN documents d ON d.id = c.document_id
           WHERE c.student_id = %s AND c.heading <> '' AND (c.heading LIKE %s OR %s LIKE '%%' || c.heading || '%%')
           ORDER BY c.idx LIMIT %s""",
        (student_id, f"%{title}%", title, k),
    )
    if len(own) >= k:
        return own
    seen = {c["id"] for c in own}
    more = [c for c in retrieve(student_id, f"{title} {title} {description}", k=k + len(own)) if c["id"] not in seen]
    return own + more[: k - len(own)]


def document_sections(document_id):
    """Chunks grouped by heading, in reading order."""
    sections = {}
    for c in db.rows("SELECT heading, content FROM chunks WHERE document_id=%s ORDER BY idx", (document_id,)):
        key = c["heading"] or "Overview"
        sections.setdefault(key, []).append(c["content"])
    return sections


def sentences(text: str):
    return [s.strip() for s in SENT_RE.split(text) if 25 <= len(s.strip()) <= 320]


def best_sentences(text: str, query: str, n=3):
    q = set(_terms(query))
    scored = []
    for i, s in enumerate(sentences(text)):
        words = {w.lower() for w in WORD_RE.findall(s)}
        scored.append((len(words & q), -i, s))
    scored.sort(reverse=True)
    return [s for _, _, s in scored[:n]]
