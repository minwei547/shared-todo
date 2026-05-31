"""共享待办清单系统 — Flask API 服务"""
import os
from flask import Flask, request, jsonify, send_from_directory
import db

app = Flask(__name__, static_folder="static", static_url_path="")

# ─── 初始化数据库 ───
db.init_db()

# ─── 静态文件 ───
@app.route("/")
def index():
    return send_from_directory("static", "index.html")

# ─── 房屋 ───

@app.route("/api/house/create", methods=["POST"])
def api_create_house():
    data = request.json or {}
    name = (data.get("name") or "").strip()
    nickname = (data.get("nickname") or "").strip()
    if not name or not nickname:
        return jsonify({"error": "房屋名称和昵称不能为空"}), 400
    house, owner_id = db.create_house(name, nickname)
    return jsonify({
        "house": house,
        "member_id": owner_id,
        "nickname": nickname,
        "is_owner": True
    })

@app.route("/api/house/join", methods=["POST"])
def api_join_house():
    data = request.json or {}
    invite_code = (data.get("invite_code") or "").strip()
    nickname = (data.get("nickname") or "").strip()
    if not invite_code or not nickname:
        return jsonify({"error": "邀请码和昵称不能为空"}), 400
    result, err = db.join_house(invite_code, nickname)
    if err:
        return jsonify({"error": err}), 400
    return jsonify({
        "house": result["house"],
        "member_id": result["member_id"],
        "nickname": result["nickname"],
        "is_owner": False
    })

@app.route("/api/house/<house_id>")
def api_get_house(house_id):
    house = db.get_house(house_id)
    if not house:
        return jsonify({"error": "房屋不存在"}), 404
    members = db.get_house_members(house_id)
    return jsonify({"house": house, "members": members})

# ─── 成员 ───

@app.route("/api/house/<house_id>/members")
def api_get_members(house_id):
    members = db.get_house_members(house_id)
    return jsonify(members)

# ─── 任务 ───

@app.route("/api/house/<house_id>/tasks")
def api_get_tasks(house_id):
    member_id = request.args.get("member_id", "")
    if not member_id:
        return jsonify({"error": "缺少 member_id"}), 400
    tasks = db.get_tasks(house_id, member_id)
    return jsonify(tasks)

@app.route("/api/house/<house_id>/tasks/all")
def api_get_all_tasks(house_id):
    """房主视图：返回全部成员的任务，需要 member_id 验证"""
    member_id = request.args.get("member_id", "")
    if not member_id or not db.is_owner(house_id, member_id):
        return jsonify({"error": "仅房主可查看全部清单"}), 403
    tasks = db.get_all_tasks_by_member(house_id)
    members = db.get_house_members(house_id)
    return jsonify({"tasks": tasks, "members": [m for m in members if not m["is_owner"]]})

@app.route("/api/house/<house_id>/tasks", methods=["POST"])
def api_add_task(house_id):
    data = request.json or {}
    member_id = data.get("member_id", "")
    title = (data.get("title") or "").strip()
    if not member_id or not title:
        return jsonify({"error": "member_id 和标题不能为空"}), 400
    task = db.add_task(
        house_id,
        member_id,
        title,
        (data.get("description") or "").strip(),
        data.get("deadline") or None,
        int(data.get("total") or 0)
    )
    return jsonify(task)

@app.route("/api/house/<house_id>/tasks/<task_id>", methods=["PUT"])
def api_update_task(house_id, task_id):
    data = request.json or {}
    member_id = data.get("member_id", "")
    actor_id = data.get("actor_id", member_id)

    task = db.update_task(task_id, house_id, member_id, **{
        k: v for k, v in data.items()
        if k in ("title", "description", "deadline", "done", "total", "done_count")
    })
    if task is None:
        return jsonify({"error": "任务不存在"}), 404
    return jsonify(task)

@app.route("/api/house/<house_id>/tasks/<task_id>/bump", methods=["POST"])
def api_bump_task(house_id, task_id):
    """快捷 +1 / -1"""
    data = request.json or {}
    delta = int(data.get("delta", 1))
    task = db.bump_task(task_id, house_id, delta)
    if task is None:
        return jsonify({"error": "任务不存在"}), 404
    return jsonify(task)

@app.route("/api/house/<house_id>/tasks/<task_id>/owner-edit", methods=["PUT"])
def api_owner_edit_task(house_id, task_id):
    """房主编辑他人任务"""
    data = request.json or {}
    actor_id = data.get("actor_id", "")
    if not actor_id or not db.is_owner(house_id, actor_id):
        return jsonify({"error": "仅房主可编辑他人任务"}), 403

    task = db.update_task(task_id, house_id, data.get("member_id", ""), **{
        k: v for k, v in data.items()
        if k in ("title", "description", "deadline", "done", "total", "done_count")
    })
    if task is None:
        return jsonify({"error": "任务不存在"}), 404
    return jsonify(task)

@app.route("/api/house/<house_id>/tasks/<task_id>", methods=["DELETE"])
def api_delete_task(house_id, task_id):
    member_id = request.args.get("member_id", "")
    actor_id = request.args.get("actor_id", member_id)
    # 允许任务所属者或房主删除
    can_delete = (actor_id == member_id) or db.is_owner(house_id, actor_id)
    if not can_delete:
        return jsonify({"error": "无权删除"}), 403
    ok = db.delete_task(task_id, house_id)
    if not ok:
        return jsonify({"error": "任务不存在"}), 404
    return jsonify({"ok": True})

# ─── 聊天 ───

@app.route("/api/house/<house_id>/messages", methods=["POST"])
def api_send_message(house_id):
    data = request.json or {}
    from_id = data.get("from_id", "")
    to_id = data.get("to_id", "")
    content = (data.get("content") or "").strip()
    if not from_id or not to_id or not content:
        return jsonify({"error": "缺少参数"}), 400
    msg = db.send_message(house_id, from_id, to_id, content)
    return jsonify(msg)

@app.route("/api/house/<house_id>/messages")
def api_get_chat(house_id):
    user_a = request.args.get("a", "")
    user_b = request.args.get("b", "")
    if not user_a or not user_b:
        return jsonify({"error": "缺少参数"}), 400
    msgs = db.get_chat(house_id, user_a, user_b)
    return jsonify(msgs)

@app.route("/api/house/<house_id>/messages/unread")
def api_unread(house_id):
    member_id = request.args.get("member_id", "")
    since = request.args.get("since") or None
    if not member_id:
        return jsonify({})
    counts = db.get_unread_counts(house_id, member_id, since)
    return jsonify(counts)

if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    app.run(host="0.0.0.0", port=5000, debug=debug)
