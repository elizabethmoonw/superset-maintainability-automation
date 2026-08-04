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

export type BatchAttemptOutcome =
  | "approval-rejected"
  | "deferred"
  | "devin-failed"
  | "draft-pr-open"
  | "pr-closed-unmerged"
  | "pr-merged";

export interface BatchAttempt {
  attemptId: string;
  batchKey: string;
  groupKeys: string[];
  findingKeys: string[];
  offeredAt: string;
  outcome: BatchAttemptOutcome;
  pullRequestUrl?: string;
}

export interface BatchLedger {
  schemaVersion: 1;
  attempts: BatchAttempt[];
}

const OUTCOMES: readonly BatchAttemptOutcome[] = [
  "approval-rejected",
  "deferred",
  "devin-failed",
  "draft-pr-open",
  "pr-closed-unmerged",
  "pr-merged",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isBatchAttempt(value: unknown): value is BatchAttempt {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.attemptId === "string" &&
    typeof value.batchKey === "string" &&
    isStringArray(value.groupKeys) &&
    isStringArray(value.findingKeys) &&
    typeof value.offeredAt === "string" &&
    !Number.isNaN(Date.parse(value.offeredAt)) &&
    typeof value.outcome === "string" &&
    OUTCOMES.includes(value.outcome as BatchAttemptOutcome) &&
    (value.pullRequestUrl === undefined ||
      typeof value.pullRequestUrl === "string")
  );
}

export function createEmptyBatchLedger(): BatchLedger {
  return { schemaVersion: 1, attempts: [] };
}

export function parseBatchLedger(content: string): BatchLedger {
  const value: unknown = JSON.parse(content);
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.attempts) ||
    !value.attempts.every(isBatchAttempt)
  ) {
    throw new Error("Invalid batch ledger");
  }
  return { schemaVersion: 1, attempts: value.attempts };
}

export function serializeBatchLedger(ledger: BatchLedger): string {
  return `${JSON.stringify(ledger, null, 2)}\n`;
}
