/**
 * Release and CI badges, rendered from the repository's real state.
 *
 * A server component so the first paint already carries the answer — same rule the proof itself
 * follows. Either badge is omitted entirely when its read failed; see the note in _lib/repo.ts on
 * why a wrong badge is worse than an absent one.
 */

import { CheckCircle2, Tag, XCircle } from 'lucide-react';

import { Badge } from '@/app/_components/ui/badge';
import { latestCi, latestRelease } from '@/app/_lib/repo';

export async function RepoBadges() {
  // Both reads are independent and both are cached; run them together rather than in series.
  const [release, ci] = await Promise.all([latestRelease(), latestCi()]);
  if (!release && !ci) return null;

  const passing = ci?.conclusion === 'success';

  return (
    <>
      {release ? (
        <a
          href={release.url}
          target="_blank"
          rel="noreferrer noopener"
          className="rounded-sm transition-opacity hover:opacity-80"
          aria-label={`Latest release ${release.tag} on GitHub`}
        >
          <Badge tone="claimed">
            <Tag className="h-3 w-3" aria-hidden />
            release {release.tag}
          </Badge>
        </a>
      ) : null}

      {ci ? (
        <a
          href={ci.url}
          target="_blank"
          rel="noreferrer noopener"
          className="rounded-sm transition-opacity hover:opacity-80"
          aria-label={`Continuous integration on main is ${passing ? 'passing' : ci.conclusion}`}
        >
          {/* `live` is the success tone; anything that is not a pass is reported as it is, not
              softened — the page argues for verifiable claims, so a red build says red. */}
          <Badge tone={passing ? 'live' : 'quiet'}>
            {passing ? (
              <CheckCircle2 className="h-3 w-3" aria-hidden />
            ) : (
              <XCircle className="h-3 w-3" aria-hidden />
            )}
            ci {passing ? 'passing' : ci.conclusion}
          </Badge>
        </a>
      ) : null}
    </>
  );
}
