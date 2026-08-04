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

import { type BatchAttempt } from "./batchLedger";
import { type ObservabilityHistory } from "./observabilityData";
import { renderDashboard } from "./observabilityDashboard";

const history: ObservabilityHistory = {
  schemaVersion: 2,
  generatedAt: "2026-08-04T12:00:00Z",
  repository: "apache/superset",
  headCommitSha: "abcdef",
  scanner: {
    knipVersion: "6.31.0",
    productionConfigDigest: "a",
    productionPlusTestsConfigDigest: "b",
  },
  snapshots: [
    {
      snapshotId: "current",
      period: "2026-08",
      kind: "current",
      commitSha: "abcdef",
      committedAt: "2026-08-04T12:00:00Z",
      analyzerSignalCount: 12,
      analyzerPathCount: 7,
      byIssueType: { enumMembers: 0, exports: 2, files: 8, types: 2 },
      runtimeCandidateSignalCount: 10,
      runtimeCandidatePathCount: 6,
      diagnosticTypeSignalCount: 2,
      diagnosticTypePathCount: 2,
      newRuntimeCandidatePathCount: 6,
      persistentRuntimeCandidatePathCount: 0,
      noLongerFlaggedRuntimeCandidatePathCount: 0,
      analyzerPaths: [
        "src/a.ts",
        "src/b.ts",
        "src/c.ts",
        "src/d.ts",
        "src/e.ts",
        "src/f.ts",
        "src/type.ts",
      ],
      runtimeCandidatePaths: [
        "src/a.ts",
        "src/b.ts",
        "src/c.ts",
        "src/d.ts",
        "src/e.ts",
        "src/f.ts",
      ],
      diagnosticTypePaths: ["src/a.ts", "src/type.ts"],
      findingKeys: ["files\u0000src/a.ts\u0000"],
    },
  ],
  benchmarks: [
    {
      benchmarkId: "accepted",
      label: "Accepted <cleanup>",
      pullRequestUrl: "https://github.com/apache/superset/pull/1",
      mergedAt: "2026-06-01T00:00:00Z",
      beforeCommitSha: "before",
      afterCommitSha: "after",
      acceptedFilePaths: ["src/a.ts"],
      acceptedRuntimeCandidatePathsDetectedBefore: 1,
      acceptedRuntimeCandidatePathsRemainingAfter: 0,
      beforeRuntimeCandidatePathCount: 8,
      afterRuntimeCandidatePathCount: 7,
      beforeAnalyzerSignalCount: 13,
      afterAnalyzerSignalCount: 12,
    },
  ],
};

function attempt(
  batchKey: string,
  outcome: BatchAttempt["outcome"],
  attemptId: string,
): BatchAttempt {
  return {
    attemptId,
    batchKey,
    groupKeys: ["src/a.ts"],
    findingKeys: ["files\u0000src/a.ts\u0000"],
    offeredAt: "2026-08-04T12:00:00Z",
    outcome,
    pullRequestUrl: `https://github.com/apache/superset/pull/${attemptId}`,
  };
}

test("renders source-backed metrics and escapes external labels", () => {
  const html = renderDashboard(history, [
    attempt("merged", "pr-merged", "2"),
    attempt("closed", "pr-closed-unmerged", "3"),
    attempt("open", "draft-pr-open", "4"),
  ]);

  expect(html).toContain("Automation PR acceptance");
  expect(html).toContain("50%");
  expect(html).toContain("1 merged / 2 finally decided automation PRs");
  expect(html).toContain("Runtime review-candidate paths over time");
  expect(html).toContain("Type diagnostics");
  expect(html).toContain("All analyzer signals");
  expect(html).toContain("Detection evidence, not system performance");
  expect(html).toContain("This is detection evidence only");
  expect(html).not.toContain("cleanup backlog");
  expect(html).toContain("Accepted &lt;cleanup&gt;");
  expect(html).not.toContain("Accepted <cleanup>");
});

test("uses only the latest state of a batch", () => {
  const html = renderDashboard(history, [
    attempt("same-batch", "draft-pr-open", "4"),
    attempt("same-batch", "pr-merged", "4-pr-merged"),
  ]);

  expect(html).toContain("1 merged / 1 finally decided automation PRs");
  expect(html).toContain("Open automation PRs</span><strong>0");
});
