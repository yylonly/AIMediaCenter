import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const items = await prisma.transferHistory.findMany({
    orderBy: { id: 'desc' },
    take: 200
  });
  return NextResponse.json({ items });
}
