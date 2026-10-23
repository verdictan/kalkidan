import { forkChat } from './chat-links';
import { useState } from 'react';
import {
  chatActionMenu,
  sessionActionState,
  type ChatActionState,
  type ChatActionTarget,
  type ChatMenuGroup,
  type ChatMenuItem,
} from '../domain/chat-actions';
import type { API, Session, SessionOrganization } from '../types';
import { errorMessage } from '../lib/errors';
import { platform } from '../lib/platform';
import { showToast } from './ui/toast';
import { NotesDialog, RenameSessionDialog, archiveSessionWithUndo } from './session-actions';
import { ManagedHistoryView } from './managed-history';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

export interface ChatListActionOptions {
  api?: API;
  onResume: (session: Session) => void;
  /**
   * Opens the chat, then sends a session command to it. Actions that need the chat view use it,
   * for example Commit changes and Link task.
   */
  onSessionCommand?: (command: string, session: Session) => void;
  /** Saves organization changes. Without it, the menu saves them with `api.updateSession`. */
  update?: (session: Session, changes: SessionOrganization) => Promise<void>;
  /** Reads the chats again after a change. */
  onChanged?: () => void;
  /** Opens the archived chats of a chat. The archive toast shows View archived with it. */
  onViewArchived?: (session: Session) => void;
  /** Opens the linked task without the chat view. */
  onOpenTask?: (session: Session) => void;
  /** What the list knows about a chat, in addition to the chat record. */
  stateOf?: (session: Session) => Partial<ChatActionState>;
}

/**
 * The chat actions of chat rows: the sidebar rows and the All chats rows. The menu and the
 * context menu of a row show the same actions as the chat header. Actions that need the chat
 * view open the chat first.
 */
export function useChatListActions(options: ChatListActionOptions) {
  const { api, onResume, onSessionCommand, onChanged } = options;
  const [renaming, setRenaming] = useState<Session | null>(null);
  const [notes, setNotes] = useState<Session | null>(null);
  const [history, setHistory] = useState<Session | null>(null);
  async function appAPI() {
    return api || window.workspace || (await import('../demo')).demo;
  }
  async function save(session: Session, changes: SessionOrganization) {
    if (options.update) await options.update(session, changes);
    else await (await appAPI()).updateSession(session.agent, session.id, changes);
  }
  function command(name: string, session: Session) {
    if (onSessionCommand) onSessionCommand(name, session);
    else {
      onResume(session);
      setTimeout(
        () =>
          window.dispatchEvent(
            new CustomEvent('kalkidan-session-command', { detail: { command: name } }),
          ),
        250,
      );
    }
  }
  function sessionAction(session: Session, kind: Parameters<API['sessionAction']>[1]) {
    void appAPI()
      .then((value) => value.sessionAction(session, kind))
      .then((result) => {
        if (typeof result === 'string' && result) showToast(result);
      })
      .catch((e) =>
        showToast({ message: 'Could not complete the action: ' + errorMessage(e), tone: 'error' }),
      );
  }
  function failed(e: unknown) {
    showToast({ message: 'Could not save the chat: ' + errorMessage(e), tone: 'error' });
  }
  function target(session: Session): ChatActionTarget {
    const send: ChatActionTarget = { command: (name) => command(name, session) };
    // The agent has not created a draft chat yet. Only the open chat view can change it.
    if (session.id.startsWith('draft-')) return { ...send, open: () => onResume(session) };
    const organization = session.organization || {};
    return {
      ...send,
      open: () => onResume(session),
      'open-window': () => sessionAction(session, 'window'),
      rename: () => setRenaming(session),
      pin: () =>
        void save(session, { pinned: !organization.pinned })
          .then(() => {
            onChanged?.();
            showToast(
              organization.pinned
                ? 'Chat unpinned.'
                : 'Chat pinned. It shows at the top of the sidebar.',
            );
          })
          .catch(failed),
      notes: () => setNotes(session),
      fork: () => forkChat(session),
      ...(options.onOpenTask ? { 'open-linked-task': () => options.onOpenTask!(session) } : {}),
      ...(organization.pullRequest?.url
        ? {
            'open-pull-request': () =>
              void window.open(organization.pullRequest!.url, '_blank', 'noreferrer'),
          }
        : {}),
      'show-folder': () => sessionAction(session, 'finder'),
      'export-markdown': () => sessionAction(session, 'markdown'),
      'export-html': () => sessionAction(session, 'html'),
      'copy-markdown': () => sessionAction(session, 'copy-transcript'),
      'usage-history': () => setHistory(session),
      'copy-id': () => sessionAction(session, 'copy-id'),
      'copy-path': () => sessionAction(session, 'copy-path'),
      'open-vscode': () => sessionAction(session, 'vscode'),
      'open-cursor': () => sessionAction(session, 'cursor'),
      archive: () => {
        if (organization.archived)
          void save(session, { archived: false })
            .then(() => {
              onChanged?.();
              showToast('Chat restored');
            })
            .catch(failed);
        else
          void archiveSessionWithUndo(session, {
            save: (changes) => save(session, changes),
            onChange: onChanged,
            onViewArchived: options.onViewArchived
              ? () => options.onViewArchived!(session)
              : undefined,
          }).catch((e) =>
            showToast({ message: 'Could not archive the chat: ' + errorMessage(e), tone: 'error' }),
          );
      },
    };
  }
  /** The menu groups and the run function for one chat row. */
  function menuFor(session: Session): {
    groups: ChatMenuGroup[];
    run: (item: ChatMenuItem) => void;
  } {
    const state = sessionActionState(session, {
      usageHistory: typeof api?.managedHistory === 'function',
      ...options.stateOf?.(session),
    });
    return {
      groups: chatActionMenu('list', state, platform),
      run: (item) => item.definition.run(target(session)),
    };
  }
  const dialogs = (
    <>
      <RenameSessionDialog
        session={renaming}
        open={!!renaming}
        onOpenChange={(open) => !open && setRenaming(null)}
        save={renaming ? (changes) => save(renaming, changes) : undefined}
        onRenamed={() => onChanged?.()}
      />
      <NotesDialog
        session={notes}
        open={!!notes}
        onOpenChange={(open) => !open && setNotes(null)}
        save={notes ? (changes) => save(notes, changes) : undefined}
        onSaved={() => onChanged?.()}
      />
      <Dialog open={!!history} onOpenChange={(open) => !open && setHistory(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Usage history</DialogTitle>
            <DialogDescription>
              The policy decision, model, tokens, time and settlement of each agent request through
              Verdictan in this chat.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {history && api && (
              <ManagedHistoryView
                api={api}
                target={{ kind: 'conversation', agent: history.agent, sessionId: history.id }}
              />
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
  return { menuFor, dialogs };
}
