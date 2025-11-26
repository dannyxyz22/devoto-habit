import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isAbsoluteUrl(u: string) {
  return /^https?:\/\//i.test(u)
}

// Resolves a URL against the app base (import.meta.env.BASE_URL) when not absolute
export function resolveAppUrl(u: string) {
  if (!u) return u
  if (isAbsoluteUrl(u)) return u
  const base = import.meta.env.BASE_URL || "/"
  return `${base}${u.replace(/^\//, "")}`
}

// Resolve EPUB source for runtime (uses dev proxy for external URLs to avoid CORS)
export function resolveEpubSource(src: string) {
  if (!src) return src;
  if (isAbsoluteUrl(src)) return `${import.meta.env.BASE_URL}proxy?url=${encodeURIComponent(src)}`;
  return resolveAppUrl(src);
}

// Upgrade http scheme to https to avoid mixed-content blocking
export function ensureHttps(u: string) {
  if (!u) return u;
  return u.replace(/^http:\/\//i, 'https://');
}
