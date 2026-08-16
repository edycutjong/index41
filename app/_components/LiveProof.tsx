'use client';

/**
 * Holds the one piece of mutable state on the page: which real read is currently on screen.
 *
 * The server renders a `ProofView` (live if the node answered, the captured artifact if it did
 * not). Pressing "re-read the chain" replaces it with a fresh read. Both are real; the banner
 * always names which.
 */

import * as React from 'react';

import { ProofTheatre } from '@/app/_components/ProofTheatre';
import { ProvenanceBar } from '@/app/_components/Provenance';
import type { ProofView } from '@/app/_lib/proof';

export function LiveProof({ initial }: { initial: ProofView }) {
  const [view, setView] = React.useState(initial);

  return (
    <div className="space-y-4">
      <ProvenanceBar view={view} onUpdate={setView} />
      <ProofTheatre key={view.provenance.at} view={view} />
    </div>
  );
}
