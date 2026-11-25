# Prepwise

**ChatGPT-style knowledge space + Notion-style notes + Google-Calendar-style planning, built for students who are about to panic before an exam.**

Instead of asking a general chatbot to "explain everything" the night before, a student uploads their own notes once. Prepwise then:

1. **RAG → mind maps & roadmap.** Notes are chunked and indexed with SQLite FTS5 full-text search (BM25 ranking). Chat answers cite the student's own notes. Mind maps and exam topics are generated from the retrieved passages, and the topics feed a day-by-day roadmap up to the exam.
2. **Notes arrangement.** Notion-like pages: nesting, drag-and-drop ordering, emoji icons, tags, subjects, pinning and markdown with checklists.
3. **Per-student progress graph.** Weighted readiness over time, study minutes, streak, plan adherence, quiz accuracy, topic mastery (strong / okay / needs work / fading) and a forecast to exam day.
4. **Crisis mode.** If time is short (exam tomorrow, or more work needed than hours left), the roadmap is rebuilt around marks per minute. High-weight, low-mastery topics come first, in 25/5 sprints, with a must / should / skim / skip triage and a cheat sheet. It never plans past the student's sleep time.

Plans include breaks, and the browser sends reminders 10 minutes before each block.

## Stack

| Layer | Tech |
|---|---|
| Backend | Python, FastAPI |
| Database | SQLite, a single file at `data/prepwise.db` that needs no setup (FTS5 full-text search for RAG retrieval) |
| Frontend | Plain HTML, CSS, JavaScript (ES modules, no framework, no build step) |
| LLM (optional) | Groq (`openai/gpt-oss-120b` by default). Without a key the app runs in **Demo mode** with extractive answers |

## Run it

```bash
pip install -r requirements.txt
./run.sh                               # → http://localhost:8000
```

No database setup is needed. The SQLite file `data/prepwise.db` is created on first start. **Delete it to reset the demo.**
Optionally, `cp .env.example .env` and add a `GROQ_API_KEY` for full AI mode.

On first launch, tick **"Load sample Operating Systems notes"** to see every screen with data.

## How the planner works (`backend/planner.py`)

- **Need per topic** = `est_minutes × (1 − mastery) × difficulty factor`
- **Priority** = `weightage × (mastery gap + 0.15) × difficulty × never-studied boost`
- **Standard roadmap:** topics fill each day's window (start time → sleep time, capped at daily hours) in 50/10 blocks. Every finished topic gets a practice quiz on +1 day and revision on +3 and +7 days. Revisions are capped at 40% of a day. The last day before the exam is full revision.
- **Assessment:** compares minutes needed with minutes available and recommends crisis mode when they don't fit or the exam is ≤ 1 day away.
- **Crisis roadmap:** compressed time per topic (~35%), greedy by `value / minutes`, then hardest high-weight topics first while fresh, a rapid-recall block, a sleep cutoff and a morning glance.
- **Mastery updates:** quizzes blend 60/40 into mastery. Finished blocks add diminishing gains. Every change is recorded in `mastery_history`, which drives the progress graph.

## Layout

```
app.py                 FastAPI routes + static frontend
backend/
  schema.sql           SQLite schema (+ FTS5 index and triggers)
  rag.py               extraction, chunking, FTS5 retrieval
  ai.py                answers, mind maps, topics, quizzes, cheat sheets (LLM + offline fallback)
  planner.py           standard + crisis roadmaps, assessment
  progress.py          mastery updates + report
  llm.py, db.py, config.py
static/
  index.html, css/styles.css
  js/app.js            shell, router, ⌘K search, reminders, onboarding
  js/views/*.js        chat, notes, library, mindmaps, planner, progress, settings, quiz
_legacy/               previous Streamlit version (kept for reference)
```

## Deploy (public link, free)

The repo includes a `Dockerfile` and a `render.yaml` blueprint.

1. Push this repo to GitHub.
2. On [render.com](https://render.com) → **New → Blueprint** → select the repo → **Apply**.
3. When asked, paste your `GROQ_API_KEY` (or leave it empty to run in Demo mode).
4. Open the `https://prepwise-xxxx.onrender.com` link Render gives you.

Notes: the free plan sleeps after 15 min idle (first visit takes ~30–50 s to wake), and the SQLite
database resets on every redeploy/restart — use **Load demo** to repopulate.

Run the same container locally: `docker build -t prepwise . && docker run -p 8000:8000 prepwise`
