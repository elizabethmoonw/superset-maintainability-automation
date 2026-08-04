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

test("counts one affected path even when it has multiple findings", () => {
  const findings = [
    finding("src/a.ts"),
    finding("src/a.ts", "exports", "unused"),
    finding("src/b.ts", "types", "OldType"),
  ];

  const snapshot = createSnapshot(identity, findings, findings);

  expect(snapshot.affectedFileCount).toBe(2);
  expect(snapshot.sharedFindingCount).toBe(3);
  expect(snapshot.byIssueType).toEqual({
    enumMembers: 0,
    exports: 1,
    files: 1,
    types: 1,
  });
});

test("derives new, persistent, and resolved files between snapshots", () => {
  const first = createSnapshot(
    identity,
    [finding("src/a.ts"), finding("src/b.ts")],
    [finding("src/a.ts"), finding("src/b.ts")],
  );
  const second = createSnapshot(
    { ...identity, snapshotId: "current", kind: "current" },
    [finding("src/b.ts"), finding("src/c.ts")],
    [finding("src/b.ts"), finding("src/c.ts")],
  );

  const movement = addSnapshotMovement([first, second]);

  expect(movement[0].newAffectedFileCount).toBe(2);
  expect(movement[1]).toMatchObject({
    newAffectedFileCount: 1,
    persistentAffectedFileCount: 1,
    resolvedAffectedFileCount: 1,
  });
});
