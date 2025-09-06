const CACHE_NAME = 'cover-cache-v1';

export async function getCoverObjectUrl(id: string): Promise<string | null> {
  try {
    if (!('caches' in window)) return null;
    const cache = await caches.open(CACHE_NAME);
    const key = `/covers/${encodeURIComponent(id)}`;
    const res = await cache.match(key);
    if (!res || !res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export async function saveCoverBlob(id: string, blob: Blob): Promise<void> {
  try {
    if (!('caches' in window)) return;
    const cache = await caches.open(CACHE_NAME);
    const key = `/covers/${encodeURIComponent(id)}`;
    const headers = new Headers({ 'Content-Type': blob.type || 'image/jpeg' });
    const res = new Response(blob, { headers });
    await cache.put(key, res);
  } catch {
    // best effort
  }
}

export async function deleteCover(id: string): Promise<void> {
  try {
    if (!('caches' in window)) return;
    const cache = await caches.open(CACHE_NAME);
    const key = `/covers/${encodeURIComponent(id)}`;
    await cache.delete(key);
  } catch {
    // best effort
  }
}

export async function clearCoverCache(): Promise<void> {
  try {
    if (!('caches' in window)) return;
    // Delete only this cache name to avoid removing other app caches
    await caches.delete(CACHE_NAME);
  } catch {
    // best effort
  }
}
