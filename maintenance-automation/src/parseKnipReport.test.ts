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
  parseKnipReport,
  KnipReport,
  NormalizedFinding,
} from "./parseKnipReport";
import * as fs from "fs";
import * as path from "path";

const realisticKnipReport = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures", "realisticKnipReport.json"),
    "utf-8",
  ),
) as KnipReport;

const integrationTestFixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures", "integrationTestFixture.json"),
    "utf-8",
  ),
) as KnipReport;

const integrationTestFixtureProductionPlusTests = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "fixtures",
      "integrationTestFixtureProductionPlusTests.json",
    ),
    "utf-8",
  ),
) as KnipReport;

test("path derivation: derives normalizedPath, fileName, and fileExtension from filePath", () => {
  const report: KnipReport = {
    issues: [
      {
        file: "src/components/Button.tsx",
        files: [{ name: "src/components/Button.tsx" }],
      },
    ],
  };

  const results = parseKnipReport(report);
  expect(results).toHaveLength(1);
  expect(results[0].normalizedPath).toBe("src/components/Button.tsx");
  expect(results[0].fileName).toBe("Button.tsx");
  expect(results[0].fileExtension).toBe("tsx");
});

test("path derivation: handles paths with leading ./", () => {
  const report: KnipReport = {
    issues: [
      {
        file: "./src/components/Button.tsx",
        files: [{ name: "./src/components/Button.tsx" }],
      },
    ],
  };

  const results = parseKnipReport(report);
  expect(results).toHaveLength(1);
  expect(results[0].normalizedPath).toBe("src/components/Button.tsx");
});

test("path derivation: handles .ts files", () => {
  const report: KnipReport = {
    issues: [
      {
        file: "src/utils/helper.ts",
        files: [{ name: "src/utils/helper.ts" }],
      },
    ],
  };

  const results = parseKnipReport(report);
  expect(results).toHaveLength(1);
  expect(results[0].fileExtension).toBe("ts");
});

test("path derivation: handles files without extension (rejected by isAcceptedFinding)", () => {
  const report: KnipReport = {
    issues: [
      {
        file: "src/components/Button",
        files: [{ name: "src/components/Button" }],
      },
    ],
  };

  const results = parseKnipReport(report);
  expect(results).toHaveLength(0); // Rejected because not .ts or .tsx
});

test("filtering with isAcceptedFinding: rejects .storybook paths", () => {
  const report: KnipReport = {
    issues: [
      {
        file: ".storybook/shared/createQueryStory.tsx",
        files: [{ name: ".storybook/shared/createQueryStory.tsx" }],
      },
    ],
  };

  const results = parseKnipReport(report);
  expect(results).toHaveLength(0);
});

test("filtering with isAcceptedFinding: rejects paths with test directory segments", () => {
  const report: KnipReport = {
    issues: [
      {
        file: "src/components/test/Button.tsx",
        files: [{ name: "src/components/test/Button.tsx" }],
      },
    ],
  };

  const results = parseKnipReport(report);
  expect(results).toHaveLength(0);
});

test("filtering with isAcceptedFinding: rejects .test. files", () => {
  const report: KnipReport = {
    issues: [
      {
        file: "src/components/Button.test.tsx",
        files: [{ name: "src/components/Button.test.tsx" }],
      },
    ],
  };

  const results = parseKnipReport(report);
  expect(results).toHaveLength(0);
});

test("filtering with isAcceptedFinding: rejects .d.ts files", () => {
  const report: KnipReport = {
    issues: [
      {
        file: "src/types/Button.d.ts",
        files: [{ name: "src/types/Button.d.ts" }],
      },
    ],
  };

  const results = parseKnipReport(report);
  expect(results).toHaveLength(0);
});

test("filtering with isAcceptedFinding: accepts valid src/ paths", () => {
  const report: KnipReport = {
    issues: [
      {
        file: "src/components/Button.tsx",
        files: [{ name: "src/components/Button.tsx" }],
      },
    ],
  };

  const results = parseKnipReport(report);
  expect(results).toHaveLength(1);
});

test("issue type processing: processes files issue type", () => {
  const report: KnipReport = {
    issues: [
      {
        file: "src/components/Button.tsx",
        files: [{ name: "src/components/Button.tsx" }],
      },
    ],
  };

  const results = parseKnipReport(report);
  expect(results).toHaveLength(1);
  expect(results[0].issueType).toBe("files");
});

test("issue type processing: processes exports issue type with symbol info", () => {
  const report: KnipReport = {
    issues: [
      {
        file: "src/components/Button.tsx",
        exports: [
          {
            name: "ButtonComponent",
            line: 10,
            col: 14,
            pos: 1234,
          },
        ],
      },
    ],
  };

  const results = parseKnipReport(report);
  expect(results).toHaveLength(1);
  expect(results[0].issueType).toBe("exports");
  expect(results[0].symbolName).toBe("ButtonComponent");
  expect(results[0].line).toBe(10);
  expect(results[0].col).toBe(14);
});

test("issue type processing: processes types issue type with symbol info", () => {
  const report: KnipReport = {
    issues: [
      {
        file: "src/components/Button.tsx",
        types: [
          {
            name: "ButtonProps",
            line: 5,
            col: 18,
            pos: 1234,
          },
        ],
      },
    ],
  };

  const results = parseKnipReport(report);
  expect(results).toHaveLength(1);
  expect(results[0].issueType).toBe("types");
  expect(results[0].symbolName).toBe("ButtonProps");
});

test("issue type processing: processes enumMembers issue type with symbol info", () => {
  const report: KnipReport = {
    issues: [
      {
        file: "src/components/Button.tsx",
        enumMembers: [
          {
            namespace: "ButtonEnum",
            name: "Primary",
            line: 20,
            col: 3,
            pos: 1234,
          },
        ],
      },
    ],
  };

  const results = parseKnipReport(report);
  expect(results).toHaveLength(1);
  expect(results[0].issueType).toBe("enumMembers");
  expect(results[0].symbolName).toBe("Primary");
});

test("issue type processing: processes multiple symbols in one file", () => {
  const report: KnipReport = {
    issues: [
      {
        file: "src/components/Button.tsx",
        exports: [
          {
            name: "ButtonComponent",
            line: 10,
            col: 14,
            pos: 1234,
          },
          {
            name: "ButtonProps",
            line: 15,
            col: 14,
            pos: 5678,
          },
        ],
      },
    ],
  };

  const results = parseKnipReport(report);
  expect(results).toHaveLength(2);
  expect(results[0].symbolName).toBe("ButtonComponent");
  expect(results[1].symbolName).toBe("ButtonProps");
});

test("issue type processing: ignores other issue types (not in our scope)", () => {
  const report: KnipReport = {
    issues: [
      {
        file: "src/components/Button.tsx",
      },
    ],
  };

  const results = parseKnipReport(report);
  expect(results).toHaveLength(0);
});

test("sorting: sorts by issueType first", () => {
  const report: KnipReport = {
    issues: [
      {
        file: "src/components/Button.tsx",
        files: [{ name: "src/components/Button.tsx" }],
      },
      {
        file: "src/utils/helper.ts",
        exports: [
          {
            name: "helper",
            line: 5,
            col: 14,
            pos: 1234,
          },
        ],
      },
    ],
  };

  const results = parseKnipReport(report);
  expect(results).toHaveLength(2);
  expect(results[0].issueType).toBe("exports"); // e comes before f
  expect(results[1].issueType).toBe("files");
});

test("sorting: sorts by normalizedPath within same issueType", () => {
  const report: KnipReport = {
    issues: [
      {
        file: "src/components/Button.tsx",
        files: [{ name: "src/components/Button.tsx" }],
      },
      {
        file: "src/utils/helper.ts",
        files: [{ name: "src/utils/helper.ts" }],
      },
    ],
  };

  const results = parseKnipReport(report);
  expect(results).toHaveLength(2);
  expect(results[0].normalizedPath).toBe("src/components/Button.tsx");
  expect(results[1].normalizedPath).toBe("src/utils/helper.ts");
});

test("sorting: sorts by symbolName within same path", () => {
  const report: KnipReport = {
    issues: [
      {
        file: "src/components/Button.tsx",
        exports: [
          {
            name: "Zebra",
            line: 10,
            col: 14,
            pos: 1234,
          },
          {
            name: "Apple",
            line: 5,
            col: 14,
            pos: 5678,
          },
        ],
      },
    ],
  };

  const results = parseKnipReport(report);
  expect(results).toHaveLength(2);
  expect(results[0].symbolName).toBe("Apple");
  expect(results[1].symbolName).toBe("Zebra");
});

test("realistic Knip report fixture: processes realistic Knip output correctly", () => {
  const results = parseKnipReport(realisticKnipReport as KnipReport);

  // Should filter out .storybook paths
  const storybookFindings = results.filter((f) =>
    f.normalizedPath.startsWith(".storybook"),
  );
  expect(storybookFindings).toHaveLength(0);

  // Should accept valid src/ paths
  const srcFindings = results.filter((f) =>
    f.normalizedPath.startsWith("src/"),
  );
  expect(srcFindings.length).toBeGreaterThan(0);

  // Check specific accepted files
  const colorSchemeFile = results.find(
    (f) =>
      f.normalizedPath ===
      "src/dashboard/components/ColorSchemeControlWrapper.tsx",
  );
  expect(colorSchemeFile).toBeDefined();
  expect(colorSchemeFile?.issueType).toBe("files");

  // Check specific accepted exports
  const selectLabelExport = results.find(
    (f) => f.symbolName === "SelectLabel" && f.issueType === "exports",
  );
  expect(selectLabelExport).toBeDefined();
  expect(selectLabelExport?.normalizedPath).toBe(
    "src/components/DatabaseSelector/index.tsx",
  );

  // Check specific accepted types
  const dashboardStateType = results.find(
    (f) => f.symbolName === "DashboardState" && f.issueType === "types",
  );
  expect(dashboardStateType).toBeDefined();
  expect(dashboardStateType?.normalizedPath).toBe(
    "src/features/alerts/types.ts",
  );

  // Check specific accepted enum members
  const endsWithEnum = results.find(
    (f) => f.symbolName === "EndsWith" && f.issueType === "enumMembers",
  );
  expect(endsWithEnum).toBeDefined();
  expect(endsWithEnum?.normalizedPath).toBe("src/components/ListView/types.ts");

  // Verify .skipped-stories files are filtered out
  const skippedStories = results.filter((f) => f.fileName.includes("-stories"));
  expect(skippedStories).toHaveLength(0);
});

test("realistic Knip report fixture: shows sample of normalized output", () => {
  const results = parseKnipReport(realisticKnipReport as KnipReport);

  // Show first few findings from each category
  const files = results.filter((f) => f.issueType === "files");
  const exports = results.filter((f) => f.issueType === "exports");
  const types = results.filter((f) => f.issueType === "types");
  const enumMembers = results.filter((f) => f.issueType === "enumMembers");

  // Verify we have findings in each category
  expect(files.length).toBeGreaterThan(0);
  expect(exports.length).toBeGreaterThan(0);
  expect(types.length).toBeGreaterThan(0);
  expect(enumMembers.length).toBeGreaterThan(0);

  // Verify sorting
  expect(
    files[0].normalizedPath.localeCompare(files[1].normalizedPath),
  ).toBeLessThanOrEqual(0);
  expect(
    (exports[0].symbolName || "").localeCompare(exports[1].symbolName || ""),
  ).toBeLessThanOrEqual(0);
});

test("realistic Knip report fixture: displays normalized sample output", () => {
  const results = parseKnipReport(realisticKnipReport as KnipReport);

  console.log("\n=== Sample Normalized Output ===");
  console.log(`Total findings: ${results.length}`);

  // Show first few findings from each category
  const files = results.filter((f) => f.issueType === "files");
  const exports = results.filter((f) => f.issueType === "exports");
  const types = results.filter((f) => f.issueType === "types");
  const enumMembers = results.filter((f) => f.issueType === "enumMembers");

  console.log(`\nFiles (${files.length}):`);
  files.slice(0, 3).forEach((f) => {
    console.log(`  - ${f.normalizedPath}`);
  });

  console.log(`\nExports (${exports.length}):`);
  exports.slice(0, 3).forEach((f) => {
    console.log(`  - ${f.symbolName} (${f.normalizedPath}:${f.line}:${f.col})`);
  });

  console.log(`\nTypes (${types.length}):`);
  types.slice(0, 3).forEach((f) => {
    console.log(`  - ${f.symbolName} (${f.normalizedPath}:${f.line}:${f.col})`);
  });

  console.log(`\nEnum Members (${enumMembers.length}):`);
  enumMembers.slice(0, 3).forEach((f) => {
    console.log(`  - ${f.symbolName} (${f.normalizedPath}:${f.line}:${f.col})`);
  });

  console.log("=== End Sample Output ===\n");
});

test("edge cases: handles empty report", () => {
  const report: KnipReport = { issues: [] };
  const results = parseKnipReport(report);
  expect(results).toHaveLength(0);
});

test("edge cases: handles report with only filtered out findings", () => {
  const report: KnipReport = {
    issues: [
      {
        file: ".storybook/test.tsx",
        files: [{ name: ".storybook/test.tsx" }],
      },
      {
        file: "src/components/Button.test.tsx",
        files: [{ name: "src/components/Button.test.tsx" }],
      },
    ],
  };
  const results = parseKnipReport(report);
  expect(results).toHaveLength(0);
});

test("edge cases: handles mixed accepted and rejected findings", () => {
  const report: KnipReport = {
    issues: [
      {
        file: ".storybook/test.tsx",
        files: [{ name: ".storybook/test.tsx" }],
      },
      {
        file: "src/components/Button.tsx",
        files: [{ name: "src/components/Button.tsx" }],
      },
      {
        file: "src/components/Button.test.tsx",
        files: [{ name: "src/components/Button.test.tsx" }],
      },
    ],
  };
  const results = parseKnipReport(report);
  expect(results).toHaveLength(1);
  expect(results[0].normalizedPath).toBe("src/components/Button.tsx");
});

test("integration test fixture - reference scope behavior: proves production code referenced only by tests/stories is absent from productionPlusTests findings", () => {
  const productionResults = parseKnipReport(integrationTestFixture);
  const productionPlusTestsResults = parseKnipReport(
    integrationTestFixtureProductionPlusTests,
  );

  // Production scan includes all 5 production files
  expect(productionResults).toHaveLength(5);

  // ProductionPlusTests scan excludes files that are only referenced by tests/stories
  // In this simulated scenario:
  // - ProductionOnlyComponent.tsx: appears in both (truly unused)
  // - TestReferencedComponent.tsx: only in production (excluded from productionPlusTests)
  // - StoryReferencedComponent.tsx: only in production (excluded from productionPlusTests)
  // - UnreferencedComponent.tsx: appears in both (truly unused)
  // - unusedConfig.ts: appears in both (truly unused)
  expect(productionPlusTestsResults).toHaveLength(3);

  // Verify specific files that are only in production (test/story referenced)
  const testReferenced = productionPlusTestsResults.find(
    (f) => f.normalizedPath === "src/production/TestReferencedComponent.tsx",
  );
  expect(testReferenced).toBeUndefined();

  const storyReferenced = productionPlusTestsResults.find(
    (f) => f.normalizedPath === "src/production/StoryReferencedComponent.tsx",
  );
  expect(storyReferenced).toBeUndefined();

  // Verify truly unused files appear in both
  const productionOnly = productionPlusTestsResults.find(
    (f) => f.normalizedPath === "src/production/ProductionOnlyComponent.tsx",
  );
  expect(productionOnly).toBeDefined();

  const unreferenced = productionPlusTestsResults.find(
    (f) => f.normalizedPath === "src/production/UnreferencedComponent.tsx",
  );
  expect(unreferenced).toBeDefined();

  const config = productionPlusTestsResults.find(
    (f) => f.normalizedPath === "src/production/config/unusedConfig.ts",
  );
  expect(config).toBeDefined();
});

test("integration test fixture - reference scope behavior: proves test/story files never appear in processed report", () => {
  const results = parseKnipReport(integrationTestFixture);

  // Verify no .test. files appear in results
  const testFiles = results.filter((f) => f.fileName.includes(".test."));
  expect(testFiles).toHaveLength(0);

  // Verify no .stories. files appear in results
  const storyFiles = results.filter((f) => f.fileName.includes(".stories."));
  expect(storyFiles).toHaveLength(0);

  // Verify no .storybook directory files appear in results
  const storybookFiles = results.filter((f) =>
    f.normalizedPath.startsWith(".storybook"),
  );
  expect(storybookFiles).toHaveLength(0);

  // Verify total count excludes all test/story files
  // Original fixture has 9 issues:
  // - 4 production .tsx files (accepted)
  // - 1 .test.tsx file (rejected)
  // - 1 .stories.tsx file (rejected)
  // - 1 .storybook config (rejected)
  // - 1 jest.config.js (rejected - wrong extension)
  // - 1 config file (accepted)
  // Expected: 5 accepted findings
  expect(results).toHaveLength(5);
});

test("integration test fixture - reference scope behavior: proves unrelated tooling/config files cannot affect the broader scan", () => {
  const results = parseKnipReport(integrationTestFixture);

  // Verify jest.config.js is not in results (wrong extension)
  const jestConfig = results.find((f) => f.fileName === "jest.config.js");
  expect(jestConfig).toBeUndefined();

  // Verify .storybook config is not in results (wrong directory)
  const storybookConfig = results.find(
    (f) => f.normalizedPath === ".storybook/config/setup.ts",
  );
  expect(storybookConfig).toBeUndefined();

  // Verify config files in src/ are still accepted if they meet criteria
  const configFiles = results.filter((f) =>
    f.normalizedPath.includes("config"),
  );
  expect(configFiles).toHaveLength(1);
  expect(configFiles[0].normalizedPath).toBe(
    "src/production/config/unusedConfig.ts",
  );
});

test("integration test fixture - reference scope behavior: asserts exact fixture results for production findings", () => {
  const results = parseKnipReport(integrationTestFixture);

  // Assert exact expected findings (sorted by normalizedPath)
  const expectedFindings: Array<{
    normalizedPath: string;
    fileName: string;
    issueType: string;
  }> = [
    {
      normalizedPath: "src/production/config/unusedConfig.ts",
      fileName: "unusedConfig.ts",
      issueType: "files",
    },
    {
      normalizedPath: "src/production/ProductionOnlyComponent.tsx",
      fileName: "ProductionOnlyComponent.tsx",
      issueType: "files",
    },
    {
      normalizedPath: "src/production/StoryReferencedComponent.tsx",
      fileName: "StoryReferencedComponent.tsx",
      issueType: "files",
    },
    {
      normalizedPath: "src/production/TestReferencedComponent.tsx",
      fileName: "TestReferencedComponent.tsx",
      issueType: "files",
    },
    {
      normalizedPath: "src/production/UnreferencedComponent.tsx",
      fileName: "UnreferencedComponent.tsx",
      issueType: "files",
    },
  ];

  expect(results).toHaveLength(expectedFindings.length);

  expectedFindings.forEach((expected, index) => {
    expect(results[index].normalizedPath).toBe(expected.normalizedPath);
    expect(results[index].fileName).toBe(expected.fileName);
    expect(results[index].issueType).toBe(expected.issueType);
  });
});

test("integration test fixture - reference scope behavior: asserts exact fixture results for productionPlusTests findings", () => {
  const results = parseKnipReport(integrationTestFixtureProductionPlusTests);

  // Assert exact expected findings (excludes test/story-referenced files, sorted by normalizedPath)
  const expectedFindings: Array<{
    normalizedPath: string;
    fileName: string;
    issueType: string;
  }> = [
    {
      normalizedPath: "src/production/config/unusedConfig.ts",
      fileName: "unusedConfig.ts",
      issueType: "files",
    },
    {
      normalizedPath: "src/production/ProductionOnlyComponent.tsx",
      fileName: "ProductionOnlyComponent.tsx",
      issueType: "files",
    },
    {
      normalizedPath: "src/production/UnreferencedComponent.tsx",
      fileName: "UnreferencedComponent.tsx",
      issueType: "files",
    },
  ];

  expect(results).toHaveLength(expectedFindings.length);

  expectedFindings.forEach((expected, index) => {
    expect(results[index].normalizedPath).toBe(expected.normalizedPath);
    expect(results[index].fileName).toBe(expected.fileName);
    expect(results[index].issueType).toBe(expected.issueType);
  });
});
