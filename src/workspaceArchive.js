export function filterWorkspaceArchive(records, comments, filters) {
  const search = filters.search.trim().toLocaleLowerCase("ru");

  return records
    .filter((record) => {
      const recordComments = record.recordType === "task"
        ? comments.filter((comment) => comment.taskId === record.id)
        : [];
      const searchText = `${record.title} ${record.notes} ${recordComments.map((comment) => comment.body).join(" ")}`
        .toLocaleLowerCase("ru");
      const recordStatus = record.recordType === "task" ? record.status : "Цель";
      const archivedDate = record.archivedAt.slice(0, 10);
      const participantIds = [
        record.createdBy,
        record.archivedBy,
        record.assigneeId,
        ...recordComments.map((comment) => comment.authorId),
      ].filter(Boolean);

      return (!search || searchText.includes(search))
        && (!filters.status || recordStatus === filters.status)
        && (!filters.participant || participantIds.includes(filters.participant))
        && (!filters.from || archivedDate >= filters.from)
        && (!filters.to || archivedDate <= filters.to);
    })
    .sort((first, second) => second.archivedAt.localeCompare(first.archivedAt));
}
