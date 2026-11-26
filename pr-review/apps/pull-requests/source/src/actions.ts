// What a person does on GitHub under their own name, from this page: send a
// pull request back, approve it, merge it. GitHub's own reason comes back
// word for word when it refuses; a missing GitHub of their own comes back as
// itself, for the page to show the way to connect it.

import { addedLines, parsePatch } from "./diff";
import { forget, githubSays, mergePull, needsMyGithub, postReview, type GhFile, type ReviewComment } from "./github";
import type { Finding, MergeHow, PullRequest, Rule } from "./types";

export function findingText(f: Finding, rule: Rule | undefined): string {
  const lines = [`**${f.title}**`];
  if (f.body) lines.push(f.body);
  if (rule) lines.push(`Breaks: ${rule.text}${rule.source ? ` (${rule.source})` : ""}`);
  if (f.suggestion) lines.push("```suggestion\n" + f.suggestion.replace(/^[+]/gm, "") + "\n```");
  return lines.join("\n\n");
}

/** The review body and the line comments GitHub will take: a comment only on a
 *  line the diff shows; anything else goes in the body. */
export function reviewParts(findings: Finding[], rules: Map<string, Rule>, files: GhFile[] | null, note?: string) {
  const comments: ReviewComment[] = [];
  const inBody: string[] = [];
  for (const f of findings) {
    const file = files?.find((x) => x.filename === f.path);
    const lines = file?.patch ? addedLines(parsePatch(file.patch)) : null;
    const text = findingText(f, f.rule_id ? rules.get(f.rule_id) : undefined);
    if (f.path && f.line && lines?.has(f.line)) comments.push({ path: f.path, line: f.line, side: "RIGHT", body: text });
    else inBody.push(`${f.path ? `\`${f.path}${f.line ? `:${f.line}` : ""}\` ` : ""}${text}`);
  }
  const head = note?.trim() || `${findings.length === 1 ? "One finding" : `${findings.length} findings`} to look at before this merges.`;
  return { body: [head, ...inBody].join("\n\n---\n\n"), comments };
}

export async function sendBackAsMe(repo: string, pr: PullRequest, findings: Finding[], rules: Map<string, Rule>, files: GhFile[] | null, note?: string): Promise<void> {
  const { body, comments } = reviewParts(findings, rules, files, note);
  try {
    await postReview(repo, pr.number, pr.head_sha || "", "REQUEST_CHANGES", body, comments);
  } catch (err) {
    throw needsMyGithub(err) ? err : new Error(githubSays(err));
  } finally {
    forget(repo, pr.number);
  }
}

export async function approveAsMe(repo: string, pr: PullRequest): Promise<void> {
  try {
    await postReview(repo, pr.number, pr.head_sha || "", "APPROVE", "Every rule in scope passed.");
  } catch (err) {
    throw needsMyGithub(err) ? err : new Error(githubSays(err));
  } finally {
    forget(repo, pr.number);
  }
}

export const METHOD: Record<MergeHow, "squash" | "merge" | "rebase"> = { auto: "squash", queue: "squash", squash: "squash" };

export async function mergeAsMe(repo: string, pr: PullRequest, how: MergeHow | null | undefined): Promise<void> {
  try {
    const r = await mergePull(repo, pr.number, pr.head_sha || "", METHOD[how || "squash"]);
    if (r && r.merged === false) throw new Error(r.message || "GitHub didn't merge it.");
  } catch (err) {
    throw needsMyGithub(err) ? err : new Error(githubSays(err));
  } finally {
    forget(repo, pr.number);
  }
}
