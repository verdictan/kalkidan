import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { API } from '../types';
import type {
  ProjectResourceKind,
  ProjectResourceOperation,
  ProjectResourceSnapshot,
} from '../domain/github-resources';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { CheckboxRow } from './ui/checkbox';
import { SegmentedControl } from './ui/segmented-control';
import { SectionHeader } from './ui/page-header';
import { EmptyState } from './ui/empty-state';
import { Alert, AlertDescription } from './ui/alert';
import { showToast } from './ui/toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Hint } from './hint';
import { Choice } from './choice';
import {
  DangerZone,
  FooterActions,
  TypedConfirmDialog,
  UpdatedNote,
  holdDialogFocus,
  useInitialFocus,
} from './dialog-parts';
import { errorMessage } from '../lib/errors';
import { cn } from '../lib/utils';
import {
  editableFieldTypes,
  fieldTypeLabel,
  optionColor,
  optionColors,
  statusUpdateLabel,
  statusUpdateValues,
  viewLayoutLabel,
} from '../lib/github-labels';

const sections: { value: ProjectResourceKind; label: string; noun: string }[] = [
  { value: 'fields', label: 'Fields', noun: 'field' },
  { value: 'views', label: 'Saved views', noun: 'view' },
  { value: 'statusUpdates', label: 'Status updates', noun: 'status update' },
  { value: 'workflows', label: 'Workflows', noun: 'workflow' },
  { value: 'issueFields', label: 'Issue fields', noun: 'issue field' },
];
const suffix = {
  issueFields: 'IssueField',
  fields: 'Field',
  views: 'View',
  statusUpdates: 'StatusUpdate',
  workflows: 'Workflow',
};
const idKey = {
  issueFields: 'issueFieldId',
  fields: 'fieldId',
  views: 'viewId',
  statusUpdates: 'statusUpdateId',
  workflows: 'workflowId',
};
/** Fields that GitHub does not let a view group or split by. */
const ungroupable = [
  'TITLE',
  'REVIEWERS',
  'LINKED_PULL_REQUESTS',
  'SUB_ISSUES_PROGRESS',
  'TRACKED_BY',
  'TRACKS',
];
type Option = { id?: string; name: string; color: string; description: string };
type Iteration = { id?: string; title: string; startDate: string; duration: number };
type Record_ = Record<string, any>;

function recordName(kind: ProjectResourceKind, record: Record_) {
  if (kind === 'statusUpdates')
    return String(record.body || statusUpdateLabel(record.status) || 'Status update')
      .split('\n')[0]
      .slice(0, 100);
  return String(record.name || record.title || 'Untitled').slice(0, 100);
}
function recordMeta(kind: ProjectResourceKind, record: Record_) {
  if (kind === 'fields' || kind === 'issueFields') return fieldTypeLabel(record.dataType);
  if (kind === 'views') return viewLayoutLabel(record.layout);
  if (kind === 'statusUpdates')
    return [statusUpdateLabel(record.status), record.startDate, record.targetDate]
      .filter(Boolean)
      .join(' · ');
  if (kind === 'workflows' && typeof record.enabled === 'boolean')
    return record.enabled ? 'On' : 'Off';
  return '';
}

/**
 * Fields, saved views, status updates and workflows of the linked GitHub project. Each write
 * loads the list again, so the next write starts from the current state on GitHub.
 */
export function GitHubProjectResources({
  api,
  groupId,
  footer,
  onChanged,
  initialKind = 'fields',
}: {
  api: API;
  groupId: string;
  /** The dialog footer element for Cancel and the save button. */
  footer: HTMLElement | null;
  onChanged(): void;
  initialKind?: ProjectResourceKind;
}) {
  const [kind, setKind] = useState<ProjectResourceKind>(initialKind);
  const [snapshot, setSnapshot] = useState<ProjectResourceSnapshot>();
  const [state, setState] = useState<'loading' | 'ready' | 'saving'>('loading');
  const [loadError, setLoadError] = useState('');
  const [writeError, setWriteError] = useState('');
  const [reload, setReload] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<number>();
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('TEXT');
  const [layout, setLayout] = useState('TABLE_LAYOUT');
  const [filter, setFilter] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState('ON_TRACK');
  const [start, setStart] = useState('');
  const [target, setTarget] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  const [iterations, setIterations] = useState<Iteration[]>([]);
  const [fields, setFields] = useState<Record_[]>([]);
  const [visible, setVisible] = useState<string[]>([]);
  const [groupField, setGroupField] = useState('');
  const [columnField, setColumnField] = useState('');
  const [sortField, setSortField] = useState('');
  const [sortDirection, setSortDirection] = useState<'ASC' | 'DESC'>('ASC');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const epoch = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  useInitialFocus(root, state === 'ready');
  const section = sections.find((item) => item.value === kind)!;
  function choose(record?: Record_) {
    setSelected(record?.id || '');
    setName(record?.name || '');
    setType(record?.dataType || 'TEXT');
    setLayout(record?.layout || 'TABLE_LAYOUT');
    setFilter(record?.filter || '');
    setBody(record?.body || '');
    setStatus(record?.status || 'ON_TRACK');
    setStart(record?.startDate || '');
    setTarget(record?.targetDate || '');
    setOptions(
      (record?.options || []).map(({ id, name, color, description }: Option) => ({
        id,
        name,
        color: color || 'GRAY',
        description: description || '',
      })),
    );
    setIterations(
      [
        ...(record?.configuration?.completedIterations || []),
        ...(record?.configuration?.iterations || []),
      ].map(({ id, title, startDate, duration }: Iteration) => ({
        id,
        title,
        startDate,
        duration,
      })),
    );
    setVisible(record?.configuration?.visibleFieldIds || []);
    setGroupField(record?.groupByFields?.[0]?.id || '');
    setColumnField(record?.verticalGroupByFields?.[0]?.id || '');
    setSortField(record?.sortByFields?.[0]?.field?.id || '');
    setSortDirection(record?.sortByFields?.[0]?.direction === 'DESC' ? 'DESC' : 'ASC');
  }
  useEffect(() => {
    const generation = ++epoch.current;
    setState('loading');
    setLoadError('');
    void Promise.all([
      api.trackerResources(groupId, kind),
      kind === 'views' ? api.trackerResources(groupId, 'fields') : Promise.resolve(undefined),
    ]).then(
      ([next, fieldList]) => {
        if (generation !== epoch.current) return;
        setSnapshot(next);
        setFields(fieldList?.records || []);
        // Keep the open record when it still exists. Its values come from GitHub again.
        const current = next.records.find((record) => record.id === selected);
        choose(current as Record_ | undefined);
        setState('ready');
      },
      (failure) => {
        if (generation !== epoch.current) return;
        setLoadError(errorMessage(failure));
        setState('ready');
      },
    );
    return () => {
      ++epoch.current;
    };
  }, [api, groupId, kind, reload]);
  const loaded = !!snapshot && snapshot.kind === kind && !loadError;
  const disabled = state !== 'ready' || !loaded || !snapshot?.writable;
  const selectedRecord = snapshot?.records.find((record) => record.id === selected) as
    Record_ | undefined;
  async function save(remove = false) {
    if (disabled || !snapshot) return;
    let input: Record<string, unknown> = {};
    let operation =
      `${kind === 'issueFields' ? 'create' : remove ? 'delete' : selected ? 'update' : 'create'}ProjectV2${suffix[kind]}` as ProjectResourceOperation;
    if (selected) input[idKey[kind]] = selected;
    if (!remove) {
      if (kind === 'fields') {
        input.name = name.trim();
        if (!selected) input.dataType = type;
        if (type === 'SINGLE_SELECT' || type === 'MULTI_SELECT')
          input[type === 'SINGLE_SELECT' ? 'singleSelectOptions' : 'multiSelectOptions'] =
            options.filter((option) => option.name.trim());
        if (type === 'ITERATION')
          input.iterationConfiguration = {
            startDate: iterations[0]?.startDate,
            duration: iterations[0]?.duration,
            iterations,
          };
      } else if (kind === 'views') {
        input = {
          ...input,
          name: name.trim(),
          layout,
          ...(selected || visible.length ? { configuration: { visibleFieldIds: visible } } : {}),
        };
        if (selected) input.filter = filter;
        else {
          operation = 'createConfiguredProjectView';
          input = {
            name: name.trim(),
            layout,
            filter,
            visibleFieldIds: visible,
            groupFieldId: groupField || undefined,
            columnFieldId: (layout === 'BOARD_LAYOUT' && columnField) || undefined,
            sort: sortField ? [{ id: sortField, direction: sortDirection }] : [],
          };
        }
      } else if (kind === 'statusUpdates')
        input = { ...input, body, status, startDate: start || null, targetDate: target || null };
    }
    const label = remove
      ? `Deleted the ${section.noun}.`
      : kind === 'issueFields'
        ? 'Added the issue field to the project.'
        : selected
          ? 'Saved the changes.'
          : `Created the ${section.noun}.`;
    const generation = epoch.current;
    setState('saving');
    setWriteError('');
    try {
      const next = await api.trackerResourceChange(groupId, snapshot.revision, operation, input);
      onChanged();
      if (generation !== epoch.current) return;
      setSnapshot(next);
      setConfirmDelete(false);
      if (remove || !selected) choose();
      setUpdatedAt(Date.now());
      showToast(label);
      setState('ready');
      // Load the list again so that new records show with their GitHub values.
      setReload((value) => value + 1);
    } catch (failure) {
      if (generation !== epoch.current) return;
      setConfirmDelete(false);
      setWriteError(
        `${errorMessage(failure).replace(/\.?$/, '.')} Kalkidan loaded the list again. ` +
          'Check it before you try again.',
      );
      setState('ready');
      setReload((value) => value + 1);
    }
  }
  const updateOption = (index: number, patch: Partial<Option>) =>
    setOptions((values) =>
      values.map((value, i) => (i === index ? { ...value, ...patch } : value)),
    );
  const updateIteration = (index: number, patch: Partial<Iteration>) =>
    setIterations((values) =>
      values.map((value, i) => (i === index ? { ...value, ...patch } : value)),
    );
  const canCreate = kind === 'fields' || kind === 'views' || kind === 'statusUpdates';
  const editing = !!selected || canCreate;
  const primaryLabel =
    state === 'saving'
      ? 'Saving…'
      : kind === 'issueFields'
        ? 'Add to project'
        : selected
          ? 'Save changes'
          : `Create ${section.noun}`;
  const primaryDisabled =
    disabled ||
    (kind === 'issueFields' && !selected) ||
    ((kind === 'fields' || kind === 'views') && !name.trim());
  const groupChoices = (all: boolean) => [
    { value: '', label: 'None' },
    ...fields
      .filter((field) => all || !ungroupable.includes(String(field.dataType)))
      .map((field) => ({ value: String(field.id), label: String(field.name) })),
  ];
  return (
    <div ref={root} className="grid gap-4" aria-busy={state !== 'ready'}>
      <SegmentedControl
        size="sm"
        label="Section"
        className="justify-self-start"
        value={kind}
        onChange={(value) => {
          setKind(value);
          setSelected('');
          setWriteError('');
          setSnapshot(undefined);
        }}
        options={sections.map((item) => ({
          value: item.value,
          label: item.label,
          disabled: state === 'saving',
        }))}
      />
      {loadError && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>
            {loadError}
            <Button variant="outline" size="sm" onClick={() => setReload((value) => value + 1)}>
              Load again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {writeError && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>{writeError}</AlertDescription>
        </Alert>
      )}
      {loaded && !snapshot.writable && (
        <Alert size="sm">
          <AlertDescription>You have read-only access to this project.</AlertDescription>
        </Alert>
      )}
      {!loaded && !loadError ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading {section.label.toLowerCase()}…
        </p>
      ) : loaded ? (
        <>
          <div
            className="list-box"
            role="group"
            aria-label={section.label}
            data-testid="resource-list"
          >
            {canCreate && (
              <button
                type="button"
                className="list-box-row text-sm"
                aria-pressed={!selected}
                disabled={state === 'saving'}
                onClick={() => choose()}
              >
                <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                New {section.noun}
              </button>
            )}
            {snapshot.records.map((record) => (
              <button
                type="button"
                key={String(record.id)}
                className="list-box-row text-sm"
                aria-pressed={selected === record.id}
                disabled={state === 'saving'}
                onClick={() => choose(record as Record_)}
              >
                <span className="min-w-0 flex-1 truncate">
                  {recordName(kind, record as Record_)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {recordMeta(kind, record as Record_)}
                </span>
              </button>
            ))}
            {!snapshot.records.length && !canCreate && (
              <EmptyState compact>
                {kind === 'workflows'
                  ? 'This project has no workflows.'
                  : 'The organization has no issue fields to add.'}
              </EmptyState>
            )}
          </div>
          {kind === 'workflows' && (
            <p className="form-help m-0">
              Kalkidan can show and delete workflows. To change the rules of a workflow, open the
              project on GitHub.
            </p>
          )}
          {kind === 'issueFields' && (
            <p className="form-help m-0">
              Choose an issue field of the organization, then add it to this project.
            </p>
          )}
          {editing && kind !== 'workflows' && kind !== 'issueFields' && (
            <section aria-label={selected ? 'Edit' : `New ${section.noun}`} className="grid gap-4">
              <SectionHeader
                size="sm"
                className="mb-0"
                title={selected ? recordName(kind, selectedRecord || {}) : `New ${section.noun}`}
              />
              {(kind === 'fields' || kind === 'views') && (
                <div className={cn('grid gap-3', kind === 'fields' && 'sm:grid-cols-2')}>
                  <label className="form-label">
                    Name
                    <Input
                      value={name}
                      disabled={disabled}
                      maxLength={256}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                  {kind === 'fields' && (
                    <label className="form-label">
                      Type
                      <Choice
                        className="w-full"
                        label="Field type"
                        value={type}
                        disabled={disabled || !!selected}
                        onChange={setType}
                        options={(selected && !editableFieldTypes.includes(type as never)
                          ? [type, ...editableFieldTypes]
                          : editableFieldTypes
                        ).map((value) => ({ value, label: fieldTypeLabel(value) }))}
                      />
                    </label>
                  )}
                </div>
              )}
              {kind === 'fields' && ['SINGLE_SELECT', 'MULTI_SELECT'].includes(type) && (
                <section aria-label="Field options" className="grid gap-2">
                  <SectionHeader
                    size="sm"
                    as="h4"
                    className="mb-0"
                    title="Options"
                    count={options.length}
                    actions={
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        onClick={() =>
                          setOptions((values) => [
                            ...values,
                            { name: '', description: '', color: 'GRAY' },
                          ])
                        }
                      >
                        <Plus />
                        Add option
                      </Button>
                    }
                  />
                  {options.length ? (
                    <ul className="m-0 grid list-none gap-2 p-0">
                      {options.map((option, index) => (
                        <li
                          key={option.id || `new-${index}`}
                          className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-2"
                        >
                          <ColorMenu
                            label={`Option ${index + 1} color`}
                            value={option.color}
                            disabled={disabled}
                            onChange={(color) => updateOption(index, { color })}
                          />
                          <Input
                            aria-label={`Option ${index + 1} name`}
                            placeholder="Name"
                            value={option.name}
                            disabled={disabled}
                            onChange={(event) => updateOption(index, { name: event.target.value })}
                          />
                          <Input
                            aria-label={`Option ${index + 1} description`}
                            placeholder="Description"
                            value={option.description}
                            disabled={disabled}
                            onChange={(event) =>
                              updateOption(index, { description: event.target.value })
                            }
                          />
                          <Hint label="Remove option">
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Remove option ${index + 1}`}
                              disabled={disabled}
                              onClick={() =>
                                setOptions((values) => values.filter((_, i) => i !== index))
                              }
                            >
                              <Trash2 />
                            </Button>
                          </Hint>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState compact>No options yet.</EmptyState>
                  )}
                  {!!selected && (
                    <p className="form-help m-0">
                      When you remove an option, GitHub clears it from the items that have it.
                    </p>
                  )}
                </section>
              )}
              {kind === 'fields' && type === 'ITERATION' && (
                <section aria-label="Iterations" className="grid gap-2">
                  <SectionHeader
                    size="sm"
                    as="h4"
                    className="mb-0"
                    title="Iterations"
                    count={iterations.length}
                    actions={
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        onClick={() =>
                          setIterations((values) => [
                            ...values,
                            { title: '', startDate: '', duration: 14 },
                          ])
                        }
                      >
                        <Plus />
                        Add iteration
                      </Button>
                    }
                  />
                  {iterations.length ? (
                    <ul className="m-0 grid list-none gap-2 p-0">
                      {iterations.map((iteration, index) => (
                        <li
                          key={iteration.id || `new-${index}`}
                          className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_5rem_auto] items-center gap-2"
                        >
                          <Input
                            aria-label={`Iteration ${index + 1} title`}
                            placeholder="Title"
                            value={iteration.title}
                            disabled={disabled}
                            onChange={(event) =>
                              updateIteration(index, { title: event.target.value })
                            }
                          />
                          <Input
                            aria-label={`Iteration ${index + 1} start`}
                            type="date"
                            value={iteration.startDate}
                            disabled={disabled}
                            onChange={(event) =>
                              updateIteration(index, { startDate: event.target.value })
                            }
                          />
                          <Input
                            aria-label={`Iteration ${index + 1} days`}
                            type="number"
                            min={1}
                            value={iteration.duration}
                            disabled={disabled}
                            onChange={(event) =>
                              updateIteration(index, { duration: Number(event.target.value) })
                            }
                          />
                          <Hint label="Remove iteration">
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Remove iteration ${index + 1}`}
                              disabled={disabled}
                              onClick={() =>
                                setIterations((values) => values.filter((_, i) => i !== index))
                              }
                            >
                              <Trash2 />
                            </Button>
                          </Hint>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState compact>No iterations yet.</EmptyState>
                  )}
                </section>
              )}
              {kind === 'views' && (
                <>
                  <div className="form-label">
                    <span>Layout</span>
                    <SegmentedControl
                      size="sm"
                      label="Layout"
                      className="justify-self-start"
                      value={layout}
                      onChange={setLayout}
                      options={['TABLE_LAYOUT', 'BOARD_LAYOUT', 'ROADMAP_LAYOUT'].map((value) => ({
                        value,
                        label: viewLayoutLabel(value),
                        disabled,
                      }))}
                    />
                  </div>
                  <label className="form-label">
                    Filter
                    <Input
                      value={filter}
                      disabled={disabled}
                      onChange={(event) => setFilter(event.target.value)}
                      placeholder="is:issue is:open"
                    />
                    <span className="form-help">Uses the GitHub filter words.</span>
                  </label>
                  {selected ? (
                    <p className="form-help m-0">
                      GitHub sets grouping and sorting only when it creates a view. To change them,
                      open the view on GitHub or create a new view.
                    </p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="form-label">
                        Group rows by
                        <Choice
                          className="w-full"
                          label="Group rows by"
                          value={groupField}
                          disabled={disabled}
                          onChange={setGroupField}
                          options={groupChoices(false)}
                        />
                      </label>
                      {layout === 'BOARD_LAYOUT' && (
                        <label className="form-label">
                          Board columns
                          <Choice
                            className="w-full"
                            label="Board columns"
                            value={columnField}
                            disabled={disabled}
                            onChange={setColumnField}
                            options={groupChoices(false)}
                          />
                        </label>
                      )}
                      <label className="form-label">
                        Sort by
                        <Choice
                          className="w-full"
                          label="Sort field"
                          value={sortField}
                          disabled={disabled}
                          onChange={setSortField}
                          options={groupChoices(true)}
                        />
                      </label>
                      {sortField && (
                        <div className="form-label">
                          <span>Sort order</span>
                          <SegmentedControl
                            size="sm"
                            label="Sort order"
                            className="justify-self-start"
                            value={sortDirection}
                            onChange={setSortDirection}
                            options={[
                              { value: 'ASC', label: 'Ascending', disabled },
                              { value: 'DESC', label: 'Descending', disabled },
                            ]}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {!!fields.length && (
                    <section aria-label="Visible fields" className="grid gap-2">
                      <SectionHeader
                        size="sm"
                        as="h4"
                        className="mb-0"
                        title="Visible fields"
                        count={visible.length}
                      />
                      <div className="list-box max-h-56 grid-cols-2">
                        {fields.map((field) => (
                          <CheckboxRow
                            key={String(field.id)}
                            className="list-box-row items-center"
                            label={<span className="truncate">{String(field.name)}</span>}
                            checked={visible.includes(String(field.id))}
                            disabled={disabled}
                            onChange={(event) =>
                              setVisible((values) =>
                                event.target.checked
                                  ? [...values, String(field.id)]
                                  : values.filter((value) => value !== String(field.id)),
                              )
                            }
                          />
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
              {kind === 'statusUpdates' && (
                <>
                  <label className="form-label">
                    Status
                    <Choice
                      className="w-full"
                      label="Status"
                      value={status}
                      disabled={disabled}
                      onChange={setStatus}
                      options={statusUpdateValues.map((value) => ({
                        value,
                        label: statusUpdateLabel(value),
                      }))}
                    />
                  </label>
                  <label className="form-label">
                    Report
                    <Textarea
                      value={body}
                      rows={4}
                      disabled={disabled}
                      maxLength={20000}
                      onChange={(event) => setBody(event.target.value)}
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="form-label">
                      Start date
                      <Input
                        type="date"
                        value={start}
                        disabled={disabled}
                        onChange={(event) => setStart(event.target.value)}
                      />
                    </label>
                    <label className="form-label">
                      Target date
                      <Input
                        type="date"
                        value={target}
                        disabled={disabled}
                        onChange={(event) => setTarget(event.target.value)}
                      />
                    </label>
                  </div>
                </>
              )}
            </section>
          )}
          {selected && kind !== 'issueFields' && (
            <DangerZone
              title={`Delete ${section.noun}`}
              description={
                kind === 'fields'
                  ? 'GitHub removes the field and its values from all items.'
                  : `GitHub removes this ${section.noun} from the project.`
              }
              action={
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  disabled={disabled}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete {section.noun}…
                </Button>
              }
            />
          )}
        </>
      ) : null}
      <TypedConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete this ${section.noun}?`}
        description="You cannot undo this on GitHub."
        confirmText={selectedRecord ? recordName(kind, selectedRecord) : 'DELETE'}
        actionLabel={`Delete ${section.noun}`}
        busy={state === 'saving'}
        onConfirm={() => void save(true)}
      />
      {kind !== 'workflows' && (
        <FooterActions target={footer}>
          <UpdatedNote at={updatedAt} />
          <DialogClose asChild>
            <Button variant="outline" disabled={state === 'saving'}>
              Cancel
            </Button>
          </DialogClose>
          <Button data-primary disabled={primaryDisabled} onClick={() => void save()}>
            {primaryLabel}
          </Button>
        </FooterActions>
      )}
      {kind === 'workflows' && updatedAt && (
        <FooterActions target={footer}>
          <UpdatedNote at={updatedAt} />
        </FooterActions>
      )}
    </div>
  );
}

/** A color swatch button that opens the list of option colors. */
function ColorMenu({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange(value: string): void;
}) {
  const color = optionColor(value);
  return (
    <DropdownMenu>
      <Hint label={`Color: ${color.label}`}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label={`${label}: ${color.label}`}
            disabled={disabled}
          >
            <span
              aria-hidden="true"
              className="size-3 rounded-full"
              style={{ backgroundColor: color.swatch }}
            />
          </Button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={color.value} onValueChange={onChange}>
          {optionColors.map((choice) => (
            <DropdownMenuRadioItem key={choice.value} value={choice.value}>
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: choice.swatch }}
              />
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function GitHubProjectResourcesDialog({
  api,
  groupId,
  onClose,
  onChanged,
}: {
  api: API;
  groupId: string;
  onClose(): void;
  onChanged(): void;
}) {
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="lg" layout="scroll" onOpenAutoFocus={holdDialogFocus}>
        <DialogHeader>
          <DialogTitle>Fields, views and reports</DialogTitle>
          <DialogDescription>
            GitHub keeps these on the project. Each change applies on GitHub at once.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <GitHubProjectResources
            api={api}
            groupId={groupId}
            footer={footer}
            onChanged={onChanged}
          />
        </DialogBody>
        <DialogFooter ref={setFooter} className="empty:hidden" />
      </DialogContent>
    </Dialog>
  );
}
