import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatViews(viewsStr: string | null | undefined): string {
  if (!viewsStr) return "0";
  const num = parseInt(viewsStr, 10);
  if (isNaN(num)) return viewsStr;
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return num.toString();
}

export function formatDuration(pt: string | null | undefined): string | null {
  if (!pt) return null;
  if (!pt.startsWith('PT')) return pt;
  
  const match = pt.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return pt;
  
  const h = match[1] || '';
  const m = match[2] || '0';
  const s = match[3] || '0';
  
  const mins = h ? m.padStart(2, '0') : m;
  const secs = s.padStart(2, '0');
  
  return h ? `${h}:${mins}:${secs}` : `${mins}:${secs}`;
}
