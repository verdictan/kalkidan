import { useEffect, useRef, useState } from 'react';
import type { API } from '../types';
import type {
  ProjectResourceKind,
  ProjectResourceOperation,
  ProjectResourceSnapshot,
} from '../domain/github-resources';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { errorMessage } from '../lib/errors';

const labels: Record<ProjectResourceKind, string> = {
  issueFields: 'Organization issue fields',
  fields: 'Fields',
  views: 'Saved views',
  statusUpdates: 'Status updates',
  workflows: 'GitHub workflows',
};
const suffix = {
  issueFields: 'IssueField',
  fields: 'Field',
  views: 'View',
  statusUpdates: 'StatusUpdate',
  workflows: 'Workflow',
};
type Option = { id?: string; name: string; color: string; description: string };
type Iteration = { id?: string; title: string; startDate: string; duration: number };

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
  const [kind, setKind] = useState<ProjectResourceKind>('fields');
  const [snapshot, setSnapshot] = useState<ProjectResourceSnapshot>();
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
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
  const [fields, setFields] = useState<Record<string, unknown>[]>([]);
  const [visible, setVisible] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState('');
  const [groupField, setGroupField] = useState('');
  const [columnField, setColumnField] = useState('');
  const [sortField, setSortField] = useState('');
  const [sortDirection, setSortDirection] = useState('ASC');
  const epoch = useRef(0);
  function choose(record?: Record<string, any>) {
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
        color,
        description,
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
    setConfirmation('');
    setGroupField(record?.groupByFields?.[0]?.id || '');
    setColumnField(record?.verticalGroupByFields?.[0]?.id || '');
    setSortField(record?.sortByFields?.[0]?.field?.id || '');
    setSortDirection(record?.sortByFields?.[0]?.direction || 'ASC');
  }
  useEffect(() => {
    const generation = ++epoch.current;
    setState('loading');
    setError('');
    choose();
    void Promise.all([
      api.trackerResources(groupId, kind),
      kind === 'views' ? api.trackerResources(groupId, 'fields') : Promise.resolve(undefined),
    ]).then(
      ([next, fieldList]) => {
        if (generation !== epoch.current) return;
        setSnapshot(next);
        setFields(fieldList?.records || []);
        setState('ready');
      },
      (failure) => {
        if (generation === epoch.current) {
          setError(errorMessage(failure));
          setState('error');
        }
      },
    );
    return () => {
      ++epoch.current;
    };
  }, [api, groupId, kind, reload]);
  const disabled = state !== 'ready' || !snapshot?.writable;
  async function save(remove = false) {
    if (disabled || !snapshot) return;
    let input: Record<string, unknown> = {};
    let operation =
      `${kind === 'issueFields' ? 'create' : remove ? 'delete' : selected ? 'update' : 'create'}ProjectV2${suffix[kind]}` as ProjectResourceOperation;
    if (selected)
      input[
        {
          issueFields: 'issueFieldId',
          fields: 'fieldId',
          views: 'viewId',
          statusUpdates: 'statusUpdateId',
          workflows: 'workflowId',
        }[kind]
      ] = selected;
    if (!remove) {
      if (kind === 'fields') {
        input.name = name;
        if (!selected) input.dataType = type;
        if (type === 'SINGLE_SELECT' || type === 'MULTI_SELECT')
          input[type === 'SINGLE_SELECT' ? 'singleSelectOptions' : 'multiSelectOptions'] = options;
        if (type === 'ITERATION')
          input.iterationConfiguration = {
            startDate: iterations[0]?.startDate,
            duration: iterations[0]?.duration,
            iterations,
          };
      } else if (kind === 'views') {
        input = {
          ...input,
          name,
          layout,
          ...(selected || visible.length ? { configuration: { visibleFieldIds: visible } } : {}),
        };
        if (selected) input.filter = filter;
        else {
          operation = 'createConfiguredProjectView';
          input = {
            name,
            layout,
            filter,
            visibleFieldIds: visible,
            groupFieldId: groupField || undefined,
            columnFieldId: columnField || undefined,
            sort: sortField ? [{ id: sortField, direction: sortDirection }] : [],
          };
        }
      } else if (kind === 'statusUpdates')
        input = { ...input, body, status, startDate: start || null, targetDate: target || null };
    }
    const generation = epoch.current;
    setState('saving');
    setError('');
    try {
      const next = await api.trackerResourceChange(groupId, snapshot.revision, operation, input);
      onChanged();
      if (generation === epoch.current) {
        setSnapshot(next);
        choose();
        setState('ready');
      }
    } catch (failure) {
      if (generation === epoch.current) {
        setError(errorMessage(failure));
        setState('error');
      }
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage GitHub project</DialogTitle>
          <DialogDescription>
            Fields, views, reports, and workflows are stored on GitHub.
          </DialogDescription>
        </DialogHeader>
        <label className="form-label">
          Section
          <select
            value={kind}
            disabled={state === 'saving'}
            onChange={(event) => setKind(event.target.value as ProjectResourceKind)}
          >
            {Object.entries(labels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {state === 'loading' && <p role="status">Loading…</p>}
        {error && (
          <div role="alert">
            <p>{error}</p>
            <p>Reload to check the result before another write.</p>
            <Button onClick={() => setReload((value) => value + 1)}>Reload</Button>
          </div>
        )}
        {snapshot && state !== 'loading' && (
          <>
            <label className="form-label">
              {labels[kind]}
              <select
                value={selected}
                disabled={disabled}
                onChange={(event) =>
                  choose(snapshot.records.find((record) => record.id === event.target.value))
                }
              >
                <option value="">
                  {kind === 'issueFields'
                    ? 'Choose organization issue field'
                    : kind === 'workflows'
                      ? 'Choose workflow'
                      : 'Create new'}
                </option>
                {snapshot.records.map((record) => (
                  <option key={String(record.id)} value={String(record.id)}>
                    {String(record.name || record.body || record.status || record.id).slice(0, 100)}
                  </option>
                ))}
              </select>
            </label>
            {!snapshot.writable && <p>You have read-only access.</p>}
            {(kind === 'fields' || kind === 'views') && (
              <label className="form-label">
                Name
                <Input
                  value={name}
                  disabled={disabled}
                  maxLength={256}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            )}
            {kind === 'fields' && (
              <>
                <label className="form-label">
                  Type
                  <select
                    value={type}
                    disabled={disabled || !!selected}
                    onChange={(event) => setType(event.target.value)}
                  >
                    {['TEXT', 'NUMBER', 'DATE', 'SINGLE_SELECT', 'MULTI_SELECT', 'ITERATION'].map(
                      (value) => (
                        <option key={value}>{value}</option>
                      ),
                    )}
                  </select>
                </label>
                {['SINGLE_SELECT', 'MULTI_SELECT'].includes(type) && (
                  <section aria-label="Field options" className="space-y-2">
                    {options.map((option, index) => (
                      <div key={option.id || index} className="grid gap-2">
                        <Input
                          aria-label={`Option ${index + 1} name`}
                          value={option.name}
                          disabled={disabled}
                          onChange={(event) =>
                            setOptions((values) =>
                              values.map((value, i) =>
                                i === index ? { ...value, name: event.target.value } : value,
                              ),
                            )
                          }
                        />
                        <Input
                          aria-label={`Option ${index + 1} description`}
                          value={option.description}
                          disabled={disabled}
                          onChange={(event) =>
                            setOptions((values) =>
                              values.map((value, i) =>
                                i === index ? { ...value, description: event.target.value } : value,
                              ),
                            )
                          }
                        />
                        <select
                          aria-label={`Option ${index + 1} color`}
                          value={option.color}
                          disabled={disabled}
                          onChange={(event) =>
                            setOptions((values) =>
                              values.map((value, i) =>
                                i === index ? { ...value, color: event.target.value } : value,
                              ),
                            )
                          }
                        >
                          {[
                            'GRAY',
                            'BLUE',
                            'GREEN',
                            'YELLOW',
                            'ORANGE',
                            'RED',
                            'PINK',
                            'PURPLE',
                          ].map((color) => (
                            <option key={color}>{color}</option>
                          ))}
                        </select>
                        <Button
                          variant="ghost"
                          disabled={disabled}
                          onClick={() =>
                            setOptions((values) => values.filter((_, i) => i !== index))
                          }
                        >
                          Remove option
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      disabled={disabled}
                      onClick={() =>
                        setOptions((values) => [
                          ...values,
                          { name: '', description: '', color: 'GRAY' },
                        ])
                      }
                    >
                      Add option
                    </Button>
                    <p className="help-text">
                      Removing an option clears its existing item values on GitHub.
                    </p>
                  </section>
                )}
                {type === 'ITERATION' && (
                  <section aria-label="Iterations" className="space-y-2">
                    {iterations.map((iteration, index) => (
                      <div key={iteration.id || index} className="grid gap-2">
                        <Input
                          aria-label={`Iteration ${index + 1} title`}
                          value={iteration.title}
                          disabled={disabled}
                          onChange={(event) =>
                            setIterations((values) =>
                              values.map((value, i) =>
                                i === index ? { ...value, title: event.target.value } : value,
                              ),
                            )
                          }
                        />
                        <Input
                          aria-label={`Iteration ${index + 1} start`}
                          type="date"
                          value={iteration.startDate}
                          disabled={disabled}
                          onChange={(event) =>
                            setIterations((values) =>
                              values.map((value, i) =>
                                i === index ? { ...value, startDate: event.target.value } : value,
                              ),
                            )
                          }
                        />
                        <Input
                          aria-label={`Iteration ${index + 1} days`}
                          type="number"
                          min={1}
                          value={iteration.duration}
                          disabled={disabled}
                          onChange={(event) =>
                            setIterations((values) =>
                              values.map((value, i) =>
                                i === index
                                  ? { ...value, duration: Number(event.target.value) }
                                  : value,
                              ),
                            )
                          }
                        />
                        <Button
                          variant="ghost"
                          disabled={disabled}
                          onClick={() =>
                            setIterations((values) => values.filter((_, i) => i !== index))
                          }
                        >
                          Remove iteration
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      disabled={disabled}
                      onClick={() =>
                        setIterations((values) => [
                          ...values,
                          { title: '', startDate: '', duration: 14 },
                        ])
                      }
                    >
                      Add iteration
                    </Button>
                  </section>
                )}
              </>
            )}
            {kind === 'views' && (
              <>
                <label className="form-label">
                  Layout
                  <select
                    value={layout}
                    disabled={disabled}
                    onChange={(event) => setLayout(event.target.value)}
                  >
                    <option value="TABLE_LAYOUT">Table</option>
                    <option value="BOARD_LAYOUT">Board</option>
                    <option value="ROADMAP_LAYOUT">Roadmap</option>
                  </select>
                </label>
                <label className="form-label">
                  GitHub filter
                  <Input
                    value={filter}
                    disabled={disabled}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder="is:issue is:open"
                  />
                </label>
                {[
                  { label: 'Group rows by', value: groupField, change: setGroupField },
                  { label: 'Board columns', value: columnField, change: setColumnField },
                  { label: 'Sort field', value: sortField, change: setSortField },
                ].map((control) => (
                  <label key={control.label} className="form-label">
                    {control.label}
                    <select
                      value={control.value}
                      onChange={(event) => control.change(event.target.value)}
                      disabled={
                        disabled ||
                        !!selected ||
                        (control.label === 'Board columns' && layout !== 'BOARD_LAYOUT')
                      }
                    >
                      <option value="">None</option>
                      {fields
                        .filter(
                          (field) =>
                            control.label === 'Sort field' ||
                            ![
                              'TITLE',
                              'REVIEWERS',
                              'LINKED_PULL_REQUESTS',
                              'SUB_ISSUES_PROGRESS',
                              'TRACKED_BY',
                              'TRACKS',
                            ].includes(String(field.dataType)),
                        )
                        .map((field) => (
                          <option key={String(field.id)} value={String(field.id)}>
                            {String(field.name)}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
                <label className="form-label">
                  Sort direction
                  <select
                    value={sortDirection}
                    disabled={disabled || !!selected || !sortField}
                    onChange={(event) => setSortDirection(event.target.value)}
                  >
                    <option value="ASC">Ascending</option>
                    <option value="DESC">Descending</option>
                  </select>
                </label>
                {selected && (
                  <p className="help-text">
                    GitHub exposes grouping and sorting when creating a view. To change these
                    settings on an existing view, open it in GitHub or create a new view.
                  </p>
                )}
                <fieldset disabled={disabled}>
                  <legend>Visible fields</legend>
                  {fields.map((field) => (
                    <label key={String(field.id)} className="flex gap-2">
                      <input
                        type="checkbox"
                        checked={visible.includes(String(field.id))}
                        onChange={(event) =>
                          setVisible((values) =>
                            event.target.checked
                              ? [...values, String(field.id)]
                              : values.filter((value) => value !== field.id),
                          )
                        }
                      />
                      {String(field.name)}
                    </label>
                  ))}
                </fieldset>
              </>
            )}
            {kind === 'statusUpdates' && (
              <>
                <label className="form-label">
                  Status
                  <select
                    value={status}
                    disabled={disabled}
                    onChange={(event) => setStatus(event.target.value)}
                  >
                    {['INACTIVE', 'ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'COMPLETE'].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label className="form-label">
                  Report
                  <Textarea
                    value={body}
                    disabled={disabled}
                    maxLength={20000}
                    onChange={(event) => setBody(event.target.value)}
                  />
                </label>
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
              </>
            )}
            {kind === 'workflows' ? (
              <p className="help-text">
                GitHub exposes workflow reads and removal. Configure workflow rules on GitHub.
              </p>
            ) : (
              <Button
                disabled={
                  disabled ||
                  (kind === 'issueFields' && !selected) ||
                  ((kind === 'fields' || kind === 'views') && !name.trim())
                }
                onClick={() => void save()}
              >
                {state === 'saving'
                  ? 'Saving…'
                  : kind === 'issueFields'
                    ? 'Add field to project'
                    : selected
                      ? 'Save changes'
                      : 'Create'}
              </Button>
            )}
            {selected && kind !== 'issueFields' && (
              <details>
                <summary>Remove from GitHub</summary>
                <p>Type DELETE to remove this {labels[kind].toLowerCase()} entry.</p>
                <Input
                  aria-label="Deletion confirmation"
                  value={confirmation}
                  disabled={disabled}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
                <Button
                  variant="destructive"
                  disabled={disabled || confirmation !== 'DELETE'}
                  onClick={() => void save(true)}
                >
                  Delete selected entry
                </Button>
              </details>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
