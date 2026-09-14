export function audioResponse(bytes: Uint8Array, range: string | null) {
  const headers: Record<string, string> = { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store", "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff", "Content-Disposition": 'inline; filename="investigation-narration.mp3"' };
  let start = 0, end = bytes.length - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]) || match.slice(1).filter(Boolean).some((part) => !Number.isSafeInteger(Number(part)))) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${bytes.length}` } });
    if (!match[1]) start = Math.max(0, bytes.length - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${bytes.length}` } });
    headers["Content-Range"] = `bytes ${start}-${end}/${bytes.length}`;
  }
  headers["Content-Length"] = String(end - start + 1);
  return new Response(new Uint8Array(bytes.slice(start, end + 1)), { status: range ? 206 : 200, headers });
}
