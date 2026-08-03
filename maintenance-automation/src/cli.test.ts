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

import { validateKnipReportStructure, KnipValidationError, type KnipReport } from "./cli";

describe("CLI Knip validation", () => {
  describe("validateKnipReportStructure", () => {
    test("accepts valid Knip report structure", () => {
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

    test("accepts Knip report with optional arrays omitted", () => {
      const validReport: KnipReport = {
        issues: [
          {
            file: "src/components/Button.tsx",
          },
        ],
      };

      expect(validateKnipReportStructure(validReport)).toBe(true);
    });

    test("accepts Knip report with empty issues array", () => {
      const validReport: KnipReport = {
        issues: [],
      };

      expect(validateKnipReportStructure(validReport)).toBe(true);
    });

    test("rejects non-object input", () => {
      expect(() => validateKnipReportStructure(null)).toThrow(KnipValidationError);
      expect(() => validateKnipReportStructure(undefined)).toThrow(KnipValidationError);
      expect(() => validateKnipReportStructure("string")).toThrow(KnipValidationError);
      expect(() => validateKnipReportStructure(123)).toThrow(KnipValidationError);
    });

    test("rejects object without issues property", () => {
      const invalidReport = {
        notIssues: [],
      };

      expect(() => validateKnipReportStructure(invalidReport)).toThrow(KnipValidationError);
    });

    test("rejects non-array issues property", () => {
      const invalidReport = {
        issues: "not an array",
      };

      expect(() => validateKnipReportStructure(invalidReport)).toThrow(KnipValidationError);
    });

    test("rejects issue without file property", () => {
      const invalidReport = {
        issues: [
          {
            notFile: "src/components/Button.tsx",
          },
        ],
      };

      expect(() => validateKnipReportStructure(invalidReport)).toThrow(KnipValidationError);
    });

    test("rejects issue with null file property", () => {
      const invalidReport = {
        issues: [
          {
            file: null,
          },
        ],
      };

      expect(() => validateKnipReportStructure(invalidReport)).toThrow(KnipValidationError);
    });

    test("rejects non-object issue", () => {
      const invalidReport = {
        issues: ["not an object"],
      };

      expect(() => validateKnipReportStructure(invalidReport)).toThrow(KnipValidationError);
    });
  });
});