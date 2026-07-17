import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'dev-secret-change-me');
const EXP_MIN = Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES || 10080);

export interface AuthPayload extends JWTPayload {
  userid: number;
  username: string;
  superUser: boolean;
}

export async function signAccessToken(payload: Omit<AuthPayload, keyof JWTPayload>) {
  return await new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${EXP_MIN}m`)
    .sign(SECRET);
}

export async function verifyAccessToken(token: string): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload as AuthPayload;
  } catch {
    return null;
  }
}
