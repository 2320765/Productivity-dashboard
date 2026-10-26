import { createClient } from "@supabase/supabase-js";
import { primaryName } from "./username.js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseKey);

export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

export const supabaseConfigError = hasSupabaseConfig
  ? ""
  : supabaseUrl || supabaseKey
    ? "Укажите оба значения: VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY."
    : "Supabase не настроен. Заполните .env.local по примеру .env.example.";

function throwIfError(error) {
  if (error) throw error;
}

// Если миграция usernames ещё не применена, интерфейс продолжает работать без username.
async function loadUsernameMap(userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await supabase.rpc("usernames_for", { p_user_ids: ids });
  if (error || !data) return new Map();
  return new Map(data.map((row) => [row.user_id, row.username]));
}

export async function loadMyUsername() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "";
  const { data, error } = await supabase.from("profiles").select("username").eq("user_id", user.id).maybeSingle();
  if (error) return "";
  return data?.username ?? "";
}

export async function saveUsername(username) {
  const { data, error } = await supabase.rpc("set_username", { p_username: username });
  if (error) {
    const text = `${error.message ?? ""}`;
    if (error.code === "23505" || /already taken/i.test(text)) throw new Error("Этот username уже занят.");
    if (/reserved/i.test(text)) throw new Error("Этот username зарезервирован, выберите другой.");
    if (/invalid username/i.test(text)) throw new Error("Допустимы латинские буквы, цифры и _, длина 3–20, начало с буквы.");
    throw error;
  }
  return data;
}

export async function setWorkspaceRecordArchived(workspaceId, recordType, recordId, archived) {
  const { error } = await supabase.rpc("set_workspace_record_archived", {
    p_workspace_id: workspaceId,
    p_record_type: recordType,
    p_record_id: recordId,
    p_archived: archived,
  });
  throwIfError(error);
}

function mapGoal(row) {
  return {
    id: row.id,
    title: row.title,
    period: row.period,
    startDate: row.start_date,
    endDate: row.end_date,
    parentId: row.parent_id,
    priority: row.priority,
    notes: row.notes,
  };
}

function mapTask(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    date: row.task_date,
    time: row.time,
    deadline: row.deadline,
    priority: row.priority,
    status: row.status,
    notes: row.notes,
    goalId: row.goal_id,
    ...(row.recurrence ? { recurrence: row.recurrence } : {}),
    ...(row.reminder ? { reminder: row.reminder } : {}),
    ...(row.move_count ? { movedFrom: row.moved_from, movedAt: row.moved_at, moveCount: row.move_count } : {}),
  };
}

export async function loadRemoteDashboard(userId) {
  const [goalsResult, tasksResult, revisionResult] = await Promise.all([
    supabase.from("goals").select("*").eq("user_id", userId),
    supabase.from("tasks").select("*").eq("user_id", userId),
    supabase.from("dashboard_revisions").select("revision").eq("user_id", userId).maybeSingle(),
  ]);

  throwIfError(goalsResult.error);
  throwIfError(tasksResult.error);
  throwIfError(revisionResult.error);

  return {
    dashboard: {
      goals: goalsResult.data.map(mapGoal),
      tasks: tasksResult.data.map(mapTask),
    },
    revision: Number(revisionResult.data?.revision ?? 0),
  };
}

// Повторяющиеся id ломают первичный ключ (user_id, id); дубликаты получают стабильный суффикс.
function withUniqueIds(items) {
  const seen = new Map();
  return items.map((item) => {
    const count = seen.get(item.id) ?? 0;
    seen.set(item.id, count + 1);
    return count === 0 ? item : { ...item, id: `${item.id}-dup${count}` };
  });
}

export async function syncRemoteDashboard(userId, rawDashboard, expectedRevision) {
  const dashboard = { goals: withUniqueIds(rawDashboard.goals), tasks: withUniqueIds(rawDashboard.tasks) };
  const { data, error } = await supabase.rpc("sync_dashboard", {
    p_goals: dashboard.goals.map((goal) => ({
      id: goal.id,
      title: goal.title,
      period: goal.period,
      start_date: goal.startDate,
      end_date: goal.endDate,
      parent_id: goal.parentId ?? null,
      priority: goal.priority,
      notes: goal.notes ?? "",
      archived_at: goal.archivedAt ?? null,
      archived_by: goal.archivedBy ?? null,
    })),
    p_tasks: dashboard.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      category: task.category,
      task_date: task.date,
      time: task.time ?? "",
      deadline: task.deadline ?? "",
      priority: task.priority,
      status: task.status,
      notes: task.notes ?? "",
      goal_id: task.goalId ?? null,
      recurrence: task.recurrence ?? null,
      reminder: task.reminder ?? null,
      moved_from: task.movedFrom ?? null,
      moved_at: task.movedAt ?? null,
      move_count: task.moveCount ?? 0,
    })),
    p_expected_revision: expectedRevision,
  });

  throwIfError(error);
  return Number(data);
}

function mapWorkspace(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.owner_id,
    createdAt: row.created_at,
  };
}

function mapWorkspaceGoal(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    createdBy: row.created_by,
    title: row.title,
    period: row.period,
    startDate: row.start_date,
    endDate: row.end_date,
    parentId: row.parent_id,
    priority: row.priority,
    notes: row.notes,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
  };
}

function mapWorkspaceTask(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    createdBy: row.created_by,
    assigneeId: row.assignee_id,
    title: row.title,
    category: row.category,
    date: row.task_date,
    time: row.time,
    deadline: row.deadline,
    priority: row.priority,
    status: row.status,
    notes: row.notes,
    goalId: row.goal_id,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
  };
}

function mapWorkspaceComment(row) {
  return { id: row.id, workspaceId: row.workspace_id, taskId: row.task_id,
    authorId: row.author_id, authorName: row.author_name, body: row.body,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function workspaceRecordId(id) {
  if (typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return id;
  }
  const generated = globalThis.crypto?.randomUUID?.();
  if (!generated) throw new Error("Нужен браузер с поддержкой генерации UUID для общей записи.");
  return generated;
}

function mapInvitation(row, workspaceNames) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name ?? workspaceNames.get(row.workspace_id) ?? "Рабочее пространство",
    invitedBy: row.invited_by,
    inviteeId: row.invitee_id,
    inviteeName: row.invitee_name,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function loadWorkspaceOverview(userId) {
  const [workspacesResult, membershipsResult, invitationsResult] = await Promise.all([
    supabase.from("workspaces").select("*").order("created_at", { ascending: false }),
    supabase.from("workspace_members").select("workspace_id, role").eq("user_id", userId),
    supabase.rpc("workspace_invitations_for_user"),
  ]);

  throwIfError(workspacesResult.error);
  throwIfError(membershipsResult.error);
  throwIfError(invitationsResult.error);

  const roles = new Map(membershipsResult.data.map((membership) => [membership.workspace_id, membership.role]));
  const workspaces = workspacesResult.data.map((row) => ({
    ...mapWorkspace(row),
    role: roles.get(row.id) ?? "member",
  }));
  const workspaceNames = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));

  return {
    workspaces,
    invitations: invitationsResult.data.map((row) => mapInvitation(row, workspaceNames)),
  };
}

export async function loadWorkspaceRecords(workspaceId) {
  const [workspaceResult, membersResult, goalsResult, tasksResult, commentsResult] = await Promise.all([
    supabase.from("workspaces").select("*").eq("id", workspaceId).single(),
    supabase.rpc("workspace_member_labels", { p_workspace_id: workspaceId }),
    supabase.from("workspace_goals").select("*").eq("workspace_id", workspaceId).order("start_date"),
    supabase.from("workspace_tasks").select("*").eq("workspace_id", workspaceId).order("task_date"),
    supabase.rpc("workspace_task_comments_with_authors", { p_workspace_id: workspaceId }),
  ]);

  throwIfError(workspaceResult.error);
  throwIfError(membersResult.error);
  throwIfError(goalsResult.error);
  throwIfError(tasksResult.error);
  throwIfError(commentsResult.error);
  const usernames = await loadUsernameMap(membersResult.data.map((member) => member.user_id));

  return {
    workspace: mapWorkspace(workspaceResult.data),
    members: membersResult.data.map((member) => ({
      userId: member.user_id,
      role: member.role,
      name: primaryName(member.display_name, usernames.get(member.user_id)),
      username: usernames.get(member.user_id) ?? "",
    })),
    goals: goalsResult.data.map(mapWorkspaceGoal),
    tasks: tasksResult.data.map(mapWorkspaceTask),
    comments: commentsResult.data.map(mapWorkspaceComment),
  };
}

export async function createWorkspace(name, description) {
  const { data, error } = await supabase.rpc("create_workspace", {
    p_name: name,
    p_description: description,
  });
  throwIfError(error);
  return data;
}

export async function sendWorkspaceInvitation(workspaceId, email) {
  const { error } = await supabase.rpc("send_workspace_invitation", {
    p_workspace_id: workspaceId,
    p_email: email,
  });
  throwIfError(error);
}

export async function sendWorkspaceInvitationByUsername(workspaceId, username) {
  const { error } = await supabase.rpc("send_workspace_invitation_by_username", {
    p_workspace_id: workspaceId, p_username: username,
  });
  if (error?.code === "P0002") throw new Error("Пользователь с таким username не найден.");
  if (error?.code === "23505") throw new Error("Пользователь уже в пространстве или приглашение уже отправлено.");
  throwIfError(error);
}

export async function sendWorkspaceInvitationToUser(workspaceId, userId) {
  const { error } = await supabase.rpc("send_workspace_invitation_to_user", {
    p_workspace_id: workspaceId, p_user_id: userId,
  });
  throwIfError(error);
}

export async function respondToWorkspaceInvitation(invitationId, accept) {
  const { error } = await supabase.rpc("respond_to_workspace_invitation", {
    p_invitation_id: invitationId,
    p_accept: accept,
  });
  throwIfError(error);
}

export async function cancelWorkspaceInvitation(invitationId) {
  const { error } = await supabase.rpc("cancel_workspace_invitation", {
    p_invitation_id: invitationId,
  });
  throwIfError(error);
}

export async function removeWorkspaceMember(workspaceId, userId) {
  const { error } = await supabase.rpc("remove_workspace_member", {
    p_workspace_id: workspaceId,
    p_user_id: userId,
  });
  throwIfError(error);
}

export async function setWorkspaceMemberRole(workspaceId, userId, role) {
  const { error } = await supabase.rpc("set_workspace_member_role", {
    p_workspace_id: workspaceId, p_user_id: userId, p_role: role,
  });
  throwIfError(error);
}

export async function transferWorkspaceOwnership(workspaceId, userId) {
  const { error } = await supabase.rpc("transfer_workspace_ownership", {
    p_workspace_id: workspaceId, p_user_id: userId,
  });
  throwIfError(error);
}

export async function renameWorkspace(workspaceId, name) {
  const { error } = await supabase.rpc("rename_workspace", {
    p_workspace_id: workspaceId, p_name: name,
  });
  throwIfError(error);
}

export async function leaveWorkspace(workspaceId) {
  const { error } = await supabase.rpc("leave_workspace", { p_workspace_id: workspaceId });
  throwIfError(error);
}

export async function deleteWorkspace(workspaceId) {
  const { error } = await supabase.rpc("delete_workspace", { p_workspace_id: workspaceId });
  throwIfError(error);
}

export async function saveWorkspaceGoal(userId, workspaceId, goal) {
  const id = workspaceRecordId(goal.id);
  const { data, error } = await supabase
    .from("workspace_goals")
    .upsert({
      workspace_id: workspaceId,
      id,
      created_by: goal.createdBy ?? userId,
      title: goal.title,
      period: goal.period,
      start_date: goal.startDate,
      end_date: goal.endDate,
      parent_id: goal.parentId || null,
      priority: goal.priority,
      notes: goal.notes ?? "",
    }, { onConflict: "workspace_id,id" })
    .select("*")
    .single();
  throwIfError(error);
  return mapWorkspaceGoal(data);
}

export async function deleteWorkspaceGoal(workspaceId, goalId) {
  const { error } = await supabase
    .from("workspace_goals")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", goalId);
  throwIfError(error);
}

export async function saveWorkspaceTask(userId, workspaceId, task) {
  const id = workspaceRecordId(task.id);
  const { data, error } = await supabase
    .from("workspace_tasks")
    .upsert({
      workspace_id: workspaceId,
      id,
      created_by: task.createdBy ?? userId,
      assignee_id: task.assigneeId ?? null,
      title: task.title,
      category: task.category,
      task_date: task.date,
      time: task.time ?? "",
      deadline: task.deadline ?? "",
      priority: task.priority,
      status: task.status,
      notes: task.notes ?? "",
      goal_id: task.goalId || null,
      archived_at: task.archivedAt ?? null,
      archived_by: task.archivedBy ?? null,
    }, { onConflict: "workspace_id,id" })
    .select("*")
    .single();
  throwIfError(error);
  return mapWorkspaceTask(data);
}

export async function saveWorkspaceComment(workspaceId, taskId, comment) {
  const id = comment.id ?? workspaceRecordId(null);
  const { data, error } = await supabase.from("workspace_task_comments").upsert({
    id, workspace_id: workspaceId, task_id: taskId,
    author_id: comment.authorId, body: comment.body.trim(),
  }, { onConflict: "id" }).select("*").single();
  throwIfError(error);
  return mapWorkspaceComment(data);
}

export async function deleteWorkspaceComment(commentId) {
  const { error } = await supabase.from("workspace_task_comments").delete().eq("id", commentId);
  throwIfError(error);
}

function mapFriend(row) {
  return { friendshipId: row.friendship_id, userId: row.user_id, name: row.display_name,
    avatarUrl: row.avatar_url, status: row.relation_status, direction: row.direction,
    createdAt: row.created_at };
}

export async function loadFriends() {
  const { data, error } = await supabase.rpc("list_friends");
  throwIfError(error);
  const usernames = await loadUsernameMap(data.map((row) => row.user_id));
  return data.map((row) => ({ ...mapFriend(row), username: usernames.get(row.user_id) ?? "" }));
}

export async function lookupFriend(query) {
  const { data, error } = await supabase.rpc("lookup_friend", { p_query: query.trim() });
  throwIfError(error);
  return data.map((row) => ({ userId: row.user_id, name: row.display_name, avatarUrl: row.avatar_url, username: row.username ?? "" }));
}

export async function sendFriendRequest(userId) {
  const { error } = await supabase.rpc("send_friend_request", { p_user_id: userId });
  throwIfError(error);
}

export async function respondFriendRequest(friendshipId, accept) {
  const { error } = await supabase.rpc("respond_friend_request", {
    p_friendship_id: friendshipId, p_accept: accept,
  });
  throwIfError(error);
}

export async function removeFriend(friendshipId) {
  const { error } = await supabase.from("friendships").delete().eq("id", friendshipId);
  throwIfError(error);
}

export async function deleteWorkspaceTask(workspaceId, taskId) {
  const { error } = await supabase
    .from("workspace_tasks")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", taskId);
  throwIfError(error);
}

export async function loadWorkspaceRecordHistory(workspaceId, recordType, recordId) {
  const { data, error } = await supabase.rpc("workspace_record_history_for_record", {
    p_workspace_id: workspaceId, p_record_type: recordType, p_record_id: recordId,
  });
  throwIfError(error);
  return data.map((row) => ({ id: row.id, recordType: row.record_type, recordId: row.record_id,
    actorId: row.actor_id, actorName: row.actor_name, action: row.action,
    changes: row.changes, occurredAt: row.occurred_at }));
}
