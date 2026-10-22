// The policy result of a refused or escalated request in a chat: the reason, the policy version,
// the request and review IDs, the review status, the Console link, and the permitted actions.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  canRetry,
  isPolicyRegion,
  openReview,
  returnAction,
  reviewStatusWords,
  type PolicyRegion,
  type PolicyResult,
  type PolicyReview,
  type ReviewDecision,
} from '../domain/policy-result';
import { managedErrorCode } from '../domain/verdictan';
import { agentErrorMessage } from '../lib/agent-errors';
import type { API } from '../types';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

type ReviewAPI = Pick<
  API,
  'verdictanReviewInspect' | 'verdictanReviewOpen' | 'verdictanReviewDecide'
>;

// Codes that mean the user may not see the review. The card then shows nothing about it.
const hiddenCodes = new Set(['desktop.review_forbidden', 'desktop.operation_unsupported']);

/**
 * The policy result card. It shows only the fields that the server sent. A review status, a
 * Console link and review actions show only when the broker returns them for this user. "Send
 * again" shows only when the policy permits a retry. It sends a new request, which the gateway
 * evaluates against the current policy. Coming back from the Console only reads the status.
 */
export function PolicyResultCard({
  api,
  policy,
  onRetry,
  busy,
}: {
  api: ReviewAPI;
  policy: PolicyResult & { region?: PolicyRegion };
  /** Sends the last message again as a new request. */
  onRetry?: () => void;
  busy?: boolean;
}) {
  const region = isPolicyRegion(policy.region) ? policy.region : undefined;
  const requestId = policy.requestId;
  const reviewable =
    policy.decision === 'escalated' && !!requestId && !!region && !!api.verdictanReviewInspect;
  const [review, setReview] = useState<PolicyReview>();
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [deciding, setDeciding] = useState<ReviewDecision>();
  // Set when the user opened the Console. Coming back to the window then reads the status.
  const openedConsole = useRef(false);
  const refresh = useCallback(async () => {
    if (!reviewable) return;
    setLoading(true);
    setError('');
    try {
      setReview(await api.verdictanReviewInspect!(requestId!, region!));
      setHidden(false);
    } catch (e) {
      const code = managedErrorCode(e instanceof Error ? e.message : String(e));
      if (code && hiddenCodes.has(code)) {
        setReview(undefined);
        setHidden(true);
      } else setError(agentErrorMessage(e).message);
    } finally {
      setLoading(false);
    }
  }, [api, reviewable, requestId, region]);
  useEffect(() => {
    setReview(undefined);
    setHidden(false);
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const back = () => {
      const action = returnAction({ requestId, openedConsole: openedConsole.current });
      // A return only reads the status. It never sends a message and never runs a command.
      if (action.kind === 'refresh') void refresh();
    };
    window.addEventListener('focus', back);
    return () => window.removeEventListener('focus', back);
  }, [refresh, requestId]);
  async function openConsole() {
    if (!requestId || !region || !api.verdictanReviewOpen) return;
    setError('');
    try {
      setReview(await api.verdictanReviewOpen(requestId, region));
      openedConsole.current = true;
    } catch (e) {
      setError(agentErrorMessage(e).message);
    }
  }
  async function decide(decision: ReviewDecision) {
    if (!review?.revision || !requestId || !region || !api.verdictanReviewDecide) return;
    setDeciding(decision);
    setError('');
    try {
      setReview(
        await api.verdictanReviewDecide(
          requestId,
          region,
          decision,
          reason.trim(),
          review.revision,
        ),
      );
      setReason('');
    } catch (e) {
      setError(agentErrorMessage(e).message);
    } finally {
      setDeciding(undefined);
    }
  }
  const escalated = policy.decision === 'escalated';
  const shown = hidden ? undefined : review;
  const details: [string, string | undefined][] = [
    ['Reason', policy.reason],
    ['Reason code', policy.reasonCode || shown?.reasonCode],
    ['Policy version', policy.policyVersion || shown?.policyVersion],
    ['Request ID', policy.requestId],
    ['Review ID', shown?.escalationId],
  ];
  const retry = !!onRetry && canRetry(policy, shown);
  const actions = shown && openReview(shown.status) ? shown.actions : [];
  return (
    <section className="policy-result" aria-label="Policy result" role="status">
      <ShieldAlert className="policy-result-icon" aria-hidden="true" />
      <div className="grid min-w-0 gap-2">
        <p className="policy-result-title">
          {escalated ? 'This request needs a review' : 'The policy refused this request'}
        </p>
        <p className="policy-result-body">
          {escalated
            ? 'The policy sent this request to a reviewer. The agent did not get an answer.'
            : 'The policy did not allow this request. The agent did not get an answer.'}
        </p>
        <dl className="policy-result-details">
          {details
            .filter(([, value]) => !!value)
            .map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{label === 'Reason' ? value : <code className="font-mono">{value}</code>}</dd>
              </div>
            ))}
          {shown && (
            <div>
              <dt>Review status</dt>
              <dd data-status={shown.status}>{reviewStatusWords[shown.status]}</dd>
            </div>
          )}
        </dl>
        {actions.length > 0 && (
          <div className="grid gap-2">
            <Textarea
              aria-label="Review reason"
              placeholder="Give a reason for your decision"
              value={reason}
              maxLength={2000}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {actions.map((action) => (
                <Button
                  key={action}
                  size="sm"
                  variant={action === 'approve' ? 'default' : 'outline'}
                  disabled={!!deciding || !reason.trim()}
                  onClick={() => void decide(action)}
                >
                  {deciding === action ? 'Saving…' : action === 'approve' ? 'Approve' : 'Deny'}
                </Button>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {retry && (
            <Button size="sm" disabled={busy} onClick={onRetry}>
              Send again
            </Button>
          )}
          {shown?.consoleUrl && api.verdictanReviewOpen && (
            <Button size="sm" variant="outline" onClick={() => void openConsole()}>
              <ExternalLink aria-hidden="true" />
              Open review in Console
            </Button>
          )}
          {reviewable && !hidden && (
            <Button size="sm" variant="ghost" disabled={loading} onClick={() => void refresh()}>
              <RefreshCw aria-hidden="true" />
              {loading ? 'Refreshing…' : 'Refresh status'}
            </Button>
          )}
        </div>
        {retry && (
          <p className="policy-result-note">
            Send again makes a new request. The current policy checks it again.
          </p>
        )}
        {error && (
          <p className="policy-result-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
