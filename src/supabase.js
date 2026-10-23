import { createClient } from "@supabase/supabase-js";

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

export async function syncRemoteDashboard(userId, dashboard, expectedRevision) {
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
    })),
    p_expected_revision: expectedRevision,
  });

  throwIfError(error);
  return Number(data);
}
