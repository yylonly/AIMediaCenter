import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '@/core/auth/jwt';

const PUBLIC_ROUTES = ['/login', '/api/access-token', '/_next', '/favicon.ico'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_ROUTES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // API routes handle auth themselves via requireAuth()
  if (pathname.startsWith('/api/')) return NextResponse.next();

  const token = req.cookies.get('access_token')?.value;
  if (!token) return NextResponse.redirect(new URL('/login', req.url));
  const payload = await verifyAccessToken(token);
  if (!payload) return NextResponse.redirect(new URL('/login', req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
