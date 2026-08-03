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
  getScanDefinition,
  compareFindings,
  runScan,
  ensureReportsDirectory,
  type ComparisonResult,
  type NormalizedFinding,
} from "./cli";

function getCountsByIssueType(findings: NormalizedFinding[]): Record<string, number> {
  return findings.reduce((acc, f) => {
    acc[f.issueType] = (acc[f.issueType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

function hasExcludedPath(finding: NormalizedFinding): boolean {
  const pathSegments = finding.normalizedPath.split("/").map((s: string) => s.toLowerCase());

  // Check for test/story directories
  const hasTestDirectory = pathSegments.some(
    (segment: string): boolean =>
      segment === "test" ||
      segment === "tests" ||
      segment === "__tests__" ||
      segment === "stories" ||
      segment === "__stories__" ||
      segment === "story"
  );

  // Check for test/story file patterns
  const hasTestFilePattern =
    finding.fileName.includes(".test.") ||
    finding.fileName.includes(".spec.") ||
    finding.fileName.includes(".stories.") ||
    finding.fileName.includes("-stories.") ||
    finding.fileName.includes(".story.") ||
    finding.fileName.includes(".testHelpers.");

  return (
    hasTestDirectory ||
    hasTestFilePattern ||
    finding.normalizedPath.endsWith(".d.ts")
  );
}

export function countExcludedPathViolations(findings: NormalizedFinding[]): number {
  return findings.filter(hasExcludedPath).length;
}

function printDemoSummary(productionFindings: NormalizedFinding[], productionPlusTestsFindings: NormalizedFinding[], comparison: ComparisonResult): void {
  console.log("\n=== End-to-End Demo Summary ===\n");

  console.log("Counts by Issue Type:");
  console.log("  Production:");
  const prodCounts = getCountsByIssueType(productionFindings);
  Object.entries(prodCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([type, count]) => {
      console.log(`    ${type}: ${count}`);
    });

  console.log("  ProductionPlusTests:");
  const prodPlusCounts = getCountsByIssueType(productionPlusTestsFindings);
  Object.entries(prodPlusCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([type, count]) => {
      console.log(`    ${type}: ${count}`);
    });

  console.log("\nComparison:");
  console.log(`  Intersection (shared findings): ${comparison.sharedCount}`);
  console.log(`  Production-only findings: ${comparison.productionOnlyCount}`);
  console.log(`  ProductionPlusTests-only findings: ${comparison.productionPlusTestsOnlyCount}`);

  // Calculate excluded-path violations independently for both reports
  const productionViolations = countExcludedPathViolations(productionFindings);
  const productionPlusTestsViolations = countExcludedPathViolations(productionPlusTestsFindings);

  console.log("\nExcluded-Path Violations (test/story/declaration files in processed reports):");
  console.log(`  Production report: ${productionViolations}`);
  console.log(`  ProductionPlusTests report: ${productionPlusTestsViolations}`);

  if (productionViolations > 0 || productionPlusTestsViolations > 0) {
    throw new Error(
      `Excluded-path validation failed: production=${productionViolations}, productionPlusTests=${productionPlusTestsViolations}`,
    );
  }

  console.log("\nRepresentative Findings (up to 10):");
  const allFindings = [...productionFindings];
  const samples = allFindings.slice(0, 10);
  samples.forEach((f) => {
    console.log(`  ${f.issueType}: ${f.normalizedPath}${f.symbolName ? ` (${f.symbolName})` : ""}`);
  });

  if (allFindings.length > 10) {
    console.log(`  ... and ${allFindings.length - 10} more`);
  }

  console.log("\n=== Demo Complete ===");
  console.log(`\nComplete reports saved to reports/ directory`);
}

export function main(): void {
  try {
    console.log("=== Maintenance Automation End-to-End Demo ===\n");
    console.log("This demo runs both production and productionPlusTests scans against Superset,");
    console.log("processes them through the same production-only filter, and displays a concise comparison.\n");

    ensureReportsDirectory();

    // Run production scan using CLI function
    const productionScanDef = getScanDefinition("production");
    const productionFindings = runScan(
      productionScanDef.configFile,
      productionScanDef.rawOutputFile,
      productionScanDef.processedOutputFile,
      productionScanDef.reportFile,
      productionScanDef.metadataFile,
      "production"
    );

    // Run productionPlusTests scan using CLI function
    const productionPlusTestsScanDef = getScanDefinition("productionPlusTests");
    const productionPlusTestsFindings = runScan(
      productionPlusTestsScanDef.configFile,
      productionPlusTestsScanDef.rawOutputFile,
      productionPlusTestsScanDef.processedOutputFile,
      productionPlusTestsScanDef.reportFile,
      productionPlusTestsScanDef.metadataFile,
      "productionPlusTests"
    );

    // Compare findings
    const comparison = compareFindings(productionFindings, productionPlusTestsFindings);

    // Print concise summary
    printDemoSummary(productionFindings, productionPlusTestsFindings, comparison);
  } catch (error) {
    console.error("\n=== Demo Failed ===");
    if (error instanceof Error) {
      console.error(error.message);
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
