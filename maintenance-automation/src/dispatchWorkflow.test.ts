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

import { dispatchMaintenanceWorkflow } from "./dispatchWorkflow";

test("dispatches the maintenance workflow for the requested ref", async () => {
  const fetchMock = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValue(new Response(null, { status: 204 }));

  const result = await dispatchMaintenanceWorkflow({
    token: "github-token",
    repository: "example/superset",
    ref: "codex/maintenance",
    apiUrl: "https://github.example/api/v3/",
    fetchImplementation: fetchMock,
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "https://github.example/api/v3/repos/example/superset/actions/workflows/maintenance-scan.yml/dispatches",
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer github-token",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "codex/maintenance" }),
    },
  );
  expect(result).toEqual({
    actionsUrl:
      "https://github.com/example/superset/actions/workflows/maintenance-scan.yml",
    ref: "codex/maintenance",
    repository: "example/superset",
  });
});

test("rejects malformed repository names before making a request", async () => {
  const fetchMock = jest.fn<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >();

  await expect(
    dispatchMaintenanceWorkflow({
      token: "github-token",
      repository: "not-a-repository",
      ref: "master",
      fetchImplementation: fetchMock,
    }),
  ).rejects.toThrow("GITHUB_REPOSITORY must use the owner/repository format");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("reports GitHub API failures without exposing the token", async () => {
  const fetchMock = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "workflow not found",
          reflectedToken: "secret-github-token",
        }),
        { status: 404 },
      ),
    );

  const dispatch = dispatchMaintenanceWorkflow({
    token: "secret-github-token",
    repository: "example/superset",
    ref: "master",
    fetchImplementation: fetchMock,
  });

  await expect(dispatch).rejects.toThrow(
    'GitHub workflow dispatch failed with HTTP 404: {"message":"workflow not found","reflectedToken":"[REDACTED]"}',
  );
  await expect(dispatch).rejects.not.toThrow("secret-github-token");
});
