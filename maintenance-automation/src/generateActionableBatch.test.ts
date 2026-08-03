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
  EVIDENCE_NOTICE,
  MAX_ACTIONABLE_FINDINGS,
  calculateDigest,
  createFindingKey,
  generateActionableBatch,
  generateRunArtifacts,
  serializeActionableBatch,
} from "./generateActionableBatch";
import { type NormalizedFinding } from "./parseKnipReport";

function createFinding(
  issueType: NormalizedFinding["issueType"],
  normalizedPath: string,
  symbolName?: string,
  line = 1,
  col = 1,
): NormalizedFinding {
  const fileName = normalizedPath.split("/").at(-1) ?? normalizedPath;
  return {
    normalizedPath,
    fileName,
    fileExtension: fileName.endsWith(".tsx") ? "tsx" : "ts",
    filePath: normalizedPath,
    issueType,
    ...(symbolName === undefined ? {} : { symbolName }),
    line,
    col,
  };
}

const RUN_CONTEXT = {
  runId: "42",
  repository: "apache/superset",
  commitSha: "0123456789abcdef",
  workflowUrl: "https://github.com/apache/superset/actions/runs/42",
  startedAt: "2026-08-03T10:00:00.000Z",
  completedAt: "2026-08-03T10:00:02.500Z",
  artifactName: "maintenance-scan-42",
};

test("finding identity uses issue type, normalized path, and an empty file symbol", () => {
  const fileFinding = createFinding("files", "src/components/Unused.tsx");
  const exportFinding = createFinding(
    "exports",
    "src/components/Unused.tsx",
    "Unused",
  );

  expect(createFindingKey(fileFinding)).toBe(
    "files\u0000src/components/Unused.tsx\u0000",
  );
  expect(createFindingKey(exportFinding)).toBe(
    "exports\u0000src/components/Unused.tsx\u0000Unused",
  );
});

test("batch selects only findings present in both reports and preserves both evidence records", () => {
  const sharedProduction = createFinding(
    "exports",
    "src/shared.ts",
    "sharedValue",
    10,
  );
  const sharedProductionPlusTests = createFinding(
    "exports",
    "src/shared.ts",
    "sharedValue",
    12,
  );
  const batch = generateActionableBatch(
    [sharedProduction, createFinding("files", "src/productionOnly.ts")],
    [
      sharedProductionPlusTests,
      createFinding("types", "src/testScopeOnly.ts", "ScopeType"),
    ],
  );

  expect(batch.totalIntersectionCount).toBe(1);
  expect(batch.findings).toEqual([
    expect.objectContaining({
      normalizedPath: "src/shared.ts",
      symbolName: "sharedValue",
      productionEvidence: sharedProduction,
      productionPlusTestsEvidence: sharedProductionPlusTests,
    }),
  ]);
  expect(batch.evidenceNotice).toBe(EVIDENCE_NOTICE);
});

test("batch sorting and serialization are deterministic and capped at ten findings", () => {
  const findings = Array.from({ length: 12 }, (_, index) =>
    createFinding(
      "exports",
      `src/module-${String(index).padStart(2, "0")}.ts`,
      `symbol${index}`,
    ),
  );
  const forward = generateActionableBatch(findings, findings);
  const reversed = generateActionableBatch(
    [...findings].reverse(),
    [...findings].reverse(),
  );

  expect(forward.totalIntersectionCount).toBe(12);
  expect(forward.findings).toHaveLength(MAX_ACTIONABLE_FINDINGS);
  expect(serializeActionableBatch(forward)).toBe(
    serializeActionableBatch(reversed),
  );
  expect(forward.findings.map((finding) => finding.normalizedPath)).toEqual(
    findings
      .slice(0, MAX_ACTIONABLE_FINDINGS)
      .map((finding) => finding.normalizedPath),
  );
});

test("duplicate identities use numeric line and column order independent of input order", () => {
  const earlierEvidence = createFinding(
    "types",
    "src/types.ts",
    "UnusedType",
    4,
    2,
  );
  const laterColumnEvidence = createFinding(
    "types",
    "src/types.ts",
    "UnusedType",
    4,
    8,
  );
  const laterEvidence = createFinding(
    "types",
    "src/types.ts",
    "UnusedType",
    20,
  );
  const plusTestsEvidence = createFinding(
    "types",
    "src/types.ts",
    "UnusedType",
    8,
  );

  const first = generateActionableBatch(
    [laterEvidence, laterColumnEvidence, earlierEvidence],
    [plusTestsEvidence],
  );
  const second = generateActionableBatch(
    [earlierEvidence, laterColumnEvidence, laterEvidence],
    [plusTestsEvidence],
  );

  expect(first.findings).toHaveLength(1);
  expect(first.findings[0].productionEvidence.line).toBe(4);
  expect(first.findings[0].productionEvidence.col).toBe(2);
  expect(first).toEqual(second);
});

test("empty intersection produces no-action-needed status and no evidence rows", () => {
  const artifacts = generateRunArtifacts(
    [createFinding("files", "src/production.ts")],
    [createFinding("files", "src/productionPlusTests.ts")],
    "production report",
    "production plus tests report",
    RUN_CONTEXT,
  );

  expect(artifacts.status.state).toBe("no-action-needed");
  expect(artifacts.status.batchSize).toBe(0);
  expect(artifacts.status.elapsedMilliseconds).toBe(2500);
  expect(artifacts.summaryMarkdown).toContain(
    "No findings were present in both processed reports.",
  );
});

test("run artifacts contain concise status metadata and a content-addressed batch", () => {
  const shared = createFinding("files", "src/shared.ts");
  const artifacts = generateRunArtifacts(
    [shared],
    [shared],
    "production report",
    "production plus tests report",
    RUN_CONTEXT,
  );

  expect(artifacts.status).toEqual(
    expect.objectContaining({
      runId: RUN_CONTEXT.runId,
      repository: RUN_CONTEXT.repository,
      commitSha: RUN_CONTEXT.commitSha,
      batchSize: 1,
      state: "awaiting-approval",
      batchDigest: calculateDigest(artifacts.batchJson),
      reportDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      issueDedupeKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    }),
  );
  expect(artifacts.status.scanCounts).toEqual({
    production: {
      total: 1,
      byIssueType: { enumMembers: 0, exports: 0, files: 1, types: 0 },
    },
    productionPlusTests: {
      total: 1,
      byIssueType: { enumMembers: 0, exports: 0, files: 1, types: 0 },
    },
    intersection: 1,
  });
  expect(artifacts.summaryMarkdown).toContain(EVIDENCE_NOTICE);
  expect(artifacts.issueMarkdown).toContain(
    `<!-- maintenance-scan:${artifacts.status.issueDedupeKey} -->`,
  );
  expect(artifacts.issueMarkdown).toContain("`maintenance-scan-42`");
});

test("non-file findings without a symbol fail at the report boundary", () => {
  const invalidFinding = createFinding("exports", "src/invalid.ts");

  expect(() =>
    generateActionableBatch([invalidFinding], [invalidFinding]),
  ).toThrow("exports finding is missing a symbol name");
});
