import { randomUUID } from 'node:crypto';
import { parseCapabilities } from './account';
import { DesktopProtocolError, type DesktopClient } from './protocol';
import type { VerdictanRegion } from './region';
import {
  isRequestId,
  parsePolicyReview,
  type PolicyReview,
  type ReviewDecision,
} from '../../src/domain/policy-result';

/**
 * Reads, opens and decides one policy review through the account broker. The renderer sends only
 * a request ID and a region. It never sends a URL. The broker and the server check each request
 * against the identity and the permissions of the signed-in user.
 */
export class PolicyReviews {
  constructor(
    private options: {
      client(): Promise<DesktopClient>;
      /** The region of the signed-in account. */
      region(): VerdictanRegion | undefined;
      openExternal(url: string): Promise<unknown>;
    },
  ) {}
  /** The account client, after a check that the review belongs to the signed-in region. */
  private async client(requestId: unknown, region: unknown, capability: string) {
    if (!isRequestId(requestId)) throw new DesktopProtocolError('desktop.invalid_review');
    const current = this.options.region();
    if (!current) throw new DesktopProtocolError('desktop.region_required');
    // A review from another region is not in this account. Do not ask this region about it.
    if (region !== current) throw new DesktopProtocolError('desktop.review_region_mismatch');
    const client = await this.options.client();
    const { capabilities } = parseCapabilities((await client.request('capabilities')).data);
    if (!capabilities.includes(capability))
      throw new DesktopProtocolError('desktop.operation_unsupported');
    return { client, region: current };
  }
  /** The current state of the review. Only the fields that the user may see are present. */
  async inspect(requestId: unknown, region: unknown): Promise<PolicyReview> {
    const { client, region: current } = await this.client(requestId, region, 'review.inspect');
    const event = await client.request('review.inspect', { request_id: requestId as string });
    return parsePolicyReview(event.data, current, requestId as string);
  }
  /**
   * Opens the Console record of the review. The link comes from the broker and must be the exact
   * review link of the account region. A link that fails the check does not open.
   */
  async open(requestId: unknown, region: unknown) {
    const review = await this.inspect(requestId, region);
    if (!review.consoleUrl) throw new DesktopProtocolError('desktop.review_link_unavailable');
    await this.options.openExternal(review.consoleUrl);
    return review;
  }
  /**
   * Approves or denies the review as the signed-in reviewer. The UI shows only the actions that
   * the broker listed, but the server makes the decision about permission and identity. A
   * decision never sends the request again: a retry is a new request with a new evaluation.
   */
  async decide(
    requestId: unknown,
    region: unknown,
    decision: unknown,
    reason: unknown,
    revision: unknown,
  ): Promise<PolicyReview> {
    if (decision !== 'approve' && decision !== 'deny')
      throw new DesktopProtocolError('desktop.invalid_review');
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 2000)
      throw new DesktopProtocolError('desktop.invalid_review');
    if (typeof revision !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(revision))
      throw new DesktopProtocolError('desktop.invalid_review');
    const { client, region: current } = await this.client(requestId, region, 'review.resolve');
    const event = await client.request('review.resolve', {
      request_id: requestId as string,
      fields: {
        decision: decision as ReviewDecision,
        reason: reason.trim(),
        expected_revision: revision,
        operation_id: randomUUID(),
      },
    });
    return parsePolicyReview(event.data, current, requestId as string);
  }
}
