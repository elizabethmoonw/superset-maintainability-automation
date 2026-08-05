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

const DEFAULT_GITHUB_API_URL = "https://api.github.com";
const DEFAULT_WORKFLOW_FILE = "maintenance-scan.yml";
const GITHUB_API_VERSION = "2022-11-28";
const MAX_ERROR_RESPONSE_LENGTH = 2_000;

export interface DispatchWorkflowOptions {
  token: string;
  repository: string;
  ref: string;
  apiUrl?: string;
  workflowFile?: string;
  fetchImplementation?: typeof fetch;
}

export interface DispatchWorkflowResult {
  actionsUrl: string;
  ref: string;
  repository: string;
}

function requireValue(name: string, value: string): string {
  const normalizedValue = value.trim();
  if (normalizedValue.length === 0) {
    throw new Error(`${name} is required`);
  }
  return normalizedValue;
}

function parseRepository(repository: string): [owner: string, name: string] {
  const normalizedRepository = requireValue("GITHUB_REPOSITORY", repository);
  const match = normalizedRepository.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (match === null) {
    throw new Error("GITHUB_REPOSITORY must use the owner/repository format");
  }
  return [match[1], match[2]];
}

export async function dispatchMaintenanceWorkflow(
  options: Readonly<DispatchWorkflowOptions>,
): Promise<DispatchWorkflowResult> {
  const [owner, repositoryName] = parseRepository(options.repository);
  const token = requireValue("GITHUB_TOKEN", options.token);
  const ref = requireValue("MAINTENANCE_WORKFLOW_REF", options.ref);
  const workflowFile = options.workflowFile ?? DEFAULT_WORKFLOW_FILE;
  const apiUrl = (options.apiUrl ?? DEFAULT_GITHUB_API_URL).replace(/\/$/, "");
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const endpoint = `${apiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repositoryName)}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`;

  const response = await fetchImplementation(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
    body: JSON.stringify({ ref }),
  });

  if (response.status !== 204) {
    const responseBody = await response.text();
    const redactedResponseBody = responseBody
      .split(token)
      .join("[REDACTED]")
      .slice(0, MAX_ERROR_RESPONSE_LENGTH);
    const detail =
      redactedResponseBody.length === 0
        ? "no response body"
        : redactedResponseBody;
    throw new Error(
      `GitHub workflow dispatch failed with HTTP ${response.status}: ${detail}`,
    );
  }

  const repository = `${owner}/${repositoryName}`;
  return {
    actionsUrl: `https://github.com/${repository}/actions/workflows/${workflowFile}`,
    ref,
    repository,
  };
}

async function main(): Promise<void> {
  const result = await dispatchMaintenanceWorkflow({
    token: process.env.GITHUB_TOKEN ?? "",
    repository: process.env.GITHUB_REPOSITORY ?? "",
    ref: process.env.MAINTENANCE_WORKFLOW_REF ?? "master",
  });
  process.stdout.write(
    [
      `Dispatched Maintenance scan for ${result.repository}@${result.ref}.`,
      `Open ${result.actionsUrl} and approve the maintenance-approval deployment after reviewing the evidence issue.`,
      "",
    ].join("\n"),
  );
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `Could not dispatch maintenance workflow: ${message}\n`,
    );
    process.exitCode = 1;
  });
}
