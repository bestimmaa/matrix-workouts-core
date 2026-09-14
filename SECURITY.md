# Security

## Reporting

Email christoph.halang@gmail.com, or open a private security advisory on GitHub. This
is a personal project — expect a reply in days, not hours.

## What this package handles

- **A gym passcode.** `loginWithXid` sends it in one request and returns only an
  exerciser id and bearer token; the login response's profile — name, email, birthday,
  height, weight — is deliberately dropped rather than returned where a caller could
  print it.
- **A bearer token.** Never logged, never persisted by this package. `redact()` exists
  so a token cannot escape inside a thrown transport error either.
- **Workout history.** Heart rate, at ten-second resolution. `downloadHistory` writes
  `0600`, and where those files go is the caller's decision.

If you find a path where any of the three reaches a log, an error message, or a file
nobody asked for, that is a bug worth reporting.
