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

import { isAcceptedFinding, Finding } from "./isAcceptedFinding";

describe("isAcceptedFinding", () => {
  // Helper to create a valid base finding
  const baseFinding: Finding = {
    normalizedPath: "src/components/Button.tsx",
    fileExtension: "tsx",
    filePath: "src/components/Button.tsx",
    fileName: "Button.tsx",
    issueType: "exports",
  };

  describe("ACCEPTED cases", () => {
    test("accepts valid .ts file with exports issue type", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "src/utils/helper.ts",
        fileExtension: "ts",
        filePath: "src/utils/helper.ts",
        fileName: "helper.ts",
      };
      expect(isAcceptedFinding(finding)).toBe(true);
    });

    test("accepts valid .tsx file with exports issue type", () => {
      expect(isAcceptedFinding(baseFinding)).toBe(true);
    });

    test("accepts files issue type", () => {
      const finding: Finding = { ...baseFinding, issueType: "files" };
      expect(isAcceptedFinding(finding)).toBe(true);
    });

    test("accepts exports issue type", () => {
      const finding: Finding = { ...baseFinding, issueType: "exports" };
      expect(isAcceptedFinding(finding)).toBe(true);
    });

    test("accepts types issue type", () => {
      const finding: Finding = { ...baseFinding, issueType: "types" };
      expect(isAcceptedFinding(finding)).toBe(true);
    });

    test("accepts enumMembers issue type", () => {
      const finding: Finding = { ...baseFinding, issueType: "enumMembers" };
      expect(isAcceptedFinding(finding)).toBe(true);
    });

    test("accepts deep nested paths under src/", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "src/components/nested/deep/path/Component.tsx",
        fileExtension: "tsx",
        filePath: "src/components/nested/deep/path/Component.tsx",
        fileName: "Component.tsx",
      };
      expect(isAcceptedFinding(finding)).toBe(true);
    });
  });

  describe("REJECTED cases - path does not start with src/", () => {
    test("rejects packages/ path", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "packages/ui/Button.tsx",
        filePath: "packages/ui/Button.tsx",
        fileName: "Button.tsx",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });

    test("rejects lib/ path", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "lib/utils.ts",
        filePath: "lib/utils.ts",
        fileName: "utils.ts",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });

    test("rejects root level path", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "Button.tsx",
        filePath: "Button.tsx",
        fileName: "Button.tsx",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });

    test("rejects src without trailing slash", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "src",
        filePath: "src",
        fileName: "src",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });
  });

  describe("REJECTED cases - file extension", () => {
    test("rejects .js files", () => {
      const finding: Finding = {
        ...baseFinding,
        fileExtension: "js",
        filePath: "src/components/Button.js",
        fileName: "Button.js",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });

    test("rejects .jsx files", () => {
      const finding: Finding = {
        ...baseFinding,
        fileExtension: "jsx",
        filePath: "src/components/Button.jsx",
        fileName: "Button.jsx",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });

    test("rejects .d.ts files", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "src/types/Button.d.ts",
        fileExtension: "d.ts",
        filePath: "src/types/Button.d.ts",
        fileName: "Button.d.ts",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });
  });

  describe("REJECTED cases - filename patterns", () => {
    test("rejects .test. in filename", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "src/components/Button.test.tsx",
        filePath: "src/components/Button.test.tsx",
        fileName: "Button.test.tsx",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });

    test("rejects .spec. in filename", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "src/components/Button.spec.tsx",
        filePath: "src/components/Button.spec.tsx",
        fileName: "Button.spec.tsx",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });

    test("rejects .stories. in filename", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "src/components/Button.stories.tsx",
        filePath: "src/components/Button.stories.tsx",
        fileName: "Button.stories.tsx",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });

    test("rejects -stories. in filename", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "src/components/Button-skipped-stories.tsx",
        filePath: "src/components/Button-skipped-stories.tsx",
        fileName: "Button-skipped-stories.tsx",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });

    test("rejects .story. in filename", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "src/components/Button.story.tsx",
        filePath: "src/components/Button.story.tsx",
        fileName: "Button.story.tsx",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });

    test("rejects .testHelpers. in filename", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "src/components/Button.testHelpers.tsx",
        filePath: "src/components/Button.testHelpers.tsx",
        fileName: "Button.testHelpers.tsx",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });
  });

  describe("REJECTED cases - issue type", () => {
    test("rejects classMembers issue type", () => {
      const finding: Finding = { ...baseFinding, issueType: "classMembers" };
      expect(isAcceptedFinding(finding)).toBe(false);
    });

    test("rejects duplicates issue type", () => {
      const finding: Finding = { ...baseFinding, issueType: "duplicates" };
      expect(isAcceptedFinding(finding)).toBe(false);
    });

    test("rejects unknown issue type", () => {
      const finding: Finding = { ...baseFinding, issueType: "unknown" };
      expect(isAcceptedFinding(finding)).toBe(false);
    });
  });

  describe("REJECTED cases - directory segments", () => {
    test("rejects 'test' directory segment", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "src/components/test/Button.tsx",
        filePath: "src/components/test/Button.tsx",
        fileName: "Button.tsx",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });

    test("rejects 'tests' directory segment", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "src/components/tests/Button.tsx",
        filePath: "src/components/tests/Button.tsx",
        fileName: "Button.tsx",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });

    test("rejects '__tests__' directory segment", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "src/components/__tests__/Button.tsx",
        filePath: "src/components/__tests__/Button.tsx",
        fileName: "Button.tsx",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });

    test("rejects 'stories' directory segment", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "src/components/stories/Button.tsx",
        filePath: "src/components/stories/Button.tsx",
        fileName: "Button.tsx",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });

    test("rejects '__stories__' directory segment", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "src/components/__stories__/Button.tsx",
        filePath: "src/components/__stories__/Button.tsx",
        fileName: "Button.tsx",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });

    test("rejects 'story' directory segment", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "src/components/story/Button.tsx",
        filePath: "src/components/story/Button.tsx",
        fileName: "Button.tsx",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });

    test("rejects multiple directory segments with 'test'", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "src/test/components/Button.tsx",
        filePath: "src/test/components/Button.tsx",
        fileName: "Button.tsx",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });
  });

  describe("Edge cases", () => {
    test("rejects when multiple rejection conditions apply", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "src/test/Button.test.tsx",
        filePath: "src/test/Button.test.tsx",
        fileName: "Button.test.tsx",
        issueType: "classMembers",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });

    test("handles complex paths with segments", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "src/dashboard/components/nativeFilters/ConfigModal/ModalFooter.tsx",
        filePath: "src/dashboard/components/nativeFilters/ConfigModal/ModalFooter.tsx",
        fileName: "ModalFooter.tsx",
      };
      expect(isAcceptedFinding(finding)).toBe(true);
    });

    test("rejects if segment appears anywhere in path", () => {
      const finding: Finding = {
        ...baseFinding,
        normalizedPath: "src/components/story/deep/nested/Button.tsx",
        filePath: "src/components/story/deep/nested/Button.tsx",
        fileName: "Button.tsx",
      };
      expect(isAcceptedFinding(finding)).toBe(false);
    });
  });

  describe("Real-world examples from Knip output", () => {
    describe("ACCEPTED - actual production code from Knip findings", () => {
      test("accepts src/components/Datasource/components/DatasourceEditor/components/index.ts", () => {
        const finding: Finding = {
          normalizedPath: "src/components/Datasource/components/DatasourceEditor/components/index.ts",
          fileExtension: "ts",
          filePath: "src/components/Datasource/components/DatasourceEditor/components/index.ts",
          fileName: "index.ts",
          issueType: "files",
        };
        expect(isAcceptedFinding(finding)).toBe(true);
      });

      test("accepts src/dashboard/components/ColorSchemeControlWrapper.tsx", () => {
        const finding: Finding = {
          normalizedPath: "src/dashboard/components/ColorSchemeControlWrapper.tsx",
          fileExtension: "tsx",
          filePath: "src/dashboard/components/ColorSchemeControlWrapper.tsx",
          fileName: "ColorSchemeControlWrapper.tsx",
          issueType: "files",
        };
        expect(isAcceptedFinding(finding)).toBe(true);
      });

      test("accepts src/explore/components/controls/MetricControl/columnType.ts", () => {
        const finding: Finding = {
          normalizedPath: "src/explore/components/controls/MetricControl/columnType.ts",
          fileExtension: "ts",
          filePath: "src/explore/components/controls/MetricControl/columnType.ts",
          fileName: "columnType.ts",
          issueType: "files",
        };
        expect(isAcceptedFinding(finding)).toBe(true);
      });

      test("accepts src/types/Action.ts", () => {
        const finding: Finding = {
          normalizedPath: "src/types/Action.ts",
          fileExtension: "ts",
          filePath: "src/types/Action.ts",
          fileName: "Action.ts",
          issueType: "files",
        };
        expect(isAcceptedFinding(finding)).toBe(true);
      });

      test("accepts src/components/AlteredSliceTag/AlteredSliceTagMocks.ts (prod scan)", () => {
        const finding: Finding = {
          normalizedPath: "src/components/AlteredSliceTag/AlteredSliceTagMocks.ts",
          fileExtension: "ts",
          filePath: "src/components/AlteredSliceTag/AlteredSliceTagMocks.ts",
          fileName: "AlteredSliceTagMocks.ts",
          issueType: "files",
        };
        expect(isAcceptedFinding(finding)).toBe(true);
      });

      test("accepts src/dashboard/components/nativeFilters/FiltersConfigModal/FilterConfigurePane.tsx", () => {
        const finding: Finding = {
          normalizedPath: "src/dashboard/components/nativeFilters/FiltersConfigModal/FilterConfigurePane.tsx",
          fileExtension: "tsx",
          filePath: "src/dashboard/components/nativeFilters/FiltersConfigModal/FilterConfigurePane.tsx",
          fileName: "FilterConfigurePane.tsx",
          issueType: "files",
        };
        expect(isAcceptedFinding(finding)).toBe(true);
      });

      test("accepts src/utils/reducerUtils.ts", () => {
        const finding: Finding = {
          normalizedPath: "src/utils/reducerUtils.ts",
          fileExtension: "ts",
          filePath: "src/utils/reducerUtils.ts",
          fileName: "reducerUtils.ts",
          issueType: "files",
        };
        expect(isAcceptedFinding(finding)).toBe(true);
      });

      test("rejects src/features/datasets/metadataBar/DatasetMetadataBar.skipped-stories.tsx (contains -stories.)", () => {
        const finding: Finding = {
          normalizedPath: "src/features/datasets/metadataBar/DatasetMetadataBar.skipped-stories.tsx",
          fileExtension: "tsx",
          filePath: "src/features/datasets/metadataBar/DatasetMetadataBar.skipped-stories.tsx",
          fileName: "DatasetMetadataBar.skipped-stories.tsx",
          issueType: "files",
        };
        expect(isAcceptedFinding(finding)).toBe(false);
      });

      test("rejects src/pages/ChartList/ChartList.testHelpers.tsx (contains .testHelpers.)", () => {
        const finding: Finding = {
          normalizedPath: "src/pages/ChartList/ChartList.testHelpers.tsx",
          fileExtension: "tsx",
          filePath: "src/pages/ChartList/ChartList.testHelpers.tsx",
          fileName: "ChartList.testHelpers.tsx",
          issueType: "files",
        };
        expect(isAcceptedFinding(finding)).toBe(false);
      });
    });

    describe("REJECTED - non-src paths from Knip findings", () => {
      test("rejects .storybook/shared/createQueryStory.tsx", () => {
        const finding: Finding = {
          normalizedPath: ".storybook/shared/createQueryStory.tsx",
          fileExtension: "tsx",
          filePath: ".storybook/shared/createQueryStory.tsx",
          fileName: "createQueryStory.tsx",
          issueType: "files",
        };
        expect(isAcceptedFinding(finding)).toBe(false);
      });

      test("rejects .storybook/shared/dummyDatasource.ts", () => {
        const finding: Finding = {
          normalizedPath: ".storybook/shared/dummyDatasource.ts",
          fileExtension: "ts",
          filePath: ".storybook/shared/dummyDatasource.ts",
          fileName: "dummyDatasource.ts",
          issueType: "files",
        };
        expect(isAcceptedFinding(finding)).toBe(false);
      });

      test("rejects .storybook/shared/ErrorMessage.tsx", () => {
        const finding: Finding = {
          normalizedPath: ".storybook/shared/ErrorMessage.tsx",
          fileExtension: "tsx",
          filePath: ".storybook/shared/ErrorMessage.tsx",
          fileName: "ErrorMessage.tsx",
          issueType: "files",
        };
        expect(isAcceptedFinding(finding)).toBe(false);
      });
    });
  });
});
