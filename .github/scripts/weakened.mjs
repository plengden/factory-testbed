// Weakened-bar detector (Factory-Design.md §3 CI "agent-specific checks"; constitution "Fix root causes").
// Finds changes that lower the bar instead of fixing a cause: deleted or skipped tests, new suppressions.
// It never fails the build on its own: its findings raise the risk class to `high` (classify.mjs),
// which puts a human (the high-risk-merge environment) in front of the merge.
// Usage: node weakened.mjs <base-sha> <head-sha>   -> {"findings": [...]}
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const TEST_FILE = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const SKIP = /\b(test|it|describe|suite)\.(skip|only|todo)\s*\(|\{\s*(skip|todo)\s*:\s*true|\bt\.skip\s*\(/;
const SUPPRESSION = /@ts-(ignore|expect-error|nocheck)|eslint-disable|nosemgrep|gitleaks:allow|trivy:ignore|NOSONAR|#\s*nosec/;
const LOOSENED_CONFIG = /"strict"\s*:\s*false|"noImplicitAny"\s*:\s*false|"skipLibCheck"\s*:\s*true/;

/** files: [{ path, status }]; added: [{ path, line }] */
export function findWeakening(files, added) {
  const findings = [];
  for (const f of files) {
    if (f.status === "D" && TEST_FILE.test(f.path)) findings.push(`test file deleted: ${f.path}`);
  }
  for (const a of added) {
    if (TEST_FILE.test(a.path) && SKIP.test(a.line)) findings.push(`test skipped or focused in ${a.path}: ${a.line.trim().slice(0, 120)}`);
    if (SUPPRESSION.test(a.line)) findings.push(`suppression added in ${a.path}: ${a.line.trim().slice(0, 120)}`);
    if (/(^|\/)tsconfig[^/]*\.json$/.test(a.path) && LOOSENED_CONFIG.test(a.line)) findings.push(`type checking loosened in ${a.path}: ${a.line.trim()}`);
  }
  return findings;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

export function collect(base, head) {
  const files = git(["diff", "--name-status", "--no-renames", `${base}...${head}`]).split("\n").filter(Boolean)
    .map((l) => { const [status, path] = l.split("\t"); return { status, path }; });
  const added = [];
  let path = null;
  for (const line of git(["diff", "--unified=0", "--no-renames", `${base}...${head}`]).split("\n")) {
    if (line.startsWith("+++ ")) path = line.startsWith("+++ b/") ? line.slice(6) : null;
    else if (path && line.startsWith("+") && !line.startsWith("+++")) added.push({ path, line: line.slice(1) });
  }
  return { files, added };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) { console.error("usage: weakened.mjs <base> <head>"); process.exit(2); }
  const { files, added } = collect(base, head);
  console.log(JSON.stringify({ findings: findWeakening(files, added) }));
}
