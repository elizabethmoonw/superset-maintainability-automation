/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { createHash } from "crypto";
import { appendFileSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import {
  EVIDENCE_NOTICE,
  type ActionableBatch,
  type ActionableBatchFinding,
  type DevinRunStatus,
  type RunStatus,
  type TaskProgress,
} from "./generateActionableBatch";

export const DEVIN_API_BASE_URL = "https://api.devin.ai/v3";
export const DEFAULT_POLL_INTERVAL_MS = 10_000;
export const DEFAULT_TIMEOUT_MS = 3_600_000;
export const DEFAULT_MAX_ACU_LIMIT = 50;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const MAX_REQUEST_TIMEOUT_MS = 120_000;
export const MAX_TOTAL_TIMEOUT_MS = 70 * 60 * 1000;

const TERMINAL_STATUSES = ["exit", "error", "suspended"] as const;
const MAX_API_ERROR_LENGTH = 500;
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const RECOVERY_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;
const SESSION_PAGE_SIZE = 200;
const MAX_RECOVERY_PAGES = 5;
const SESSION_MARKER_PATTERN = /<!-- maintenance-devin:([A-Za-z0-9_-]+) -->/g;
const REQUIRED_PULL_REQUEST_SECTIONS = [
  "SCAN EVIDENCE",
  "TESTING INSTRUCTIONS",
  "UNRESOLVED FINDINGS",
] as const;

export type DevinApiStatus =
  "new" | "claimed" | "running" | "exit" | "error" | "suspended" | "resuming";

export type DevinStatusDetail =
  | "working"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "finished"
  | "inactivity"
  | "user_request"
  | "usage_limit_exceeded"
  | "user_usage_limit_exceeded"
  | "out_of_credits"
  | "out_of_quota"
  | "no_quota_allocation"
  | "payment_declined"
  | "org_usage_limit_exceeded"
  | "total_session_limit_exceeded"
  | "error";

export interface DevinPullRequest {
  state: string | null;
  url: string;
}

export interface DevinSession {
  sessionId: string;
  url: string;
  status: DevinApiStatus;
  statusDetail?: DevinStatusDetail;
  acusConsumed: number;
  createdAt: string;
  tags: string[];
  pullRequests: DevinPullRequest[];
}

export interface CreateDevinSessionRequest {
  prompt: string;
  repos: string[];
  title: string;
  maxAcuLimit: number;
  tags: string[];
}

export interface DevinApiClientOptions {
  apiKey: string;
  organizationId: string;
  baseUrl?: string;
  requestTimeoutMilliseconds?: number;
}

export interface PersistedSessionReference {
  batchDigest: string;
  sessionId: string;
  sessionUrl: string;
}

export interface StartSessionResult {
  session: DevinSession;
  reused: boolean;
}

export interface PollOptions {
  timeoutMilliseconds: number;
  intervalMilliseconds: number;
  initialSession?: Pick<DevinSession, "status" | "statusDetail">;
  onStatusChange?: (session: DevinSession) => void | Promise<void>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface PollResult {
  session: DevinSession;
  timedOut: boolean;
  terminationFailure?: string;
}

export interface SessionRecoverySearch {
  tag: string;
  createdAfterSeconds: number;
}

interface DevinSessionPage {
  sessions: DevinSession[];
  nextCursor?: string;
}

interface DevinSessionResponse {
  acus_consumed: number;
  session_id: string;
  url: string;
  status: DevinApiStatus;
  created_at: number;
  tags: string[];
  status_detail?: DevinStatusDetail | null;
  pull_requests: Array<{
    pr_state: string | null;
    pr_url: string;
  }>;
}

interface CreateDevinSessionBody {
  prompt: string;
  repos: string[];
  title: string;
  max_acu_limit: number;
  bypass_approval: true;
  structured_output_required: false;
  tags: string[];
}

interface WorkflowInputs {
  reportsDirectory: string;
  apiKey: string;
  organizationId: string;
  issueUrl: string;
  githubToken?: string;
  existingSessionId?: string;
  maxAcuLimit: number;
  timeoutMilliseconds: number;
  intervalMilliseconds: number;
  requestTimeoutMilliseconds: number;
}

export class DevinApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "DevinApiError";
  }
}

export class DevinApiClient {
  private readonly baseUrl: string;
  private readonly requestTimeoutMilliseconds: number;

  constructor(
    private readonly options: DevinApiClientOptions,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    this.baseUrl = options.baseUrl ?? DEVIN_API_BASE_URL;
    this.requestTimeoutMilliseconds =
      options.requestTimeoutMilliseconds ?? DEFAULT_REQUEST_TIMEOUT_MS;
    validateBoundedPositiveInteger(
      "request timeout",
      this.requestTimeoutMilliseconds,
      MAX_REQUEST_TIMEOUT_MS,
    );
  }

  async createSession(
    request: CreateDevinSessionRequest,
  ): Promise<DevinSession> {
    const body: CreateDevinSessionBody = {
      prompt: request.prompt,
      repos: request.repos,
      title: request.title,
      max_acu_limit: request.maxAcuLimit,
      bypass_approval: true,
      structured_output_required: false,
      tags: request.tags,
    };
    const creationResponse = await this.request("", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return parseCreatedSessionResponse(creationResponse, request, new Date());
  }

  async getSession(sessionId: string): Promise<DevinSession> {
    return this.requestSession(`/${encodeURIComponent(sessionId)}`, {
      method: "GET",
    });
  }

  async terminateSession(sessionId: string): Promise<DevinSession> {
    return this.requestSession(`/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
  }

  async listSessions(
    createdAfterSeconds: number,
    cursor?: string,
  ): Promise<DevinSessionPage> {
    const query = new URLSearchParams({
      first: String(SESSION_PAGE_SIZE),
      created_after: String(createdAfterSeconds),
      ...(cursor === undefined ? {} : { after: cursor }),
    });
    const value = await this.request(`?${query.toString()}`, { method: "GET" });
    if (
      !isRecord(value) ||
      !Array.isArray(value.items) ||
      typeof value.has_next_page !== "boolean" ||
      (value.end_cursor !== undefined &&
        value.end_cursor !== null &&
        typeof value.end_cursor !== "string")
    ) {
      throw new DevinApiError("Devin API returned an invalid session page");
    }
    if (value.has_next_page && typeof value.end_cursor !== "string") {
      throw new DevinApiError("Devin API omitted the next session cursor");
    }
    return {
      sessions: value.items.map(parseSessionResponse),
      ...(value.has_next_page
        ? { nextCursor: value.end_cursor as string }
        : {}),
    };
  }

  private async requestSession(
    sessionPath: string,
    request: RequestInit,
  ): Promise<DevinSession> {
    return parseSessionResponse(await this.request(sessionPath, request));
  }

  private async request(
    sessionPath: string,
    request: RequestInit,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.requestTimeoutMilliseconds,
    );
    try {
      const response = await this.fetchImplementation(
        `${this.baseUrl}/organizations/${encodeURIComponent(this.options.organizationId)}/sessions${sessionPath}`,
        {
          ...request,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );
      const responseText = await response.text();
      if (!response.ok) {
        throw new DevinApiError(
          `Devin API request failed with HTTP ${response.status}: ${responseText.slice(0, MAX_API_ERROR_LENGTH)}`,
          response.status,
        );
      }
      try {
        return JSON.parse(responseText) as unknown;
      } catch {
        throw new DevinApiError(
          "Devin API returned invalid JSON",
          response.status,
        );
      }
    } catch (error: unknown) {
      if (error instanceof DevinApiError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new DevinApiError(
          `Devin API request timed out after ${this.requestTimeoutMilliseconds} milliseconds`,
        );
      }
      const message =
        error instanceof Error ? error.message : "Unexpected error";
      throw new DevinApiError(`Devin API request failed: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || /[\r\n]/.test(value)) {
    return false;
  }
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isApiStatus(value: unknown): value is DevinApiStatus {
  return (
    typeof value === "string" &&
    [
      "new",
      "claimed",
      "running",
      "exit",
      "error",
      "suspended",
      "resuming",
    ].includes(value)
  );
}

function isStatusDetail(value: unknown): value is DevinStatusDetail {
  return (
    typeof value === "string" &&
    [
      "working",
      "waiting_for_user",
      "waiting_for_approval",
      "finished",
      "inactivity",
      "user_request",
      "usage_limit_exceeded",
      "user_usage_limit_exceeded",
      "out_of_credits",
      "out_of_quota",
      "no_quota_allocation",
      "payment_declined",
      "org_usage_limit_exceeded",
      "total_session_limit_exceeded",
      "error",
    ].includes(value)
  );
}

function isSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    !/[\u0000-\u001F\u007F]/.test(value)
  );
}

function getSessionResponseViolation(
  value: Record<string, unknown>,
): string | undefined {
  if (!isSessionId(value.session_id)) {
    return "session_id";
  }
  if (!isHttpsUrl(value.url)) return "url";
  if (!isApiStatus(value.status)) return "status";
  if (
    typeof value.created_at !== "number" ||
    !Number.isSafeInteger(value.created_at) ||
    value.created_at < 0
  ) {
    return "created_at";
  }
  if (
    typeof value.acus_consumed !== "number" ||
    !Number.isFinite(value.acus_consumed) ||
    value.acus_consumed < 0
  ) {
    return "acus_consumed";
  }
  if (
    !Array.isArray(value.tags) ||
    !value.tags.every((tag: unknown) => typeof tag === "string")
  ) {
    return "tags";
  }
  if (!Array.isArray(value.pull_requests)) return "pull_requests";
  return undefined;
}

function parseSessionResponse(value: unknown): DevinSession {
  if (!isRecord(value)) {
    throw new DevinApiError(
      "Devin API returned an invalid session response field: payload",
    );
  }
  const violation = getSessionResponseViolation(value);
  if (violation !== undefined) {
    throw new DevinApiError(
      `Devin API returned an invalid session response field: ${violation}`,
    );
  }
  if (
    value.status_detail !== undefined &&
    value.status_detail !== null &&
    !isStatusDetail(value.status_detail)
  ) {
    throw new DevinApiError("Devin API returned an unknown status detail");
  }

  const response = value as unknown as DevinSessionResponse;
  const pullRequests = response.pull_requests.map((pullRequest: unknown) => {
    if (
      !isRecord(pullRequest) ||
      (pullRequest.pr_state !== null &&
        typeof pullRequest.pr_state !== "string") ||
      (typeof pullRequest.pr_state === "string" &&
        /[\r\n]/.test(pullRequest.pr_state)) ||
      !isHttpsUrl(pullRequest.pr_url)
    ) {
      throw new DevinApiError("Devin API returned invalid pull request data");
    }
    return { state: pullRequest.pr_state, url: pullRequest.pr_url };
  });

  const createdAt = new Date(response.created_at * 1000);
  if (Number.isNaN(createdAt.valueOf())) {
    throw new DevinApiError("Devin API returned an invalid creation time");
  }
  return {
    sessionId: response.session_id,
    url: response.url,
    status: response.status,
    acusConsumed: response.acus_consumed,
    createdAt: createdAt.toISOString(),
    tags: [...response.tags],
    ...(response.status_detail === undefined || response.status_detail === null
      ? {}
      : { statusDetail: response.status_detail }),
    pullRequests,
  };
}

function parseCreatedSessionResponse(
  value: unknown,
  request: CreateDevinSessionRequest,
  createdAt: Date,
): DevinSession {
  if (
    !isRecord(value) ||
    !isSessionId(value.session_id) ||
    !isHttpsUrl(value.url) ||
    !isApiStatus(value.status)
  ) {
    throw new DevinApiError(
      "Devin API returned an invalid session creation response",
    );
  }
  return {
    sessionId: value.session_id,
    url: value.url,
    status: value.status,
    acusConsumed: 0,
    createdAt: createdAt.toISOString(),
    tags: [...request.tags],
    pullRequests: [],
  };
}

function renderFinding(finding: ActionableBatchFinding): string {
  const symbol = finding.symbolName.length === 0 ? "file" : finding.symbolName;
  return `- ${finding.issueType}: ${finding.normalizedPath} (${symbol})`;
}

export function buildDevinPrompt(
  status: RunStatus,
  batch: ActionableBatch,
  issueUrl: string,
): string {
  const findings = batch.selectedBatch?.findings ?? [];
  return [
    "Investigate the approved maintenance evidence below and prepare a safe remediation.",
    "",
    `Repository: https://github.com/${status.repository}`,
    `Approved commit: ${status.commitSha}`,
    `Remediation issue: ${issueUrl}`,
    `Source workflow: ${status.workflowUrl}`,
    `Batch digest: ${status.batchDigest}`,
    "",
    EVIDENCE_NOTICE,
    "Investigate every finding before changing code. Do not delete or modify code unless repository evidence confirms it is unused and safe to change.",
    "",
    "Approved evidence batch:",
    ...findings.map(renderFinding),
    "",
    "Required delivery:",
    `1. Create a new branch from the exact approved commit ${status.commitSha}; do not use a newer branch tip.`,
    "2. Investigate usages, dynamic imports, registrations, plugins, feature flags, and public API implications for every finding.",
    "3. Make only verified, focused maintenance changes and run relevant tests, type checks, or lint checks.",
    `4. Create one draft pull request that references ${issueUrl}. Do not mark it ready for review and never merge it.`,
    `5. Follow .github/PULL_REQUEST_TEMPLATE.md. Include the exact headings ${REQUIRED_PULL_REQUEST_SECTIONS.map((heading) => `\`### ${heading}\``).join(", ")}. Under them, record the evidence considered, commands and results, unresolved findings, and source workflow ${status.workflowUrl}.`,
    "6. If no finding is safe to change, explain why in the issue-linked draft pull request without making speculative deletions.",
  ].join("\n");
}

export function validateDevinPullRequestBody(body: string): void {
  for (const heading of REQUIRED_PULL_REQUEST_SECTIONS) {
    const headingPattern = new RegExp(
      `^#{1,6}\\s+${heading.replace(" ", "\\s+")}\\s*$`,
      "im",
    );
    if (!headingPattern.test(body)) {
      throw new Error(`Devin pull request is missing ${heading}`);
    }
  }
}

export function createSessionRecoveryTag(
  repository: string,
  commitSha: string,
  batchDigest: string,
): string {
  const digest = createHash("sha256")
    .update(`${repository}\u0000${commitSha}\u0000${batchDigest}`)
    .digest("hex");
  return `maintenance-${digest.slice(0, 40)}`;
}

async function findTaggedSession(
  client: DevinApiClient,
  search: SessionRecoverySearch,
): Promise<DevinSession | undefined> {
  validateNonNegativeInteger(
    "recovery created-after time",
    search.createdAfterSeconds,
  );
  const matches: DevinSession[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_RECOVERY_PAGES; pageNumber += 1) {
    const page = await client.listSessions(search.createdAfterSeconds, cursor);
    matches.push(
      ...page.sessions.filter((session) => session.tags.includes(search.tag)),
    );
    if (page.nextCursor === undefined) {
      break;
    }
    if (pageNumber === MAX_RECOVERY_PAGES - 1) {
      throw new DevinApiError(
        "Devin session recovery exceeded the bounded page limit",
      );
    }
    cursor = page.nextCursor;
  }
  if (matches.length > 1) {
    throw new DevinApiError(
      `Found ${matches.length} Devin sessions for the approved batch tag`,
    );
  }
  return matches[0];
}

export async function startOrReuseSession(
  client: DevinApiClient,
  request: CreateDevinSessionRequest,
  recoverySearch: SessionRecoverySearch,
  existingSessionId?: string,
): Promise<StartSessionResult> {
  if (existingSessionId !== undefined) {
    const session = await client.getSession(existingSessionId);
    if (!session.tags.includes(recoverySearch.tag)) {
      throw new DevinApiError(
        "Persisted Devin session does not match the approved batch",
      );
    }
    return {
      session,
      reused: true,
    };
  }
  const recoveredSession = await findTaggedSession(client, recoverySearch);
  if (recoveredSession !== undefined) {
    return { session: recoveredSession, reused: true };
  }
  return { session: await client.createSession(request), reused: false };
}

function isTerminalStatus(
  status: DevinApiStatus,
): status is (typeof TERMINAL_STATUSES)[number] {
  return TERMINAL_STATUSES.includes(
    status as (typeof TERMINAL_STATUSES)[number],
  );
}

function shouldTerminateDeliveredSession(session: DevinSession): boolean {
  if (session.status !== "running") {
    return false;
  }
  if (session.statusDetail === "finished") {
    return true;
  }
  return (
    session.statusDetail === "waiting_for_user" &&
    session.pullRequests.length === 1
  );
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function pollDevinSession(
  client: DevinApiClient,
  sessionId: string,
  options: PollOptions,
): Promise<PollResult> {
  validateBoundedPositiveInteger(
    "total timeout",
    options.timeoutMilliseconds,
    MAX_TOTAL_TIMEOUT_MS,
  );
  validateBoundedPositiveInteger(
    "poll interval",
    options.intervalMilliseconds,
    options.timeoutMilliseconds,
  );
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = now() + options.timeoutMilliseconds;
  let previousStatus = options.initialSession?.status;
  let previousStatusDetail = options.initialSession?.statusDetail;

  while (true) {
    const session = await client.getSession(sessionId);
    if (
      session.status !== previousStatus ||
      session.statusDetail !== previousStatusDetail
    ) {
      await options.onStatusChange?.(session);
      previousStatus = session.status;
      previousStatusDetail = session.statusDetail;
    }
    if (isTerminalStatus(session.status)) {
      return { session, timedOut: false };
    }
    if (shouldTerminateDeliveredSession(session)) {
      return {
        session: await client.terminateSession(sessionId),
        timedOut: false,
      };
    }
    if (now() >= deadline) {
      try {
        await client.terminateSession(sessionId);
        return { session, timedOut: true };
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unexpected error";
        return { session, timedOut: true, terminationFailure: message };
      }
    }
    await sleep(Math.min(options.intervalMilliseconds, deadline - now()));
  }
}

export function renderPersistedSessionMarker(
  reference: PersistedSessionReference,
): string {
  const encoded = Buffer.from(JSON.stringify(reference)).toString("base64url");
  return `<!-- maintenance-devin:${encoded} -->`;
}

export function extractPersistedSessionReference(
  issueBody: string,
  batchDigest: string,
): PersistedSessionReference | undefined {
  const matches = [...issueBody.matchAll(SESSION_MARKER_PATTERN)].reverse();
  for (const match of matches) {
    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(match[1], "base64url").toString("utf8"),
      );
      if (
        isRecord(parsed) &&
        parsed.batchDigest === batchDigest &&
        typeof parsed.sessionId === "string" &&
        typeof parsed.sessionUrl === "string"
      ) {
        return {
          batchDigest,
          sessionId: parsed.sessionId,
          sessionUrl: parsed.sessionUrl,
        };
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function calculateProgress(
  findingCount: number,
  state: RunStatus["state"],
  elapsedMilliseconds: number,
): TaskProgress {
  const selected = findingCount === 0 ? 0 : 1;
  const completed =
    state === "draft-pr-ready" || state === "devin-failed" ? selected : 0;
  const succeeded = state === "draft-pr-ready" ? selected : 0;
  const failed = state === "devin-failed" ? selected : 0;
  return {
    selected,
    active: state === "devin-running" ? selected : 0,
    completed,
    succeeded,
    failed,
    ...(completed === 0 ? {} : { successRate: succeeded / completed }),
    ...(completed === 0 || elapsedMilliseconds === 0
      ? {}
      : {
          completedPerHour:
            completed / (elapsedMilliseconds / MILLISECONDS_PER_HOUR),
        }),
  };
}

export function createRunningStatus(
  status: RunStatus,
  issueUrl: string,
  session: DevinSession,
  reused: boolean,
  maxAcuLimit: number,
): RunStatus {
  const devin: DevinRunStatus = {
    sessionId: session.sessionId,
    sessionUrl: session.url,
    apiStatus: session.status,
    ...(session.statusDetail === undefined
      ? {}
      : { statusDetail: session.statusDetail }),
    maxAcuLimit,
    acusConsumed: session.acusConsumed,
    reused,
    timedOut: false,
    startedAt: session.createdAt,
    elapsedMilliseconds: 0,
  };
  return {
    ...status,
    state: "devin-running",
    issueUrl,
    progress: calculateProgress(status.batchSize, "devin-running", 0),
    devin,
  };
}

export function createObservedStatus(
  status: RunStatus,
  session: DevinSession,
  observedAt: string,
): RunStatus {
  if (status.devin === undefined) {
    throw new Error("Cannot observe a run without a Devin session");
  }
  const elapsedMilliseconds = Math.max(
    0,
    Date.parse(observedAt) - Date.parse(status.devin.startedAt),
  );
  return {
    ...status,
    progress: calculateProgress(
      status.batchSize,
      "devin-running",
      elapsedMilliseconds,
    ),
    devin: {
      ...status.devin,
      apiStatus: session.status,
      statusDetail: session.statusDetail,
      acusConsumed: session.acusConsumed,
      elapsedMilliseconds,
    },
  };
}

function getCompletedState(
  session: DevinSession,
  timedOut: boolean,
  terminationFailure?: string,
): { state: RunStatus["state"]; pullRequestUrl?: string; failure?: string } {
  if (timedOut) {
    return {
      state: "devin-failed",
      failure:
        terminationFailure === undefined
          ? `Timed out while waiting for Devin; termination request succeeded with last observed status ${session.status}`
          : `Timed out while waiting for Devin with last observed status ${session.status}; session termination failed: ${terminationFailure}`,
    };
  }
  if (session.status === "error" || session.status === "suspended") {
    return {
      state: "devin-failed",
      failure: `Devin ended with ${session.status}${session.statusDetail === undefined ? "" : ` (${session.statusDetail})`}`,
    };
  }
  if (session.pullRequests.length !== 1) {
    return {
      state: "devin-failed",
      failure: `Devin completed with ${session.pullRequests.length} pull requests; expected exactly one`,
    };
  }
  return {
    state: "draft-pr-ready",
    pullRequestUrl: session.pullRequests[0].url,
  };
}

export function createCompletedStatus(
  status: RunStatus,
  result: PollResult,
  completedAt: string,
): RunStatus {
  if (status.devin === undefined) {
    throw new Error("Cannot complete a run without a Devin session");
  }
  const elapsedMilliseconds = Math.max(
    0,
    Date.parse(completedAt) - Date.parse(status.devin.startedAt),
  );
  const completion = getCompletedState(
    result.session,
    result.timedOut,
    result.terminationFailure,
  );
  return {
    ...status,
    state: completion.state,
    ...(completion.failure === undefined
      ? { failure: undefined }
      : { failure: completion.failure }),
    progress: calculateProgress(
      status.batchSize,
      completion.state,
      elapsedMilliseconds,
    ),
    devin: {
      ...status.devin,
      apiStatus: result.session.status,
      ...(result.session.statusDetail === undefined
        ? {}
        : { statusDetail: result.session.statusDetail }),
      ...(completion.pullRequestUrl === undefined
        ? {}
        : { draftPullRequestUrl: completion.pullRequestUrl }),
      acusConsumed: result.session.acusConsumed,
      timedOut: result.timedOut,
      completedAt,
      elapsedMilliseconds,
    },
  };
}

export function createFailedStatus(
  status: RunStatus,
  failure: string,
  completedAt: string,
): RunStatus {
  const startedAt = status.devin?.startedAt ?? completedAt;
  const elapsedMilliseconds = Math.max(
    0,
    Date.parse(completedAt) - Date.parse(startedAt),
  );
  const devin =
    status.devin === undefined
      ? undefined
      : {
          ...status.devin,
          draftPullRequestUrl: undefined,
          completedAt,
          elapsedMilliseconds,
        };
  return {
    ...status,
    state: "devin-failed",
    failure,
    progress: calculateProgress(
      status.batchSize,
      "devin-failed",
      elapsedMilliseconds,
    ),
    ...(devin === undefined ? {} : { devin }),
  };
}

function formatMetric(value: number | undefined): string {
  return value === undefined ? "n/a" : value.toFixed(2);
}

function formatSummaryText(value: string): string {
  return value.replace(/[\r\n]/g, " ");
}

export function renderDevinSummary(status: RunStatus): string {
  const successRate =
    status.progress.successRate === undefined
      ? "n/a"
      : `${(status.progress.successRate * 100).toFixed(2)}%`;
  const lines = [
    "# Devin remediation",
    "",
    `- State: \`${status.state}\``,
    `- Issue: ${status.issueUrl ?? "unavailable"}`,
    `- Findings in batch: ${status.batchSize}`,
    `- Batches selected: ${status.progress.selected}`,
    `- Batches active: ${status.progress.active}`,
    `- Batches completed: ${status.progress.completed}`,
    `- Batches with a verified draft PR: ${status.progress.succeeded}`,
    `- Failed batches: ${status.progress.failed}`,
    `- Draft-PR production rate: ${successRate}`,
    `- Completed batches/hour: ${formatMetric(status.progress.completedPerHour)}`,
    `- Remediation elapsed milliseconds: ${status.devin?.elapsedMilliseconds ?? 0}`,
  ];
  if (status.failure !== undefined) {
    lines.push(`- Failure: ${formatSummaryText(status.failure)}`);
  }
  if (status.devin !== undefined) {
    lines.push(
      `- Devin session: [${status.devin.sessionId}](${status.devin.sessionUrl})`,
      `- Devin API status: \`${status.devin.apiStatus}\``,
      `- Session reused: ${status.devin.reused ? "yes" : "no"}`,
      `- Per-session ACU cap: ${status.devin.maxAcuLimit}`,
      `- ACUs consumed: ${formatMetric(status.devin.acusConsumed)}`,
      `- Elapsed milliseconds: ${status.devin.elapsedMilliseconds}`,
    );
    if (status.devin.statusDetail !== undefined) {
      lines.push(`- Status detail: \`${status.devin.statusDetail}\``);
    }
    if (status.devin.draftPullRequestUrl !== undefined) {
      lines.push(`- Draft pull request: ${status.devin.draftPullRequestUrl}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function writeDevinArtifacts(
  reportsDirectory: string,
  status: RunStatus,
): void {
  const summary = renderDevinSummary(status);
  const issueBase = readFileSync(
    path.join(reportsDirectory, "remediation-issue.md"),
    "utf8",
  ).trimEnd();
  const marker =
    status.devin === undefined
      ? ""
      : `\n\n${renderPersistedSessionMarker({
          batchDigest: status.batchDigest,
          sessionId: status.devin.sessionId,
          sessionUrl: status.devin.sessionUrl,
        })}`;
  writeFileSync(
    path.join(reportsDirectory, "run-status.json"),
    `${JSON.stringify(status, null, 2)}\n`,
  );
  writeFileSync(path.join(reportsDirectory, "devin-summary.md"), summary);
  writeFileSync(
    path.join(reportsDirectory, "remediation-update.md"),
    `${issueBase}\n\n${summary}${marker}\n`,
  );
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function requirePrefixedEnvironment(name: string, prefix: string): string {
  const value = requireEnvironment(name);
  if (!value.startsWith(prefix)) {
    throw new Error(`${name} must start with ${prefix}`);
  }
  return value;
}

function validateNonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function validateBoundedPositiveInteger(
  name: string,
  value: number,
  maximum: number,
): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 through ${maximum}`);
  }
}

function readBoundedPositiveInteger(
  name: string,
  defaultValue: number,
  maximum: number,
): number {
  const value = process.env[name];
  const parsed =
    value === undefined || value.length === 0 ? defaultValue : Number(value);
  validateBoundedPositiveInteger(name, parsed, maximum);
  return parsed;
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readRunStatus(reportsDirectory: string): RunStatus {
  const value = readJson(path.join(reportsDirectory, "run-status.json"));
  if (
    !isRecord(value) ||
    typeof value.repository !== "string" ||
    typeof value.commitSha !== "string" ||
    typeof value.workflowUrl !== "string" ||
    typeof value.batchDigest !== "string" ||
    typeof value.batchSize !== "number" ||
    !isRecord(value.progress)
  ) {
    throw new Error("Invalid run status artifact");
  }
  return value as unknown as RunStatus;
}

function readActionableBatch(reportsDirectory: string): ActionableBatch {
  const value = readJson(path.join(reportsDirectory, "actionable-batch.json"));
  if (
    !isRecord(value) ||
    (value.selectedBatch !== null &&
      (!isRecord(value.selectedBatch) ||
        !Array.isArray(value.selectedBatch.findings)))
  ) {
    throw new Error("Invalid actionable batch artifact");
  }
  return value as unknown as ActionableBatch;
}

function getWorkflowInputs(): WorkflowInputs {
  return {
    reportsDirectory: path.resolve(
      process.env.MAINTENANCE_REPORTS_DIRECTORY ?? "reports",
    ),
    apiKey: requirePrefixedEnvironment("DEVIN_API_KEY", "cog_"),
    organizationId: requirePrefixedEnvironment("DEVIN_ORG_ID", "org-"),
    issueUrl: requireEnvironment("MAINTENANCE_ISSUE_URL"),
    ...(process.env.GITHUB_TOKEN === undefined ||
    process.env.GITHUB_TOKEN.length === 0
      ? {}
      : { githubToken: process.env.GITHUB_TOKEN }),
    ...(process.env.EXISTING_DEVIN_SESSION_ID === undefined ||
    process.env.EXISTING_DEVIN_SESSION_ID.length === 0
      ? {}
      : { existingSessionId: process.env.EXISTING_DEVIN_SESSION_ID }),
    maxAcuLimit: readBoundedPositiveInteger(
      "DEVIN_MAX_ACU_LIMIT",
      DEFAULT_MAX_ACU_LIMIT,
      Number.MAX_SAFE_INTEGER,
    ),
    timeoutMilliseconds: readBoundedPositiveInteger(
      "DEVIN_TIMEOUT_MS",
      DEFAULT_TIMEOUT_MS,
      MAX_TOTAL_TIMEOUT_MS,
    ),
    intervalMilliseconds: readBoundedPositiveInteger(
      "DEVIN_POLL_INTERVAL_MS",
      DEFAULT_POLL_INTERVAL_MS,
      MAX_TOTAL_TIMEOUT_MS,
    ),
    requestTimeoutMilliseconds: readBoundedPositiveInteger(
      "DEVIN_REQUEST_TIMEOUT_MS",
      DEFAULT_REQUEST_TIMEOUT_MS,
      MAX_REQUEST_TIMEOUT_MS,
    ),
  };
}

function writeOutput(name: string, value: string): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath !== undefined) {
    appendFileSync(outputPath, `${name}=${value}\n`);
  }
}

async function publishIssueUpdate(
  token: string,
  issueUrl: string,
  body: string,
): Promise<void> {
  const url = new URL(issueUrl);
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)$/);
  if (url.hostname !== "github.com" || match === null) {
    throw new Error("MAINTENANCE_ISSUE_URL must identify a GitHub issue");
  }
  const [, owner, repository, issueNumber] = match;
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/issues/${issueNumber}`,
    {
      method: "PATCH",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ body }),
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub issue update failed with HTTP ${response.status}`);
  }
}

async function startWorkflow(inputs: WorkflowInputs): Promise<RunStatus> {
  const status = readRunStatus(inputs.reportsDirectory);
  const batch = readActionableBatch(inputs.reportsDirectory);
  if (
    status.state !== "awaiting-approval" ||
    batch.selectedBatch === null ||
    batch.selectedBatch.findings.length === 0
  ) {
    throw new Error("Devin can start only for an approved actionable batch");
  }
  const client = new DevinApiClient({
    apiKey: inputs.apiKey,
    organizationId: inputs.organizationId,
    requestTimeoutMilliseconds: inputs.requestTimeoutMilliseconds,
  });
  const startedAt = new Date().toISOString();
  const recoveryTag = createSessionRecoveryTag(
    status.repository,
    status.commitSha,
    status.batchDigest,
  );
  try {
    const result = await startOrReuseSession(
      client,
      {
        prompt: buildDevinPrompt(status, batch, inputs.issueUrl),
        repos: [`https://github.com/${status.repository}`],
        title: `Maintenance evidence ${status.commitSha.slice(0, 12)}`,
        maxAcuLimit: inputs.maxAcuLimit,
        tags: [recoveryTag],
      },
      {
        tag: recoveryTag,
        createdAfterSeconds:
          Math.floor(Date.now() / 1000) - RECOVERY_LOOKBACK_SECONDS,
      },
      inputs.existingSessionId,
    );
    const runningStatus = createRunningStatus(
      status,
      inputs.issueUrl,
      result.session,
      result.reused,
      inputs.maxAcuLimit,
    );
    writeDevinArtifacts(inputs.reportsDirectory, runningStatus);
    writeOutput("state", runningStatus.state);
    writeOutput("session-id", result.session.sessionId);
    writeOutput("session-url", result.session.url);
    return runningStatus;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    const failedStatus = createFailedStatus(
      { ...status, issueUrl: inputs.issueUrl },
      `Unable to start or reuse Devin session: ${message}`,
      startedAt,
    );
    writeDevinArtifacts(inputs.reportsDirectory, failedStatus);
    writeOutput("state", failedStatus.state);
    return failedStatus;
  }
}

async function pollWorkflow(inputs: WorkflowInputs): Promise<RunStatus> {
  const status = readRunStatus(inputs.reportsDirectory);
  if (status.state !== "devin-running" || status.devin === undefined) {
    throw new Error(
      "No running Devin session is recorded in the status artifact",
    );
  }
  const client = new DevinApiClient({
    apiKey: inputs.apiKey,
    organizationId: inputs.organizationId,
    requestTimeoutMilliseconds: inputs.requestTimeoutMilliseconds,
  });
  let observedStatus = status;
  let completedStatus: RunStatus;
  try {
    const result = await pollDevinSession(client, status.devin.sessionId, {
      timeoutMilliseconds: inputs.timeoutMilliseconds,
      intervalMilliseconds: inputs.intervalMilliseconds,
      initialSession: {
        status: status.devin.apiStatus as DevinApiStatus,
        ...(status.devin.statusDetail === undefined
          ? {}
          : { statusDetail: status.devin.statusDetail as DevinStatusDetail }),
      },
      onStatusChange: async (session) => {
        observedStatus = createObservedStatus(
          observedStatus,
          session,
          new Date().toISOString(),
        );
        writeDevinArtifacts(inputs.reportsDirectory, observedStatus);
        if (inputs.githubToken !== undefined) {
          const body = readFileSync(
            path.join(inputs.reportsDirectory, "remediation-update.md"),
            "utf8",
          );
          await publishIssueUpdate(inputs.githubToken, inputs.issueUrl, body);
        }
      },
    });
    completedStatus = createCompletedStatus(
      observedStatus,
      result,
      new Date().toISOString(),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    completedStatus = createFailedStatus(
      status,
      `Unable to monitor Devin session: ${message}`,
      new Date().toISOString(),
    );
  }
  writeDevinArtifacts(inputs.reportsDirectory, completedStatus);
  writeOutput("state", completedStatus.state);
  writeOutput(
    "pull-request-url",
    completedStatus.devin?.draftPullRequestUrl ?? "",
  );
  return completedStatus;
}

export async function main(): Promise<void> {
  const command = process.argv[2];
  const inputs = getWorkflowInputs();
  if (command === "start") {
    await startWorkflow(inputs);
    return;
  }
  if (command === "poll") {
    await pollWorkflow(inputs);
    return;
  }
  throw new Error("Expected command: start or poll");
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unexpected error";
    process.stderr.write(`Devin workflow failed: ${message}\n`);
    process.exitCode = 1;
  });
}
