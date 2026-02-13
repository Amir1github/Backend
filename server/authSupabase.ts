import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

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

// Supabase JWT auth middleware: expects Authorization: Bearer <token>
export function isAuthenticated(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const token = authHeader.slice("Bearer ".length);
  const secret = process.env.SUPABASE_JWT_SECRET;

  if (!secret) {
    console.error("SUPABASE_JWT_SECRET is not configured");
    res.status(500).json({ message: "Authentication not configured" });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret) as any;
    const user: SupabaseUser = {
      id: decoded.sub,
      email: decoded.email,
      ...decoded,
    };
    req.user = user;
    next();
  } catch (err) {
    console.error("Failed to verify Supabase JWT:", err);
    res.status(401).json({ message: "Unauthorized" });
  }
}

