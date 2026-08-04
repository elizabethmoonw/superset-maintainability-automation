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
  compareFindings,
  KnipValidationError,
  validateKnipReportStructure,
  validateKnipExitCode,
  validateMode,
  getScanDefinition,
  buildKnipArguments,
  buildKnipCommand,
  type KnipReport,
  type ScanDefinition,
  type ScanMode,
} from "./cli";
import { NormalizedFinding } from "./parseKnipReport";
import { readFileSync } from "fs";
import { join } from "path";

test("validateKnipExitCode: accepts Knip success and findings exit codes", () => {
  expect(() => validateKnipExitCode(0)).not.toThrow();
  expect(() => validateKnipExitCode(1)).not.toThrow();
});

test("validateKnipExitCode: rejects unexpected Knip exit codes", () => {
  expect(() => validateKnipExitCode(2)).toThrow(
    "Knip returned unexpected exit code 2",
  );
});

test("validateMode: accepts valid mode 'production'", () => {
  const result = validateMode("production");
  expect(result).toBe("production");
});

test("validateMode: accepts valid mode 'productionPlusTests'", () => {
  const result = validateMode("productionPlusTests");
  expect(result).toBe("productionPlusTests");
});

test("validateMode: throws error for missing mode argument", () => {
  expect(() => validateMode(undefined)).toThrow(
    "Missing required mode argument",
  );
});

test("validateMode: throws error for invalid mode argument", () => {
  expect(() => validateMode("invalidMode")).toThrow(
    "Invalid mode 'invalidMode'",
  );
  expect(() => validateMode("Production")).toThrow("Invalid mode 'Production'");
  expect(() => validateMode("test")).toThrow("Invalid mode 'test'");
});

test("getScanDefinition: returns correct scan definition for production mode", () => {
  const scanDef = getScanDefinition("production");

  expect(scanDef.modeName).toBe("production");
  expect(scanDef.configFile).toBe("knip.json");
  expect(scanDef.rawOutputFile).toContain("raw-production.json");
  expect(scanDef.processedOutputFile).toContain("processed-production.json");
  expect(scanDef.reportFile).toContain("production-report.md");
  expect(scanDef.metadataFile).toContain("production-metadata.json");
});

test("getScanDefinition: returns correct scan definition for productionPlusTests mode", () => {
  const scanDef = getScanDefinition("productionPlusTests");

  expect(scanDef.modeName).toBe("productionPlusTests");
  expect(scanDef.configFile).toBe("knip-production-plus-tests.json");
  expect(scanDef.rawOutputFile).toContain("raw-productionPlusTests.json");
  expect(scanDef.processedOutputFile).toContain(
    "processed-productionPlusTests.json",
  );
  expect(scanDef.reportFile).toContain("productionPlusTests-report.md");
  expect(scanDef.metadataFile).toContain("productionPlusTests-metadata.json");
});

test("getScanDefinition: returns different config files for each mode", () => {
  const productionDef = getScanDefinition("production");
  const productionPlusTestsDef = getScanDefinition("productionPlusTests");

  expect(productionDef.configFile).not.toBe(productionPlusTestsDef.configFile);
  expect(productionDef.configFile).toBe("knip.json");
  expect(productionPlusTestsDef.configFile).toBe(
    "knip-production-plus-tests.json",
  );
});

test("getScanDefinition: returns different output paths for each mode", () => {
  const productionDef = getScanDefinition("production");
  const productionPlusTestsDef = getScanDefinition("productionPlusTests");

  expect(productionDef.rawOutputFile).not.toBe(
    productionPlusTestsDef.rawOutputFile,
  );
  expect(productionDef.processedOutputFile).not.toBe(
    productionPlusTestsDef.processedOutputFile,
  );
  expect(productionDef.reportFile).not.toBe(productionPlusTestsDef.reportFile);
  expect(productionDef.metadataFile).not.toBe(
    productionPlusTestsDef.metadataFile,
  );
});

test("buildKnipCommand: uses --production only for production mode", () => {
  const scanDef = getScanDefinition("production");
  const command = buildKnipCommand(scanDef);

  expect(command).toContain("--production");
  expect(
    buildKnipCommand(getScanDefinition("productionPlusTests")),
  ).not.toContain("--production");
});

test("buildKnipArguments: keeps shared flags identical across scan modes", () => {
  const productionArguments = buildKnipArguments(
    "production",
    "frontend",
    "production.json",
  );
  const productionPlusTestsArguments = buildKnipArguments(
    "productionPlusTests",
    "frontend",
    "all.json",
  );

  expect(productionArguments).toContain("--production");
  expect(productionPlusTestsArguments).not.toContain("--production");
  expect(productionArguments).toEqual(
    expect.arrayContaining([
      "--directory",
      "frontend",
      "--include",
      "files,exports,types,enumMembers",
      "--reporter",
      "json",
    ]),
  );
  expect(productionPlusTestsArguments).toEqual(
    expect.arrayContaining([
      "--directory",
      "frontend",
      "--include",
      "files,exports,types,enumMembers",
      "--reporter",
      "json",
    ]),
  );
});

test("buildKnipCommand: includes correct config file for production mode", () => {
  const scanDef = getScanDefinition("production");
  const command = buildKnipCommand(scanDef);

  expect(command).toContain("--config ../maintenance-automation/knip.json");
});

test("buildKnipCommand: includes correct config file for productionPlusTests mode", () => {
  const scanDef = getScanDefinition("productionPlusTests");
  const command = buildKnipCommand(scanDef);

  expect(command).toContain(
    "--config ../maintenance-automation/knip-production-plus-tests.json",
  );
});

test("buildKnipCommand: includes required flags for both modes", () => {
  const productionDef = getScanDefinition("production");
  const productionPlusTestsDef = getScanDefinition("productionPlusTests");

  const productionCommand = buildKnipCommand(productionDef);
  const productionPlusTestsCommand = buildKnipCommand(productionPlusTestsDef);

  // Both should have these flags
  expect(productionCommand).toContain("--directory ../superset-frontend");
  expect(productionCommand).toContain(
    "--include files,exports,types,enumMembers",
  );
  expect(productionCommand).toContain("--reporter json");

  expect(productionPlusTestsCommand).toContain(
    "--directory ../superset-frontend",
  );
  expect(productionPlusTestsCommand).toContain(
    "--include files,exports,types,enumMembers",
  );
  expect(productionPlusTestsCommand).toContain("--reporter json");
});

test("validateKnipReportStructure: accepts valid Knip report structure", () => {
  const validReport: KnipReport = {
    issues: [
      {
        file: "src/components/Button.tsx",
        enumMembers: [],
        exports: [],
        files: [{ name: "src/components/Button.tsx" }],
        types: [],
      },
    ],
  };

  expect(validateKnipReportStructure(validReport)).toBe(true);
});

test("validateKnipReportStructure: accepts Knip report with optional arrays omitted", () => {
  const validReport: KnipReport = {
    issues: [
      {
        file: "src/components/Button.tsx",
      },
    ],
  };

  expect(validateKnipReportStructure(validReport)).toBe(true);
});

test("validateKnipReportStructure: accepts Knip report with empty issues array", () => {
  const validReport: KnipReport = {
    issues: [],
  };

  expect(validateKnipReportStructure(validReport)).toBe(true);
});

test("validateKnipReportStructure: rejects non-object input", () => {
  expect(() => validateKnipReportStructure(null)).toThrow(KnipValidationError);
  expect(() => validateKnipReportStructure(undefined)).toThrow(
    KnipValidationError,
  );
  expect(() => validateKnipReportStructure("string")).toThrow(
    KnipValidationError,
  );
  expect(() => validateKnipReportStructure(123)).toThrow(KnipValidationError);
});

test("validateKnipReportStructure: rejects object without issues property", () => {
  const invalidReport = {
    notIssues: [],
  };

  expect(() => validateKnipReportStructure(invalidReport)).toThrow(
    KnipValidationError,
  );
});

test("validateKnipReportStructure: rejects non-array issues property", () => {
  const invalidReport = {
    issues: "not an array",
  };

  expect(() => validateKnipReportStructure(invalidReport)).toThrow(
    KnipValidationError,
  );
});

test("validateKnipReportStructure: rejects issue without file property", () => {
  const invalidReport = {
    issues: [
      {
        notFile: "src/components/Button.tsx",
      },
    ],
  };

  expect(() => validateKnipReportStructure(invalidReport)).toThrow(
    KnipValidationError,
  );
});

test("validateKnipReportStructure: rejects issue with null file property", () => {
  const invalidReport = {
    issues: [
      {
        file: null,
      },
    ],
  };

  expect(() => validateKnipReportStructure(invalidReport)).toThrow(
    KnipValidationError,
  );
});

test("validateKnipReportStructure: rejects non-object issue", () => {
  const invalidReport = {
    issues: ["not an object"],
  };

  expect(() => validateKnipReportStructure(invalidReport)).toThrow(
    KnipValidationError,
  );
});

test("compareFindings: identifies shared, production-only, and productionPlusTests-only findings", () => {
  const productionFindings: NormalizedFinding[] = [
    {
      normalizedPath: "src/components/Button.tsx",
      fileName: "Button.tsx",
      fileExtension: "tsx",
      filePath: "src/components/Button.tsx",
      issueType: "files",
    },
    {
      normalizedPath: "src/utils/helper.ts",
      fileName: "helper.ts",
      fileExtension: "ts",
      filePath: "src/utils/helper.ts",
      issueType: "exports",
      symbolName: "unusedFunction",
      line: 10,
    },
    {
      normalizedPath: "src/types/CustomType.ts",
      fileName: "CustomType.ts",
      fileExtension: "ts",
      filePath: "src/types/CustomType.ts",
      issueType: "types",
      symbolName: "UnusedType",
      line: 5,
    },
    {
      normalizedPath: "src/enums/Status.ts",
      fileName: "Status.ts",
      fileExtension: "ts",
      filePath: "src/enums/Status.ts",
      issueType: "enumMembers",
      symbolName: "DeprecatedStatus",
      line: 15,
    },
  ];

  const productionPlusTestsFindings: NormalizedFinding[] = [
    {
      normalizedPath: "src/components/Button.tsx",
      fileName: "Button.tsx",
      fileExtension: "tsx",
      filePath: "src/components/Button.tsx",
      issueType: "files",
    },
    {
      normalizedPath: "src/utils/helper.ts",
      fileName: "helper.ts",
      fileExtension: "ts",
      filePath: "src/utils/helper.ts",
      issueType: "exports",
      symbolName: "unusedFunction",
      line: 10,
    },
    {
      normalizedPath: "src/types/AnotherType.ts",
      fileName: "AnotherType.ts",
      fileExtension: "ts",
      filePath: "src/types/AnotherType.ts",
      issueType: "types",
      symbolName: "AnotherUnusedType",
      line: 8,
    },
  ];

  const result = compareFindings(
    productionFindings,
    productionPlusTestsFindings,
  );

  expect(result.sharedCount).toBe(2);
  expect(result.productionOnlyCount).toBe(2);
  expect(result.productionPlusTestsOnlyCount).toBe(1);
  expect(result.productionOnly).toHaveLength(2);
  expect(result.productionPlusTestsOnly).toHaveLength(1);
});

test("compareFindings: handles empty arrays", () => {
  const result = compareFindings([], []);

  expect(result.sharedCount).toBe(0);
  expect(result.productionOnlyCount).toBe(0);
  expect(result.productionPlusTestsOnlyCount).toBe(0);
  expect(result.productionOnly).toHaveLength(0);
  expect(result.productionPlusTestsOnly).toHaveLength(0);
});

test("compareFindings: handles all shared findings", () => {
  const findings: NormalizedFinding[] = [
    {
      normalizedPath: "src/components/Button.tsx",
      fileName: "Button.tsx",
      fileExtension: "tsx",
      filePath: "src/components/Button.tsx",
      issueType: "files",
    },
  ];

  const result = compareFindings(findings, findings);

  expect(result.sharedCount).toBe(1);
  expect(result.productionOnlyCount).toBe(0);
  expect(result.productionPlusTestsOnlyCount).toBe(0);
  expect(result.productionOnly).toHaveLength(0);
  expect(result.productionPlusTestsOnly).toHaveLength(0);
});

test("compareFindings: handles findings with different issue types at same path", () => {
  const productionFindings: NormalizedFinding[] = [
    {
      normalizedPath: "src/components/Button.tsx",
      fileName: "Button.tsx",
      fileExtension: "tsx",
      filePath: "src/components/Button.tsx",
      issueType: "files",
    },
  ];

  const productionPlusTestsFindings: NormalizedFinding[] = [
    {
      normalizedPath: "src/components/Button.tsx",
      fileName: "Button.tsx",
      fileExtension: "tsx",
      filePath: "src/components/Button.tsx",
      issueType: "exports",
      symbolName: "unusedExport",
      line: 5,
    },
  ];

  const result = compareFindings(
    productionFindings,
    productionPlusTestsFindings,
  );

  expect(result.sharedCount).toBe(0);
  expect(result.productionOnlyCount).toBe(1);
  expect(result.productionPlusTestsOnlyCount).toBe(1);
});

test("CLI uses correct output paths from scan definition: production mode uses production-specific output paths", () => {
  const scanDef = getScanDefinition("production");

  expect(scanDef.rawOutputFile).toContain("raw-production.json");
  expect(scanDef.processedOutputFile).toContain("processed-production.json");
  expect(scanDef.reportFile).toContain("production-report.md");
  expect(scanDef.metadataFile).toContain("production-metadata.json");
});

test("CLI uses correct output paths from scan definition: productionPlusTests mode uses productionPlusTests-specific output paths", () => {
  const scanDef = getScanDefinition("productionPlusTests");

  expect(scanDef.rawOutputFile).toContain("raw-productionPlusTests.json");
  expect(scanDef.processedOutputFile).toContain(
    "processed-productionPlusTests.json",
  );
  expect(scanDef.reportFile).toContain("productionPlusTests-report.md");
  expect(scanDef.metadataFile).toContain("productionPlusTests-metadata.json");
});

test("CLI uses correct output paths from scan definition: both modes use different output paths to avoid conflicts", () => {
  const productionDef = getScanDefinition("production");
  const productionPlusTestsDef = getScanDefinition("productionPlusTests");

  // All output paths should be different
  expect(productionDef.rawOutputFile).not.toBe(
    productionPlusTestsDef.rawOutputFile,
  );
  expect(productionDef.processedOutputFile).not.toBe(
    productionPlusTestsDef.processedOutputFile,
  );
  expect(productionDef.reportFile).not.toBe(productionPlusTestsDef.reportFile);
  expect(productionDef.metadataFile).not.toBe(
    productionPlusTestsDef.metadataFile,
  );
});

test("production code selection logic: production config uses only source entry points", () => {
  const scanDef = getScanDefinition("production");
  expect(scanDef.configFile).toBe("knip.json");
});

test("production code selection logic: productionPlusTests config includes test entry points", () => {
  const scanDef = getScanDefinition("productionPlusTests");
  expect(scanDef.configFile).toBe("knip-production-plus-tests.json");
});

test("production code selection logic: both modes include same issue types", () => {
  const productionDef = getScanDefinition("production");
  const productionPlusTestsDef = getScanDefinition("productionPlusTests");

  const productionCommand = buildKnipCommand(productionDef);
  const productionPlusTestsCommand = buildKnipCommand(productionPlusTestsDef);

  // Both should include the same issue types
  expect(productionCommand).toContain(
    "--include files,exports,types,enumMembers",
  );
  expect(productionPlusTestsCommand).toContain(
    "--include files,exports,types,enumMembers",
  );
});

interface KnipWorkspaceConfig {
  $schema?: string;
  workspaces?: Record<string, { entry: string[] }>;
  ignoreWorkspaces?: string[];
}

const configPath = join(__dirname, "..", "knip-production-plus-tests.json");
const config: KnipWorkspaceConfig = JSON.parse(
  readFileSync(configPath, "utf-8"),
);

function entryPatternsOf(workspaceConfig: KnipWorkspaceConfig): string[] {
  const entry = workspaceConfig.workspaces?.["."].entry;
  if (entry === undefined) {
    throw new Error(
      "Knip config is missing entry patterns for the root workspace",
    );
  }
  return entry;
}

test("knip-production-plus-tests.json configuration validation: config file exists and is valid JSON", () => {
  expect(config).toBeDefined();
  expect(config.$schema).toBeDefined();
  expect(config.workspaces).toBeDefined();
});

test("knip-production-plus-tests.json configuration validation: contains all required filename patterns", () => {
  const entryPatterns = entryPatternsOf(config);

  // Filename patterns for test/spec/story files
  expect(entryPatterns).toContain("**/*.test.{ts,tsx,js,jsx}!");
  expect(entryPatterns).toContain("**/*.spec.{ts,tsx,js,jsx}!");
  expect(entryPatterns).toContain("**/*.story.{ts,tsx,js,jsx}!");
  expect(entryPatterns).toContain("**/*.stories.{ts,tsx,js,jsx}!");
  expect(entryPatterns).toContain("**/*-stories.{ts,tsx,js,jsx}!");
  expect(entryPatterns).toContain("**/*.testHelpers.{ts,tsx,js,jsx}!");
});

test("knip-production-plus-tests.json configuration validation: contains all required directory patterns for root and nested", () => {
  const entryPatterns = entryPatternsOf(config);

  // Spec is a root directory; test and story directories may occur anywhere.
  expect(entryPatterns).toContain("spec/*.{ts,tsx,js,jsx}!");
  expect(entryPatterns).toContain("spec/**/*.{ts,tsx,js,jsx}!");
  expect(entryPatterns).toContain("**/test/**/*.{ts,tsx,js,jsx}!");
  expect(entryPatterns).toContain("**/tests/**/*.{ts,tsx,js,jsx}!");
  expect(entryPatterns).toContain("**/__tests__/**/*.{ts,tsx,js,jsx}!");
  expect(entryPatterns).toContain("**/story/**/*.{ts,tsx,js,jsx}!");
  expect(entryPatterns).toContain("**/stories/**/*.{ts,tsx,js,jsx}!");
  expect(entryPatterns).toContain("**/__stories__/**/*.{ts,tsx,js,jsx}!");
});

test("knip-production-plus-tests.json configuration validation: directory patterns match representative root and nested paths", () => {
  const picomatch = require("picomatch");
  const entryPatterns = entryPatternsOf(config).map((pattern: string) =>
    pattern.endsWith("!") ? pattern.slice(0, -1) : pattern,
  );
  const isReferenceSource = (filePath: string) =>
    entryPatterns.some((pattern: string) =>
      picomatch.isMatch(filePath, pattern),
    );

  expect(isReferenceSource("tests/helper.ts")).toBe(true);
  expect(isReferenceSource("src/components/tests/helper.ts")).toBe(true);
  expect(isReferenceSource("src/features/widget/__stories__/helper.tsx")).toBe(
    true,
  );
});

test("knip-production-plus-tests.json configuration validation: contains all production entry points", () => {
  const entryPatterns = entryPatternsOf(config);

  // Production source entry points
  expect(entryPatterns).toContain("src/preamble.ts!");
  expect(entryPatterns).toContain("src/theme.ts!");
  expect(entryPatterns).toContain("src/views/menu.tsx!");
  expect(entryPatterns).toContain("src/views/index.tsx!");
  expect(entryPatterns).toContain("src/embedded/index.tsx!");
  expect(entryPatterns).toContain("src/service-worker.ts!");
});

test("knip-production-plus-tests.json configuration validation: does not include tooling/config patterns in entry", () => {
  const entryPatterns = entryPatternsOf(config);

  // These should NOT be in entry patterns
  const hasStorybookPatterns = entryPatterns.some((pattern: string) =>
    pattern.includes(".storybook"),
  );
  const hasWebpackPatterns = entryPatterns.some((pattern: string) =>
    pattern.includes("webpack"),
  );
  const hasPluginsPatterns = entryPatterns.some((pattern: string) =>
    pattern.startsWith("plugins/"),
  );
  const hasPackagesPatterns = entryPatterns.some((pattern: string) =>
    pattern.startsWith("packages/"),
  );

  expect(hasStorybookPatterns).toBe(false);
  expect(hasWebpackPatterns).toBe(false);
  expect(hasPluginsPatterns).toBe(false);
  expect(hasPackagesPatterns).toBe(false);
});

test("knip-production-plus-tests.json configuration validation: has correct ignoreWorkspaces configuration", () => {
  expect(config.ignoreWorkspaces).toBeDefined();
  expect(config.ignoreWorkspaces).toContain("packages/*");
  expect(config.ignoreWorkspaces).toContain("plugins/*");
});

test("knip-production-plus-tests.json configuration validation: ignoreWorkspaces entries are not in entry patterns", () => {
  const entryPatterns = entryPatternsOf(config);
  const ignoreWorkspaces = config.ignoreWorkspaces ?? [];

  // Ensure ignoreWorkspaces patterns are not duplicated in entry
  ignoreWorkspaces.forEach((ignorePattern: string) => {
    const isInEntry = entryPatterns.some((entryPattern: string) =>
      entryPattern.startsWith(ignorePattern),
    );
    expect(isInEntry).toBe(false);
  });
});
