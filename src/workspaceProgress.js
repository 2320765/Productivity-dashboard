import { getGoalProgress, STATUSES } from "./dashboard.js";

function taskDueAt(task) {
  if (task.deadline) {
    const deadline = new Date(task.deadline);
    if (!Number.isNaN(deadline.getTime())) return deadline;
  }

  const dueAt = task.time
    ? new Date(`${task.date}T${task.time.slice(0, 5)}:59`)
    : new Date(`${task.date}T23:59:59.999`);
  return Number.isNaN(dueAt.getTime()) ? null : dueAt;
}

export function buildWorkspaceProgress(records, range, now = new Date()) {
  const goals = records.goals.filter((goal) =>
    !goal.archivedAt && goal.startDate <= range.end && goal.endDate >= range.start);
  const activeGoals = records.goals.filter((goal) => !goal.archivedAt);
  const uniqueTasks = [...new Map(records.tasks
    .filter((task) => task.id && !task.archivedAt)
    .map((task) => [task.id, task])).values()];
  const tasks = uniqueTasks.filter((task) => task.date >= range.start && task.date <= range.end);
  const overdueIds = new Set(tasks
    .filter((task) => task.status !== STATUSES[2])
    .filter((task) => {
      const dueAt = taskDueAt(task);
      return dueAt && dueAt < now;
    })
    .map((task) => task.id));
  const completed = tasks.filter((task) => task.status === STATUSES[2]).length;
  const overdue = overdueIds.size;
  const active = tasks.filter((task) => task.status === STATUSES[1] && !overdueIds.has(task.id)).length;
  const pending = tasks.length - completed - overdue - active;
  const assigneeNames = new Map(records.members.map((member) => [member.userId, member.name]));
  const assigneeCounts = new Map();

  for (const task of tasks) {
    const userId = task.assigneeId ?? "";
    const assignment = assigneeCounts.get(userId) ?? { userId, count: 0 };
    assignment.count += 1;
    assigneeCounts.set(userId, assignment);
  }

  const assignees = [...assigneeCounts.values()]
    .map((assignment) => ({
      ...assignment,
      name: assignment.userId ? assigneeNames.get(assignment.userId) ?? "Участник" : "Не назначен",
    }))
    .sort((first, second) => second.count - first.count || first.name.localeCompare(second.name, "ru"));
  const goalProgress = goals.map((goal) => ({
    ...goal,
    progress: getGoalProgress(goal.id, activeGoals, uniqueTasks),
  }));
  const upcoming = tasks
    .filter((task) => task.status !== STATUSES[2])
    .map((task) => ({ task, dueAt: taskDueAt(task) }))
    .filter((item) => item.dueAt && item.dueAt >= now)
    .sort((first, second) => first.dueAt - second.dueAt)
    .slice(0, 5);

  return {
    total: tasks.length,
    completed,
    active,
    overdue,
    pending,
    percent: tasks.length ? Math.round((completed / tasks.length) * 100) : 0,
    goals: goalProgress,
    assignees,
    upcoming,
  };
}
