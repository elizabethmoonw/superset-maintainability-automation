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
  createEmptyBatchLedger,
  parseBatchLedger,
  serializeBatchLedger,
} from "./batchLedger";

test("batch ledger round trips terminal and open attempts", () => {
  const ledger = {
    schemaVersion: 1 as const,
    attempts: [
      {
        attemptId: "42-1",
        batchKey: "batch-key",
        groupKeys: ["src/a.ts"],
        findingKeys: ["files\u0000src/a.ts\u0000"],
        offeredAt: "2026-08-04T10:00:00.000Z",
        outcome: "draft-pr-open" as const,
        pullRequestUrl: "https://github.com/apache/superset/pull/1",
      },
    ],
  };

  expect(parseBatchLedger(serializeBatchLedger(ledger))).toEqual(ledger);
  expect(createEmptyBatchLedger()).toEqual({ schemaVersion: 1, attempts: [] });
});

test("batch ledger rejects invalid external data", () => {
  expect(() =>
    parseBatchLedger(
      JSON.stringify({
        schemaVersion: 1,
        attempts: [{ outcome: "unknown" }],
      }),
    ),
  ).toThrow("Invalid batch ledger");
});
