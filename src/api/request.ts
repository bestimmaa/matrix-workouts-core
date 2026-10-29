import type { FetchInit, FetchLike } from "./client.js";
import { redact, type Credentials } from "./credentials.js";

/**
 * The one way this package makes a request, shared by the history and sign-in calls
 * so the two cannot drift on what a failure is allowed to say. Only `ApiError` leaves
 * the package, re-exported from `client.ts`; `fetchHistoryBody` reaches consumers as
 * `fetchWorkoutHistory` and, under Node, `fetchRawHistory`. Not listed in `index.ts`.
 */

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    message: string,
    /** HTTP status, or 0 for a transport failure. */
    readonly status: number,
  ) {
    super(message);
  }
}

interface RequestPolicy {
  /** Redacted out of a transport error's message, which can quote the request. */
  secret: string;
  /** Names the API in the messages: "workout", "sign-in". */
  what: string;
  /** The message for a response that arrived but was not ok. */
  describeStatus: (status: number) => string;
}

/** Make the request and return its JSON body, or throw an `ApiError` safe to show. */
export async function requestJson(
  fetchImpl: FetchLike,
  url: string,
  init: FetchInit,
  policy: RequestPolicy,
): Promise<{ status: number; body: unknown }> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    const detail = error instanceof Error ? redact(error.message, policy.secret) : "";
    throw new ApiError(`Could not reach the ${policy.what} API. ${detail}`.trim(), 0);
  }

  if (!response.ok) {
    throw new ApiError(policy.describeStatus(response.status), response.status);
  }

  try {
    return { status: response.status, body: await response.json() };
  } catch {
    throw new ApiError(`The ${policy.what} API returned something that is not JSON.`, response.status);
  }
}

/**
 * The history response body, verbatim. `fetchWorkoutHistory` parses it; `downloadHistory`
 * keeps it as well, so the archive and the parsed result come from one request and
 * cannot disagree.
 */
export async function fetchHistoryBody(
  url: string,
  credentials: Credentials,
  fetchImpl: FetchLike,
): Promise<unknown> {
  const { body } = await requestJson(
    fetchImpl,
    url,
    { headers: { Authorization: `Bearer ${credentials.token}`, Accept: "application/json" } },
    // A transport failure's message can carry the request, so the token is redacted
    // before it escapes into a UI string or a log.
    { secret: credentials.token, what: "workout", describeStatus: describeHistoryStatus },
  );
  return body;
}

function describeHistoryStatus(status: number): string {
  if (status === 401 || status === 403) {
    return "The workout API rejected the stored sign-in. Reload the site to refresh it, then try again.";
  }
  if (status === 404) return "The workout API has no history for this account.";
  if (status >= 500) return `The workout API is failing (HTTP ${status}). Try again later.`;
  return `The workout API refused the request (HTTP ${status}).`;
}
