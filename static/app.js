/* 共享待办清单 — 前端逻辑 */

// ─── 状态 ───
let state = {
  house: null,
  memberId: "",
  nickname: "",
  isOwner: false,
  tasks: [],
  members: [],
  viewingMemberId: "",    // 房主当前查看的成员
  filter: "all",
};

// ─── 初始化 ───
document.addEventListener("DOMContentLoaded", () => {
  // 尝试从 localStorage 恢复会话
  const saved = localStorage.getItem("todo_session");
  if (saved) {
    try {
      const data = JSON.parse(saved);
      state = { ...state, ...data };
      if (state.house) {
        showMain();
        refreshAll();
      }
    } catch (e) { localStorage.removeItem("todo_session"); }
  }

  // Tab 切换
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      document.getElementById("tab-" + tab).classList.add("active");
    });
  });

  // 筛选按钮
  document.querySelectorAll(".filter").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.filter = btn.dataset.filter;
      renderTasks();
    });
  });

  // 邀请码点击复制
  document.getElementById("invite-badge").addEventListener("click", () => {
    if (state.house) {
      navigator.clipboard.writeText(state.house.invite_code).then(() => {
        const el = document.getElementById("invite-badge");
        const orig = el.textContent;
        el.textContent = "已复制!";
        setTimeout(() => { el.textContent = orig; }, 1200);
      });
    }
  });

  // 截止时间默认值：明天 18:00
  const now = new Date();
  now.setDate(now.getDate() + 1);
  now.setHours(18, 0, 0, 0);
  document.getElementById("modal-task-deadline").value = toLocalDatetime(now);
});

function saveSession() {
  localStorage.setItem("todo_session", JSON.stringify({
    house: state.house,
    memberId: state.memberId,
    nickname: state.nickname,
    isOwner: state.isOwner,
  }));
}

// ─── 视图切换 ───
function showView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById("view-" + name).classList.add("active");
}

function showMain() {
  showView("main");
  document.getElementById("house-name").textContent = "🏠 " + state.house.name;
  document.getElementById("invite-badge").textContent = state.house.invite_code;
  const ub = document.getElementById("user-badge");
  ub.innerHTML = `${avatarHtml(state.nickname, 32)} ${escapeHtml(state.nickname)}`;
  ub.className = "user-badge" + (state.isOwner ? " owner" : "");
  if (state.isOwner) {
    document.getElementById("owner-panel").classList.remove("hidden");
  } else {
    document.getElementById("owner-panel").classList.add("hidden");
  }
  saveSession();
}

// ─── 创建/加入房屋 ───
async function createHouse() {
  const name = document.getElementById("create-house-name").value.trim();
  const nickname = document.getElementById("create-nickname").value.trim();
  if (!name || !nickname) return showError("请填写房屋名称和昵称");

  const res = await fetch("/api/house/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, nickname }),
  });
  const data = await res.json();
  if (res.ok) {
    state.house = data.house;
    state.memberId = data.member_id;
    state.nickname = data.nickname;
    state.isOwner = true;
    state.viewingMemberId = state.memberId;
    showMain();
    refreshAll();
  } else {
    showError(data.error);
  }
}

async function joinHouse() {
  const invite_code = document.getElementById("join-code").value.trim();
  const nickname = document.getElementById("join-nickname").value.trim();
  if (!invite_code || !nickname) return showError("请填写邀请码和昵称");

  const res = await fetch("/api/house/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invite_code, nickname }),
  });
  const data = await res.json();
  if (res.ok) {
    state.house = data.house;
    state.memberId = data.member_id;
    state.nickname = data.nickname;
    state.isOwner = false;
    state.viewingMemberId = state.memberId;
    showMain();
    refreshAll();
  } else {
    showError(data.error);
  }
}

function showError(msg) {
  document.getElementById("join-error").textContent = msg || "";
}

function leaveHouse() {
  localStorage.removeItem("todo_session");
  state = { house: null, memberId: "", nickname: "", isOwner: false, tasks: [], members: [], viewingMemberId: "", filter: "all" };
  showView("join");
}

// ─── 刷新数据 ───
async function refreshAll() {
  await Promise.all([loadMembers(), loadTasks()]);
}

async function loadMembers() {
  const res = await fetch("/api/house/" + state.house.id + "/members");
  if (res.ok) {
    state.members = await res.json();
    renderMemberList();
  }
}

async function loadTasks(forMemberId) {
  const mid = forMemberId || state.viewingMemberId || state.memberId;

  if (state.isOwner && mid !== state.memberId) {
    // 房主查看他人清单
    const res = await fetch(
      "/api/house/" + state.house.id + "/tasks/all?member_id=" + state.memberId
    );
    if (res.ok) {
      const data = await res.json();
      // 过滤出当前查看成员的任务
      state.tasks = (data.tasks || []).filter(t => t.member_id === mid);
    }
  }

  // 始终加载自己的任务
  const res = await fetch(
    "/api/house/" + state.house.id + "/tasks?member_id=" + state.memberId
  );
  if (res.ok) {
    const ownTasks = await res.json();
    if (mid === state.memberId) {
      state.tasks = ownTasks;
    }
  }

  renderTasks();
}

// ─── 成员列表 ───
function renderMemberList() {
  const container = document.getElementById("member-list");
  const others = state.members.filter(m => m.id !== state.memberId);
  const me = state.members.find(m => m.id === state.memberId);

  let html = "";
  if (me) {
    html += `<div class="member-item me ${state.viewingMemberId === me.id ? 'active' : ''}"
             onclick="viewMember('${me.id}', '${escapeHtml(me.nickname)}')">
             ${avatarHtml(me.nickname, 26)}${escapeHtml(me.nickname)}（我）</div>`;
  }
  others.forEach(m => {
    html += `<div class="member-item ${state.viewingMemberId === m.id ? 'active' : ''}"
             onclick="viewMember('${m.id}', '${escapeHtml(m.nickname)}')">
             ${avatarHtml(m.nickname, 26)}${escapeHtml(m.nickname)}</div>`;
  });

  if (others.length === 0 && !me) {
    html = '<div class="member-item" style="cursor:default;color:var(--text-muted)">暂无成员</div>';
  }

  container.innerHTML = html;
}

function viewMember(memberId, nickname) {
  state.viewingMemberId = memberId;
  const label = memberId === state.memberId ? "📋 我的任务" : "📋 " + escapeHtml(nickname) + " 的任务";
  document.getElementById("task-owner-label").textContent = label;

  // 房主查看别人时可以添加任务
  const addBtn = document.querySelector(".btn-add");
  if (memberId !== state.memberId) {
    addBtn.textContent = "+ 为 " + escapeHtml(nickname) + " 添加";
  } else {
    addBtn.textContent = "+ 新建任务";
  }

  loadTasks(memberId);
  renderMemberList();
}

// ─── 进度条 ───
function updateProgress(tasks) {
  const total = tasks.length;
  const done = tasks.filter(t => t.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  document.getElementById("progress-text").textContent = `完成 ${done}/${total}`;
  document.getElementById("progress-pct").textContent = `${pct}%`;
  document.getElementById("progress-fill").style.width = `${pct}%`;
}

// ─── 任务渲染 ───
function renderTasks() {
  const container = document.getElementById("task-list");
  const emptyHint = document.getElementById("empty-hint");
  const now = new Date();

  let tasks = [...state.tasks];

  // 进度条（用全量数据，不受筛选影响）
  updateProgress(state.tasks);

  // 筛选
  if (state.filter === "done") tasks = tasks.filter(t => t.done);
  else if (state.filter === "pending") tasks = tasks.filter(t => !t.done);
  else if (state.filter === "overdue") tasks = tasks.filter(t => !t.done && t.deadline && new Date(t.deadline) < now);

  if (tasks.length === 0) {
    container.innerHTML = "";
    emptyHint.classList.remove("hidden");
    return;
  }
  emptyHint.classList.add("hidden");

  container.innerHTML = tasks.map(t => {
    const isDone = t.done === 1 || t.done === true;
    const isOverdue = t.deadline && new Date(t.deadline) < now && !isDone;
    const isSoon = t.deadline && !isDone && !isOverdue && (new Date(t.deadline) - now) < 24 * 3600 * 1000;

    let cardClass = "task-card";
    if (isDone) cardClass += " done";
    if (isOverdue) cardClass += " overdue";

    let deadlineHtml = "";
    if (t.deadline) {
      const d = new Date(t.deadline);
      const cls = isOverdue ? "past" : (isSoon ? "soon" : "");
      deadlineHtml = `<span class="task-deadline ${cls}">⏰ ${formatDate(d)}</span>`;
    }

    const isOwnTask = t.member_id === state.memberId;
    const canEdit = isOwnTask || state.isOwner;

    // 显示所属者标签（房主视角看他人任务时）
    let ownerTag = "";
    if (state.isOwner && !isOwnTask && state.viewingMemberId !== state.memberId) {
      const member = state.members.find(m => m.id === t.member_id);
      if (member) ownerTag = `<span class="task-owner-tag">${escapeHtml(member.nickname)}</span>`;
    }

    return `
    <div class="${cardClass}">
      <input type="checkbox" class="task-checkbox" ${isDone ? "checked" : ""}
             onchange="toggleDone('${t.id}')" ${canEdit ? "" : "disabled"}>
      <div class="task-body">
        <div class="task-title">${escapeHtml(t.title)}${ownerTag}</div>
        ${t.description ? `<div class="task-desc">${escapeHtml(t.description)}</div>` : ""}
        <div class="task-meta">${deadlineHtml}</div>
      </div>
      ${canEdit ? `
      <div class="task-actions">
        <button class="btn-xs" onclick="openTaskModal('${t.id}')">编辑</button>
        <button class="btn-xs danger" onclick="deleteTask('${t.id}')">删除</button>
      </div>` : ""}
    </div>`;
  }).join("");
}

// ─── 任务操作 ───
function openTaskModal(taskId) {
  const modal = document.getElementById("modal-overlay");
  modal.classList.remove("hidden");

  if (taskId) {
    document.getElementById("modal-title").textContent = "编辑任务";
    document.getElementById("modal-task-id").value = taskId;
    const task = state.tasks.find(t => t.id === taskId);
    if (task) {
      document.getElementById("modal-task-title").value = task.title;
      document.getElementById("modal-task-desc").value = task.description || "";
      document.getElementById("modal-task-deadline").value = task.deadline ? toLocalDatetime(new Date(task.deadline)) : "";
    }
  } else {
    document.getElementById("modal-title").textContent = "新建任务";
    document.getElementById("modal-task-id").value = "";
    document.getElementById("modal-task-title").value = "";
    document.getElementById("modal-task-desc").value = "";
    const now = new Date();
    now.setDate(now.getDate() + 1);
    now.setHours(18, 0, 0, 0);
    document.getElementById("modal-task-deadline").value = toLocalDatetime(now);
  }
}

function closeModal(e) {
  if (e && e.target !== document.getElementById("modal-overlay")) return;
  document.getElementById("modal-overlay").classList.add("hidden");
}

async function saveTask() {
  const taskId = document.getElementById("modal-task-id").value;
  const title = document.getElementById("modal-task-title").value.trim();
  const desc = document.getElementById("modal-task-desc").value.trim();
  const deadline = document.getElementById("modal-task-deadline").value || null;

  if (!title) return alert("请输入任务标题");

  const viewingId = state.viewingMemberId || state.memberId;
  const body = {
    member_id: viewingId,
    actor_id: state.memberId,
    title, description: desc, deadline,
  };

  if (taskId) {
    // 更新
    const isOwn = state.tasks.find(t => t.id === taskId)?.member_id === state.memberId;
    const url = isOwn
      ? `/api/house/${state.house.id}/tasks/${taskId}`
      : `/api/house/${state.house.id}/tasks/${taskId}/owner-edit`;
    await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } else {
    await fetch(`/api/house/${state.house.id}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  document.getElementById("modal-overlay").classList.add("hidden");
  await loadTasks(state.viewingMemberId);
}

async function toggleDone(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  const isOwn = task.member_id === state.memberId;
  const url = isOwn
    ? `/api/house/${state.house.id}/tasks/${taskId}`
    : `/api/house/${state.house.id}/tasks/${taskId}/owner-edit`;

  await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      member_id: task.member_id,
      actor_id: state.memberId,
      done: task.done ? 0 : 1,
    }),
  });

  await loadTasks(state.viewingMemberId);
}

async function deleteTask(taskId) {
  if (!confirm("确定删除此任务？")) return;

  const task = state.tasks.find(t => t.id === taskId);
  await fetch(
    `/api/house/${state.house.id}/tasks/${taskId}?member_id=${task?.member_id || ""}&actor_id=${state.memberId}`,
    { method: "DELETE" }
  );

  await loadTasks(state.viewingMemberId);
}

// ─── 工具函数 ───
function formatDate(d) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

function toLocalDatetime(d) {
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${mm}-${dd}T${hh}:${mi}`;
}

// ─── 头像 ───
const AVATAR_COLORS = ['#4f6ef7','#e74c3c','#27ae60','#f39c12','#8e44ad','#16a085','#e67e22','#2980b9','#c0392b','#2ecc71'];
function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
function avatarChar(name) {
  return (name || '?').charAt(0).toUpperCase();
}
function avatarHtml(name, size) {
  const cls = size <= 26 ? 'avatar avatar-sm' : 'avatar';
  return `<span class="${cls}" style="background:${avatarColor(name)}">${avatarChar(name)}</span>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
