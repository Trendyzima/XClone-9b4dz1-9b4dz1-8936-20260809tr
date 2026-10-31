const NODEINFO_RELATIONS = [
  "http://nodeinfo.diaspora.software/ns/schema/2.0",
  "http://nodeinfo.diaspora.software/ns/schema/2.1",
];

export function isNodeInfoDiscoveryDocument(body) {
  if (!Array.isArray(body?.links)) return false;
  return NODEINFO_RELATIONS.every((relation) =>
    body.links.some((link) =>
      link?.rel === relation &&
      typeof link?.href === "string" &&
      link.href.trim().length > 0
    )
  );
}

export function isWebFingerDocument(body, expectedResource) {
  if (!body || typeof body !== "object" || body.subject !== expectedResource || !Array.isArray(body.links)) {
    return false;
  }
  return body.links.some((link) =>
    link?.rel === "self" &&
    typeof link?.href === "string" &&
    link.href.trim().length > 0
  );
}