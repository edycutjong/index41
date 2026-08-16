import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/app/_lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 font-mono text-[0.6875rem] font-bold uppercase tracking-[0.14em]',
  {
    variants: {
      tone: {
        /** A position that has been proven. The only gold in the system. */
        indexed: 'border-accent/70 bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-accent',
        /** A position that is merely asserted. */
        claimed:
          'border-[color-mix(in_srgb,var(--primary)_50%,transparent)] bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-primary-ink',
        live: 'border-ok/60 bg-[color-mix(in_srgb,var(--color-success)_14%,transparent)] text-ok',
        quiet: 'border-line bg-transparent text-low',
      },
    },
    defaultVariants: { tone: 'quiet' },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
