import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 0xabc…def — long enough to recognise, short enough to sit in a table row. */
export function shortHash(hash: string, head = 10, tail = 8) {
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export const groupDigits = (n: number) => n.toLocaleString('en-US');

export function utc(seconds: number) {
  return new Date(seconds * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

export function utcFromIso(iso: string) {
  return iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace('Z', ' UTC');
}
