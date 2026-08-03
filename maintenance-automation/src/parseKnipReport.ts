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

export interface KnipReport {
  issues: KnipIssue[];
}

export interface KnipIssue {
  file: string;
  enumMembers?: KnipEnumMemberIssue[];
  exports?: KnipExportIssue[];
  files?: KnipFileIssue[];
  types?: KnipTypeIssue[];
}

export interface KnipFileIssue {
  name: string;
}

export interface KnipExportIssue {
  name: string;
  line: number;
  col: number;
  pos: number;
}

export interface KnipTypeIssue {
  name: string;
  line: number;
  col: number;
  pos: number;
}

export interface KnipEnumMemberIssue {
  namespace: string;
  name: string;
  line: number;
  col: number;
  pos: number;
}

export interface NormalizedFinding extends Finding {
  issueType: "files" | "exports" | "types" | "enumMembers";
  symbolName?: string; // For exports, types, enumMembers
  line?: number;
  col?: number;
}

function derivePathComponents(filePath: string): {
  normalizedPath: string;
  fileName: string;
  fileExtension: string;
} {
  // Extract file name from path
  const pathParts = filePath.split("/");
  const fileName = pathParts[pathParts.length - 1];

  // Extract extension
  const lastDotIndex = fileName.lastIndexOf(".");
  const fileExtension =
    lastDotIndex !== -1 ? fileName.slice(lastDotIndex + 1) : "";

  // Normalize path (remove leading ./ if present)
  const normalizedPath = filePath.replace(/^\.\//, "");

  return { normalizedPath, fileName, fileExtension };
}

export function parseKnipReport(report: KnipReport): NormalizedFinding[] {
  const findings: NormalizedFinding[] = [];

  for (const issue of report.issues) {
    const { normalizedPath, fileName, fileExtension } = derivePathComponents(
      issue.file,
    );

    // Process files
    for (const fileIssue of issue.files || []) {
      const finding: NormalizedFinding = {
        normalizedPath,
        fileName,
        fileExtension,
        filePath: issue.file,
        issueType: "files",
      };

      if (isAcceptedFinding(finding)) {
        findings.push(finding);
      }
    }

    // Process exports
    for (const exportIssue of issue.exports || []) {
      const finding: NormalizedFinding = {
        normalizedPath,
        fileName,
        fileExtension,
        filePath: issue.file,
        issueType: "exports",
        symbolName: exportIssue.name,
        line: exportIssue.line,
        col: exportIssue.col,
      };

      if (isAcceptedFinding(finding)) {
        findings.push(finding);
      }
    }

    // Process types
    for (const typeIssue of issue.types || []) {
      const finding: NormalizedFinding = {
        normalizedPath,
        fileName,
        fileExtension,
        filePath: issue.file,
        issueType: "types",
        symbolName: typeIssue.name,
        line: typeIssue.line,
        col: typeIssue.col,
      };

      if (isAcceptedFinding(finding)) {
        findings.push(finding);
      }
    }

    // Process enumMembers
    for (const enumMemberIssue of issue.enumMembers || []) {
      const finding: NormalizedFinding = {
        normalizedPath,
        fileName,
        fileExtension,
        filePath: issue.file,
        issueType: "enumMembers",
        symbolName: `${enumMemberIssue.namespace}.${enumMemberIssue.name}`,
        line: enumMemberIssue.line,
        col: enumMemberIssue.col,
      };

      if (isAcceptedFinding(finding)) {
        findings.push(finding);
      }
    }
  }

  // Sort results: by issueType, then normalizedPath, then symbolName
  return findings.sort((a, b) => {
    if (a.issueType !== b.issueType) {
      return a.issueType.localeCompare(b.issueType);
    }
    if (a.normalizedPath !== b.normalizedPath) {
      return a.normalizedPath.localeCompare(b.normalizedPath);
    }
    if (a.symbolName !== b.symbolName) {
      return (a.symbolName || "").localeCompare(b.symbolName || "");
    }
    return 0;
  });
}
