"""SQLite storage — zero setup. The whole database is one file (data/prepwise.db);
delete it to reset the demo.

Queries use %s placeholders (converted to ?), and rows come back as dicts with
dates, times, timestamps and JSON columns already parsed into Python objects.
"""
import json
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, time
from pathlib import Path

from backend.config import DB_PATH

DATETIME_COLS = {"created_at", "updated_at", "last_studied", "start_at", "end_at", "recorded_at"}
DATE_COLS = {"exam_date", "d"}
TIME_COLS = {"study_start", "sleep_time"}
JSON_COLS = {"data", "summary", "meta", "tags"}


# ---------------------------------------------------------------- adapters (Python -> SQLite)
def _dt(v: datetime):
    if v.tzinfo is not None:
        v = v.astimezone().replace(tzinfo=None)
    return v.strftime("%Y-%m-%d %H:%M:%S")


sqlite3.register_adapter(datetime, _dt)
sqlite3.register_adapter(date, lambda v: v.isoformat())
sqlite3.register_adapter(time, lambda v: v.strftime("%H:%M:%S"))
sqlite3.register_adapter(list, json.dumps)
sqlite3.register_adapter(dict, json.dumps)
sqlite3.register_adapter(bool, int)


def Json(value):
    return json.dumps(value)


# ---------------------------------------------------------------- row parsing (SQLite -> Python)
def _parse(row: sqlite3.Row):
    out = {}
    for key in row.keys():
        v = row[key]
        if isinstance(v, str):
            try:
                if key in DATETIME_COLS:
                    v = datetime.fromisoformat(v)
                elif key in DATE_COLS:
                    v = date.fromisoformat(v[:10])
                elif key in TIME_COLS:
                    v = time.fromisoformat(v)
                elif key in JSON_COLS:
                    v = json.loads(v)
            except ValueError:
                pass
        out[key] = v
    return out


class _Cursor:
    """Small wrapper so callers can use %s placeholders and get dict rows."""

    def __init__(self, cur):
        self._cur = cur

    def execute(self, sql, params=None):
        self._cur.execute(sql.replace("%s", "?").replace("%%", "%"), tuple(params or ()))
        return self

    def executescript(self, sql):
        self._cur.executescript(sql)

    def fetchone(self):
        r = self._cur.fetchone()
        return _parse(r) if r else None

    def fetchall(self):
        return [_parse(r) for r in self._cur.fetchall()]

    @property
    def rowcount(self):
        return self._cur.rowcount


def _connect():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_pool():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    schema = (Path(__file__).parent / "schema.sql").read_text()
    conn = _connect()
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(schema)
        conn.commit()
    finally:
        conn.close()


@contextmanager
def cursor():
    """A cursor inside a transaction; commit on success, roll back on error."""
    conn = _connect()
    try:
        yield _Cursor(conn.cursor())
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def rows(sql, params=None):
    with cursor() as cur:
        return cur.execute(sql, params).fetchall()


def row(sql, params=None):
    with cursor() as cur:
        return cur.execute(sql, params).fetchone()


def run(sql, params=None):
    with cursor() as cur:
        return cur.execute(sql, params).rowcount
