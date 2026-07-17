import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { prisma } from '@/lib/prisma';
import { signAccessToken } from '@/core/auth/jwt';

// OAuth2 password grant compatible with MoviePilot's /api/access-token
export async function POST(req: NextRequest) {
  let username: string | null = null;
  let password: string | null = null;
  let otp: string | null = null;

  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const body = await req.json().catch(() => ({}));
    username = body.username;
    password = body.password;
    otp = body.otp_password || body.otp || null;
  } else {
    const form = await req.formData();
    username = form.get('username')?.toString() ?? null;
    password = form.get('password')?.toString() ?? null;
    otp = form.get('otp_password')?.toString() ?? null;
  }

  if (!username || !password) {
    return NextResponse.json({ error: 'username/password required' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { name: username } });
  if (!user) return NextResponse.json({ error: 'incorrect credentials' }, { status: 401 });
  if (!user.isActive) return NextResponse.json({ error: 'user disabled' }, { status: 403 });

  const passOk = await bcrypt.compare(password, user.hashedPassword);
  if (!passOk) return NextResponse.json({ error: 'incorrect credentials' }, { status: 401 });

  if (user.otpSecret) {
    if (!otp) return NextResponse.json({ error: 'otp required' }, { status: 401 });
    const otpOk = authenticator.check(otp, user.otpSecret);
    if (!otpOk) return NextResponse.json({ error: 'incorrect otp' }, { status: 401 });
  }

  const token = await signAccessToken({
    userid: user.id,
    username: user.name,
    superUser: user.isSuperuser
  });

  const res = NextResponse.json({
    access_token: token,
    token_type: 'bearer',
    super_user: user.isSuperuser,
    user_name: user.name,
    avatar: user.avatar || ''
  });
  res.cookies.set('access_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES || 10080)
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('access_token');
  return res;
}
