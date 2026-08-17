/**
 * The repository's own release and CI state, read from the GitHub API on the server.
 *
 * Deliberately NOT shields.io <img> badges. Two reasons, in order:
 *   1. This page is gated on a Lighthouse CI performance stage. Two render-blocking image
 *      requests to a third-party host is a real cost for two short strings.
 *   2. The badges then look like the product rather than something stapled to it — they use the
 *      same Badge component, tokens and mono face as everything else on the page.
 *
 * Every call fails SAFE: any error, any non-200, any unexpected shape returns null and the badge
 * simply does not render. The site's standing rule is that it never prints a fact it cannot
 * stand behind, and a CI badge that is wrong is worse than no CI badge at all.
 *
 * Unauthenticated GitHub API is 60 requests/hour/IP, and Vercel functions share egress IPs, so
 * both reads are cached for 5 minutes — about 24 calls/hour at worst, well inside the budget.
 */

import { REPO_URL } from '@/app/_lib/links';

const REVALIDATE_SECONDS = 300;

/** `https://github.com/owner/repo` -> `owner/repo`. Null when the repo is not public yet. */
function repoSlug(): string | null {
  if (!REPO_URL) return null;
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(REPO_URL);
  return m?.[1] ?? null;
}

async function ghJson<T>(path: string): Promise<T | null> {
  const slug = repoSlug();
  if (!slug) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}${path}`, {
      headers: { accept: 'application/vnd.github+json' },
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // Offline, rate-limited, timed out — all the same answer: say nothing.
    return null;
  }
}

export interface ReleaseInfo {
  tag: string;
  url: string;
  publishedAt: string | null;
}

export async function latestRelease(): Promise<ReleaseInfo | null> {
  const d = await ghJson<{ tag_name?: string; html_url?: string; published_at?: string }>(
    '/releases/latest',
  );
  if (!d?.tag_name || !d.html_url) return null;
  return { tag: d.tag_name, url: d.html_url, publishedAt: d.published_at ?? null };
}

export interface CiInfo {
  /** GitHub's own conclusion string — 'success' and 'failure' are the two that matter here. */
  conclusion: string;
  url: string;
}

/**
 * Conclusions that are a statement about the CODE. `cancelled` and `skipped` are statements about
 * the WORKFLOW — ci.yml runs under a cancel-in-progress concurrency group, so any two pushes close
 * together leave the earlier run `cancelled`. Reporting that as the build state renders "ci
 * cancelled" on the landing page, which reads as a broken build when nothing is broken.
 */
const CONCLUSIVE = new Set(['success', 'failure', 'timed_out']);

/**
 * The most recent CONCLUSIVE run of ci.yml on main.
 *
 * Completed runs only — an in-flight run has a null conclusion, and reporting that as anything but
 * "no answer yet" would be a guess. The API cannot filter on "success OR failure" in one query, so
 * this pulls a short page and takes the first conclusive entry. If the whole page is cancelled or
 * skipped, it returns null and the badge is simply absent, which is the honest answer.
 */
export async function latestCi(): Promise<CiInfo | null> {
  const d = await ghJson<{
    workflow_runs?: Array<{ conclusion?: string | null; html_url?: string }>;
  }>('/actions/workflows/ci.yml/runs?branch=main&status=completed&per_page=10');
  const run = d?.workflow_runs?.find((r) => r.conclusion && CONCLUSIVE.has(r.conclusion));
  if (!run?.conclusion || !run.html_url) return null;
  return { conclusion: run.conclusion, url: run.html_url };
}
