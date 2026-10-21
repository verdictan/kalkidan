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
        reason: 'The task is not on the board now.',
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
    if (item.kind !== 'Issue')
      reason = 'Only issues can be planned. Kalkidan cannot check other items for blockers.';
    else if (!item.repository || !input.repositories.includes(item.repository.toLowerCase()))
      reason = 'The task is not in the selected repository.';
    else if (!item.body.trim()) reason = 'Add a description and acceptance criteria.';
    else if (input.activeItemIds.includes(id))
      reason = 'A chat is linked to this task. Check that work first.';
    else if (!relation || 'error' in relation)
      reason = 'Kalkidan could not read the blockers. Try again.';
    else if (relation.blockedBy.some((issue) => issue.state !== 'CLOSED'))
      reason = 'Other issues block this task. Close them first.';
    else if (projectFieldValue(item, field.id) !== null)
      reason = 'The task is already in an iteration.';
    else if (estimate === undefined)
      reason = 'Set a positive estimate. Kalkidan does not use zero for a missing estimate.';
    else if (result.used + estimate > input.capacity)
      reason = 'The remaining capacity is too small.';
    if (reason) result.rows.push({ itemId: id, title: item.title, estimate, reason });
    else {
      result.used += estimate!;
      result.rows.push({
        itemId: id,
        title: item.title,
        estimate,
        reason: 'Fits the capacity. No open issues block it.',
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
