// Who is clicking. In the pilot the app sits behind HTTP basic auth (see
// src/proxy.ts); the username becomes "decided_by" on every decision.

export function userFrom(headers: Headers): string {
  const auth = headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    const user = atob(auth.slice(6)).split(":")[0];
    if (user) return user;
  }
  return process.env.DEFAULT_USER || "raghav";
}
