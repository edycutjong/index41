'use client';

import * as React from 'react';
import { FileCode2 } from 'lucide-react';

import { Button } from '@/app/_components/ui/button';
import { REPO_URL, sourceHref, sourceLinkProps } from '@/app/_lib/links';
import { cn } from '@/app/_lib/utils';

const NAV = [
  { href: '#proof', label: 'The proof' },
  { href: '#mechanism', label: 'Mechanism' },
  { href: '#provenance', label: 'Provenance' },
  { href: '#evidence', label: 'Evidence' },
  { href: '#faq', label: 'FAQ' },
];

export function Header() {
  const [stuck, setStuck] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-300',
        stuck
          ? 'border-b border-line bg-[color-mix(in_srgb,var(--bg-base)_86%,transparent)] backdrop-blur-xl'
          : 'border-b border-transparent',
      )}
    >
      <div className="mx-auto flex h-16 max-w-[78rem] items-center gap-6 px-5 sm:px-8">
        <a href="#top" className="group flex shrink-0 items-center gap-2.5" aria-label="index41 home">
          {/* the project mark itself — same file the README and the favicon use */}
          <img
            src="/icon.svg"
            alt=""
            width={30}
            height={30}
            className="rounded-[6px] transition-transform duration-300 group-hover:scale-105"
          />
          <span className="font-mono text-sm font-bold tracking-[0.06em] text-hi">
            index<span className="text-accent">41</span>
          </span>
        </a>

        <nav className="scroll-x -mx-1 hidden flex-1 items-center gap-6 px-1 md:flex" aria-label="Sections">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="whitespace-nowrap font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-mid transition-colors hover:text-accent"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <Button asChild size="sm" variant="ghost" className="hidden sm:inline-flex">
            <a href={sourceHref('docs/PIPELINE.md')} {...sourceLinkProps}>
              <FileCode2 className="h-3.5 w-3.5" aria-hidden />
              {REPO_URL ? 'Source' : 'Pipeline doc'}
            </a>
          </Button>
          <Button asChild size="sm" variant="indexed">
            <a href="#proof">Watch the proof</a>
          </Button>
        </div>
      </div>
    </header>
  );
}
