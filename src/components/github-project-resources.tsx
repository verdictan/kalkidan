import { useEffect, useState } from 'react';
import type { API } from '../types';
import type { ProjectResourceOperation, ProjectResourceSnapshot } from '../domain/github-resources';
import { Button } from './ui/button';
import { showToast } from './ui/toast';
import { errorMessage } from '../lib/errors';

/** The date fields that the roadmap needs. */
export const roadmapDateFields = ['Start date', 'End date'];

/**
 * Finds the roadmap date fields that the GitHub project does not have, and creates them with one
 * click. The other fields of the project are changed on GitHub.
 */
export function useRoadmapDateFields(
  api: Pick<API, 'trackerResources' | 'trackerResourceChange'>,
  groupId: string,
  onChanged: () => void,
) {
  const [snapshot, setSnapshot] = useState<ProjectResourceSnapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    setError('');
    api.trackerResources(groupId, 'fields').then(
      (next) => live && setSnapshot(next),
      (failure) => live && setError(errorMessage(failure)),
    );
    return () => {
      live = false;
    };
  }, [api, groupId, reload]);
  const missing = snapshot
    ? roadmapDateFields.filter(
        (field) =>
          !snapshot.records.some(
            (record) => String(record.name).toLowerCase() === field.toLowerCase(),
          ),
      )
    : [];
  /** Creates the missing date fields one after the other. Each write uses the new revision. */
  async function create() {
    if (!snapshot || busy || !missing.length) return;
    setBusy(true);
    setError('');
    let revision = snapshot.revision;
    try {
      for (const name of missing) {
        const next = await api.trackerResourceChange(
          groupId,
          revision,
          'createProjectV2Field' as ProjectResourceOperation,
          { name, dataType: 'DATE' },
        );
        revision = next.revision;
        setSnapshot(next);
      }
      onChanged();
      showToast(`Created ${missing.join(' and ')}.`);
    } catch (failure) {
      setError(errorMessage(failure));
      setReload((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }
  return {
    loaded: !!snapshot,
    writable: !!snapshot?.writable,
    missing,
    busy,
    error,
    create,
  };
}

/** The button that creates the missing roadmap date fields. */
export function RoadmapDateButton({ state }: { state: ReturnType<typeof useRoadmapDateFields> }) {
  if (!state.loaded) return <span className="project-settings-value">Loading…</span>;
  if (!state.missing.length) return <span className="project-settings-value">Added</span>;
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={state.busy || !state.writable}
      title={state.writable ? undefined : 'Read only'}
      onClick={() => void state.create()}
    >
      {state.busy ? 'Adding…' : 'Add fields'}
    </Button>
  );
}
