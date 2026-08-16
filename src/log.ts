/** Tee to stdout and to an evidence file, so a run is reproducible from its transcript. */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class Log {
  constructor(private readonly path: string | null) {
    if (path) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '');
    }
  }

  line(text = ''): void {
    console.log(text);
    if (this.path) appendFileSync(this.path, text + '\n');
  }

  rule(title = ''): void {
    this.line(title ? `\n── ${title} ${'─'.repeat(Math.max(1, 74 - title.length))}` : '─'.repeat(78));
  }

  kv(key: string, value: unknown): void {
    this.line(`${key.padEnd(16)}${String(value)}`);
  }
}

export class PipelineFailure extends Error {}

export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new PipelineFailure(message);
}
