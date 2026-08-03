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

export interface Finding {
  normalizedPath: string;
  fileExtension: string;
  filePath: string;
  fileName: string;
  issueType: string;
}

export function isAcceptedFinding(finding: Finding): boolean {
  return (
    finding.normalizedPath.startsWith("src/") &&
    (finding.fileExtension === "ts" || finding.fileExtension === "tsx") &&
    !finding.normalizedPath.endsWith(".d.ts") &&
    !finding.fileName.includes(".test.") &&
    !finding.fileName.includes(".spec.") &&
    !finding.fileName.includes(".stories.") &&
    !finding.fileName.includes("-stories.") &&
    !finding.fileName.includes(".story.") &&
    !finding.fileName.includes(".testHelpers.") &&
    (finding.issueType === "files" ||
    finding.issueType === "exports" ||
    finding.issueType === "types" ||
    finding.issueType === "enumMembers") &&
    !finding.normalizedPath.split("/").some(segment =>
      segment === "test" ||
      segment === "tests" ||
      segment === "__tests__" ||
      segment === "stories" ||
      segment === "__stories__" ||
      segment === "story"
    )
  );
}
