"""Mastery updates and the per-student progress report."""
from datetime import date, datetime, timedelta

from backend import db


def set_mastery(topic_id, value, source, cur=None):
    value = round(max(0.0, min(100.0, value)), 1)
    sql_t = """UPDATE topics SET mastery=%s, last_studied=datetime('now','localtime'), times_studied=times_studied+1
               WHERE id=%s"""
    sql_h = "INSERT INTO mastery_history (topic_id, mastery, source) VALUES (%s,%s,%s)"
    if cur is not None:
        cur.execute(sql_t, (value, topic_id))
        cur.execute(sql_h, (topic_id, value, source))
    else:
        with db.cursor() as c:
            c.execute(sql_t, (value, topic_id))
            c.execute(sql_h, (topic_id, value, source))
    return value


def after_quiz(student_id, topic_id, score, total):
    """Blend the new quiz result into mastery: recent evidence counts 40%."""
    t = db.row("SELECT mastery FROM topics WHERE id=%s AND student_id=%s", (topic_id, student_id))
    if not t:
        return None
    pct = 100 * score / max(1, total)
    new = 0.6 * t["mastery"] + 0.4 * pct
    with db.cursor() as cur:
        cur.execute("INSERT INTO quiz_attempts (student_id, topic_id, score, total) VALUES (%s,%s,%s,%s)",
                    (student_id, topic_id, score, total))
        return set_mastery(topic_id, new, "quiz", cur)


def after_session(student_id, event):
    """A completed study/revision block nudges mastery up, with diminishing returns."""
    minutes = int((event["end_at"] - event["start_at"]).total_seconds() // 60)
    with db.cursor() as cur:
        cur.execute("UPDATE events SET status='done' WHERE id=%s", (event["id"],))
        if event["kind"] in ("break", "exam", "reminder"):
            return None
        cur.execute("INSERT INTO study_sessions (student_id, topic_id, event_id, minutes, kind) VALUES (%s,%s,%s,%s,%s)",
                    (student_id, event["topic_id"], event["id"], minutes, event["kind"]))
        if not event["topic_id"]:
            return None
        cur.execute("SELECT mastery FROM topics WHERE id=%s", (event["topic_id"],))
        t = cur.fetchone()
        if not t:
            return None
        gain = {"study": min(12, minutes / 4), "practice": 6, "revise": 5}.get(event["kind"], 4)
        return set_mastery(event["topic_id"], t["mastery"] + gain * (1 - t["mastery"] / 100), event["kind"], cur)


# ------------------------------------------------------------------ report

def _readiness(topics, mastery_of):
    total_w = sum(t["weightage"] for t in topics) or 1
    return round(sum(mastery_of(t) * t["weightage"] for t in topics) / total_w, 1)


def report(student_id):
    student = db.row("SELECT * FROM students WHERE id=%s", (student_id,))
    topics = db.rows("""SELECT t.*, s.name AS subject FROM topics t LEFT JOIN subjects s ON s.id=t.subject_id
                        WHERE t.student_id=%s ORDER BY t.weightage DESC, t.title""", (student_id,))
    today = date.today()
    now = datetime.now()

    # readiness over the last 30 days, replaying mastery history
    history = db.rows("""SELECT h.topic_id, h.mastery, date(h.recorded_at) AS d FROM mastery_history h
                         JOIN topics t ON t.id=h.topic_id WHERE t.student_id=%s ORDER BY h.recorded_at""",
                      (student_id,))
    by_topic = {}
    for h in history:
        by_topic.setdefault(h["topic_id"], []).append((h["d"], h["mastery"]))

    def mastery_on(day):
        def f(t):
            val = 0.0
            for d, m in by_topic.get(t["id"], []):
                if d <= day:
                    val = m
            return val
        return f

    timeline = []
    for i in range(29, -1, -1):
        d = today - timedelta(days=i)
        timeline.append({"date": d.isoformat(), "readiness": _readiness(topics, mastery_on(d)) if topics else 0})
    readiness = _readiness(topics, lambda t: t["mastery"]) if topics else 0

    sessions = db.rows("""SELECT date(created_at) AS d, CAST(strftime('%%H', created_at) AS INTEGER) AS h, minutes
                          FROM study_sessions WHERE student_id=%s AND created_at > datetime('now','localtime','-60 days')""",
                       (student_id,))
    per_day = {}
    per_hour = {}
    for s in sessions:
        per_day[s["d"]] = per_day.get(s["d"], 0) + s["minutes"]
        per_hour[s["h"]] = per_hour.get(s["h"], 0) + s["minutes"]
    minutes_14 = [{"date": (today - timedelta(days=i)).isoformat(),
                   "minutes": per_day.get(today - timedelta(days=i), 0)} for i in range(13, -1, -1)]
    week_minutes = sum(m["minutes"] for m in minutes_14[-7:])

    streak, d = 0, today
    if per_day.get(d, 0) == 0:
        d -= timedelta(days=1)
    while per_day.get(d, 0) > 0:
        streak += 1
        d -= timedelta(days=1)

    adherence = db.row("""SELECT count(*) FILTER (WHERE status='done') AS done, count(*) AS total
                          FROM events WHERE student_id=%s AND end_at < %s
                          AND kind IN ('study','revise','practice')""", (student_id, now))
    adherence_pct = round(100 * adherence["done"] / adherence["total"]) if adherence["total"] else None

    quizzes = db.rows("""SELECT q.score, q.total, q.created_at, t.title FROM quiz_attempts q
                         LEFT JOIN topics t ON t.id=q.topic_id WHERE q.student_id=%s
                         ORDER BY q.created_at DESC LIMIT 20""", (student_id,))
    quiz_avg = round(100 * sum(q["score"] for q in quizzes) / max(1, sum(q["total"] for q in quizzes))) if quizzes else None

    topic_rows = []
    for t in topics:
        days_since = (now.date() - t["last_studied"].date()).days if t["last_studied"] else None
        if t["mastery"] >= 75:
            status = "strong"
        elif t["mastery"] >= 50:
            status = "okay"
        else:
            status = "weak"
        if days_since is not None and days_since >= 6 and t["mastery"] < 90:
            status = "fading"
        topic_rows.append({"id": t["id"], "title": t["title"], "subject": t["subject"], "mastery": t["mastery"],
                           "weightage": t["weightage"], "difficulty": t["difficulty"], "status": status,
                           "days_since": days_since})

    subjects = {}
    for t in topics:
        subjects.setdefault(t["subject"] or "General", []).append(t)
    subject_rows = [{"name": k, "readiness": _readiness(v, lambda t: t["mastery"]), "topics": len(v)}
                    for k, v in subjects.items()]

    # simple linear forecast from the last 7 days of readiness
    gain_per_day = (timeline[-1]["readiness"] - timeline[-8]["readiness"]) / 7
    days_left = (student["exam_date"] - today).days if student and student["exam_date"] else None
    forecast = None
    if days_left is not None and days_left >= 0:
        forecast = round(min(100, readiness + max(0, gain_per_day) * days_left), 1)

    insights = []
    weak_heavy = sorted([t for t in topic_rows if t["status"] in ("weak", "fading")],
                        key=lambda t: (-t["weightage"], t["mastery"]))
    if weak_heavy:
        insights.append(f"Biggest gain available: “{weak_heavy[0]['title']}” — high weightage, "
                        f"{round(weak_heavy[0]['mastery'])}% mastery.")
    fading = [t for t in topic_rows if t["status"] == "fading"]
    if fading:
        insights.append(f"{len(fading)} topic(s) are fading (not revised in 6+ days). A 20-min revision restores them.")
    if per_hour:
        best = max(per_hour, key=per_hour.get)
        insights.append(f"You study most around {best:02d}:00. Schedule hard topics there.")
    if adherence_pct is not None and adherence_pct < 60:
        insights.append("You're finishing under 60% of planned blocks. Try fewer daily hours you can actually keep.")
    if forecast is not None and forecast < 60:
        insights.append(f"At your current pace you'd reach ~{round(forecast)}% readiness by the exam. "
                        "Consider crisis mode to focus on high-weight topics.")
    if not insights:
        insights.append("Steady progress. Keep revising on schedule.")

    return {
        "kpis": {"readiness": readiness, "week_minutes": week_minutes, "streak": streak,
                 "adherence": adherence_pct, "quiz_avg": quiz_avg, "forecast": forecast, "days_left": days_left},
        "timeline": timeline,
        "minutes_14": minutes_14,
        "topics": topic_rows,
        "subjects": subject_rows,
        "quizzes": [{"title": q["title"], "pct": round(100 * q["score"] / max(1, q["total"])),
                     "at": q["created_at"].isoformat()} for q in reversed(quizzes)],
        "insights": insights,
    }
