import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { loadSubtitleConfig, testConnection, type SubtitleConfig } from '@/core/subtitle/opensubtitles';

/**
 * POST /api/subtitle/test — test the OpenSubtitles connection.
 * Accepts optional form values in the body so the user can test before
 * saving; falls back to the stored config otherwise.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const stored = await loadSubtitleConfig();
  const body = (await req.json().catch(() => ({}))) as Partial<SubtitleConfig>;
  const cfg: SubtitleConfig = {
    ...stored,
    apiKey: body.apiKey ?? stored.apiKey,
    username: body.username ?? stored.username,
    password: body.password ?? stored.password
  };
  const result = await testConnection(cfg);
  return NextResponse.json(result);
}
