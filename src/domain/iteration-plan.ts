import type { TrackerBoard } from './tracker';
import type { IssueRelations } from './github-relations';
import { projectFieldValue, type ProjectBatchChange } from './project-batch';
export interface IterationPlanInput {
  itemIds: string[];
  estimateFieldId: string;
  priorityFieldId?: string;
  iterationFieldId: string;
  iterationId: string;
  capacity: number;
  relations: Record<string, IssueRelations | { error: string }>;
  activeItemIds: string[];
  repositories: string[];
}
export interface IterationPlan {
  used: number;
  capacity: number;
  rows: {
    itemId: string;
    title: string;
    estimate?: number;
    reason: string;
    change?: ProjectBatchChange;
  }[];
}
/** First-fit in explicit project priority order. Unknown estimates and blockers are never guessed. */
export function planIteration(board: TrackerBoard, input: IterationPlanInput): IterationPlan {
  const field = board.fields?.find(
    (field) => field.id === input.iterationFieldId && field.dataType === 'ITERATION',
  );
  if (!field?.iterations?.some((iteration) => iteration.id === input.iterationId))
    throw new Error('Choose an iteration from this project.');
  if (
    !board.fields?.some(
      (field) => field.id === input.estimateFieldId && field.dataType === 'NUMBER',
    )
  )
    throw new Error('Choose a numeric estimate field.');
  if (!Number.isFinite(input.capacity) || input.capacity <= 0 || input.capacity > 1000000)
    throw new Error('Enter capacity greater than zero and at most 1,000,000.');
  if (
    !input.itemIds.length ||
    input.itemIds.length > 50 ||
    new Set(input.itemIds).size !== input.itemIds.length
  )
    throw new Error('Select between 1 and 50 distinct tasks.');
  const priority = board.fields?.find((field) => field.id === input.priorityFieldId);
  if (input.priorityFieldId && priority?.dataType !== 'SINGLE_SELECT')
    throw new Error('Choose a single-select priority field.');
  const rank = (id: string) => {
    const item = board.items.find((item) => item.id === id);
    const value = item && priority ? projectFieldValue(item, priority.id) : null;
    const index =
      value && 'singleSelectOptionId' in value
        ? priority?.options?.findIndex((option) => option.id === value.singleSelectOptionId)
        : -1;
    return index === undefined || index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const result: IterationPlan = { used: 0, capacity: input.capacity, rows: [] };
  for (const id of [...input.itemIds].sort((a, b) => rank(a) - rank(b))) {
    const item = board.items.find((item) => item.id === id);
    if (!item) {
      result.rows.push({
        itemId: id,
        title: id,
        reason: 'Task is no longer active in this project.',
      });
      continue;
    }
    const relation = input.relations[id],
      value = projectFieldValue(item, input.estimateFieldId);
    const estimate =
      value && 'number' in value && Number.isFinite(value.number) && value.number > 0
        ? value.number
        : undefined;
    let reason = '';
    if (item.kind !== 'Issue') reason = 'Select a repository issue to verify dependencies.';
    else if (!item.repository || !input.repositories.includes(item.repository.toLowerCase()))
      reason = 'Repository is outside the selected planning scope.';
    else if (!item.body.trim()) reason = 'Add a description and acceptance criteria.';
    else if (input.activeItemIds.includes(id))
      reason = 'A linked session already exists. Review overlapping work.';
    else if (!relation || 'error' in relation)
      reason = 'Dependency access is incomplete. Refresh before planning.';
    else if (relation.blockedBy.some((issue) => issue.state !== 'CLOSED'))
      reason = 'An open or unknown blocker must be resolved first.';
    else if (projectFieldValue(item, field.id) !== null)
      reason = 'This task already has an iteration. Review it separately.';
    else if (estimate === undefined)
      reason = 'Set a positive estimate. Missing estimates are not treated as zero.';
    else if (result.used + estimate > input.capacity) reason = 'Remaining capacity is too small.';
    if (reason) result.rows.push({ itemId: id, title: item.title, estimate, reason });
    else {
      result.used += estimate!;
      result.rows.push({
        itemId: id,
        title: item.title,
        estimate,
        reason: 'Fits capacity; no open blockers in the verified snapshot.',
        change: {
          itemId: id,
          fieldId: field.id,
          before: null,
          value: { iterationId: input.iterationId },
        },
      });
    }
  }
  return result;
}
