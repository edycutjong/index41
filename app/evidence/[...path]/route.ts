/**
 * GET /evidence/<path> — read-only view of the files the claim rests on.
 *
 * Strictly allowlisted (see `app/_lib/links.ts`): this is an evidence viewer, not a file browser.
 * It exists so that "the ruling transcript" is a link a judge can click today, without the site
 * printing a github.com URL that does not yet resolve.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { EVIDENCE } from '@/app/_lib/links';

export const dynamic = 'force-dynamic';

const TEXT_TYPE: Record<string, string> = {
  json: 'application/json; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  sol: 'text/plain; charset=utf-8',
  ts: 'text/plain; charset=utf-8',
  mjs: 'text/plain; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const requested = path.join('/');

  if (!(EVIDENCE as readonly string[]).includes(requested)) {
    return new Response(
      `Not on the evidence allowlist.\n\nReadable files:\n${EVIDENCE.map((p) => `  /evidence/${p}`).join('\n')}\n`,
      { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  try {
    // The set of readable paths is the frozen allowlist above, so the join is safe even though
    // the bundler cannot see the literal.
    const body = await readFile(join(/* turbopackIgnore: true */ process.cwd(), requested), 'utf8');
    const ext = requested.split('.').pop() ?? 'txt';
    return new Response(body, {
      headers: {
        'content-type': TEXT_TYPE[ext] ?? 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch {
    return new Response(`${requested} is allowlisted but not present in this checkout.\n`, {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}
