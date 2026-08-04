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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import {
  type BatchAttempt,
  type BatchLedger,
  createEmptyBatchLedger,
  parseBatchLedger,
} from "./batchLedger";
import { type NormalizedFinding } from "./parseKnipReport";

export const BATCH_TARGET_FINDINGS = 10;
export const MAX_ACTIONABLE_FINDINGS = BATCH_TARGET_FINDINGS;
export const EVIDENCE_NOTICE =
  "Knip findings are evidence to investigate, not approved deletions.";

export type MaintenanceRunState =
  | "scan-failed"
  | "no-action-needed"
  | "no-eligible-batch"
  | "awaiting-approval"
  | "approval-rejected"
  | "devin-running"
  | "devin-failed"
  | "draft-pr-ready";
export type IssueType = NormalizedFinding["issueType"];

export interface TaskProgress {
  selected: number;
  active: number;
  completed: number;
  succeeded: number;
  failed: number;
  successRate?: number;
  completedPerHour?: number;
}

export interface DevinRunStatus {
  sessionId: string;
  sessionUrl: string;
  apiStatus: string;
  statusDetail?: string;
  draftPullRequestUrl?: string;
  reused: boolean;
  timedOut: boolean;
  startedAt: string;
  completedAt?: string;
  elapsedMilliseconds: number;
  maxAcuLimit?: number;
  acusConsumed?: number;
}

export interface ActionableBatchFinding {
  findingKey: string;
  issueType: IssueType;
  normalizedPath: string;
  symbolName: string;
  productionEvidence: NormalizedFinding;
  productionPlusTestsEvidence: NormalizedFinding;
}

export interface CandidateGroup {
  groupKey: string;
  normalizedPath: string;
  findingKeys: string[];
  findingCount: number;
}

export interface FindingInventory {
  sharedEvidenceFindingCount: number;
  diagnosticTypeFindingCount: number;
  actionableRuntimeCandidateCount: number;
  actionableRuntimeCandidateFileCount: number;
  diagnosticTypeFindings: ActionableBatchFinding[];
  actionableRuntimeCandidates: ActionableBatchFinding[];
  candidateGroups: CandidateGroup[];
}

export interface SelectedBatch {
  batchKey: string;
  groupKeys: string[];
  filePaths: string[];
  findingCount: number;
  oversizedSingleFile: boolean;
  findings: ActionableBatchFinding[];
}

export interface ActionableBatch {
  schemaVersion: 3;
  evidenceNotice: string;
  batchTargetSize: number;
  inventory: FindingInventory;
  selectedBatch: SelectedBatch | null;
}

export interface ScanCount {
  total: number;
  byIssueType: Record<IssueType, number>;
}

export interface ScanCounts {
  production: ScanCount;
  productionPlusTests: ScanCount;
  sharedEvidenceFindingCount: number;
  actionableRuntimeCandidateCount: number;
}

export interface RunStatus {
  schemaVersion: 1;
  runId: string;
  repository: string;
  commitSha: string;
  workflowUrl: string;
  scanCounts: ScanCounts;
  batchSize: number;
  state: MaintenanceRunState;
  issueUrl?: string;
  failure?: string;
  progress: TaskProgress;
  devin?: DevinRunStatus;
  timestamps: {
    startedAt: string;
    completedAt: string;
  };
  elapsedMilliseconds: number;
  reportDigest: string;
  batchDigest: string;
  issueDedupeKey: string;
  artifactName: string;
}

export interface RunContext {
  runId: string;
  repository: string;
  commitSha: string;
  workflowUrl: string;
  startedAt: string;
  completedAt: string;
  artifactName: string;
}

export interface GeneratedRunArtifacts {
  batch: ActionableBatch;
  batchJson: string;
  batchDigest: string;
  reportDigest: string;
  status: RunStatus;
  summaryMarkdown: string;
  issueMarkdown: string;
}

export interface BatchSelectionOptions {
  ledger?: BatchLedger;
  targetFindingCount?: number;
}

const ISSUE_TYPES: IssueType[] = ["enumMembers", "exports", "files", "types"];

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function getIdentitySymbol(finding: NormalizedFinding): string {
  if (finding.issueType === "files") {
    return "";
  }
  if (finding.symbolName === undefined) {
    throw new Error(`${finding.issueType} finding is missing a symbol name`);
  }
  return finding.symbolName;
}

export function createFindingKey(finding: NormalizedFinding): string {
  return [
    finding.issueType,
    finding.normalizedPath,
    getIdentitySymbol(finding),
  ].join("\u0000");
}

function compareFindings(
  left: NormalizedFinding,
  right: NormalizedFinding,
): number {
  const identityComparison = compareStrings(
    createFindingKey(left),
    createFindingKey(right),
  );
  if (identityComparison !== 0) {
    return identityComparison;
  }

  return (
    compareNumbers(left.line ?? -1, right.line ?? -1) ||
    compareNumbers(left.col ?? -1, right.col ?? -1) ||
    compareStrings(left.filePath, right.filePath) ||
    compareStrings(left.fileName, right.fileName) ||
    compareStrings(left.fileExtension, right.fileExtension)
  );
}

function indexFindings(
  findings: readonly NormalizedFinding[],
): Map<string, NormalizedFinding> {
  const indexed = new Map<string, NormalizedFinding>();
  for (const finding of [...findings].sort(compareFindings)) {
    const key = createFindingKey(finding);
    if (!indexed.has(key)) {
      indexed.set(key, finding);
    }
  }
  return indexed;
}

export function generateActionableBatch(
  productionFindings: readonly NormalizedFinding[],
  productionPlusTestsFindings: readonly NormalizedFinding[],
  options: BatchSelectionOptions = {},
): ActionableBatch {
  const production = indexFindings(productionFindings);
  const productionPlusTests = indexFindings(productionPlusTestsFindings);
  const sharedKeys = [...production.keys()]
    .filter((key) => productionPlusTests.has(key))
    .sort(compareStrings);

  const sharedEvidence = sharedKeys.map((key) => {
    const productionEvidence = production.get(key);
    const productionPlusTestsEvidence = productionPlusTests.get(key);
    if (
      productionEvidence === undefined ||
      productionPlusTestsEvidence === undefined
    ) {
      throw new Error(`Missing evidence for shared finding ${key}`);
    }

    return {
      findingKey: key,
      issueType: productionEvidence.issueType,
      normalizedPath: productionEvidence.normalizedPath,
      symbolName: getIdentitySymbol(productionEvidence),
      productionEvidence,
      productionPlusTestsEvidence,
    };
  });

  const diagnosticTypeFindings = sharedEvidence.filter(
    (finding) => finding.issueType === "types",
  );
  const actionableRuntimeCandidates = sharedEvidence.filter(
    (finding) => finding.issueType !== "types",
  );
  const candidateGroups = createCandidateGroups(actionableRuntimeCandidates);
  const targetFindingCount =
    options.targetFindingCount ?? BATCH_TARGET_FINDINGS;
  const selectedBatch = selectBatch(
    candidateGroups,
    actionableRuntimeCandidates,
    options.ledger ?? createEmptyBatchLedger(),
    targetFindingCount,
  );

  return {
    schemaVersion: 3,
    evidenceNotice: EVIDENCE_NOTICE,
    batchTargetSize: targetFindingCount,
    inventory: {
      sharedEvidenceFindingCount: sharedEvidence.length,
      diagnosticTypeFindingCount: diagnosticTypeFindings.length,
      actionableRuntimeCandidateCount: actionableRuntimeCandidates.length,
      actionableRuntimeCandidateFileCount: candidateGroups.length,
      diagnosticTypeFindings,
      actionableRuntimeCandidates,
      candidateGroups,
    },
    selectedBatch,
  };
}

function createCandidateGroups(
  findings: readonly ActionableBatchFinding[],
): CandidateGroup[] {
  const findingKeysByPath = new Map<string, string[]>();
  for (const finding of findings) {
    const findingKeys = findingKeysByPath.get(finding.normalizedPath) ?? [];
    findingKeysByPath.set(finding.normalizedPath, [
      ...findingKeys,
      finding.findingKey,
    ]);
  }
  return [...findingKeysByPath.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([normalizedPath, findingKeys]) => ({
      groupKey: normalizedPath,
      normalizedPath,
      findingKeys,
      findingCount: findingKeys.length,
    }));
}

interface GroupPriority {
  group: CandidateGroup;
  latestAttempt?: BatchAttempt;
}

function getLatestAttempt(
  group: CandidateGroup,
  attempts: readonly BatchAttempt[],
): BatchAttempt | undefined {
  return attempts
    .filter(
      (attempt) =>
        attempt.groupKeys.includes(group.groupKey) ||
        attempt.findingKeys.some((key) => group.findingKeys.includes(key)),
    )
    .sort(
      (left, right) =>
        Date.parse(right.offeredAt) - Date.parse(left.offeredAt) ||
        compareStrings(right.attemptId, left.attemptId),
    )[0];
}

function compareGroupPriority(
  left: GroupPriority,
  right: GroupPriority,
): number {
  if (left.latestAttempt === undefined && right.latestAttempt !== undefined) {
    return -1;
  }
  if (left.latestAttempt !== undefined && right.latestAttempt === undefined) {
    return 1;
  }
  if (left.latestAttempt !== undefined && right.latestAttempt !== undefined) {
    const offeredComparison =
      Date.parse(left.latestAttempt.offeredAt) -
      Date.parse(right.latestAttempt.offeredAt);
    if (offeredComparison !== 0) {
      return offeredComparison;
    }
  }
  return compareStrings(left.group.groupKey, right.group.groupKey);
}

function selectBatch(
  groups: readonly CandidateGroup[],
  findings: readonly ActionableBatchFinding[],
  ledger: BatchLedger,
  targetFindingCount: number,
): SelectedBatch | null {
  const eligible = groups
    .map((group) => ({
      group,
      latestAttempt: getLatestAttempt(group, ledger.attempts),
    }))
    .filter(({ latestAttempt }) => latestAttempt?.outcome !== "draft-pr-open")
    .sort(compareGroupPriority);
  const selectedGroups: CandidateGroup[] = [];
  let selectedFindingCount = 0;
  for (const { group } of eligible) {
    if (
      selectedGroups.length === 0 &&
      group.findingCount > targetFindingCount
    ) {
      selectedGroups.push(group);
      break;
    }
    if (selectedFindingCount + group.findingCount <= targetFindingCount) {
      selectedGroups.push(group);
      selectedFindingCount += group.findingCount;
    }
  }
  if (selectedGroups.length === 0) {
    return null;
  }
  const selectedFindingKeys = new Set(
    selectedGroups.flatMap((group) => group.findingKeys),
  );
  const selectedFindings = findings.filter((finding) =>
    selectedFindingKeys.has(finding.findingKey),
  );
  const groupKeys = selectedGroups.map((group) => group.groupKey);
  return {
    batchKey: calculateDigest(
      selectedFindings.map(({ findingKey }) => findingKey).join("\u0000"),
    ),
    groupKeys,
    filePaths: groupKeys,
    findingCount: selectedFindings.length,
    oversizedSingleFile:
      selectedGroups.length === 1 &&
      selectedFindings.length > targetFindingCount,
    findings: selectedFindings,
  };
}

export function serializeActionableBatch(batch: ActionableBatch): string {
  return `${JSON.stringify(batch, null, 2)}\n`;
}

export function calculateDigest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function calculateReportDigest(
  productionReport: string,
  productionPlusTestsReport: string,
): string {
  return calculateDigest(
    `production\u0000${productionReport}\u0000productionPlusTests\u0000${productionPlusTestsReport}`,
  );
}

function countFindings(findings: readonly NormalizedFinding[]): ScanCount {
  const byIssueType: Record<IssueType, number> = {
    enumMembers: 0,
    exports: 0,
    files: 0,
    types: 0,
  };
  for (const finding of findings) {
    byIssueType[finding.issueType] += 1;
  }
  return { total: findings.length, byIssueType };
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\r\n|]/g, (character) =>
    character === "|" ? "\\|" : " ",
  );
}

function renderFindings(batch: ActionableBatch): string {
  const selectedFindings = batch.selectedBatch?.findings ?? [];
  if (selectedFindings.length === 0) {
    return batch.inventory.actionableRuntimeCandidateCount === 0
      ? batch.inventory.sharedEvidenceFindingCount === 0
        ? "No findings were present in both processed reports.\n"
        : "No actionable runtime candidates were present; shared type findings remain diagnostic evidence only.\n"
      : "No eligible batch is available; all current candidates have an open pull request.\n";
  }

  const rows = selectedFindings.map(
    (finding) =>
      `| ${finding.issueType} | \`${escapeMarkdown(finding.normalizedPath)}\` | ${escapeMarkdown(finding.symbolName || "—")} |`,
  );
  return ["| Type | Path | Symbol |", "| --- | --- | --- |", ...rows, ""].join(
    "\n",
  );
}

function renderTypeCounts(count: ScanCount): string {
  return ISSUE_TYPES.map(
    (issueType) => `${issueType}=${count.byIssueType[issueType]}`,
  ).join(", ");
}

function renderStatus(status: RunStatus): string {
  return [
    `- State: \`${status.state}\``,
    `- Source commit: \`${status.commitSha}\``,
    `- Workflow run: [${status.runId}](${status.workflowUrl})`,
    `- Production findings: ${status.scanCounts.production.total}`,
    `- Production by type: ${renderTypeCounts(status.scanCounts.production)}`,
    `- Production-plus-tests findings: ${status.scanCounts.productionPlusTests.total}`,
    `- Production-plus-tests by type: ${renderTypeCounts(status.scanCounts.productionPlusTests)}`,
    `- Shared scanner evidence: ${status.scanCounts.sharedEvidenceFindingCount}`,
    `- Actionable runtime candidates: ${status.scanCounts.actionableRuntimeCandidateCount}`,
    `- Selected runtime candidates: ${status.batchSize}`,
    `- Report digest: \`${status.reportDigest}\``,
    `- Batch digest: \`${status.batchDigest}\``,
    `- Started: \`${status.timestamps.startedAt}\``,
    `- Prepared: \`${status.timestamps.completedAt}\``,
    `- Elapsed milliseconds: ${status.elapsedMilliseconds}`,
  ].join("\n");
}

function createRunStatus(
  productionFindings: readonly NormalizedFinding[],
  productionPlusTestsFindings: readonly NormalizedFinding[],
  batch: ActionableBatch,
  batchDigest: string,
  reportDigest: string,
  context: RunContext,
): RunStatus {
  const selectedFindingCount = batch.selectedBatch?.findingCount ?? 0;
  const state: MaintenanceRunState = batch.selectedBatch
    ? "awaiting-approval"
    : batch.inventory.actionableRuntimeCandidateCount === 0
      ? "no-action-needed"
      : "no-eligible-batch";
  return {
    schemaVersion: 1,
    runId: context.runId,
    repository: context.repository,
    commitSha: context.commitSha,
    workflowUrl: context.workflowUrl,
    scanCounts: {
      production: countFindings(productionFindings),
      productionPlusTests: countFindings(productionPlusTestsFindings),
      sharedEvidenceFindingCount: batch.inventory.sharedEvidenceFindingCount,
      actionableRuntimeCandidateCount:
        batch.inventory.actionableRuntimeCandidateCount,
    },
    batchSize: selectedFindingCount,
    state,
    progress: {
      selected: selectedFindingCount === 0 ? 0 : 1,
      active: 0,
      completed: 0,
      succeeded: 0,
      failed: 0,
    },
    timestamps: {
      startedAt: context.startedAt,
      completedAt: context.completedAt,
    },
    elapsedMilliseconds: Math.max(
      0,
      Date.parse(context.completedAt) - Date.parse(context.startedAt),
    ),
    reportDigest,
    batchDigest,
    issueDedupeKey: calculateDigest(
      `${context.repository}\u0000${context.commitSha}\u0000${batchDigest}`,
    ),
    artifactName: context.artifactName,
  };
}

function renderSummary(batch: ActionableBatch, status: RunStatus): string {
  return [
    "# Maintenance scan",
    "",
    renderStatus(status),
    "",
    `> ${EVIDENCE_NOTICE}`,
    "",
    "## Selected evidence",
    "",
    renderFindings(batch),
  ].join("\n");
}

function renderIssue(batch: ActionableBatch, status: RunStatus): string {
  return [
    `<!-- maintenance-scan:${status.issueDedupeKey} -->`,
    "# Automated maintenance evidence",
    "",
    renderStatus(status),
    `- Reports artifact: \`${status.artifactName}\``,
    "- Reports: `raw-production.json`, `processed-production.json`, `production-report.md`, `production-metadata.json`, `raw-productionPlusTests.json`, `processed-productionPlusTests.json`, `productionPlusTests-report.md`, `productionPlusTests-metadata.json`",
    "",
    `> ${EVIDENCE_NOTICE}`,
    "",
    "## Selected evidence",
    "",
    renderFindings(batch),
  ].join("\n");
}

export function generateRunArtifacts(
  productionFindings: readonly NormalizedFinding[],
  productionPlusTestsFindings: readonly NormalizedFinding[],
  productionReport: string,
  productionPlusTestsReport: string,
  context: RunContext,
  options: BatchSelectionOptions = {},
): GeneratedRunArtifacts {
  const batch = generateActionableBatch(
    productionFindings,
    productionPlusTestsFindings,
    options,
  );
  const batchJson = serializeActionableBatch(batch);
  const batchDigest = calculateDigest(batchJson);
  const reportDigest = calculateReportDigest(
    productionReport,
    productionPlusTestsReport,
  );
  const status = createRunStatus(
    productionFindings,
    productionPlusTestsFindings,
    batch,
    batchDigest,
    reportDigest,
    context,
  );

  return {
    batch,
    batchJson,
    batchDigest,
    reportDigest,
    status,
    summaryMarkdown: renderSummary(batch, status),
    issueMarkdown: renderIssue(batch, status),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIssueType(value: unknown): value is IssueType {
  return typeof value === "string" && ISSUE_TYPES.includes(value as IssueType);
}

function isNormalizedFinding(value: unknown): value is NormalizedFinding {
  if (!isRecord(value)) {
    return false;
  }
  const hasBaseFields =
    typeof value.normalizedPath === "string" &&
    typeof value.fileName === "string" &&
    typeof value.fileExtension === "string" &&
    typeof value.filePath === "string" &&
    isIssueType(value.issueType);
  if (!hasBaseFields) {
    return false;
  }
  return value.issueType === "files" || typeof value.symbolName === "string";
}

function readProcessedFindings(filePath: string): NormalizedFinding[] {
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  if (!Array.isArray(parsed) || !parsed.every(isNormalizedFinding)) {
    throw new Error(`Invalid processed findings report: ${filePath}`);
  }
  return parsed;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export function main(): void {
  const reportsDirectory = path.resolve(__dirname, "..", "reports");
  const productionPath = path.join(
    reportsDirectory,
    "processed-production.json",
  );
  const productionPlusTestsPath = path.join(
    reportsDirectory,
    "processed-productionPlusTests.json",
  );
  const productionReport = readFileSync(productionPath, "utf8");
  const productionPlusTestsReport = readFileSync(
    productionPlusTestsPath,
    "utf8",
  );
  const startedAt = requireEnvironment("MAINTENANCE_STARTED_AT");
  if (Number.isNaN(Date.parse(startedAt))) {
    throw new Error("MAINTENANCE_STARTED_AT must be an ISO-8601 timestamp");
  }

  const ledgerPath =
    process.env.MAINTENANCE_BATCH_LEDGER_PATH ??
    path.join(reportsDirectory, "batch-ledger.json");
  const ledger = readFileIfPresent(ledgerPath);
  const artifacts = generateRunArtifacts(
    readProcessedFindings(productionPath),
    readProcessedFindings(productionPlusTestsPath),
    productionReport,
    productionPlusTestsReport,
    {
      runId: requireEnvironment("GITHUB_RUN_ID"),
      repository: requireEnvironment("GITHUB_REPOSITORY"),
      commitSha: requireEnvironment("GITHUB_SHA"),
      workflowUrl: requireEnvironment("MAINTENANCE_WORKFLOW_URL"),
      startedAt,
      completedAt: new Date().toISOString(),
      artifactName: requireEnvironment("MAINTENANCE_ARTIFACT_NAME"),
    },
    { ledger },
  );

  mkdirSync(reportsDirectory, { recursive: true });
  writeFileSync(
    path.join(reportsDirectory, "actionable-batch.json"),
    artifacts.batchJson,
  );
  writeFileSync(
    path.join(reportsDirectory, "run-status.json"),
    `${JSON.stringify(artifacts.status, null, 2)}\n`,
  );
  writeFileSync(
    path.join(reportsDirectory, "maintenance-summary.md"),
    artifacts.summaryMarkdown,
  );
  writeFileSync(
    path.join(reportsDirectory, "remediation-issue.md"),
    artifacts.issueMarkdown,
  );
}

function readFileIfPresent(filePath: string): BatchLedger {
  return existsSync(filePath)
    ? parseBatchLedger(readFileSync(filePath, "utf8"))
    : createEmptyBatchLedger();
}

if (require.main === module) {
  try {
    main();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    process.stderr.write(`Failed to generate actionable batch: ${message}\n`);
    process.exitCode = 1;
  }
}
