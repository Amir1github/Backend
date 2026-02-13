import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { createRemoteJWKSet, jwtVerify } from "jose";

export interface SupabaseUser {
  id: string;
  email?: string;
  [key: string]: any;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: SupabaseUser;
  }
}

let cachedIssuer = "";
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getSupabaseIssuer(): string | null {
  const raw = process.env.SUPABASE_URL?.trim();
  if (!raw) return null;

  const supabaseUrl = raw.replace(/\/+$/, "");
  if (supabaseUrl.endsWith("/auth/v1")) {
    return supabaseUrl;
  }

  if (!supabaseUrl) return null;
  return `${supabaseUrl}/auth/v1`;
}

async function verifyWithSupabaseJwks(token: string): Promise<Record<string, any>> {
  const issuer = getSupabaseIssuer();
  if (!issuer) {
    throw new Error("SUPABASE_URL is not configured");
  }

  if (!cachedJwks || cachedIssuer !== issuer) {
    cachedIssuer = issuer;
    cachedJwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  }

  const { payload } = await jwtVerify(token, cachedJwks, {
    issuer,
    audience: "authenticated",
  });

  return payload as Record<string, any>;
}

// Supabase JWT auth middleware: expects Authorization: Bearer <token>
export async function isAuthenticated(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const token = authHeader.slice("Bearer ".length);
  const secret = process.env.SUPABASE_JWT_SECRET;
  const hasSupabaseUrl = !!getSupabaseIssuer();

  try {
    let decoded: Record<string, any> | null = null;
    let jwksError: unknown = null;

    // Modern Supabase projects use asymmetric signing and should verify via JWKS.
    if (hasSupabaseUrl) {
      try {
        decoded = await verifyWithSupabaseJwks(token);
      } catch (err) {
        jwksError = err;
      }
    }

    // Legacy HS256 fallback
    if (!decoded && secret) {
      decoded = jwt.verify(token, secret) as Record<string, any>;
    }

    if (!decoded) {
      if (jwksError) throw jwksError;
      throw new Error("No auth verification method configured");
    }

    const user: SupabaseUser = {
      id: decoded.sub,
      email: decoded.email,
      ...decoded,
    };

    if (!user.id) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("Failed to verify Supabase JWT:", err);
    const missingConfig =
      !process.env.SUPABASE_JWT_SECRET && !process.env.SUPABASE_URL;
    if (missingConfig) {
      res.status(500).json({
        message: "Authentication not configured",
      });
      return;
    }
    res.status(401).json({ message: "Unauthorized" });
  }
}
