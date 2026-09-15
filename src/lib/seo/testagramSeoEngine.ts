export type SeoAuditInput = { url: string; title?: string | null; description?: string | null; canonical?: string | null; robots?: string | null; h1?: string | null; bodyText?: string | null; hasStructuredData?: boolean; hasOgImage?: boolean };
export type SeoFinding = { code: string; severity: "error" | "warning" | "info"; message: string; recommendation: string };
export type SeoAuditResult = { score: number; findings: SeoFinding[]; signals: { titleLength: number; descriptionLength: number; wordCount: number; indexable: boolean } };

/** Deterministic RankMySEO-inspired audit core. No network, secrets, model calls or arbitrary URL fetching. */
export function auditTestagramPage(input: SeoAuditInput): SeoAuditResult {
  const title = input.title?.trim() ?? "", description = input.description?.trim() ?? "", body = input.bodyText?.trim() ?? "";
  const findings: SeoFinding[] = []; let points = 100;
  const add = (finding: SeoFinding, penalty: number) => { findings.push(finding); points -= penalty; };
  if (!title) add({ code: "TITLE_MISSING", severity: "error", message: "The page has no title.", recommendation: "Provide a unique descriptive title." }, 20);
  else if (title.length < 30 || title.length > 65) add({ code: "TITLE_LENGTH", severity: "warning", message: `Title length is ${title.length}; target 30–65 characters.`, recommendation: "Rewrite around the page intent without keyword stuffing." }, 8);
  if (!description) add({ code: "DESCRIPTION_MISSING", severity: "warning", message: "The page has no meta description.", recommendation: "Add a concise description of the page." }, 10);
  else if (description.length < 70 || description.length > 170) add({ code: "DESCRIPTION_LENGTH", severity: "warning", message: `Description length is ${description.length}; target roughly 70–170 characters.`, recommendation: "Rewrite the description for clear context and value." }, 5);
  if (!input.canonical) add({ code: "CANONICAL_MISSING", severity: "warning", message: "No canonical URL was supplied.", recommendation: "Emit an absolute canonical URL for indexable pages." }, 8);
  if (!input.h1?.trim()) add({ code: "H1_MISSING", severity: "warning", message: "No primary heading was supplied.", recommendation: "Give the page one clear H1." }, 7);
  if (!input.hasStructuredData) add({ code: "SCHEMA_MISSING", severity: "info", message: "No structured-data signal was supplied.", recommendation: "Add schema only when it accurately describes the page." }, 4);
  if (!input.hasOgImage) add({ code: "OG_IMAGE_MISSING", severity: "info", message: "No social preview image was supplied.", recommendation: "Provide an OG image where appropriate." }, 3);
  const indexable = !(input.robots ?? "").toLowerCase().includes("noindex");
  if (!indexable) add({ code: "NOINDEX", severity: "info", message: "The page is marked noindex.", recommendation: "Keep noindex only for intentionally private/non-search pages." }, 0);
  const wordCount = body ? body.split(/\s+/).filter(Boolean).length : 0;
  if (body && wordCount < 50) add({ code: "THIN_CONTENT", severity: "warning", message: "The supplied body contains very little text.", recommendation: "Add useful original context rather than keyword padding." }, 5);
  return { score: Math.max(0, Math.min(100, Math.round(points))), findings, signals: { titleLength: title.length, descriptionLength: description.length, wordCount, indexable } };
}

/** OpenGSC-inspired deterministic before/after SEO regression guard. */
export function compareSeoMetadata(before: SeoAuditInput, after: SeoAuditInput) {
  const previous = auditTestagramPage(before), next = auditTestagramPage(after);
  return { scoreBefore: previous.score, scoreAfter: next.score, delta: next.score - previous.score, newFindings: next.findings.filter(x => !previous.findings.some(y => y.code === x.code)), resolvedFindings: previous.findings.filter(x => !next.findings.some(y => y.code === x.code)) };
}
