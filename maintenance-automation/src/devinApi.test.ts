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

import {
  MAX_TOTAL_TIMEOUT_MS,
  DevinApiClient,
  buildDevinPrompt,
  createCompletedStatus,
  createObservedStatus,
  createRunningStatus,
  createSessionRecoveryTag,
  extractPersistedSessionReference,
  pollDevinSession,
  renderDevinSummary,
  renderPersistedSessionMarker,
  startOrReuseSession,
  type DevinSession,
  type PersistedSessionReference,
} from "./devinApi";
import {
  EVIDENCE_NOTICE,
  type ActionableBatch,
  type RunStatus,
} from "./generateActionableBatch";

const RUN_STATUS: RunStatus = {
  schemaVersion: 1,
  runId: "42",
  repository: "example/superset",
  commitSha: "0123456789abcdef",
  workflowUrl: "https://github.com/example/superset/actions/runs/42",
  scanCounts: {
    production: {
      total: 1,
      byIssueType: { enumMembers: 0, exports: 1, files: 0, types: 0 },
    },
    productionPlusTests: {
      total: 1,
      byIssueType: { enumMembers: 0, exports: 1, files: 0, types: 0 },
    },
    sharedEvidenceFindingCount: 1,
    actionableRuntimeCandidateCount: 1,
  },
  batchSize: 1,
  state: "awaiting-approval",
  progress: { selected: 1, active: 0, completed: 0, succeeded: 0, failed: 0 },
  timestamps: {
    startedAt: "2026-08-03T10:00:00.000Z",
    completedAt: "2026-08-03T10:00:02.000Z",
  },
  elapsedMilliseconds: 2000,
  reportDigest: "report-digest",
  batchDigest: "batch-digest",
  issueDedupeKey: "issue-key",
  artifactName: "maintenance-scan-42",
};

const FINDING = {
  normalizedPath: "src/unused.ts",
  fileName: "unused.ts",
  fileExtension: "ts",
  filePath: "src/unused.ts",
  issueType: "exports" as const,
  symbolName: "unusedExport",
  line: 5,
  col: 1,
};

const BATCH: ActionableBatch = {
  schemaVersion: 3,
  evidenceNotice: EVIDENCE_NOTICE,
  batchTargetSize: 10,
  inventory: {
    sharedEvidenceFindingCount: 1,
    diagnosticTypeFindingCount: 0,
    actionableRuntimeCandidateCount: 1,
    actionableRuntimeCandidateFileCount: 1,
    diagnosticTypeFindings: [],
    actionableRuntimeCandidates: [
      {
        findingKey: "exports\0src/unused.ts\0unusedExport",
        issueType: "exports",
        normalizedPath: "src/unused.ts",
        symbolName: "unusedExport",
        productionEvidence: FINDING,
        productionPlusTestsEvidence: FINDING,
      },
    ],
    candidateGroups: [
      {
        groupKey: "src/unused.ts",
        normalizedPath: "src/unused.ts",
        findingKeys: ["exports\0src/unused.ts\0unusedExport"],
        findingCount: 1,
      },
    ],
  },
  selectedBatch: {
    batchKey: "batch-digest",
    groupKeys: ["src/unused.ts"],
    filePaths: ["src/unused.ts"],
    findingCount: 1,
    oversizedSingleFile: false,
    findings: [
      {
        findingKey: "exports\0src/unused.ts\0unusedExport",
        issueType: "exports",
        normalizedPath: "src/unused.ts",
        symbolName: "unusedExport",
        productionEvidence: FINDING,
        productionPlusTestsEvidence: FINDING,
      },
    ],
  },
};

const RUNNING_SESSION: DevinSession = {
  sessionId: "devin-session-1",
  url: "https://app.devin.ai/sessions/devin-session-1",
  status: "running",
  statusDetail: "working",
  acusConsumed: 2.5,
  createdAt: "2026-08-03T10:00:00.000Z",
  tags: ["maintenance-recovery"],
  pullRequests: [],
};

interface RawSession {
  acus_consumed: number;
  session_id: string;
  url: string;
  status: DevinSession["status"];
  status_detail: string | null;
  created_at: number;
  tags: string[];
  pull_requests: Array<{ pr_state: string | null; pr_url: string }>;
}

function sessionBody(
  status: DevinSession["status"],
  pullRequests: Array<{ pr_state: string | null; pr_url: string }> = [],
  overrides: Partial<RawSession> = {},
): RawSession {
  return {
    acus_consumed: 2.5,
    session_id: "devin-session-1",
    url: "https://app.devin.ai/sessions/devin-session-1",
    status,
    status_detail: status === "running" ? "working" : "finished",
    created_at: Date.parse("2026-08-03T10:00:00.000Z") / 1000,
    tags: ["maintenance-recovery"],
    pull_requests: pullRequests,
    ...overrides,
  };
}

function sessionResponse(
  status: DevinSession["status"],
  pullRequests: Array<{ pr_state: string | null; pr_url: string }> = [],
  overrides: Partial<RawSession> = {},
): Response {
  return new Response(
    JSON.stringify(sessionBody(status, pullRequests, overrides)),
    {
      status: 200,
    },
  );
}

function sessionPageResponse(
  items: RawSession[],
  nextCursor?: string,
): Response {
  return new Response(
    JSON.stringify({
      items,
      has_next_page: nextCursor !== undefined,
      end_cursor: nextCursor ?? null,
    }),
    { status: 200 },
  );
}

const CREATE_REQUEST = {
  prompt: "Investigate evidence",
  repos: ["https://github.com/example/superset"],
  title: "Maintenance evidence",
  maxAcuLimit: 50,
  tags: ["maintenance-recovery"],
};

const RECOVERY_SEARCH = {
  tag: "maintenance-recovery",
  createdAfterSeconds: 1_700_000_000,
};

test("create session accepts the documented acknowledgement", async () => {
  const fetchMock = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          session_id: "devin-session-1",
          url: "https://app.devin.ai/sessions/devin-session-1",
          status: "new",
        }),
        { status: 200 },
      ),
    );
  const client = new DevinApiClient(
    {
      apiKey: "secret-token",
      organizationId: "org-example",
    },
    fetchMock,
  );

  const session = await client.createSession(CREATE_REQUEST);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, request] = fetchMock.mock.calls[0];
  expect(url).toBe(
    "https://api.devin.ai/v3/organizations/org-example/sessions",
  );
  expect(request).toEqual(
    expect.objectContaining({
      method: "POST",
      headers: {
        Authorization: "Bearer secret-token",
        "Content-Type": "application/json",
      },
    }),
  );
  expect(JSON.parse(String(request?.body))).toEqual({
    prompt: "Investigate evidence",
    repos: ["https://github.com/example/superset"],
    title: "Maintenance evidence",
    max_acu_limit: 50,
    bypass_approval: true,
    structured_output_required: false,
    tags: ["maintenance-recovery"],
  });
  expect(request?.headers).not.toHaveProperty("Idempotency-Key");
  expect(session.sessionId).toBe("devin-session-1");
  expect(session.acusConsumed).toBe(0);
  expect(session.tags).toEqual(["maintenance-recovery"]);
});

test("v3 response accepts nullable PR state and user usage suspension detail", async () => {
  const fetchMock = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValue(
      sessionResponse(
        "suspended",
        [
          {
            pr_state: null,
            pr_url: "https://github.com/example/superset/pull/9",
          },
        ],
        { status_detail: "user_usage_limit_exceeded" },
      ),
    );
  const client = new DevinApiClient(
    { apiKey: "token", organizationId: "org-example" },
    fetchMock,
  );

  const session = await client.getSession("devin-session-1");

  expect(session.statusDetail).toBe("user_usage_limit_exceeded");
  expect(session.acusConsumed).toBe(2.5);
  expect(session.pullRequests[0].state).toBeNull();
  expect(session.createdAt).toBe("2026-08-03T10:00:00.000Z");
});

test("v3 response rejects invalid ACU consumption", async () => {
  const fetchMock = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValue(sessionResponse("running", [], { acus_consumed: -1 }));
  const client = new DevinApiClient(
    { apiKey: "token", organizationId: "org-example" },
    fetchMock,
  );

  await expect(client.getSession("devin-session-1")).rejects.toThrow(
    "invalid session response",
  );
});

test("each API request aborts at its configured timeout", async () => {
  const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(
    async (_input, request) =>
      new Promise<Response>((_resolve, reject) => {
        request?.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      }),
  );
  const client = new DevinApiClient(
    {
      apiKey: "token",
      organizationId: "org-example",
      requestTimeoutMilliseconds: 1,
    },
    fetchMock,
  );

  await expect(client.getSession("devin-session-1")).rejects.toThrow(
    "Devin API request timed out after 1 milliseconds",
  );
  expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
});

test("prompt fixes the approved SHA and requires investigation, a linked draft PR, and no merge", () => {
  const issueUrl = "https://github.com/example/superset/issues/7";
  const prompt = buildDevinPrompt(RUN_STATUS, BATCH, issueUrl);

  expect(prompt).toContain(RUN_STATUS.commitSha);
  expect(prompt).toContain(RUN_STATUS.workflowUrl);
  expect(prompt).toContain(issueUrl);
  expect(prompt).toContain(EVIDENCE_NOTICE);
  expect(prompt).toContain("Investigate every finding before changing code");
  expect(prompt).toContain("src/unused.ts (unusedExport)");
  expect(prompt).toContain("Create one draft pull request");
  expect(prompt).toContain("never merge it");
  expect(prompt).toContain("tests run, unresolved findings");
});

test("persisted session is retrieved instead of creating another session", async () => {
  const fetchMock = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockImplementation(async () => sessionResponse("running"));
  const client = new DevinApiClient(
    { apiKey: "token", organizationId: "org-example" },
    fetchMock,
  );

  const result = await startOrReuseSession(
    client,
    CREATE_REQUEST,
    RECOVERY_SEARCH,
    "devin-session-1",
  );

  expect(result.reused).toBe(true);
  expect(result.session.sessionId).toBe("devin-session-1");
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.devin.ai/v3/organizations/org-example/sessions/devin-session-1",
    expect.objectContaining({ method: "GET" }),
  );
});

test("persisted session must carry the approved recovery tag", async () => {
  const fetchMock = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValue(
      sessionResponse("running", [], { tags: ["different-batch"] }),
    );
  const client = new DevinApiClient(
    { apiKey: "token", organizationId: "org-example" },
    fetchMock,
  );

  await expect(
    startOrReuseSession(
      client,
      CREATE_REQUEST,
      RECOVERY_SEARCH,
      "devin-session-1",
    ),
  ).rejects.toThrow("does not match the approved batch");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("stable recovery tag is scoped to repository, commit, and approved batch", () => {
  const tag = createSessionRecoveryTag(
    "example/superset",
    "approved-commit",
    "batch-digest",
  );

  expect(tag).toMatch(/^maintenance-[a-f0-9]{40}$/);
  expect(
    createSessionRecoveryTag(
      "example/superset",
      "approved-commit",
      "batch-digest",
    ),
  ).toBe(tag);
  expect(
    createSessionRecoveryTag(
      "example/superset",
      "different-commit",
      "batch-digest",
    ),
  ).not.toBe(tag);
  expect(
    createSessionRecoveryTag(
      "example/superset",
      "approved-commit",
      "other-batch",
    ),
  ).not.toBe(tag);
});

test("crash recovery reuses one matching tagged session with its original time", async () => {
  const recovered = sessionBody("running", [], {
    created_at: Date.parse("2026-08-03T09:45:00.000Z") / 1000,
    tags: [RECOVERY_SEARCH.tag],
  });
  const fetchMock = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValue(sessionPageResponse([recovered]));
  const client = new DevinApiClient(
    { apiKey: "token", organizationId: "org-example" },
    fetchMock,
  );

  const result = await startOrReuseSession(
    client,
    CREATE_REQUEST,
    RECOVERY_SEARCH,
  );
  const runningStatus = createRunningStatus(
    RUN_STATUS,
    "https://github.com/example/superset/issues/7",
    result.session,
    result.reused,
    50,
  );

  expect(result.reused).toBe(true);
  expect(runningStatus.devin?.startedAt).toBe("2026-08-03T09:45:00.000Z");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe(
    "https://api.devin.ai/v3/organizations/org-example/sessions?first=200&created_after=1700000000",
  );
});

test("recovery accepts an API-returned session ID without a devin prefix", async () => {
  const fetchMock = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValue(
      sessionPageResponse([
        sessionBody("running", [], {
          session_id: "legacy-session-1",
          tags: [RECOVERY_SEARCH.tag],
        }),
      ]),
    );
  const client = new DevinApiClient(
    { apiKey: "token", organizationId: "org-example" },
    fetchMock,
  );

  const result = await startOrReuseSession(
    client,
    CREATE_REQUEST,
    RECOVERY_SEARCH,
  );

  expect(result.reused).toBe(true);
  expect(result.session.sessionId).toBe("legacy-session-1");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("recovery follows documented pagination before creating one tagged session", async () => {
  const fetchMock = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValueOnce(sessionPageResponse([], "next-page"))
    .mockResolvedValueOnce(sessionPageResponse([]))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          session_id: "devin-session-1",
          url: "https://app.devin.ai/sessions/devin-session-1",
          status: "new",
        }),
        { status: 200 },
      ),
    );
  const client = new DevinApiClient(
    { apiKey: "token", organizationId: "org-example" },
    fetchMock,
  );

  const result = await startOrReuseSession(
    client,
    CREATE_REQUEST,
    RECOVERY_SEARCH,
  );

  expect(result.reused).toBe(false);
  expect(fetchMock.mock.calls[1][0]).toBe(
    "https://api.devin.ai/v3/organizations/org-example/sessions?first=200&created_after=1700000000&after=next-page",
  );
  expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body)).tags).toEqual([
    RECOVERY_SEARCH.tag,
  ]);
});

test("recovery refuses to create when a tag matches multiple sessions", async () => {
  const fetchMock = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValue(
      sessionPageResponse([
        sessionBody("running", [], {
          session_id: "devin-session-1",
          tags: [RECOVERY_SEARCH.tag],
        }),
        sessionBody("exit", [], {
          session_id: "devin-session-2",
          tags: [RECOVERY_SEARCH.tag],
        }),
      ]),
    );
  const client = new DevinApiClient(
    { apiKey: "token", organizationId: "org-example" },
    fetchMock,
  );

  await expect(
    startOrReuseSession(client, CREATE_REQUEST, RECOVERY_SEARCH),
  ).rejects.toThrow("Found 2 Devin sessions");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("polling stops at documented exit status and captures the pull request", async () => {
  const fetchMock = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValueOnce(sessionResponse("running"))
    .mockResolvedValueOnce(
      sessionResponse("exit", [
        {
          pr_state: "open",
          pr_url: "https://github.com/example/superset/pull/9",
        },
      ]),
    );
  const client = new DevinApiClient(
    { apiKey: "token", organizationId: "org-example" },
    fetchMock,
  );

  const onStatusChange = jest.fn();
  const result = await pollDevinSession(client, "devin-session-1", {
    timeoutMilliseconds: 100,
    intervalMilliseconds: 10,
    initialSession: RUNNING_SESSION,
    onStatusChange,
    now: jest.fn().mockReturnValueOnce(0).mockReturnValueOnce(0),
    sleep: async () => undefined,
  });

  expect(result.timedOut).toBe(false);
  expect(result.session.status).toBe("exit");
  expect(result.session.pullRequests[0].url).toBe(
    "https://github.com/example/superset/pull/9",
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(onStatusChange).toHaveBeenCalledTimes(1);
  expect(onStatusChange).toHaveBeenCalledWith(
    expect.objectContaining({ status: "exit", statusDetail: "finished" }),
  );
});

test.each(["waiting_for_user", "finished"] as const)(
  "polling terminates a delivered session in %s state",
  async (statusDetail) => {
    const pullRequests = [
      {
        pr_state: "open",
        pr_url: "https://github.com/example/superset/pull/9",
      },
    ];
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(
        sessionResponse("running", pullRequests, {
          status_detail: statusDetail,
        }),
      )
      .mockResolvedValueOnce(sessionResponse("exit", pullRequests));
    const client = new DevinApiClient(
      { apiKey: "token", organizationId: "org-example" },
      fetchMock,
    );

    const result = await pollDevinSession(client, "devin-session-1", {
      timeoutMilliseconds: 100,
      intervalMilliseconds: 10,
      now: jest.fn().mockReturnValue(0),
      sleep: async () => undefined,
    });

    expect(result).toEqual(
      expect.objectContaining({
        timedOut: false,
        session: expect.objectContaining({
          status: "exit",
          pullRequests: [
            expect.objectContaining({
              url: "https://github.com/example/superset/pull/9",
            }),
          ],
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.devin.ai/v3/organizations/org-example/sessions/devin-session-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  },
);

test("polling keeps waiting when Devin needs input before producing a pull request", async () => {
  const fetchMock = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValue(
      sessionResponse("running", [], {
        status_detail: "waiting_for_user",
      }),
    );
  const client = new DevinApiClient(
    { apiKey: "token", organizationId: "org-example" },
    fetchMock,
  );

  const result = await pollDevinSession(client, "devin-session-1", {
    timeoutMilliseconds: 100,
    intervalMilliseconds: 10,
    now: jest.fn().mockReturnValueOnce(0).mockReturnValueOnce(100),
    sleep: async () => undefined,
  });

  expect(result.timedOut).toBe(true);
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    "https://api.devin.ai/v3/organizations/org-example/sessions/devin-session-1",
    expect.objectContaining({ method: "DELETE" }),
  );
});

test("creation acknowledgement flows through polling to a pull request", async () => {
  const fetchMock = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValueOnce(sessionPageResponse([]))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          session_id: "devin-session-1",
          url: "https://app.devin.ai/sessions/devin-session-1",
          status: "new",
        }),
        { status: 200 },
      ),
    )
    .mockResolvedValueOnce(sessionResponse("running"))
    .mockResolvedValueOnce(
      sessionResponse("exit", [
        {
          pr_state: "open",
          pr_url: "https://github.com/example/superset/pull/9",
        },
      ]),
    );
  const client = new DevinApiClient(
    { apiKey: "token", organizationId: "org-example" },
    fetchMock,
  );

  const started = await startOrReuseSession(
    client,
    CREATE_REQUEST,
    RECOVERY_SEARCH,
  );
  const result = await pollDevinSession(client, started.session.sessionId, {
    timeoutMilliseconds: 100,
    intervalMilliseconds: 10,
    initialSession: started.session,
    now: jest.fn().mockReturnValue(0),
    sleep: async () => undefined,
  });

  expect(started.reused).toBe(false);
  expect(started.session.status).toBe("new");
  expect(result.timedOut).toBe(false);
  expect(result.session.status).toBe("exit");
  expect(result.session.pullRequests[0].url).toBe(
    "https://github.com/example/superset/pull/9",
  );
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

test("polling terminates the session at the configured timeout", async () => {
  const fetchMock = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockImplementation(async () => sessionResponse("running"));
  const client = new DevinApiClient(
    { apiKey: "token", organizationId: "org-example" },
    fetchMock,
  );
  const now = jest.fn().mockReturnValueOnce(0).mockReturnValueOnce(100);

  const result = await pollDevinSession(client, "devin-session-1", {
    timeoutMilliseconds: 100,
    intervalMilliseconds: 10,
    now,
    sleep: async () => undefined,
  });

  expect(result.timedOut).toBe(true);
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    "https://api.devin.ai/v3/organizations/org-example/sessions/devin-session-1",
    expect.objectContaining({ method: "DELETE" }),
  );
});

test("polling rejects a total timeout that can exceed the workflow budget", async () => {
  const fetchMock = jest.fn<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >();
  const client = new DevinApiClient(
    { apiKey: "token", organizationId: "org-example" },
    fetchMock,
  );

  await expect(
    pollDevinSession(client, "devin-session-1", {
      timeoutMilliseconds: MAX_TOTAL_TIMEOUT_MS + 1,
      intervalMilliseconds: 10,
    }),
  ).rejects.toThrow(`total timeout must be an integer from 1 through`);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("timeout remains explicit when session termination fails", async () => {
  const fetchMock = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValueOnce(sessionResponse("running"))
    .mockResolvedValueOnce(
      new Response("termination unavailable", { status: 503 }),
    );
  const client = new DevinApiClient(
    { apiKey: "token", organizationId: "org-example" },
    fetchMock,
  );
  const result = await pollDevinSession(client, "devin-session-1", {
    timeoutMilliseconds: 100,
    intervalMilliseconds: 10,
    now: jest.fn().mockReturnValueOnce(0).mockReturnValueOnce(100),
    sleep: async () => undefined,
  });
  const completed = createCompletedStatus(
    createRunningStatus(
      RUN_STATUS,
      "https://github.com/example/superset/issues/7",
      RUNNING_SESSION,
      false,
      50,
    ),
    result,
    "2026-08-03T10:30:00.000Z",
  );

  expect(result).toEqual(
    expect.objectContaining({
      timedOut: true,
      terminationFailure: expect.stringContaining("HTTP 503"),
    }),
  );
  expect(completed.state).toBe("devin-failed");
  expect(completed.devin).toEqual(
    expect.objectContaining({ apiStatus: "running", timedOut: true }),
  );
  expect(completed.failure).toContain(
    "last observed status running; session termination failed",
  );
  expect(completed.devin?.draftPullRequestUrl).toBeUndefined();
});

test("completed status reports one batch outcome rather than one outcome per finding", () => {
  const tenFindingStatus: RunStatus = {
    ...RUN_STATUS,
    batchSize: 10,
    progress: {
      selected: 10,
      active: 0,
      completed: 0,
      succeeded: 0,
      failed: 0,
    },
  };
  const started = createRunningStatus(
    tenFindingStatus,
    "https://github.com/example/superset/issues/7",
    RUNNING_SESSION,
    false,
    50,
  );
  const succeeded = createCompletedStatus(
    started,
    {
      timedOut: false,
      session: {
        ...RUNNING_SESSION,
        status: "exit",
        statusDetail: "finished",
        acusConsumed: 12.75,
        pullRequests: [
          {
            state: "open",
            url: "https://github.com/example/superset/pull/9",
          },
        ],
      },
    },
    "2026-08-03T10:30:00.000Z",
  );
  const failed = createCompletedStatus(
    started,
    {
      timedOut: false,
      session: {
        ...RUNNING_SESSION,
        status: "suspended",
        statusDetail: "out_of_credits",
        acusConsumed: 7,
      },
    },
    "2026-08-03T10:30:00.000Z",
  );

  expect(succeeded.state).toBe("draft-pr-ready");
  expect(succeeded.progress).toEqual({
    selected: 1,
    active: 0,
    completed: 1,
    succeeded: 1,
    failed: 0,
    successRate: 1,
    completedPerHour: 2,
  });
  expect(renderDevinSummary(succeeded)).toContain(
    "https://github.com/example/superset/pull/9",
  );
  expect(renderDevinSummary(succeeded)).toContain("Findings in batch: 10");
  expect(renderDevinSummary(succeeded)).toContain(
    "Batches with a verified draft PR: 1",
  );
  expect(renderDevinSummary(succeeded)).toContain("Per-session ACU cap: 50");
  expect(renderDevinSummary(succeeded)).toContain("ACUs consumed: 12.75");
  expect(succeeded.devin?.acusConsumed).toBe(12.75);
  expect(failed.state).toBe("devin-failed");
  expect(failed.failure).toContain("out_of_credits");
  expect(failed.devin?.draftPullRequestUrl).toBeUndefined();
});

test("completed status still requires exactly one pull request", () => {
  const started = createRunningStatus(
    RUN_STATUS,
    "https://github.com/example/superset/issues/7",
    RUNNING_SESSION,
    false,
    50,
  );
  const pullRequest = {
    state: "open",
    url: "https://github.com/example/superset/pull/9",
  };

  for (const pullRequests of [[], [pullRequest, pullRequest]]) {
    const completed = createCompletedStatus(
      started,
      {
        timedOut: false,
        session: {
          ...RUNNING_SESSION,
          status: "exit",
          statusDetail: "finished",
          pullRequests,
        },
      },
      "2026-08-03T10:30:00.000Z",
    );

    expect(completed.state).toBe("devin-failed");
    expect(completed.failure).toBe(
      `Devin completed with ${pullRequests.length} pull requests; expected exactly one`,
    );
  }
});

test("observed status exposes API transitions without completing the run", () => {
  const running = createRunningStatus(
    RUN_STATUS,
    "https://github.com/example/superset/issues/7",
    RUNNING_SESSION,
    false,
    50,
  );

  const observed = createObservedStatus(
    running,
    {
      ...RUNNING_SESSION,
      status: "claimed",
      statusDetail: "waiting_for_user",
      acusConsumed: 3.75,
    },
    "2026-08-03T10:05:00.000Z",
  );

  expect(observed.state).toBe("devin-running");
  expect(observed.devin).toEqual(
    expect.objectContaining({
      apiStatus: "claimed",
      statusDetail: "waiting_for_user",
      acusConsumed: 3.75,
      elapsedMilliseconds: 300_000,
    }),
  );
  expect(observed.progress.active).toBe(1);
  expect(observed.progress.completed).toBe(0);
});

test("session marker round-trips only for its approved batch", () => {
  const reference: PersistedSessionReference = {
    batchDigest: "batch-digest",
    sessionId: "devin-session-1",
    sessionUrl: "https://app.devin.ai/sessions/devin-session-1",
  };
  const issueBody = `${renderPersistedSessionMarker(reference)}\nissue body`;

  expect(extractPersistedSessionReference(issueBody, "batch-digest")).toEqual(
    reference,
  );
  expect(
    extractPersistedSessionReference(issueBody, "different-batch"),
  ).toBeUndefined();
});
