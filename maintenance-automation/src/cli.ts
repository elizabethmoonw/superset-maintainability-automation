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

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {
  parseKnipReport,
  type NormalizedFinding,
  type KnipReport,
} from "./parseKnipReport";

interface KnipExecutionError extends Error {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

class KnipValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnipValidationError";
  }
}

class KnipExecutionError extends Error implements KnipExecutionError {
  stdout?: string;
  stderr?: string;
  exitCode?: number;

  constructor(
    message: string,
    stdout?: string,
    stderr?: string,
    exitCode?: number,
  ) {
    super(message);
    this.name = "KnipExecutionError";
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

export {
  KnipValidationError,
  KnipExecutionError,
  validateKnipReportStructure,
  validateMode,
  compareFindings,
  getScanDefinition,
  buildKnipArguments,
  buildKnipCommand,
};
export type {
  ScanMode,
  ComparisonResult,
  ScanDefinition,
  NormalizedFinding,
  KnipReport,
};

type ScanMode = "production" | "productionPlusTests";

interface ScanDefinition {
  modeName: ScanMode;
  configFile: string;
  rawOutputFile: string;
  processedOutputFile: string;
  reportFile: string;
  metadataFile: string;
}

interface ComparisonResult {
  sharedCount: number;
  productionOnlyCount: number;
  productionPlusTestsOnlyCount: number;
  productionOnly: NormalizedFinding[];
  productionPlusTestsOnly: NormalizedFinding[];
}

interface ScanMetadata {
  timestamp: string;
  scanMode: string;
  rawHash: string;
  processedHash: string;
  rawReportPath: string;
  processedReportPath: string;
  reportPath: string;
}

const VALID_MODES: ScanMode[] = ["production", "productionPlusTests"];
const KNIP_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

function getScanDefinition(mode: ScanMode): ScanDefinition {
  const scanDefinitions: Record<ScanMode, ScanDefinition> = {
    production: {
      modeName: "production",
      configFile: "knip.json",
      rawOutputFile: RAW_PRODUCTION_FILE,
      processedOutputFile: PROCESSED_PRODUCTION_FILE,
      reportFile: PRODUCTION_REPORT_FILE,
      metadataFile: PRODUCTION_METADATA_FILE,
    },
    productionPlusTests: {
      modeName: "productionPlusTests",
      configFile: "knip-production-plus-tests.json",
      rawOutputFile: RAW_PRODUCTION_PLUS_TESTS_FILE,
      processedOutputFile: PROCESSED_PRODUCTION_PLUS_TESTS_FILE,
      reportFile: PRODUCTION_PLUS_TESTS_REPORT_FILE,
      metadataFile: PRODUCTION_PLUS_TESTS_METADATA_FILE,
    },
  };

  return scanDefinitions[mode];
}

function buildKnipCommand(scanDefinition: ScanDefinition): string {
  return [
    "knip",
    ...buildKnipArguments(
      scanDefinition.modeName,
      "../superset-frontend",
      `../maintenance-automation/${scanDefinition.configFile}`,
    ),
  ].join(" ");
}

function buildKnipArguments(
  mode: ScanMode,
  directory: string,
  configFile: string,
): string[] {
  const scanModeArguments = mode === "production" ? ["--production"] : [];
  return [
    "--directory",
    directory,
    "--config",
    configFile,
    ...scanModeArguments,
    "--include",
    "files,exports,types,enumMembers",
    "--reporter",
    "json",
  ];
}

function validateMode(mode: string | undefined): ScanMode {
  if (mode === undefined) {
    throw new Error("Missing required mode argument");
  }

  if (!VALID_MODES.includes(mode as ScanMode)) {
    throw new Error(`Invalid mode '${mode}'`);
  }

  return mode as ScanMode;
}

function createFindingKey(finding: NormalizedFinding): string {
  return `${finding.issueType}|${finding.normalizedPath}|${finding.symbolName || ""}`;
}

function compareFindings(
  productionFindings: NormalizedFinding[],
  productionPlusTestsFindings: NormalizedFinding[],
): ComparisonResult {
  const productionSet = new Set(productionFindings.map(createFindingKey));
  const productionPlusTestsSet = new Set(
    productionPlusTestsFindings.map(createFindingKey),
  );

  const shared: NormalizedFinding[] = [];
  const productionOnly: NormalizedFinding[] = [];
  const productionPlusTestsOnly: NormalizedFinding[] = [];

  for (const finding of productionFindings) {
    const key = createFindingKey(finding);
    if (productionPlusTestsSet.has(key)) {
      shared.push(finding);
    } else {
      productionOnly.push(finding);
    }
  }

  for (const finding of productionPlusTestsFindings) {
    const key = createFindingKey(finding);
    if (!productionSet.has(key)) {
      productionPlusTestsOnly.push(finding);
    }
  }

  return {
    sharedCount: shared.length,
    productionOnlyCount: productionOnly.length,
    productionPlusTestsOnlyCount: productionPlusTestsOnly.length,
    productionOnly,
    productionPlusTestsOnly,
  };
}

const REPORTS_DIR = path.join(__dirname, "..", "reports");

// Production scan files
const RAW_PRODUCTION_FILE = path.join(REPORTS_DIR, "raw-production.json");
const PROCESSED_PRODUCTION_FILE = path.join(
  REPORTS_DIR,
  "processed-production.json",
);
const PRODUCTION_REPORT_FILE = path.join(REPORTS_DIR, "production-report.md");
const PRODUCTION_METADATA_FILE = path.join(
  REPORTS_DIR,
  "production-metadata.json",
);

// Production Plus Tests scan files
const RAW_PRODUCTION_PLUS_TESTS_FILE = path.join(
  REPORTS_DIR,
  "raw-productionPlusTests.json",
);
const PROCESSED_PRODUCTION_PLUS_TESTS_FILE = path.join(
  REPORTS_DIR,
  "processed-productionPlusTests.json",
);
const PRODUCTION_PLUS_TESTS_REPORT_FILE = path.join(
  REPORTS_DIR,
  "productionPlusTests-report.md",
);
const PRODUCTION_PLUS_TESTS_METADATA_FILE = path.join(
  REPORTS_DIR,
  "productionPlusTests-metadata.json",
);

export function ensureReportsDirectory(): void {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

function validateKnipReportStructure(data: unknown): data is KnipReport {
  if (typeof data !== "object" || data === null) {
    throw new KnipValidationError("Knip output is not an object");
  }

  const report = data as Record<string, unknown>;

  if (!("issues" in report) || !Array.isArray(report.issues)) {
    throw new KnipValidationError(
      "Knip output does not contain valid 'issues' array",
    );
  }

  for (const issue of report.issues) {
    if (
      typeof issue !== "object" ||
      issue === null ||
      !("file" in issue) ||
      typeof issue.file !== "string"
    ) {
      throw new KnipValidationError(
        "Each issue must have a non-null 'file' property",
      );
    }
  }

  return true;
}

export function validateKnipExitCode(
  exitCode: number,
  stdout = "",
  stderr = "",
): void {
  if (exitCode !== 0 && exitCode !== 1) {
    throw new KnipExecutionError(
      `Knip returned unexpected exit code ${exitCode}. Only exit codes 0 and 1 are accepted.`,
      stdout,
      stderr,
      exitCode,
    );
  }
}

function readExecutionOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return Buffer.isBuffer(value) ? value.toString("utf8") : "";
}

function getExecutionExitCode(error: Record<string, unknown>): number {
  if (typeof error.status === "number") {
    return error.status;
  }
  return typeof error.exitCode === "number" ? error.exitCode : 1;
}

function captureRawKnipOutput(
  configFile: string,
  outputFile: string,
  scanMode: string,
): string {
  console.log(`Capturing raw Knip output for ${scanMode} mode...`);

  const scanDefinition = {
    ...getScanDefinition(validateMode(scanMode)),
    configFile,
  };
  const command = buildKnipCommand(scanDefinition);

  let stdout: string;
  let stderr: string;
  let exitCode = 0;

  try {
    stdout = execSync(command, {
      cwd: path.join(__dirname, ".."),
      encoding: "utf-8",
      stdio: "pipe",
      maxBuffer: KNIP_MAX_BUFFER_BYTES,
    });
    stderr = "";
    exitCode = 0;
  } catch (error: unknown) {
    const executionFailure =
      typeof error === "object" && error !== null
        ? (error as Record<string, unknown>)
        : {};
    stdout = readExecutionOutput(executionFailure.stdout);
    stderr = readExecutionOutput(executionFailure.stderr);
    exitCode = getExecutionExitCode(executionFailure);

    if (executionFailure.code === "ENOBUFS") {
      throw new KnipExecutionError(
        `Knip output exceeded the ${KNIP_MAX_BUFFER_BYTES}-byte capture limit`,
        stdout,
        stderr,
        exitCode,
      );
    }

    if (!stdout) {
      throw new KnipExecutionError(
        "Knip execution failed with no stdout output",
        stdout,
        stderr,
        exitCode,
      );
    }
  }

  // Only accept exit codes 0 (no issues) or 1 (issues found)
  validateKnipExitCode(exitCode, stdout, stderr);

  // Validate the output is valid JSON
  let parsedData: unknown;
  try {
    parsedData = JSON.parse(stdout);
  } catch (parseError) {
    throw new KnipExecutionError(
      "Failed to parse Knip output as JSON",
      stdout,
      stderr,
      exitCode,
    );
  }

  // Validate the structure
  try {
    validateKnipReportStructure(parsedData);
  } catch (validationError: unknown) {
    const message =
      validationError instanceof Error
        ? validationError.message
        : "Unexpected validation error";
    throw new KnipExecutionError(
      `Knip output validation failed: ${message}`,
      stdout,
      stderr,
      exitCode,
    );
  }

  // If we got here, the output is valid
  fs.writeFileSync(outputFile, stdout);
  console.log(`Raw output saved to ${outputFile}`);

  if (exitCode === 0) {
    console.log("Knip completed successfully with no findings");
  } else if (exitCode === 1) {
    console.log(
      "Knip found unused code (exit code 1) - this is expected behavior",
    );
  } else {
    console.log(
      `Knip completed with exit code ${exitCode} - output validated and accepted`,
    );
  }

  return stdout;
}

function calculateHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function generateProcessedReport(
  rawContent: string,
  outputFile: string,
): NormalizedFinding[] {
  console.log("Parsing and filtering Knip report...");
  const knipReport = JSON.parse(rawContent) as KnipReport;
  const findings = parseKnipReport(knipReport);

  fs.writeFileSync(outputFile, JSON.stringify(findings, null, 2));
  console.log(`Processed report saved to ${outputFile}`);

  return findings;
}

function generateMarkdownReport(
  findings: NormalizedFinding[],
  metadata: ScanMetadata,
  reportFile: string,
  scanMode: string,
): void {
  console.log("Generating markdown report...");

  const totalFindings = findings.length;
  const files = findings.filter((f) => f.issueType === "files");
  const exports = findings.filter((f) => f.issueType === "exports");
  const types = findings.filter((f) => f.issueType === "types");
  const enumMembers = findings.filter((f) => f.issueType === "enumMembers");

  const reportTitle =
    scanMode === "production"
      ? "Production Code Unused Findings Report"
      : "Production Plus Tests Unused Findings Report";

  let markdown = `# ${reportTitle}\n\n`;
  markdown += `**Total Findings:** ${totalFindings}\n\n`;

  markdown += `## Summary\n\n`;
  markdown += `- **Files:** ${files.length}\n`;
  markdown += `- **Exports:** ${exports.length}\n`;
  markdown += `- **Types:** ${types.length}\n`;
  markdown += `- **Enum Members:** ${enumMembers.length}\n\n`;

  markdown += `## Breakdown by Issue Type\n\n`;

  if (files.length > 0) {
    markdown += `### Files (${files.length})\n\n`;
    markdown += `| Path |\n`;
    markdown += `|------|\n`;
    files.slice(0, 10).forEach((f) => {
      markdown += `| ${f.normalizedPath} |\n`;
    });
    if (files.length > 10) {
      markdown += `| ... and ${files.length - 10} more |\n`;
    }
    markdown += `\n`;
  }

  if (exports.length > 0) {
    markdown += `### Exports (${exports.length})\n\n`;
    markdown += `| Symbol | Path | Line |\n`;
    markdown += `|--------|------|------|\n`;
    exports.slice(0, 10).forEach((f) => {
      markdown += `| ${f.symbolName} | ${f.normalizedPath} | ${f.line} |\n`;
    });
    if (exports.length > 10) {
      markdown += `| ... | ... and ${exports.length - 10} more | |\n`;
    }
    markdown += `\n`;
  }

  if (types.length > 0) {
    markdown += `### Types (${types.length})\n\n`;
    markdown += `| Symbol | Path | Line |\n`;
    markdown += `|--------|------|------|\n`;
    types.slice(0, 10).forEach((f) => {
      markdown += `| ${f.symbolName} | ${f.normalizedPath} | ${f.line} |\n`;
    });
    if (types.length > 10) {
      markdown += `| ... | ... and ${types.length - 10} more | |\n`;
    }
    markdown += `\n`;
  }

  if (enumMembers.length > 0) {
    markdown += `### Enum Members (${enumMembers.length})\n\n`;
    markdown += `| Symbol | Path | Line |\n`;
    markdown += `|--------|------|------|\n`;
    enumMembers.slice(0, 10).forEach((f) => {
      markdown += `| ${f.symbolName} | ${f.normalizedPath} | ${f.line} |\n`;
    });
    if (enumMembers.length > 10) {
      markdown += `| ... | ... and ${enumMembers.length - 10} more | |\n`;
    }
    markdown += `\n`;
  }

  markdown += `## Metadata\n\n`;
  markdown += `- **Raw Report Hash:** ${metadata.rawHash}\n`;
  markdown += `- **Processed Report Hash:** ${metadata.processedHash}\n`;
  markdown += `- **Scan Mode:** ${scanMode}\n\n`;

  fs.writeFileSync(reportFile, markdown);
  console.log(`Markdown report saved to ${reportFile}`);
}

function generateMetadata(
  rawContent: string,
  processedContent: string,
  scanMode: string,
  metadataFile: string,
  rawReportPath: string,
  processedReportPath: string,
  reportPath: string,
): ScanMetadata {
  const timestamp = new Date().toISOString();
  const rawHash = calculateHash(rawContent);
  const processedHash = calculateHash(processedContent);

  const metadata = {
    timestamp,
    scanMode,
    rawHash,
    processedHash,
    rawReportPath,
    processedReportPath,
    reportPath,
  };

  fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
  console.log(`Metadata saved to ${metadataFile}`);

  return metadata;
}

function displayStatistics(findings: NormalizedFinding[]): void {
  console.log("\n=== Statistics ===");
  console.log(`Total findings: ${findings.length}`);

  const byType = findings.reduce(
    (acc, f) => {
      acc[f.issueType] = (acc[f.issueType] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  console.log("\nBreakdown by issue type:");
  Object.entries(byType)
    .sort()
    .forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });

  console.log("\n=== Sample Findings ===");
  const samples = findings.slice(0, 5);
  samples.forEach((f) => {
    console.log(
      `  ${f.issueType}: ${f.normalizedPath}${f.symbolName ? ` (${f.symbolName})` : ""}`,
    );
  });

  if (findings.length > 5) {
    console.log(`  ... and ${findings.length - 5} more`);
  }
}

export function runScan(
  configFile: string,
  rawFile: string,
  processedFile: string,
  reportFile: string,
  metadataFile: string,
  scanMode: string,
): NormalizedFinding[] {
  console.log(
    `\n=== ${scanMode.charAt(0).toUpperCase() + scanMode.slice(1)} Scan Runner ===\n`,
  );

  const rawContent = captureRawKnipOutput(configFile, rawFile, scanMode);
  const findings = generateProcessedReport(rawContent, processedFile);
  const processedContent = fs.readFileSync(processedFile, "utf-8");

  const metadata = generateMetadata(
    rawContent,
    processedContent,
    scanMode,
    metadataFile,
    rawFile,
    processedFile,
    reportFile,
  );
  generateMarkdownReport(findings, metadata, reportFile, scanMode);

  displayStatistics(findings);

  return findings;
}

function main(): void {
  try {
    const mode = process.argv[2];

    if (mode === "compare") {
      runComparisonMode();
      return;
    }

    const validatedMode = validateMode(mode);

    console.log(
      `=== ${validatedMode.charAt(0).toUpperCase() + validatedMode.slice(1)} Scan Runner ===`,
    );
    console.log(
      validatedMode === "production"
        ? "Running production-only scan with --production flag\n"
        : "Running scan with configured test/spec/story references\n",
    );

    ensureReportsDirectory();

    const scanDefinition = getScanDefinition(validatedMode);
    const findings = runScan(
      scanDefinition.configFile,
      scanDefinition.rawOutputFile,
      scanDefinition.processedOutputFile,
      scanDefinition.reportFile,
      scanDefinition.metadataFile,
      scanDefinition.modeName,
    );

    console.log("\n=== Scan Complete ===");
    console.log(`Reports generated in: ${REPORTS_DIR}`);
    console.log(`\nTotal findings: ${findings.length}`);
  } catch (error) {
    console.error("\n=== Scan Failed ===");
    if (error instanceof KnipExecutionError) {
      console.error(`Knip execution error (exit code ${error.exitCode}):`);
      console.error(error.message);
      if (error.stderr) {
        console.error("Stderr:", error.stderr);
      }
    } else if (error instanceof KnipValidationError) {
      console.error("Knip validation error:", error.message);
    } else if (error instanceof Error) {
      console.error(error.message);
      if (error.message === "Missing required mode argument") {
        console.error("\nUsage: node dist/cli.js <mode>");
        console.error("\nValid modes:");
        console.error("  production          - Scan production code only");
        console.error(
          "  productionPlusTests - Scan production code with test/spec/story references",
        );
        console.error(
          "  compare             - Compare production and productionPlusTests scans",
        );
      } else if (error.message.startsWith("Invalid mode")) {
        console.error("\nValid modes are:");
        console.error("  production          - Scan production code only");
        console.error(
          "  productionPlusTests - Scan production code with test/spec/story references",
        );
        console.error(
          "  compare             - Compare production and productionPlusTests scans",
        );
      }
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

function runComparisonMode(): void {
  console.log("=== Comparison Mode ===\n");

  if (!fs.existsSync(PROCESSED_PRODUCTION_FILE)) {
    console.error(
      `Error: Production findings file not found: ${PROCESSED_PRODUCTION_FILE}`,
    );
    console.error(
      "Please run 'npm run scan:production' first to generate the production scan results.",
    );
    process.exit(1);
  }

  if (!fs.existsSync(PROCESSED_PRODUCTION_PLUS_TESTS_FILE)) {
    console.error(
      `Error: ProductionPlusTests findings file not found: ${PROCESSED_PRODUCTION_PLUS_TESTS_FILE}`,
    );
    console.error(
      "Please run 'npm run scan:productionPlusTests' first to generate the productionPlusTests scan results.",
    );
    process.exit(1);
  }

  const productionFindings: NormalizedFinding[] = JSON.parse(
    fs.readFileSync(PROCESSED_PRODUCTION_FILE, "utf-8"),
  );
  const productionPlusTestsFindings: NormalizedFinding[] = JSON.parse(
    fs.readFileSync(PROCESSED_PRODUCTION_PLUS_TESTS_FILE, "utf-8"),
  );

  const comparison = compareFindings(
    productionFindings,
    productionPlusTestsFindings,
  );

  console.log("\n=== Comparison Results ===\n");
  console.log(`Shared findings: ${comparison.sharedCount}`);
  console.log(`Production-only findings: ${comparison.productionOnlyCount}`);
  console.log(
    `ProductionPlusTests-only findings: ${comparison.productionPlusTestsOnlyCount}`,
  );
  console.log(`\nTotal production findings: ${productionFindings.length}`);
  console.log(
    `Total productionPlusTests findings: ${productionPlusTestsFindings.length}`,
  );

  if (comparison.productionOnly.length > 0) {
    console.log("\n=== Production-Only Findings ===\n");
    comparison.productionOnly.slice(0, 10).forEach((finding) => {
      console.log(
        `  ${finding.issueType}: ${finding.normalizedPath}${finding.symbolName ? ` (${finding.symbolName})` : ""}`,
      );
    });
    if (comparison.productionOnly.length > 10) {
      console.log(`  ... and ${comparison.productionOnly.length - 10} more`);
    }
  }

  if (comparison.productionPlusTestsOnly.length > 0) {
    console.log("\n=== ProductionPlusTests-Only Findings ===\n");
    comparison.productionPlusTestsOnly.slice(0, 10).forEach((finding) => {
      console.log(
        `  ${finding.issueType}: ${finding.normalizedPath}${finding.symbolName ? ` (${finding.symbolName})` : ""}`,
      );
    });
    if (comparison.productionPlusTestsOnly.length > 10) {
      console.log(
        `  ... and ${comparison.productionPlusTestsOnly.length - 10} more`,
      );
    }
  }

  console.log("\n=== Comparison Complete ===");
}

// Only run main if this file is executed directly (not imported)
if (require.main === module) {
  main();
}
