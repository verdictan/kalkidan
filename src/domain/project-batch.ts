import type { ProjectFieldValue } from './github-mutations';
import type { TrackerItem } from './tracker';
export interface ProjectBatchChange {
  itemId: string;
  fieldId: string;
  before: ProjectFieldValue;
  value: ProjectFieldValue;
}
export interface ProjectBatchRequest {
  id: string;
  changes: ProjectBatchChange[];
}
export interface ProjectBatchResult {
  id: string;
  rows: {
    itemId: string;
    fieldId: string;
    state: 'pending' | 'writing' | 'confirmed' | 'conflict' | 'unknown-outcome';
    message?: string;
  }[];
}
export function projectFieldValue(item: TrackerItem, fieldId: string): ProjectFieldValue {
  const value = item.fieldValues?.find((value) => (value.field as { id?: string })?.id === fieldId);
  if (!value) return null;
  if (typeof value.optionId === 'string') return { singleSelectOptionId: value.optionId };
  if (Array.isArray(value.options))
    return { multiSelectOptionIds: value.options.map((option) => option.id).sort() };
  for (const key of ['text', 'number', 'date', 'iterationId'] as const)
    if (value[key] !== undefined) return { [key]: value[key] } as ProjectFieldValue;
  return null;
}
export function sameProjectValue(a: ProjectFieldValue, b: ProjectFieldValue) {
  const normalize = (value: ProjectFieldValue) =>
    value && 'multiSelectOptionIds' in value
      ? { multiSelectOptionIds: [...value.multiSelectOptionIds].sort() }
      : value;
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
export interface GitHubMutationReceipt {
  id: string;
  signature: string;
  operation: string;
  state: 'writing' | 'confirmed' | 'rejected' | 'unknown-outcome' | 'reviewed';
  updatedAt: number;
}
export type GitHubMutationHistory = Omit<GitHubMutationReceipt, 'signature'>[];
