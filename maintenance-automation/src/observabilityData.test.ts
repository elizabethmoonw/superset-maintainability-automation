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

import { type NormalizedFinding } from "./parseKnipReport";
import {
  addSnapshotMovement,
  createSnapshot,
  intersectFindings,
  validateObservabilityHistory,
} from "./observabilityData";

function finding(
  normalizedPath: string,
  issueType: NormalizedFinding["issueType"] = "files",
  symbolName?: string,
): NormalizedFinding {
  const fileName = normalizedPath.split("/").at(-1)!;
  return {
    normalizedPath,
    filePath: normalizedPath,
    fileName,
    fileExtension: fileName.split(".").at(-1)!,
    issueType,
    ...(symbolName === undefined ? {} : { symbolName }),
  };
}

const identity = {
  snapshotId: "month-end-2026-07",
  period: "2026-07",
  kind: "month-end" as const,
  commitSha: "abc",
  committedAt: "2026-07-31T00:00:00Z",
};

test("intersects scans at finding identity grain", () => {
  const wholeFile = finding("src/a.ts");
  const unusedExport = finding("src/a.ts", "exports", "unused");
  const productionOnly = finding("src/b.ts");

  expect(
    intersectFindings(
      [wholeFile, unusedExport, productionOnly],
      [unusedExport, wholeFile],
    ),
  ).toEqual([unusedExport, wholeFile]);
});

test("separates runtime review candidates from type diagnostics", () => {
  const findings = [
    finding("src/a.ts"),
    finding("src/a.ts", "exports", "unused"),
    finding("src/b.ts", "types", "OldType"),
    finding("src/a.ts", "types", "LocalType"),
  ];

  const snapshot = createSnapshot(identity, findings, findings);

  expect(snapshot.analyzerSignalCount).toBe(4);
  expect(snapshot.analyzerPathCount).toBe(2);
  expect(snapshot.runtimeCandidateSignalCount).toBe(2);
  expect(snapshot.runtimeCandidatePathCount).toBe(1);
  expect(snapshot.runtimeCandidatePaths).toEqual(["src/a.ts"]);
  expect(snapshot.diagnosticTypeSignalCount).toBe(2);
  expect(snapshot.diagnosticTypePathCount).toBe(2);
  expect(snapshot.diagnosticTypePaths).toEqual(["src/a.ts", "src/b.ts"]);
  expect(snapshot.byIssueType).toEqual({
    enumMembers: 0,
    exports: 1,
    files: 1,
    types: 2,
  });
});

test("derives movement from runtime candidate paths only", () => {
  const first = createSnapshot(
    identity,
    [
      finding("src/a.ts"),
      finding("src/b.ts"),
      finding("src/type-a.ts", "types", "TypeA"),
    ],
    [
      finding("src/a.ts"),
      finding("src/b.ts"),
      finding("src/type-a.ts", "types", "TypeA"),
    ],
  );
  const second = createSnapshot(
    { ...identity, snapshotId: "current", kind: "current" },
    [
      finding("src/b.ts"),
      finding("src/c.ts"),
      finding("src/type-b.ts", "types", "TypeB"),
    ],
    [
      finding("src/b.ts"),
      finding("src/c.ts"),
      finding("src/type-b.ts", "types", "TypeB"),
    ],
  );

  const movement = addSnapshotMovement([first, second]);

  expect(movement[0].newRuntimeCandidatePathCount).toBe(2);
  expect(movement[1]).toMatchObject({
    newRuntimeCandidatePathCount: 1,
    persistentRuntimeCandidatePathCount: 1,
    noLongerFlaggedRuntimeCandidatePathCount: 1,
  });
});

test("rejects observability history from the ambiguous schema", () => {
  expect(() =>
    validateObservabilityHistory({
      schemaVersion: 1,
      snapshots: [],
      benchmarks: [],
    }),
  ).toThrow("Invalid observability history");
});
