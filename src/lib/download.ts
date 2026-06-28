/**
 * Force-download a (possibly cross-origin) URL as a file, staying on the page.
 * The HTML5 `download` attribute is ignored cross-origin, so fetch the bytes,
 * make a same-origin blob: URL, and click a temporary anchor. Falls back to
 * opening the URL in a new tab if the fetch is blocked (e.g. CORS).
 */
export async function downloadFile(url: string, filename: string): Promise<void> {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`download fetch failed: ${res.status}`)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(objectUrl)
  } catch {
    window.open(url, '_blank', 'noopener')
  }
}

/** Map an image mediaType to a file extension for a download filename. */
export function imageExt(mediaType: string | null | undefined): string {
  const sub = (mediaType ?? '').split('/')[1]?.toLowerCase()
  if (!sub) return 'png'
  return sub === 'jpeg' ? 'jpg' : sub
}
