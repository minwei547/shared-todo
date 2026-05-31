"""共享待办清单系统 — 数据库层"""
import sqlite3
import uuid
from datetime import datetime

import os
DB_PATH = os.environ.get("DB_PATH", "todo.db")

# 确保云端持久化目录存在
db_dir = os.path.dirname(DB_PATH)
if db_dir:
    os.makedirs(db_dir, exist_ok=True)

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS houses (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            invite_code TEXT UNIQUE NOT NULL,
            owner_id TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS members (
            id TEXT PRIMARY KEY,
            house_id TEXT NOT NULL REFERENCES houses(id),
            nickname TEXT NOT NULL,
            is_owner INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            house_id TEXT NOT NULL REFERENCES houses(id),
            member_id TEXT NOT NULL REFERENCES members(id),
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            deadline TEXT,
            done INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
    """)
    conn.commit()
    conn.close()

# ─── 房屋操作 ───

def create_house(name: str, owner_nickname: str):
    house_id = str(uuid.uuid4())
    invite_code = str(uuid.uuid4())[:8]
    owner_id = str(uuid.uuid4())
    conn = get_db()
    conn.execute("INSERT INTO houses (id, name, invite_code, owner_id) VALUES (?,?,?,?)",
                 [house_id, name, invite_code, owner_id])
    conn.execute("INSERT INTO members (id, house_id, nickname, is_owner) VALUES (?,?,?,1)",
                 [owner_id, house_id, owner_nickname])
    conn.commit()
    row = conn.execute("SELECT * FROM houses WHERE id=?", [house_id]).fetchone()
    conn.close()
    return dict(row), owner_id

def join_house(invite_code: str, nickname: str):
    conn = get_db()
    house = conn.execute("SELECT * FROM houses WHERE invite_code=?", [invite_code]).fetchone()
    if not house:
        conn.close()
        return None, "邀请码无效"
    member_id = str(uuid.uuid4())
    conn.execute("INSERT INTO members (id, house_id, nickname) VALUES (?,?,?)",
                 [member_id, house["id"], nickname])
    conn.commit()
    conn.close()
    return {"house": dict(house), "member_id": member_id, "nickname": nickname}, None

def get_house(house_id: str):
    conn = get_db()
    house = conn.execute("SELECT * FROM houses WHERE id=?", [house_id]).fetchone()
    conn.close()
    return dict(house) if house else None

# ─── 成员操作 ───

def get_house_members(house_id: str):
    conn = get_db()
    members = conn.execute(
        "SELECT * FROM members WHERE house_id=? ORDER BY is_owner DESC, created_at ASC",
        [house_id]
    ).fetchall()
    conn.close()
    return [dict(m) for m in members]

def is_owner(house_id: str, member_id: str):
    conn = get_db()
    member = conn.execute(
        "SELECT is_owner FROM members WHERE id=? AND house_id=?",
        [member_id, house_id]
    ).fetchone()
    conn.close()
    return member and member["is_owner"] == 1

# ─── 任务操作 ───

def get_tasks(house_id: str, member_id: str):
    conn = get_db()
    tasks = conn.execute(
        "SELECT * FROM tasks WHERE house_id=? AND member_id=? ORDER BY done ASC, deadline ASC NULLS LAST, created_at DESC",
        [house_id, member_id]
    ).fetchall()
    conn.close()
    return [dict(t) for t in tasks]

def add_task(house_id: str, member_id: str, title: str, description: str = "", deadline: str = None):
    task_id = str(uuid.uuid4())
    conn = get_db()
    conn.execute(
        "INSERT INTO tasks (id, house_id, member_id, title, description, deadline) VALUES (?,?,?,?,?,?)",
        [task_id, house_id, member_id, title, description, deadline]
    )
    conn.commit()
    task = conn.execute("SELECT * FROM tasks WHERE id=?", [task_id]).fetchone()
    conn.close()
    return dict(task)

def update_task(task_id: str, house_id: str, member_id: str, **fields):
    """仅任务所属者或房主可更新；房主只能改非自己的任务"""
    allowed = {"title", "description", "deadline", "done"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return None
    conn = get_db()
    task = conn.execute("SELECT * FROM tasks WHERE id=? AND house_id=?", [task_id, house_id]).fetchone()
    if not task:
        conn.close()
        return None
    set_clause = ", ".join(f"{k}=?" for k in updates)
    values = list(updates.values()) + [task_id]
    conn.execute(f"UPDATE tasks SET {set_clause} WHERE id=?", values)
    conn.commit()
    task = conn.execute("SELECT * FROM tasks WHERE id=?", [task_id]).fetchone()
    conn.close()
    return dict(task)

def delete_task(task_id: str, house_id: str):
    conn = get_db()
    conn.execute("DELETE FROM tasks WHERE id=? AND house_id=?", [task_id, house_id])
    conn.commit()
    affected = conn.execute("SELECT changes()").fetchone()[0]
    conn.close()
    return affected > 0

def get_all_tasks_by_member(house_id: str):
    """房主视图：按成员分组的全部任务"""
    conn = get_db()
    rows = conn.execute(
        """SELECT t.*, m.nickname FROM tasks t
           JOIN members m ON t.member_id = m.id
           WHERE t.house_id=? ORDER BY m.nickname, t.done ASC, t.deadline ASC NULLS LAST""",
        [house_id]
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
