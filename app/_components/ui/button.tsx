'use client';

/**
 * ShadCN's button, taken as a starting point and then made to belong to this ledger.
 * `indexed` is the only variant allowed to wear data-gold, because gold means proven.
 */

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/app/_lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-mono text-xs uppercase tracking-[0.16em] font-bold transition-all duration-200 disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0 active:translate-y-px',
  {
    variants: {
      variant: {
        indexed:
          'bg-[image:var(--gradient-index)] text-[#1a1206] border border-accent hover:shadow-[0_0_38px_var(--accent-glow)] hover:-translate-y-0.5',
        slate:
          'bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] text-hi border border-[color-mix(in_srgb,var(--primary)_50%,transparent)] hover:border-accent hover:text-accent',
        ghost: 'text-mid border border-transparent hover:text-accent hover:border-line',
      },
      size: {
        sm: 'h-9 px-4 rounded-sm',
        md: 'h-11 px-6 rounded',
        lg: 'h-14 px-9 text-sm rounded',
      },
    },
    defaultVariants: { variant: 'slate', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
