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

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { parseKnipReport } from "./parseKnipReport";
import { type KnipReport, type NormalizedFinding } from "./parseKnipReport";
import { countExcludedPathViolations } from "./demo";

const FIXTURE_DIR = path.join(__dirname, "fixtures");

function calculateHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function hasTestOrStoryPath(finding: NormalizedFinding): boolean {
  const pathSegments = finding.normalizedPath.split("/").map(s => s.toLowerCase());

  // Check for test/story directories
  const hasTestDirectory = pathSegments.some(
    (segment: string) =>
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

  return hasTestDirectory || hasTestFilePattern;
}

test("Deterministic parser processing validation: processing identical parser input twice produces identical output", () => {
  // Load a parser fixture (simulated Knip JSON output)
  const fixturePath = path.join(FIXTURE_DIR, "integrationTestFixture.json");
  const fixtureContent = fs.readFileSync(fixturePath, "utf-8");
  const knipReport = JSON.parse(fixtureContent) as KnipReport;

  // Process the same input twice
  const results1 = parseKnipReport(knipReport);
  const results2 = parseKnipReport(knipReport);

  // Serialize both results
  const serialized1 = JSON.stringify(results1);
  const serialized2 = JSON.stringify(results2);

  // Assert identical serialized output
  expect(serialized1).toBe(serialized2);

  // Assert identical hashes
  const hash1 = calculateHash(serialized1);
  const hash2 = calculateHash(serialized2);
  expect(hash1).toBe(hash2);
});

test("Deterministic parser processing validation: productionPlusTests parser fixture has zero excluded-path violations", () => {
  const fixturePath = path.join(FIXTURE_DIR, "integrationTestFixtureProductionPlusTests.json");
  const fixtureContent = fs.readFileSync(fixturePath, "utf-8");
  const knipReport = JSON.parse(fixtureContent) as KnipReport;

  const results = parseKnipReport(knipReport);
  const violations = results.filter(hasTestOrStoryPath);

  expect(violations).toHaveLength(0);
});

test("Deterministic parser processing validation: production parser fixture has zero excluded-path violations", () => {
  const fixturePath = path.join(FIXTURE_DIR, "integrationTestFixture.json");
  const fixtureContent = fs.readFileSync(fixturePath, "utf-8");
  const knipReport = JSON.parse(fixtureContent) as KnipReport;

  const results = parseKnipReport(knipReport);
  const violations = results.filter(hasTestOrStoryPath);

  expect(violations).toHaveLength(0);
});

test("Deterministic parser processing validation: declaration files count as excluded-path violations", () => {
  const declarationFinding: NormalizedFinding = {
    normalizedPath: "src/types/generated.d.ts",
    fileName: "generated.d.ts",
    fileExtension: "ts",
    filePath: "src/types/generated.d.ts",
    issueType: "files",
  };

  expect(countExcludedPathViolations([declarationFinding])).toBe(1);
});
