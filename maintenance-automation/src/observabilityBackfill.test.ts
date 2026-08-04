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

import * as path from "path";
import {
  buildHistoricalKnipArguments,
  completedMonthBoundaries,
  parseBackfillOptions,
} from "./observabilityBackfill";

test("selects completed months in ascending order", () => {
  expect(completedMonthBoundaries(new Date("2026-08-04T12:00:00Z"), 3)).toEqual(
    [
      { period: "2026-05", before: "2026-06-01T00:00:00.000Z" },
      { period: "2026-06", before: "2026-07-01T00:00:00.000Z" },
      { period: "2026-07", before: "2026-08-01T00:00:00.000Z" },
    ],
  );
});

test("parses reproducible backfill options and guards scan volume", () => {
  const root = "/tmp/maintenance-automation";
  expect(
    parseBackfillOptions(
      ["--months", "4", "--as-of", "2026-08-04", "--output", "out.json"],
      root,
    ),
  ).toMatchObject({
    months: 4,
    outputPath: path.resolve("out.json"),
  });
  expect(() => parseBackfillOptions(["--months", "25"], root)).toThrow(
    "cannot exceed 24",
  );
});

test("backfill uses production filtering only for the production scan", () => {
  const productionArguments = buildHistoricalKnipArguments(
    "/automation",
    "/frontend",
    "production",
  );
  const productionPlusTestsArguments = buildHistoricalKnipArguments(
    "/automation",
    "/frontend",
    "productionPlusTests",
  );

  expect(productionArguments).toContain("--production");
  expect(productionPlusTestsArguments).not.toContain("--production");
  expect(productionArguments).toContain("/automation/knip.json");
  expect(productionPlusTestsArguments).toContain(
    "/automation/knip-production-plus-tests.json",
  );
});
