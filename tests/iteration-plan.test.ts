import test from 'node:test';
import assert from 'node:assert/strict';
import { planIteration, type IterationPlanInput } from '../src/domain/iteration-plan';
import type { TrackerBoard } from '../src/domain/tracker';
const board: TrackerBoard = {
  project: { id: 'P', title: 'P', url: '' },
  fields: [
    { id: 'E', name: 'Estimate', dataType: 'NUMBER', raw: {} },
    {
      id: 'S',
      name: 'Sprint',
      dataType: 'ITERATION',
      iterations: [{ id: 'sprint', title: 'Next', startDate: '2026-10-21', duration: 14 }],
      raw: {},
    },
    {
      id: 'Priority',
      name: 'Priority',
      dataType: 'SINGLE_SELECT',
      options: [
        { id: 'high', name: 'High' },
        { id: 'low', name: 'Low' },
      ],
      raw: {},
    },
  ],
  items: ['A', 'B', 'C'].map((id, index) => ({
    id,
    title: id,
    body: 'Acceptance criteria',
    kind: 'Issue',
    repository: 'org/repo',
    fieldValues: [
      { field: { id: 'E' }, number: index === 2 ? undefined : 3 },
      { field: { id: 'Priority' }, optionId: id === 'B' ? 'high' : 'low' },
    ],
  })),
};
const input: IterationPlanInput = {
  itemIds: ['A', 'B', 'C'],
  estimateFieldId: 'E',
  priorityFieldId: 'Priority',
  iterationFieldId: 'S',
  iterationId: 'sprint',
  capacity: 5,
  activeItemIds: [],
  repositories: ['org/repo'],
  relations: Object.fromEntries(
    ['A', 'B', 'C'].map((id) => [
      id,
      {
        issueId: id,
        revision: '1',
        writable: true,
        parent: null,
        subIssues: [],
        blocking: [],
        blockedBy: [],
      },
    ]),
  ),
};
test('iteration allocation honors explicit priority and capacity, retaining missing estimates', () => {
  const result = planIteration(board, input);
  assert.equal(result.used, 3);
  assert.equal(result.rows[0].itemId, 'B');
  assert.deepEqual(result.rows[0].change?.value, { iterationId: 'sprint' });
  assert.match(result.rows.find((row) => row.itemId === 'A')!.reason, /capacity/);
  assert.match(result.rows.find((row) => row.itemId === 'C')!.reason, /positive estimate/);
  assert.equal(board.items[0].fieldValues?.length, 2);
});
test('iteration planning fails closed for blockers, missing access, overlapping sessions and unknown fields', () => {
  const next = structuredClone(input);
  next.relations.A = { error: 'Denied' };
  (next.relations.B as any).blockedBy = [
    { id: 'external', title: 'Dependency', url: '', state: 'OPEN' },
  ];
  next.activeItemIds = ['C'];
  assert.equal(planIteration(board, next).rows.filter((row) => row.change).length, 0);
  assert.throws(
    () => planIteration(board, { ...input, iterationId: 'removed' }),
    /Choose an iteration/,
  );
  assert.throws(() => planIteration(board, { ...input, capacity: NaN }), /capacity/);
});
