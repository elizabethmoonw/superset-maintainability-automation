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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { parseBatchLedger, type BatchAttempt } from "./batchLedger";
import {
  validateObservabilityHistory,
  type ObservabilityHistory,
} from "./observabilityData";

interface DashboardOptions {
  inputPath: string;
  ledgerPath: string;
  outputPath: string;
}

interface PullRequestOutcome {
  period: string;
  status: "merged" | "closed-unmerged" | "open";
  url: string;
  source: "automation";
}

const COLORS = {
  blue: "#2563eb",
  green: "#16a34a",
  red: "#dc2626",
  amber: "#d97706",
  grid: "#dbe3ee",
  ink: "#172033",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseArguments(
  args: readonly string[],
  automationRoot: string,
): DashboardOptions {
  const options: DashboardOptions = {
    inputPath: path.join(
      automationRoot,
      "reports",
      "observability-history.json",
    ),
    ledgerPath: path.join(automationRoot, "reports", "batch-ledger.json"),
    outputPath: path.join(
      automationRoot,
      "reports",
      "observability-dashboard.html",
    ),
  };
  const names: Record<string, keyof DashboardOptions> = {
    "--input": "inputPath",
    "--ledger": "ledgerPath",
    "--output": "outputPath",
  };
  for (let index = 0; index < args.length; index += 2) {
    const option = names[args[index]];
    const value = args[index + 1];
    if (option === undefined || value === undefined) {
      throw new Error(`Unknown or incomplete argument ${args[index]}`);
    }
    options[option] = path.resolve(value);
  }
  return options;
}

function latestAttempts(attempts: readonly BatchAttempt[]): BatchAttempt[] {
  const latestByBatch = new Map<string, BatchAttempt>();
  for (const attempt of attempts) {
    const previous = latestByBatch.get(attempt.batchKey);
    if (
      previous === undefined ||
      Date.parse(attempt.offeredAt) > Date.parse(previous.offeredAt) ||
      (attempt.offeredAt === previous.offeredAt &&
        attempt.attemptId > previous.attemptId)
    ) {
      latestByBatch.set(attempt.batchKey, attempt);
    }
  }
  return [...latestByBatch.values()];
}

function pullRequestOutcomes(
  attempts: readonly BatchAttempt[],
): PullRequestOutcome[] {
  return latestAttempts(attempts)
    .flatMap<PullRequestOutcome>((attempt) => {
      if (attempt.pullRequestUrl === undefined) {
        return [];
      }
      const status =
        attempt.outcome === "pr-merged"
          ? "merged"
          : attempt.outcome === "pr-closed-unmerged"
            ? "closed-unmerged"
            : attempt.outcome === "draft-pr-open"
              ? "open"
              : undefined;
      return status === undefined
        ? []
        : [
            {
              period: attempt.offeredAt.slice(0, 7),
              status,
              url: attempt.pullRequestUrl,
              source: "automation",
            },
          ];
    })
    .sort((left, right) => left.period.localeCompare(right.period));
}

function lineChart(history: ObservabilityHistory): string {
  const values = history.snapshots.map(
    ({ affectedFileCount }) => affectedFileCount,
  );
  const width = 960;
  const height = 320;
  const margin = { top: 24, right: 30, bottom: 58, left: 62 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding = Math.max(5, Math.ceil((maximum - minimum) * 0.15));
  const lower = Math.max(0, minimum - padding);
  const upper = maximum + padding;
  const x = (index: number): number =>
    margin.left +
    (history.snapshots.length === 1
      ? innerWidth / 2
      : (index * innerWidth) / (history.snapshots.length - 1));
  const y = (value: number): number =>
    margin.top + ((upper - value) * innerHeight) / (upper - lower || 1);
  const ticks = Array.from({ length: 5 }, (_, index) =>
    Math.round(lower + ((upper - lower) * index) / 4),
  );
  const points = values
    .map((value, index) => `${x(index)},${y(value)}`)
    .join(" ");
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="trend-title trend-desc">
    <title id="trend-title">Affected files by monthly snapshot</title>
    <desc id="trend-desc">Line chart of distinct paths with at least one finding shared by both scans.</desc>
    ${ticks
      .map(
        (
          tick,
        ) => `<line x1="${margin.left}" x2="${width - margin.right}" y1="${y(tick)}" y2="${y(tick)}" stroke="${COLORS.grid}" />
          <text x="${margin.left - 12}" y="${y(tick) + 4}" text-anchor="end">${tick}</text>`,
      )
      .join("")}
    <polyline points="${points}" fill="none" stroke="${COLORS.blue}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
    ${history.snapshots
      .map(
        (snapshot, index) => `<g>
          <circle cx="${x(index)}" cy="${y(snapshot.affectedFileCount)}" r="6" fill="white" stroke="${COLORS.blue}" stroke-width="3"><title>${escapeHtml(snapshot.period)}: ${snapshot.affectedFileCount} affected files</title></circle>
          <text x="${x(index)}" y="${height - 28}" text-anchor="middle">${escapeHtml(snapshot.kind === "current" ? `${snapshot.period} current` : snapshot.period)}</text>
        </g>`,
      )
      .join("")}
  </svg>`;
}

function pullRequestChart(outcomes: readonly PullRequestOutcome[]): string {
  const periods = [...new Set(outcomes.map(({ period }) => period))];
  const width = 960;
  const height = 300;
  const margin = { top: 24, right: 30, bottom: 58, left: 62 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const totals = periods.map(
    (period) => outcomes.filter((outcome) => outcome.period === period).length,
  );
  const maximum = Math.max(1, ...totals);
  const barWidth = Math.min(82, innerWidth / Math.max(1, periods.length) / 2);
  const slotWidth = innerWidth / Math.max(1, periods.length);
  const y = (value: number): number =>
    margin.top + innerHeight - (value * innerHeight) / maximum;
  if (periods.length === 0) {
    return `<div class="empty-state">No automation PRs recorded yet. The chart will populate after the workflow opens its first draft PR.</div>`;
  }
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="pr-title pr-desc">
    <title id="pr-title">Cleanup pull request outcomes by month</title>
    <desc id="pr-desc">Stacked bars show merged, closed without merge, and open cleanup pull requests.</desc>
    ${Array.from(
      { length: maximum + 1 },
      (
        _,
        tick,
      ) => `<line x1="${margin.left}" x2="${width - margin.right}" y1="${y(tick)}" y2="${y(tick)}" stroke="${COLORS.grid}" />
      <text x="${margin.left - 12}" y="${y(tick) + 4}" text-anchor="end">${tick}</text>`,
    ).join("")}
    ${periods
      .map((period, index) => {
        const periodOutcomes = outcomes.filter(
          (outcome) => outcome.period === period,
        );
        const counts = {
          merged: periodOutcomes.filter(({ status }) => status === "merged")
            .length,
          "closed-unmerged": periodOutcomes.filter(
            ({ status }) => status === "closed-unmerged",
          ).length,
          open: periodOutcomes.filter(({ status }) => status === "open").length,
        };
        let accumulated = 0;
        const bars = (
          [
            ["merged", COLORS.green],
            ["closed-unmerged", COLORS.red],
            ["open", COLORS.amber],
          ] as const
        )
          .map(([status, color]) => {
            const count = counts[status];
            const bottom = accumulated;
            accumulated += count;
            return count === 0
              ? ""
              : `<rect x="${margin.left + index * slotWidth + (slotWidth - barWidth) / 2}" y="${y(accumulated)}" width="${barWidth}" height="${y(bottom) - y(accumulated)}" rx="3" fill="${color}"><title>${escapeHtml(period)} ${status}: ${count}</title></rect>`;
          })
          .join("");
        return `${bars}<text x="${margin.left + index * slotWidth + slotWidth / 2}" y="${height - 28}" text-anchor="middle">${escapeHtml(period)}</text>`;
      })
      .join("")}
  </svg>`;
}

function renderMetric(label: string, value: string, note: string): string {
  return `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`;
}

function shortSha(sha: string): string {
  return sha.slice(0, 8);
}

export function renderDashboard(
  history: ObservabilityHistory,
  attempts: readonly BatchAttempt[] = [],
): string {
  if (history.snapshots.length === 0) {
    throw new Error("Observability history contains no snapshots");
  }
  const current = history.snapshots.at(-1)!;
  const outcomes = pullRequestOutcomes(attempts);
  const merged = outcomes.filter(({ status }) => status === "merged").length;
  const closed = outcomes.filter(
    ({ status }) => status === "closed-unmerged",
  ).length;
  const open = outcomes.filter(({ status }) => status === "open").length;
  const decided = merged + closed;
  const rejectedBatches = latestAttempts(attempts).filter(
    ({ outcome }) => outcome === "approval-rejected",
  ).length;
  const acceptance =
    decided === 0 ? "N/A" : `${Math.round((merged / decided) * 100)}%`;
  const benchmark = history.benchmarks[0];
  const baseline = history.snapshots[0];
  const affectedFileChange =
    current.affectedFileCount - baseline.affectedFileCount;
  const affectedFileChangePercent =
    baseline.affectedFileCount === 0
      ? undefined
      : (affectedFileChange / baseline.affectedFileCount) * 100;
  const signedAffectedFileChange = `${affectedFileChange >= 0 ? "+" : ""}${affectedFileChange}`;
  const repositoryUrl = `https://github.com/${history.repository}`;
  const rows = history.snapshots
    .map(
      (snapshot, index) => `<tr>
        <td>${escapeHtml(snapshot.kind === "current" ? `${snapshot.period} (current)` : snapshot.period)}</td>
        <td>${snapshot.affectedFileCount}</td>
        <td>${snapshot.sharedFindingCount}</td>
        <td>${index === 0 ? "Baseline" : snapshot.newAffectedFileCount}</td>
        <td>${index === 0 ? "—" : snapshot.resolvedAffectedFileCount}</td>
        <td><a href="${repositoryUrl}/commit/${escapeHtml(snapshot.commitSha)}">${escapeHtml(shortSha(snapshot.commitSha))}</a></td>
      </tr>`,
    )
    .join("");
  const outcomeRows = outcomes
    .map(
      (outcome) =>
        `<tr><td>${escapeHtml(outcome.period)}</td><td><span class="status ${escapeHtml(outcome.status)}">${escapeHtml(outcome.status)}</span></td><td>${escapeHtml(outcome.source)}</td><td><a href="${escapeHtml(outcome.url)}">View PR</a></td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Maintenance automation observability</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: ${COLORS.ink}; background: #f4f7fb; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    main { max-width: 1160px; margin: 0 auto; padding: 48px 28px 72px; }
    header { margin-bottom: 28px; }
    h1 { margin: 0 0 8px; font-size: clamp(2rem, 4vw, 3.25rem); letter-spacing: -0.04em; }
    h2 { margin: 0 0 6px; font-size: 1.45rem; }
    h3 { margin: 0 0 10px; font-size: 1.05rem; }
    p { color: #526079; line-height: 1.6; }
    .eyebrow { color: ${COLORS.blue}; font-weight: 750; text-transform: uppercase; letter-spacing: .1em; font-size: .76rem; }
    .subtitle { max-width: 780px; margin: 0; font-size: 1.05rem; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin: 26px 0; }
    .metric, .panel { background: white; border: 1px solid #e2e8f0; border-radius: 16px; box-shadow: 0 8px 24px rgba(24, 39, 75, .055); }
    .metric { padding: 20px; min-height: 150px; display: flex; flex-direction: column; }
    .metric span { color: #64748b; font-weight: 650; font-size: .86rem; }
    .metric strong { font-size: 2.35rem; margin: 8px 0 4px; letter-spacing: -.04em; }
    .metric small { color: #718096; line-height: 1.35; margin-top: auto; }
    .panel { padding: 26px; margin-top: 18px; overflow: hidden; }
    .panel-heading { display: flex; justify-content: space-between; gap: 20px; align-items: start; }
    .panel-heading p { margin: 0; max-width: 660px; }
    .chart { width: 100%; height: auto; margin-top: 20px; overflow: visible; }
    .chart text { fill: #64748b; font: 13px ui-sans-serif, system-ui, sans-serif; }
    .legend { display: flex; flex-wrap: wrap; gap: 18px; margin: 12px 0 0; color: #526079; font-size: .88rem; }
    .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; }
    .table-wrap { overflow-x: auto; margin-top: 20px; }
    table { width: 100%; border-collapse: collapse; min-width: 660px; font-size: .9rem; }
    th, td { padding: 12px 10px; border-top: 1px solid #e5eaf2; text-align: left; }
    th { color: #64748b; font-size: .75rem; text-transform: uppercase; letter-spacing: .045em; }
    a { color: #1d4ed8; text-decoration: none; font-weight: 650; }
    a:hover { text-decoration: underline; }
    .status { padding: 4px 8px; border-radius: 999px; font-size: .78rem; font-weight: 700; }
    .status.merged { color: #166534; background: #dcfce7; }
    .status.closed-unmerged { color: #991b1b; background: #fee2e2; }
    .status.open { color: #92400e; background: #fef3c7; }
    .benchmark { display: grid; grid-template-columns: 1fr 1.3fr; gap: 22px; align-items: center; }
    .benchmark-number { font-size: 3.4rem; font-weight: 800; letter-spacing: -.055em; color: ${COLORS.green}; }
    .benchmark-number span { color: #9aa6b7; font-size: 2rem; }
    .callout { padding: 16px 18px; border-left: 4px solid ${COLORS.blue}; background: #eff6ff; border-radius: 8px; color: #334155; line-height: 1.55; }
    dl { display: grid; grid-template-columns: 180px 1fr; gap: 12px 18px; margin: 18px 0 0; }
    dt { font-weight: 750; }
    dd { margin: 0; color: #526079; line-height: 1.5; }
    .empty-state { margin-top: 22px; padding: 48px 20px; text-align: center; color: #64748b; background: #f8fafc; border-radius: 12px; }
    footer { margin-top: 24px; color: #718096; font-size: .82rem; }
    @media (max-width: 850px) { .metrics { grid-template-columns: repeat(2, 1fr); } .benchmark { grid-template-columns: 1fr; } }
    @media (max-width: 520px) { main { padding: 28px 16px 50px; } .metrics { grid-template-columns: 1fr; } .panel { padding: 18px; } dl { grid-template-columns: 1fr; gap: 4px; } }
  </style>
</head>
<body>
<main>
  <header>
    <div class="eyebrow">Proof of concept · monthly workflow</div>
    <h1>Maintenance automation observability</h1>
    <p class="subtitle">Does the scanner identify a meaningful cleanup backlog, and does the automation turn reviewable batches into accepted pull requests?</p>
  </header>
  <section class="metrics" aria-label="Current metrics">
    ${renderMetric("Affected files", current.affectedFileCount.toLocaleString(), "Distinct file paths in the current shared-finding inventory")}
    ${renderMetric("Net backlog change", `${signedAffectedFileChange} files`, `${affectedFileChangePercent === undefined ? "No percentage baseline" : `${Math.abs(affectedFileChangePercent).toFixed(1)}% ${affectedFileChange >= 0 ? "increase" : "decrease"}`} since ${baseline.period}`)}
    ${renderMetric("Automation PR acceptance", acceptance, `${merged} merged / ${decided} finally decided automation PRs`)}
    ${renderMetric("Open automation PRs", open.toString(), `${rejectedBatches} approval-rejected batch${rejectedBatches === 1 ? "" : "es"} tracked separately`)}
  </section>

  <section class="panel">
    <div class="panel-heading"><div><h2>Affected files over time</h2><p>Monthly first-parent snapshots use the same pinned scanner and configs. Lower is directionally better, but product development may add new candidates.</p></div></div>
    ${lineChart(history)}
    <div class="table-wrap"><table><thead><tr><th>Snapshot</th><th>Affected files</th><th>Overlapping analyzer signals</th><th>New files</th><th>Resolved files</th><th>Commit</th></tr></thead><tbody>${rows}</tbody></table></div>
  </section>

  <section class="panel">
    <div class="panel-heading"><div><h2>Automation PR outcomes</h2><p>Only pull requests created by this workflow appear here. Acceptance = merged automation PRs ÷ automation PRs with a final human decision. Open PRs are not in the denominator.</p></div></div>
    <div class="legend"><span><i class="swatch" style="background:${COLORS.green}"></i>Merged</span><span><i class="swatch" style="background:${COLORS.red}"></i>Closed without merge</span><span><i class="swatch" style="background:${COLORS.amber}"></i>Open</span></div>
    ${pullRequestChart(outcomes)}
    <div class="table-wrap"><table><thead><tr><th>Month</th><th>Outcome</th><th>Source</th><th>Evidence</th></tr></thead><tbody>${outcomeRows || '<tr><td colspan="4">No automation PRs recorded</td></tr>'}</tbody></table></div>
  </section>

  ${
    benchmark === undefined
      ? ""
      : `<section class="panel benchmark">
    <div><div class="eyebrow">Scanner recall backtest</div><div class="benchmark-number">${benchmark.acceptedFilesDetectedBefore}<span> / ${benchmark.acceptedFilePaths.length}</span></div><p>files a human independently chose to delete were present in the scanner inventory immediately before the cleanup.</p></div>
    <div><h2>Detection evidence, not system performance</h2><p><a href="${escapeHtml(benchmark.pullRequestUrl)}">${escapeHtml(benchmark.label)}</a> tests whether the scanner can surface historically useful candidates. Because a human selected and implemented this cleanup outside the automation, it is excluded from PR acceptance and automation outcomes.</p><div class="callout">After the merge, ${benchmark.acceptedFilesRemainingAfter} of those accepted files remained in the inventory. Affected files moved from ${benchmark.beforeAffectedFileCount} to ${benchmark.afterAffectedFileCount}, matching the 9 deleted files.</div></div>
  </section>`
  }

  <section class="panel">
    <h2>Semantic definitions and limits</h2>
    <dl>
      <dt>Affected file</dt><dd>One distinct repository path containing at least one analyzer signal present in both the production-only and production-plus-tests scans. A file counts once even if it has multiple unused symbols or signal types.</dd>
      <dt>Analyzer signal</dt><dd>One raw detector output keyed by issue category + file path + symbol. Signals overlap: a file reported as unused may also contain unused exports, types, or enum members. Therefore this count is diagnostic only and must not be interpreted as a number of cleanup tasks, files, or PRs.</dd>
      <dt>Batch</dt><dd>A file-coherent review unit targeting at most 10 analyzer signals. A file is never split; one oversized file may therefore exceed 10.</dd>
      <dt>Acceptance rate</dt><dd>Merged workflow-created PRs divided by merged plus closed-unmerged workflow-created PRs. The human-selected historical cleanup is excluded. Drafts still open, approval-rejected batches, deferred batches, and failed automation runs are also excluded.</dd>
      <dt>Backfill method</dt><dd>A consistent-ruler proof of concept: each historical worktree is scanned with Knip ${escapeHtml(history.scanner.knipVersion)}, the current scanner configs, and the current installed dependencies. It is comparable across snapshots but does not recreate each month’s historical dependency environment.</dd>
    </dl>
  </section>
  <footer>Generated ${escapeHtml(history.generatedAt)} · Repository ${escapeHtml(history.repository)} · Schema v${history.schemaVersion}</footer>
</main>
</body>
</html>\n`;
}

export function main(): void {
  const automationRoot = path.resolve(__dirname, "..");
  const options = parseArguments(process.argv.slice(2), automationRoot);
  const history = validateObservabilityHistory(
    JSON.parse(readFileSync(options.inputPath, "utf8")),
  );
  const attempts = existsSync(options.ledgerPath)
    ? parseBatchLedger(readFileSync(options.ledgerPath, "utf8")).attempts
    : [];
  mkdirSync(path.dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, renderDashboard(history, attempts));
  process.stdout.write(`Wrote ${options.outputPath}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    process.stderr.write(`Dashboard generation failed: ${message}\n`);
    process.exitCode = 1;
  }
}
