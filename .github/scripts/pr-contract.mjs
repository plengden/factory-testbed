// Agent PR contract (Factory-Constitution.md "Pull request contract"; Factory-Design.md §3 CI).
// For agent branches only: the PR body has every required section, and every commit names its
// Paperclip issue, agent and model in trailers.
// Usage: PR_BODY="..." node pr-contract.mjs <base-sha> <head-sha>
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const SECTIONS = [
  "Intent",
  "Security assessment",
  "Evidence",
  "Security findings fixed",
  "Configuration and secrets required",
  "Human verification points",
  "Blast radius and reversibility",
  "Suspected injection",
];
export const TRAILERS = ["Paperclip-Issue", "Agent", "Model"];

export function checkBody(body) {
  const problems = [];
  for (const s of SECTIONS) {
    const m = new RegExp(`^##\\s+${s}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "m").exec(body ?? "");
    if (!m) problems.push(`PR body is missing the "## ${s}" section`);
    else if (!m[1].trim()) problems.push(`PR body section "## ${s}" is empty (write "none" if nothing applies)`);
  }
  return problems;
}

export function checkTrailers(commits) {
  const problems = [];
  for (const { sha, message } of commits) {
    for (const t of TRAILERS) {
      if (!new RegExp(`^${t}:\\s*\\S`, "m").test(message)) problems.push(`commit ${sha.slice(0, 8)} has no "${t}:" trailer`);
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base, head] = process.argv.slice(2);
  const log = execFileSync("git", ["log", "--format=%H%x00%B%x01", `${base}..${head}`], { encoding: "utf8" });
  const commits = log.split("\x01").map((e) => e.trim()).filter(Boolean)
    .map((e) => { const [sha, message] = e.split("\0"); return { sha, message }; });
  const problems = [...checkBody(process.env.PR_BODY), ...checkTrailers(commits)];
  for (const p of problems) console.error(`::error::${p}`);
  console.log(problems.length ? `${problems.length} contract problem(s)` : `PR contract OK (${commits.length} commit(s))`);
  process.exit(problems.length ? 1 : 0);
}
