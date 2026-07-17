import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api';
import { aggregatedSearchStream, type SearchProgress } from '@/core/indexer/registry';
import type { MediaType } from '@/core/meta/types';

/**
 * Streaming search via Server-Sent Events. Emits one `progress` event per
 * site as it completes, then a final `done` event with the deduped/sorted
 * torrent list. Falls back is the plain /api/search route (kept for clients
 * that don't consume SSE).
 *
 * Event shapes:
 *   data: {"type":"progress","current":3,"total":8,"site":"DMHY","found":12}
 *   data: {"type":"done","items":[...]}
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const keyword = url.searchParams.get('keyword')?.trim();
  const mtype = (url.searchParams.get('type') as MediaType | null) || undefined;
  const page = Number(url.searchParams.get('page') || 1);
  const sitesParam = url.searchParams.get('sites');
  const sites = sitesParam
    ? sitesParam.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;
  if (!keyword) {
    return new Response(JSON.stringify({ error: 'keyword required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Guards against enqueueing into an already-closed controller. After the
      // timeout fires, aggregatedSearchStream resolves with partial results and
      // this handler sends `done` + closes the stream, but the background
      // per-site searches keep running and may still invoke onProgress.
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          // controller was closed (client disconnect / timeout) - ignore.
        }
      };
      try {
        const items = await aggregatedSearchStream(
          { keyword, mtype, page, sites },
          (p: SearchProgress) => send({ type: 'progress', ...p })
        );
        send({ type: 'done', items });
      } catch (e) {
        send({ type: 'error', error: (e as Error).message });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed - ignore
        }
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable Next.js buffering for the streaming response.
      'X-Accel-Buffering': 'no'
    }
  });
}
