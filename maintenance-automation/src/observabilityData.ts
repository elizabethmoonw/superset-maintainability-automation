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

import { createFindingKey, type IssueType } from "./generateActionableBatch";
import { type NormalizedFinding } from "./parseKnipReport";

export const OBSERVABILITY_SCHEMA_VERSION = 1;

export interface IssueTypeCounts {
  enumMembers: number;
  exports: number;
  files: number;
  types: number;
}

export interface FindingSnapshot {
  snapshotId: string;
  period: string;
  kind: "month-end" | "current";
  commitSha: string;
  committedAt: string;
  sharedFindingCount: number;
  affectedFileCount: number;
  byIssueType: IssueTypeCounts;
  newAffectedFileCount: number;
  persistentAffectedFileCount: number;
  resolvedAffectedFileCount: number;
  affectedFilePaths: string[];
  findingKeys: string[];
}

export interface HistoricalBenchmark {
  benchmarkId: string;
  label: string;
  pullRequestUrl: string;
  mergedAt: string;
  beforeCommitSha: string;
  afterCommitSha: string;
  acceptedFilePaths: string[];
  acceptedFilesDetectedBefore: number;
  acceptedFilesRemainingAfter: number;
  beforeAffectedFileCount: number;
  afterAffectedFileCount: number;
  beforeSharedFindingCount: number;
  afterSharedFindingCount: number;
}

export interface ScannerIdentity {
  knipVersion: string;
  productionConfigDigest: string;
  productionPlusTestsConfigDigest: string;
}

export interface ObservabilityHistory {
  schemaVersion: 1;
  generatedAt: string;
  repository: string;
  headCommitSha: string;
  scanner: ScannerIdentity;
  snapshots: FindingSnapshot[];
  benchmarks: HistoricalBenchmark[];
}

export interface SnapshotIdentity {
  snapshotId: string;
  period: string;
  kind: FindingSnapshot["kind"];
  commitSha: string;
  committedAt: string;
}

const ISSUE_TYPES: readonly IssueType[] = [
  "enumMembers",
  "exports",
  "files",
  "types",
];

function emptyIssueTypeCounts(): IssueTypeCounts {
  return { enumMembers: 0, exports: 0, files: 0, types: 0 };
}

export function intersectFindings(
  productionFindings: readonly NormalizedFinding[],
  productionPlusTestsFindings: readonly NormalizedFinding[],
): NormalizedFinding[] {
  const productionPlusTestsKeys = new Set(
    productionPlusTestsFindings.map(createFindingKey),
  );
  const sharedByKey = new Map<string, NormalizedFinding>();
  for (const finding of productionFindings) {
    const findingKey = createFindingKey(finding);
    if (
      productionPlusTestsKeys.has(findingKey) &&
      !sharedByKey.has(findingKey)
    ) {
      sharedByKey.set(findingKey, finding);
    }
  }
  return [...sharedByKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, finding]) => finding);
}

export function createSnapshot(
  identity: SnapshotIdentity,
  productionFindings: readonly NormalizedFinding[],
  productionPlusTestsFindings: readonly NormalizedFinding[],
): FindingSnapshot {
  const sharedFindings = intersectFindings(
    productionFindings,
    productionPlusTestsFindings,
  );
  const byIssueType = sharedFindings.reduce<IssueTypeCounts>(
    (counts, finding) => ({
      ...counts,
      [finding.issueType]: counts[finding.issueType] + 1,
    }),
    emptyIssueTypeCounts(),
  );
  const affectedFilePaths = [
    ...new Set(sharedFindings.map(({ normalizedPath }) => normalizedPath)),
  ].sort();
  return {
    ...identity,
    sharedFindingCount: sharedFindings.length,
    affectedFileCount: affectedFilePaths.length,
    byIssueType,
    newAffectedFileCount: 0,
    persistentAffectedFileCount: 0,
    resolvedAffectedFileCount: 0,
    affectedFilePaths,
    findingKeys: sharedFindings.map(createFindingKey).sort(),
  };
}

export function addSnapshotMovement(
  snapshots: readonly FindingSnapshot[],
): FindingSnapshot[] {
  return snapshots.map((snapshot, index) => {
    if (index === 0) {
      return {
        ...snapshot,
        newAffectedFileCount: snapshot.affectedFileCount,
      };
    }
    const previousPaths = new Set(snapshots[index - 1].affectedFilePaths);
    const currentPaths = new Set(snapshot.affectedFilePaths);
    return {
      ...snapshot,
      newAffectedFileCount: snapshot.affectedFilePaths.filter(
        (filePath) => !previousPaths.has(filePath),
      ).length,
      persistentAffectedFileCount: snapshot.affectedFilePaths.filter(
        (filePath) => previousPaths.has(filePath),
      ).length,
      resolvedAffectedFileCount: snapshots[index - 1].affectedFilePaths.filter(
        (filePath) => !currentPaths.has(filePath),
      ).length,
    };
  });
}

export function validateObservabilityHistory(
  value: unknown,
): ObservabilityHistory {
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== OBSERVABILITY_SCHEMA_VERSION ||
    !("snapshots" in value) ||
    !Array.isArray(value.snapshots) ||
    !("benchmarks" in value) ||
    !Array.isArray(value.benchmarks)
  ) {
    throw new Error("Invalid observability history");
  }
  return value as ObservabilityHistory;
}

export function serializeObservabilityHistory(
  history: ObservabilityHistory,
): string {
  return `${JSON.stringify(history, null, 2)}\n`;
}

export function issueTypes(): readonly IssueType[] {
  return ISSUE_TYPES;
}
