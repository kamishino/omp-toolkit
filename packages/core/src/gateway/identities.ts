// Identity masking for gateway views (ADR-0010): raw emails never leave this
// boundary; views carry masked values only.

export function maskIdentityKey(identity: string): string {
  const colon = identity.indexOf(":");
  const hasPrefix = colon > 0 && !identity.slice(0, colon).includes("@");
  const prefix = hasPrefix ? identity.slice(0, colon) : null;
  const value = hasPrefix ? identity.slice(colon + 1) : identity;
  const maskedValue = maskValue(value);
  return prefix ? `${prefix}:${maskedValue}` : maskedValue;
}

function maskValue(value: string): string {
  const at = value.indexOf("@");
  if (at > 0) {
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    const dot = domain.lastIndexOf(".");
    const host = dot > 0 ? domain.slice(0, dot) : domain;
    const tld = dot > 0 ? domain.slice(dot) : "";
    return `${local.slice(0, 1)}***@${host.slice(0, 1)}***${tld}`;
  }
  return `${value.slice(0, 3)}***`;
}

export function emailFromIdentityKey(identityKey: string | null | undefined): string | null {
  if (!identityKey) return null;
  const value = identityKey.includes(":")
    ? identityKey.slice(identityKey.indexOf(":") + 1)
    : identityKey;
  return value.includes("@") ? value.toLowerCase() : null;
}
