#!/usr/bin/env node
/**
 * next-version.mjs — derive the next semantic version from the commit log.
 *
 * Why this is a script and not a marketplace action: the release path is the one
 * workflow that can push a tag and cut a release, so it runs with `contents:
 * write`. Every third-party action added there is unpinned code inheriting that
 * token. This repository already runs CodeQL and gitleaks over its own source;
 * the release logic should be source it can scan too. It has no dependencies.
 *
 * Conventional Commits, extended with the types this repository actually uses.
 * A plain `fix:`/`feat:` mapping would be wrong here: the log is mostly `docs:`,
 * `prove:`, `bench:`, `meta:` and `deploy:`, so a stock configuration would
 * label a release that rewrote the judge-facing README as "no change at all".
 *
 *   BREAKING CHANGE: footer, or a `!` before the colon   -> major
 *   feat                                                 -> minor
 *   fix, perf, prove, deploy                             -> patch
 *   docs, ci, test, chore, style, refactor, build,
 *   meta, bench, demo                                    -> patch, but only
 *                                                           alongside something
 *                                                           else releasable
 *
 * Usage:
 *   node scripts/next-version.mjs            # prints JSON to stdout
 *   node scripts/next-version.mjs --github   # also writes GITHUB_OUTPUT
 */

import { execSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

/** Types that justify cutting a release on their own. */
const RELEASING = new Set(['feat', 'fix', 'perf', 'prove', 'deploy']);
/** Types that are real work but ride along rather than triggering a release. */
const RIDEALONG = new Set([
  'docs', 'ci', 'test', 'chore', 'style', 'refactor', 'build', 'meta', 'bench', 'demo',
]);

const SECTIONS = [
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['perf', 'Performance'],
  ['prove', 'Proving pipeline'],
  ['deploy', 'Deployment'],
  ['bench', 'Benchmarks'],
  ['demo', 'Demo surface'],
  ['docs', 'Documentation'],
  ['ci', 'CI'],
  ['meta', 'Metadata'],
  ['test', 'Tests'],
  ['refactor', 'Refactoring'],
  ['build', 'Build'],
  ['chore', 'Chores'],
  ['style', 'Style'],
];

function latestTag() {
  try {
    // stderr silenced: with no tags yet, git describe writes "fatal: No names
    // found" before exiting non-zero, and that is the expected first-run path.
    return execSync('git describe --tags --abbrev=0 --match "v[0-9]*.[0-9]*.[0-9]*"', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null; // no release yet
  }
}

function commitsSince(tag) {
  // %H unit-separated from %s and %b, records separated by \x1e, so multi-line
  // bodies (where BREAKING CHANGE lives) survive parsing intact.
  const range = tag ? `${tag}..HEAD` : 'HEAD';
  const raw = sh(`git log ${range} --no-merges --format=%H%x1f%s%x1f%b%x1e`);
  if (!raw) return [];
  return raw
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((rec) => {
      const [hash, subject, body = ''] = rec.split('\x1f');
      return { hash, subject, body };
    });
}

/** Parse `type(scope)!: subject`. Returns null when the subject is unconventional. */
function parse(commit) {
  const m = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/.exec(commit.subject);
  if (!m) return null;
  const [, type, scope, bang, description] = m;
  const breaking = Boolean(bang) || /^BREAKING[ -]CHANGE:/m.test(commit.body);
  return { ...commit, type: type.toLowerCase(), scope, description, breaking };
}

function bumpFor(parsed) {
  if (parsed.some((c) => c.breaking)) return 'major';
  if (parsed.some((c) => c.type === 'feat')) return 'minor';
  if (parsed.some((c) => RELEASING.has(c.type))) return 'patch';
  if (parsed.some((c) => RIDEALONG.has(c.type))) return 'patch';
  return null;
}

function applyBump(version, bump) {
  const [maj, min, pat] = version.split('.').map(Number);
  if (bump === 'major') return `${maj + 1}.0.0`;
  if (bump === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

function notesFor(parsed, prevTag, nextTag) {
  const breaking = parsed.filter((c) => c.breaking);
  const lines = [];

  if (breaking.length) {
    lines.push('### ⚠ Breaking changes', '');
    for (const c of breaking) {
      lines.push(`- ${c.scope ? `**${c.scope}:** ` : ''}${c.description} (${c.hash.slice(0, 7)})`);
    }
    lines.push('');
  }

  for (const [type, heading] of SECTIONS) {
    const items = parsed.filter((c) => c.type === type && !c.breaking);
    if (!items.length) continue;
    lines.push(`### ${heading}`, '');
    for (const c of items) {
      lines.push(`- ${c.scope ? `**${c.scope}:** ` : ''}${c.description} (${c.hash.slice(0, 7)})`);
    }
    lines.push('');
  }

  const other = parsed.filter(
    (c) => !c.breaking && !SECTIONS.some(([t]) => t === c.type),
  );
  if (other.length) {
    lines.push('### Other', '');
    for (const c of other) lines.push(`- ${c.description} (${c.hash.slice(0, 7)})`);
    lines.push('');
  }

  if (prevTag) {
    lines.push(`**Full changelog:** \`${prevTag}...${nextTag}\``);
  }
  return lines.join('\n').trim();
}

// ── main ─────────────────────────────────────────────────────────────────────

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = latestTag();
const commits = commitsSince(tag);
const parsed = commits.map(parse).filter(Boolean);
const unconventional = commits.length - parsed.length;

const bump = parsed.length ? bumpFor(parsed) : null;

// The tag is the source of truth for what was last released. package.json can be
// ahead of it (hand-edited), so start from whichever is higher rather than
// silently re-releasing a version that already exists.
const fromTag = tag ? tag.replace(/^v/, '') : '0.0.0';
const higher = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? a : b;
  }
  return a;
};
const current = higher(fromTag, pkg.version || '0.0.0');

// First release ever: ship what package.json already declares rather than
// inventing a bump on top of it.
const isFirst = !tag;
const next = bump === null ? current : isFirst ? current : applyBump(current, bump);

const result = {
  currentTag: tag,
  currentVersion: current,
  bump: bump ?? 'none',
  nextVersion: next,
  shouldRelease: bump !== null && (isFirst || next !== current),
  commitCount: commits.length,
  unconventional,
  notes: bump === null ? '' : notesFor(parsed, tag, `v${next}`),
};

if (process.argv.includes('--github') && process.env.GITHUB_OUTPUT) {
  const out = process.env.GITHUB_OUTPUT;
  appendFileSync(out, `should_release=${result.shouldRelease}\n`);
  appendFileSync(out, `version=${result.nextVersion}\n`);
  appendFileSync(out, `tag=v${result.nextVersion}\n`);
  appendFileSync(out, `bump=${result.bump}\n`);
  appendFileSync(out, `notes<<__NOTES_EOF__\n${result.notes}\n__NOTES_EOF__\n`);
}

console.log(JSON.stringify(result, null, 2));
