import { API_ORIGIN, ApiError, type FetchLike } from "./client.js";
import { redact, type Credentials } from "./credentials.js";

/**
 * Exchange an xid and passcode for a bearer token.
 *
 * The extension does not use this — inside the browser the site has already signed
 * in and `readCredentials` reads the token it left behind, which is strictly better:
 * no passcode is handled at all. This exists for the standalone client, which has no
 * browser to borrow a session from. See MATRIX_API.md.
 *
 * The request shape is the site's own, read out of its bundle rather than guessed:
 *
 *     loginWithXid(e, t, n = `xid`, r = 0) {
 *       let i = { username: e, password: t, type: n, club_id: r };
 *       return apisauce.post(`/exerciser/login`, i);
 *     }
 *
 * PRIVACY: the passcode is used for exactly this one request and is never returned,
 * stored or logged. `redact()` guards the one path — a thrown transport error — that
 * could otherwise carry the request body out with it.
 */
export const LOGIN_PATH = "/exerciser/login";

/** The site sends `xid`; `apollo` is the other value its bundle uses, for SSO. */
export const LOGIN_TYPE_XID = "xid";

export interface XidLogin {
  /** The member number printed on the gym tag. Sent as `username`. */
  xid: string;
  /** The numeric passcode. Sent as `password`. */
  pin: string;
  /** The site defaults this to 0 and so do we. */
  clubId?: number;
}

export function loginUrl(): string {
  return `${API_ORIGIN}${LOGIN_PATH}`;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Sign in and return just enough to make the history request.
 *
 * Deliberately returns `Credentials` and nothing else. The login response is a full
 * profile — name, email, birthday, height, weight — and none of it is needed to
 * fetch workouts, so none of it is carried out of this function where a caller could
 * print it by accident.
 */
export async function loginWithXid(login: XidLogin, fetchImpl: FetchLike): Promise<Credentials> {
  const body = JSON.stringify({
    username: login.xid,
    password: login.pin,
    type: LOGIN_TYPE_XID,
    club_id: login.clubId ?? 0,
  });

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(loginUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
    });
  } catch (error) {
    // The message can quote the request, and the request is the passcode.
    const detail = error instanceof Error ? redact(error.message, login.pin) : "";
    throw new ApiError(`Could not reach the sign-in API. ${detail}`.trim(), 0);
  }

  if (!response.ok) {
    throw new ApiError(describeLoginStatus(response.status), response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError("The sign-in API returned something that is not JSON.", response.status);
  }

  if (typeof payload !== "object" || payload === null) {
    throw new ApiError("The sign-in API returned no profile.", response.status);
  }

  // Observed live: `id` and `token` sit at the top level of the login response,
  // which is the same pair `readCredentials` digs out of the persisted blob.
  const record = payload as Record<string, unknown>;
  const token = str(record["token"]);
  const exerciserId = str(record["id"]);

  if (!token) {
    throw new ApiError("Signed in, but the API returned no token.", response.status);
  }
  if (!exerciserId) {
    throw new ApiError("Signed in, but the API returned no exerciser id.", response.status);
  }

  return { exerciserId, token };
}

function describeLoginStatus(status: number): string {
  if (status === 400 || status === 401 || status === 403) {
    return "The API rejected that xid and passcode.";
  }
  if (status === 404) return "The sign-in endpoint is gone — the API has moved.";
  if (status === 429) return "Too many sign-in attempts. Wait before trying again.";
  if (status >= 500) return `The sign-in API is failing (HTTP ${status}). Try again later.`;
  return `The sign-in API refused the request (HTTP ${status}).`;
}
