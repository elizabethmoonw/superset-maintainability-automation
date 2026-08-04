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

import { spawnSync } from "child_process";
import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { parseKnipReport, type KnipReport } from "./parseKnipReport";
import {
  OBSERVABILITY_SCHEMA_VERSION,
  addSnapshotMovement,
  createSnapshot,
  type FindingSnapshot,
  type HistoricalBenchmark,
  type ObservabilityHistory,
  serializeObservabilityHistory,
} from "./observabilityData";

const DEFAULT_MONTHS = 6;
const MAX_MONTHS = 24;
const KNIP_MAX_BUFFER_BYTES = 32 * 1024 * 1024;
const BENCHMARK_BEFORE_SHA = "4ae9980e4cd3fcfa229d712d0f781ef3b14dce8d";
const BENCHMARK_AFTER_SHA = "f56524bb7100d919e30c9ff20797977fcb762e33";
const BENCHMARK_PR_URL = "https://github.com/apache/superset/pull/41072";

interface BackfillOptions {
  months: number;
  outputPath: string;
  asOf: Date;
}

interface SnapshotTarget {
  snapshotId: string;
  period: string;
  kind: FindingSnapshot["kind"];
  commitSha: string;
}

interface ScanResult {
  production: ReturnType<typeof parseKnipReport>;
  productionPlusTests: ReturnType<typeof parseKnipReport>;
}

function runCommand(
  executable: string,
  args: readonly string[],
  cwd: string,
  acceptedExitCodes: readonly number[] = [0],
): string {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: KNIP_MAX_BUFFER_BYTES,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  const exitCode = result.status ?? 1;
  if (!acceptedExitCodes.includes(exitCode)) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(
      `${path.basename(executable)} ${args[0] ?? ""} failed with exit code ${exitCode}${detail.length === 0 ? "" : `: ${detail}`}`,
    );
  }
  if (result.stdout.trim().length === 0 && result.stderr.trim().length > 0) {
    throw new Error(result.stderr.trim());
  }
  return result.stdout;
}

function git(repositoryRoot: string, args: readonly string[]): string {
  return runCommand("git", args, repositoryRoot).trim();
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function parseBackfillOptions(
  args: readonly string[],
  automationRoot: string,
): BackfillOptions {
  let months = DEFAULT_MONTHS;
  let outputPath = path.join(
    automationRoot,
    "reports",
    "observability-history.json",
  );
  let asOf = new Date();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === "--months" && value !== undefined) {
      months = parsePositiveInteger(value, "--months");
      index += 1;
      continue;
    }
    if (argument === "--output" && value !== undefined) {
      outputPath = path.resolve(value);
      index += 1;
      continue;
    }
    if (argument === "--as-of" && value !== undefined) {
      asOf = new Date(value);
      if (Number.isNaN(asOf.valueOf())) {
        throw new Error("--as-of must be an ISO-8601 date");
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete argument ${argument}`);
  }
  if (months > MAX_MONTHS) {
    throw new Error(`--months cannot exceed ${MAX_MONTHS}`);
  }
  return { months, outputPath, asOf };
}

function formatPeriod(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function completedMonthBoundaries(
  asOf: Date,
  months: number,
): Array<{ period: string; before: string }> {
  const currentMonth = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1),
  );
  return Array.from({ length: months }, (_, index) => {
    const monthsBack = months - index;
    const month = new Date(
      Date.UTC(
        currentMonth.getUTCFullYear(),
        currentMonth.getUTCMonth() - monthsBack,
        1,
      ),
    );
    const nextMonth = new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1),
    );
    return { period: formatPeriod(month), before: nextMonth.toISOString() };
  });
}

function getSnapshotTargets(
  repositoryRoot: string,
  options: BackfillOptions,
): SnapshotTarget[] {
  const completed = completedMonthBoundaries(options.asOf, options.months).map(
    ({ period, before }) => {
      const commitSha = git(repositoryRoot, [
        "rev-list",
        "-1",
        "--first-parent",
        `--before=${before}`,
        "HEAD",
      ]);
      if (commitSha.length === 0) {
        throw new Error(`No first-parent commit exists for ${period}`);
      }
      return {
        snapshotId: `month-end-${period}`,
        period,
        kind: "month-end" as const,
        commitSha,
      };
    },
  );
  const headCommitSha = git(repositoryRoot, ["rev-parse", "HEAD"]);
  return [
    ...completed,
    {
      snapshotId: `current-${formatPeriod(options.asOf)}`,
      period: formatPeriod(options.asOf),
      kind: "current",
      commitSha: headCommitSha,
    },
  ];
}

function parseKnipOutput(output: string): ReturnType<typeof parseKnipReport> {
  const parsed: unknown = JSON.parse(output);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("issues" in parsed) ||
    !Array.isArray(parsed.issues)
  ) {
    throw new Error("Knip returned an invalid JSON report");
  }
  return parseKnipReport(parsed as KnipReport);
}

function runKnip(
  automationRoot: string,
  frontendRoot: string,
  configFile: string,
): ReturnType<typeof parseKnipReport> {
  const knipExecutable = path.join(
    automationRoot,
    "node_modules",
    ".bin",
    "knip",
  );
  if (!existsSync(knipExecutable)) {
    throw new Error("Run npm ci in maintenance-automation before backfilling");
  }
  const output = runCommand(
    knipExecutable,
    [
      "--directory",
      frontendRoot,
      "--config",
      path.join(automationRoot, configFile),
      "--production",
      "--include",
      "files,exports,types,enumMembers",
      "--reporter",
      "json",
    ],
    automationRoot,
    [0, 1],
  );
  return parseKnipOutput(output);
}

function scanCommit(
  repositoryRoot: string,
  automationRoot: string,
  commitSha: string,
): ScanResult {
  const temporaryRoot = realpathSync(
    mkdtempSync(path.join(tmpdir(), "superset-observability-")),
  );
  const worktreeRoot = path.join(temporaryRoot, "repository");
  let worktreeAdded = false;
  try {
    git(repositoryRoot, [
      "worktree",
      "add",
      "--detach",
      worktreeRoot,
      commitSha,
    ]);
    worktreeAdded = true;
    const historicalFrontendRoot = path.join(worktreeRoot, "superset-frontend");
    const installedModules = path.join(
      repositoryRoot,
      "superset-frontend",
      "node_modules",
    );
    if (!existsSync(installedModules)) {
      throw new Error("Run npm ci in superset-frontend before backfilling");
    }
    symlinkSync(
      installedModules,
      path.join(historicalFrontendRoot, "node_modules"),
      "dir",
    );
    return {
      production: runKnip(automationRoot, historicalFrontendRoot, "knip.json"),
      productionPlusTests: runKnip(
        automationRoot,
        historicalFrontendRoot,
        "knip-production-plus-tests.json",
      ),
    };
  } finally {
    if (worktreeAdded) {
      git(repositoryRoot, ["worktree", "remove", "--force", worktreeRoot]);
    }
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function commitTimestamp(repositoryRoot: string, commitSha: string): string {
  return git(repositoryRoot, ["show", "-s", "--format=%cI", commitSha]);
}

function acceptedBenchmarkFiles(repositoryRoot: string): string[] {
  return git(repositoryRoot, [
    "diff",
    "--diff-filter=D",
    "--name-only",
    BENCHMARK_BEFORE_SHA,
    BENCHMARK_AFTER_SHA,
    "--",
    "superset-frontend/src",
  ])
    .split("\n")
    .filter((filePath) => filePath.length > 0)
    .map((filePath) => filePath.replace(/^superset-frontend\//, ""))
    .sort();
}

function createBenchmark(
  repositoryRoot: string,
  before: FindingSnapshot,
  after: FindingSnapshot,
): HistoricalBenchmark {
  const acceptedFilePaths = acceptedBenchmarkFiles(repositoryRoot);
  const beforePaths = new Set(before.affectedFilePaths);
  const afterPaths = new Set(after.affectedFilePaths);
  return {
    benchmarkId: "superset-pr-41072",
    label: "Human-reviewed Knip cleanup",
    pullRequestUrl: BENCHMARK_PR_URL,
    mergedAt: commitTimestamp(repositoryRoot, BENCHMARK_AFTER_SHA),
    beforeCommitSha: BENCHMARK_BEFORE_SHA,
    afterCommitSha: BENCHMARK_AFTER_SHA,
    acceptedFilePaths,
    acceptedFilesDetectedBefore: acceptedFilePaths.filter((filePath) =>
      beforePaths.has(filePath),
    ).length,
    acceptedFilesRemainingAfter: acceptedFilePaths.filter((filePath) =>
      afterPaths.has(filePath),
    ).length,
    beforeAffectedFileCount: before.affectedFileCount,
    afterAffectedFileCount: after.affectedFileCount,
    beforeSharedFindingCount: before.sharedFindingCount,
    afterSharedFindingCount: after.sharedFindingCount,
  };
}

function digestFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function readKnipVersion(automationRoot: string): string {
  const packageJson: unknown = JSON.parse(
    readFileSync(path.join(automationRoot, "package.json"), "utf8"),
  );
  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    !("devDependencies" in packageJson) ||
    typeof packageJson.devDependencies !== "object" ||
    packageJson.devDependencies === null ||
    !("knip" in packageJson.devDependencies) ||
    typeof packageJson.devDependencies.knip !== "string"
  ) {
    throw new Error("maintenance-automation package.json does not pin Knip");
  }
  return packageJson.devDependencies.knip;
}

function repositoryName(repositoryRoot: string): string {
  const remote = git(repositoryRoot, ["config", "--get", "remote.origin.url"]);
  const match = remote.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  return match?.[1] ?? path.basename(repositoryRoot);
}

export function runBackfill(options: BackfillOptions): ObservabilityHistory {
  const automationRoot = path.resolve(__dirname, "..");
  const repositoryRoot = path.resolve(automationRoot, "..");
  const cache = new Map<string, ScanResult>();
  const scan = (commitSha: string): ScanResult => {
    const cached = cache.get(commitSha);
    if (cached !== undefined) {
      return cached;
    }
    process.stdout.write(`Scanning ${commitSha.slice(0, 12)}...\n`);
    const result = scanCommit(repositoryRoot, automationRoot, commitSha);
    cache.set(commitSha, result);
    return result;
  };
  const snapshots = getSnapshotTargets(repositoryRoot, options).map(
    (target) => {
      const result = scan(target.commitSha);
      return createSnapshot(
        {
          ...target,
          committedAt: commitTimestamp(repositoryRoot, target.commitSha),
        },
        result.production,
        result.productionPlusTests,
      );
    },
  );
  const benchmarkSnapshots = [BENCHMARK_BEFORE_SHA, BENCHMARK_AFTER_SHA].map(
    (commitSha, index) => {
      const result = scan(commitSha);
      return createSnapshot(
        {
          snapshotId: `benchmark-${index === 0 ? "before" : "after"}`,
          period: "2026-06",
          kind: "month-end",
          commitSha,
          committedAt: commitTimestamp(repositoryRoot, commitSha),
        },
        result.production,
        result.productionPlusTests,
      );
    },
  );
  return {
    schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repository: repositoryName(repositoryRoot),
    headCommitSha: git(repositoryRoot, ["rev-parse", "HEAD"]),
    scanner: {
      knipVersion: readKnipVersion(automationRoot),
      productionConfigDigest: digestFile(
        path.join(automationRoot, "knip.json"),
      ),
      productionPlusTestsConfigDigest: digestFile(
        path.join(automationRoot, "knip-production-plus-tests.json"),
      ),
    },
    snapshots: addSnapshotMovement(snapshots),
    benchmarks: [
      createBenchmark(
        repositoryRoot,
        benchmarkSnapshots[0],
        benchmarkSnapshots[1],
      ),
    ],
  };
}

export function main(): void {
  const automationRoot = path.resolve(__dirname, "..");
  const options = parseBackfillOptions(process.argv.slice(2), automationRoot);
  const history = runBackfill(options);
  mkdirSync(path.dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, serializeObservabilityHistory(history));
  process.stdout.write(`Wrote ${options.outputPath}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    process.stderr.write(`Observability backfill failed: ${message}\n`);
    process.exitCode = 1;
  }
}
