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
import { parseKnipReport, NormalizedFinding, KnipReport } from "./parseKnipReport";

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

  constructor(message: string, stdout?: string, stderr?: string, exitCode?: number) {
    super(message);
    this.name = "KnipExecutionError";
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

export { KnipValidationError, KnipExecutionError, validateKnipReportStructure, KnipReport };

const REPORTS_DIR = path.join(__dirname, "..", "reports");
const RAW_OUTPUT_FILE = path.join(REPORTS_DIR, "raw-production.json");
const PROCESSED_OUTPUT_FILE = path.join(REPORTS_DIR, "processed-production.json");
const REPORT_FILE = path.join(REPORTS_DIR, "production-report.md");
const METADATA_FILE = path.join(REPORTS_DIR, "production-metadata.json");

function ensureReportsDirectory(): void {
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
    throw new KnipValidationError("Knip output does not contain valid 'issues' array");
  }

  // Validate that each issue has a file property and optional arrays
  for (const issue of report.issues) {
    if (typeof issue !== "object" || issue === null || !("file" in issue) || (issue as any).file === null) {
      throw new KnipValidationError("Each issue must have a non-null 'file' property");
    }
    // The arrays are optional, so we don't need to validate their presence
  }

  return true;
}

function captureRawKnipOutput(): string {
  console.log("Capturing raw Knip output...");
  
  let stdout: string;
  let stderr: string;
  let exitCode: number | undefined;

  try {
    stdout = execSync(
      "knip --directory ../superset-frontend --config ../maintenance-automation/knip.json --production --include files,exports,types,enumMembers --reporter json",
      {
        cwd: path.join(__dirname, ".."),
        encoding: "utf-8",
        stdio: "pipe",
      }
    );
    stderr = "";
    exitCode = 0;
  } catch (error: any) {
    // Knip returns exit code 1 when it finds issues, but stdout still contains the JSON
    stdout = error.stdout || "";
    stderr = error.stderr || "";
    exitCode = error.status || error.exitCode || 1;
    
    if (!stdout) {
      throw new KnipExecutionError(
        "Knip execution failed with no stdout output",
        stdout,
        stderr,
        exitCode
      );
    }
  }

  // Validate the output is valid JSON
  let parsedData: unknown;
  try {
    parsedData = JSON.parse(stdout);
  } catch (parseError) {
    throw new KnipExecutionError(
      "Failed to parse Knip output as JSON",
      stdout,
      stderr,
      exitCode
    );
  }

  // Validate the structure
  try {
    validateKnipReportStructure(parsedData);
  } catch (validationError: any) {
    throw new KnipExecutionError(
      `Knip output validation failed: ${validationError.message}`,
      stdout,
      stderr,
      exitCode
    );
  }

  // If we got here, the output is valid
  fs.writeFileSync(RAW_OUTPUT_FILE, stdout);
  console.log(`Raw output saved to ${RAW_OUTPUT_FILE}`);
  
  if (exitCode === 0) {
    console.log("Knip completed successfully with no findings");
  } else if (exitCode === 1) {
    console.log("Knip found unused code (exit code 1) - this is expected behavior");
  } else {
    console.log(`Knip completed with exit code ${exitCode} - output validated and accepted`);
  }
  
  return stdout;
}

function calculateHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function generateProcessedReport(rawContent: string): NormalizedFinding[] {
  console.log("Parsing and filtering Knip report...");
  const knipReport = JSON.parse(rawContent) as KnipReport;
  const findings = parseKnipReport(knipReport);
  
  fs.writeFileSync(PROCESSED_OUTPUT_FILE, JSON.stringify(findings, null, 2));
  console.log(`Processed report saved to ${PROCESSED_OUTPUT_FILE}`);
  
  return findings;
}

function generateMarkdownReport(findings: NormalizedFinding[], metadata: any): void {
  console.log("Generating markdown report...");
  
  const totalFindings = findings.length;
  const files = findings.filter(f => f.issueType === "files");
  const exports = findings.filter(f => f.issueType === "exports");
  const types = findings.filter(f => f.issueType === "types");
  const enumMembers = findings.filter(f => f.issueType === "enumMembers");
  
  let markdown = `# Production Code Unused Findings Report\n\n`;
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
    files.slice(0, 10).forEach(f => {
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
    exports.slice(0, 10).forEach(f => {
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
    types.slice(0, 10).forEach(f => {
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
    enumMembers.slice(0, 10).forEach(f => {
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
  markdown += `- **Scan Mode:** production\n\n`;
  
  fs.writeFileSync(REPORT_FILE, markdown);
  console.log(`Markdown report saved to ${REPORT_FILE}`);
}

function generateMetadata(rawContent: string, processedContent: string): any {
  const timestamp = new Date().toISOString();
  const rawHash = calculateHash(rawContent);
  const processedHash = calculateHash(processedContent);
  
  const metadata = {
    timestamp,
    scanMode: "production",
    rawHash,
    processedHash,
    rawReportPath: RAW_OUTPUT_FILE,
    processedReportPath: PROCESSED_OUTPUT_FILE,
    reportPath: REPORT_FILE,
  };
  
  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));
  console.log(`Metadata saved to ${METADATA_FILE}`);
  
  return metadata;
}

function displayStatistics(findings: NormalizedFinding[]): void {
  console.log("\n=== Statistics ===");
  console.log(`Total findings: ${findings.length}`);
  
  const byType = findings.reduce((acc, f) => {
    acc[f.issueType] = (acc[f.issueType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log("\nBreakdown by issue type:");
  Object.entries(byType).sort().forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });
  
  console.log("\n=== Sample Findings ===");
  const samples = findings.slice(0, 5);
  samples.forEach(f => {
    console.log(`  ${f.issueType}: ${f.normalizedPath}${f.symbolName ? ` (${f.symbolName})` : ""}`);
  });
  
  if (findings.length > 5) {
    console.log(`  ... and ${findings.length - 5} more`);
  }
}

function main(): void {
  try {
    console.log("=== Production Scan Runner ===\n");
    
    ensureReportsDirectory();
    const rawContent = captureRawKnipOutput();
    const findings = generateProcessedReport(rawContent);
    const processedContent = fs.readFileSync(PROCESSED_OUTPUT_FILE, "utf-8");
    
    const metadata = generateMetadata(rawContent, processedContent);
    generateMarkdownReport(findings, metadata);
    
    displayStatistics(findings);
    
    console.log("\n=== Scan Complete ===");
    console.log(`Reports generated in: ${REPORTS_DIR}`);
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
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

// Only run main if this file is executed directly (not imported)
if (require.main === module) {
  main();
}