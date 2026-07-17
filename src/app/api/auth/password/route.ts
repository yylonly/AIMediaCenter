import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireAuth, jsonError } from '@/lib/api';
import { prisma } from '@/lib/prisma';

/** Change the current user's password. Requires the current password to match. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => null)) as
    | { currentPassword?: string; newPassword?: string }
    | null;
  if (!body?.currentPassword || !body?.newPassword) {
    return jsonError('currentPassword and newPassword are required');
  }
  if (body.newPassword.length < 6) {
    return jsonError('新密码至少 6 位');
  }

  const user = await prisma.user.findUnique({ where: { id: auth.user.userid } });
  if (!user) return jsonError('用户不存在', 404);

  const ok = await bcrypt.compare(body.currentPassword, user.hashedPassword);
  if (!ok) return jsonError('当前密码不正确', 401);

  const hashedPassword = await bcrypt.hash(body.newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { hashedPassword }
  });
  return NextResponse.json({ ok: true });
}
