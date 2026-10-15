// Loaded with `node --import` before the app, as the Sentry SDK requires. No DSN, no Sentry.
import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    release: process.env.RELEASE,
    environment: process.env.APP_ENV ?? "development",
    tracesSampleRate: 0.1,
    // Sentry 11 collects bodies, headers, cookies and user info by default. Login bodies carry passwords and
    // Authorization headers carry session tokens, so collection is off across the board.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
  });
}
