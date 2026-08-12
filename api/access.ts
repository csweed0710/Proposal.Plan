import crypto from "node:crypto";

function sameValue(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function isPublicRequest(path: string) {
  if (path.startsWith("/intake/") || path.startsWith("/assets/") || path === "/favicon.ico") return true;

  const trpcPrefix = "/api/trpc/";
  if (!path.startsWith(trpcPrefix)) return false;
  const procedures = path.slice(trpcPrefix.length).split(",");
  return procedures.every((name) => name === "share.getForm" || name === "share.submit");
}

export function hasValidBasicAuth(
  authorization: string | undefined,
  expectedUsername: string,
  expectedPassword: string,
) {
  if (!authorization?.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    return sameValue(username, expectedUsername) && sameValue(password, expectedPassword);
  } catch {
    return false;
  }
}
