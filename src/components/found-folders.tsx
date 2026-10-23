import { useEffect, useState } from 'react';
import type { API, FoundCodeFolder } from '../api/contracts';
import { autoIdentityColor, getIdentityOverrides, type IdentityColor } from '../domain/identity';
import { plural } from '../lib/platform';
import { IdentityMark } from './ui/identity-mark';

/**
 * The code folders that Kalkidan found in the usual places of the home folder. Empty in a
 * build without the scan, or while the scan runs.
 */
export function useFoundCodeFolders(api: API) {
  const [folders, setFolders] = useState<FoundCodeFolder[]>([]);
  useEffect(() => {
    let live = true;
    if (typeof api.findCodeFolders !== 'function') return;
    void Promise.resolve()
      .then(() => api.findCodeFolders!())
      .then(
        (found) => live && setFolders(Array.isArray(found) ? found : []),
        () => live && setFolders([]),
      );
    return () => {
      live = false;
    };
  }, [api]);
  return folders;
}

/**
 * The project color that a found folder gets: a color that the user chose for that name, else
 * the automatic color, different from the chips before it.
 */
function folderColors(folders: FoundCodeFolder[]) {
  const chosen = Object.entries(getIdentityOverrides('project'));
  const used: IdentityColor[] = [];
  return folders.map((folder) => {
    const name = folder.name.toLowerCase();
    const override = chosen.find(([key]) => key.toLowerCase() === name);
    const color = override?.[1] ?? autoIdentityColor(folder.name, used);
    used.push(color);
    return color;
  });
}

/**
 * The found folders as chips under the first composer (ST-C2): the project mark, the name and,
 * for a folder of repos, "3 repos". A click chooses the folder for the new chat, the same as
 * "Choose a folder". Nothing shows when Kalkidan found no folder.
 */
export function FoundFolderChips({
  api,
  chosen,
  disabled,
  onChoose,
}: {
  api: API;
  /** The path of the chosen folder. Its chip is pressed. */
  chosen?: string;
  disabled?: boolean;
  onChoose: (path: string) => void;
}) {
  const folders = useFoundCodeFolders(api);
  if (!folders.length) return null;
  const colors = folderColors(folders);
  return (
    <ul className="found-folders" aria-label="Code folders on this computer">
      {folders.map((folder, index) => (
        <li key={folder.path}>
          <button
            type="button"
            className="found-folder"
            title={folder.path}
            disabled={disabled}
            aria-pressed={chosen === folder.path}
            onClick={() => onChoose(folder.path)}
          >
            <IdentityMark kind="project" color={colors[index]} slot={false} />
            <span className="found-folder-name">{folder.name}</span>
            {folder.repos > 1 && (
              <span className="found-folder-count">{plural(folder.repos, 'repo')}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
