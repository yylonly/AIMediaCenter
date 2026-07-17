import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatSize(bytes: number | bigint): string {
  const b = Number(bytes);
  if (!b || b < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = b;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(2)} ${units[i]}`;
}

export function parseSize(text: string): number {
  const m = text.trim().match(/^([\d.]+)\s*([KMGT]?I?B)$/i);
  if (!m) return 0;
  const [, num, unit] = m;
  const map: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4
  };
  return Number(num) * (map[unit.toUpperCase()] || 1);
}

export function pad2(n: number | string): string {
  return String(n).padStart(2, '0');
}
