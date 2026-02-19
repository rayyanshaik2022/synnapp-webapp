import "server-only";

import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

type RateLimitScope = "uid_or_ip" | "ip";

type RateLimitConfig = {
  maxRequests: number;
  windowSeconds: number;
  scope: RateLimitScope;
};

type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetEpochSeconds: number;
  retryAfterSeconds: number;
};

type AuditOutcome = "success" | "error" | "rate_limited" | "exception";

type ActorContext = {
  uid: string;
  ip: string;
  key: string;
  keyType: "uid" | "ip";
};

type WriteGuardrailsOptions = {
  routeId: string;
  rateLimit?: Partial<RateLimitConfig>;
};

type Handler<TContext> = (request: NextRequest, context: TContext) => Promise<Response>;

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 90,
  windowSeconds: 60,
  scope: "uid_or_ip",
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor
      .split(",")
      .map((entry) => entry.trim())
      .find(Boolean);
    if (first) {
      return first;
    }
  }

  const realIp = normalizeText(request.headers.get("x-real-ip"));
  if (realIp) return realIp;

  const cfIp = normalizeText(request.headers.get("cf-connecting-ip"));
  if (cfIp) return cfIp;

  return "unknown";
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function tryResolveUidFromSessionCookie(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    return "";
  }

  try {
    const decodedSession = await adminAuth.verifySessionCookie(sessionCookie, false);
    return normalizeText(decodedSession.uid);
  } catch {
    return "";
  }
}

async function resolveActorContext(
  request: NextRequest,
  scope: RateLimitScope,
): Promise<ActorContext> {
  const ip = getClientIp(request);

  if (scope === "ip") {
    return {
      uid: "",
      ip,
      key: ip || "unknown",
      keyType: "ip",
    };
  }

  const uid = await tryResolveUidFromSessionCookie(request);
  if (uid) {
    return {
      uid,
      ip,
      key: uid,
      keyType: "uid",
    };
  }

  return {
    uid: "",
    ip,
    key: ip || "unknown",
    keyType: "ip",
  };
}

async function enforceRateLimit(
  routeId: string,
  actor: ActorContext,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const nowMs = Date.now();
  const windowMs = Math.max(1, config.windowSeconds) * 1000;
  const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
  const resetMs = windowStartMs + windowMs;
  const resetEpochSeconds = Math.ceil(resetMs / 1000);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetMs - nowMs) / 1000));
  const limit = Math.max(1, Math.floor(config.maxRequests));
  const keyHash = hashValue(`${routeId}|${actor.key}|${windowStartMs}`);
  const rateLimitRef = adminDb.collection("apiRateLimits").doc(keyHash);

  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(rateLimitRef);
    const currentCount = snapshot.exists
      ? Math.max(0, Number(snapshot.get("count")) || 0)
      : 0;

    if (currentCount >= limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetEpochSeconds,
        retryAfterSeconds,
      };
    }

    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(resetMs + 24 * 60 * 60 * 1000);
    transaction.set(
      rateLimitRef,
      {
        routeId,
        actorKeyHash: hashValue(actor.key),
        actorKeyType: actor.keyType,
        windowStartMs,
        windowSeconds: config.windowSeconds,
        count: currentCount + 1,
        resetAt: Timestamp.fromMillis(resetMs),
        expiresAt,
        updatedAt: now,
        createdAt: snapshot.get("createdAt") ?? now,
      },
      { merge: true },
    );

    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - (currentCount + 1)),
      resetEpochSeconds,
      retryAfterSeconds,
    };
  });
}

function extractAuditPathContext(pathname: string) {
  const segments = pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return {
      workspaceSlug: "",
      entityType: "",
      entityId: "",
    };
  }

  if (segments[0] === "api" && segments[1] === "workspaces") {
    return {
      workspaceSlug: normalizeText(segments[2]),
      entityType: normalizeText(segments[3]),
      entityId: normalizeText(segments[4]),
    };
  }

  if (segments[0] === "api" && segments[1] === "invites") {
    return {
      workspaceSlug: "",
      entityType: "invite",
      entityId: normalizeText(segments[2]) ? "token_redacted" : "",
    };
  }

  if (segments[0] === "api" && segments[1] === "auth") {
    return {
      workspaceSlug: "",
      entityType: "auth",
      entityId: normalizeText(segments[2]),
    };
  }

  return {
    workspaceSlug: "",
    entityType: normalizeText(segments[1]),
    entityId: normalizeText(segments[2]),
  };
}

async function writeAuditLog(params: {
  routeId: string;
  request: NextRequest;
  actor: ActorContext;
  outcome: AuditOutcome;
  statusCode: number;
  durationMs: number;
  rateLimit: RateLimitResult;
  errorMessage?: string;
}) {
  const { workspaceSlug, entityType, entityId } = extractAuditPathContext(
    params.request.nextUrl.pathname,
  );
  const requestId =
    normalizeText(params.request.headers.get("x-request-id")) ||
    normalizeText(params.request.headers.get("x-vercel-id")) ||
    "";
  const userAgent = normalizeText(params.request.headers.get("user-agent")).slice(0, 280);

  await adminDb.collection("apiAuditLogs").add({
    routeId: params.routeId,
    method: params.request.method,
    pathname: params.request.nextUrl.pathname,
    workspaceSlug,
    entityType,
    entityId,
    actorUid: params.actor.uid,
    actorKeyType: params.actor.keyType,
    actorKeyHash: hashValue(params.actor.key),
    actorIp: params.actor.ip,
    requestId,
    userAgent,
    outcome: params.outcome,
    statusCode: params.statusCode,
    durationMs: params.durationMs,
    rateLimit: {
      limit: params.rateLimit.limit,
      remaining: params.rateLimit.remaining,
      resetEpochSeconds: params.rateLimit.resetEpochSeconds,
    },
    errorMessage: normalizeText(params.errorMessage).slice(0, 500),
    createdAt: Timestamp.now(),
  });
}

function setRateLimitHeaders(response: Response, rateLimit: RateLimitResult) {
  response.headers.set("X-RateLimit-Limit", String(rateLimit.limit));
  response.headers.set("X-RateLimit-Remaining", String(rateLimit.remaining));
  response.headers.set("X-RateLimit-Reset", String(rateLimit.resetEpochSeconds));
}

export function withWriteGuardrails<TContext>(
  options: WriteGuardrailsOptions,
  handler: Handler<TContext>,
) {
  return async (request: NextRequest, context: TContext) => {
    const startedAt = Date.now();
    const config: RateLimitConfig = {
      ...DEFAULT_RATE_LIMIT,
      ...options.rateLimit,
    };
    const actor = await resolveActorContext(request, config.scope);
    const rateLimit = await enforceRateLimit(options.routeId, actor, config);

    if (!rateLimit.allowed) {
      const rateLimitedResponse = NextResponse.json(
        {
          error: "Too many requests. Please retry shortly.",
        },
        { status: 429 },
      );
      rateLimitedResponse.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      setRateLimitHeaders(rateLimitedResponse, rateLimit);

      try {
        await writeAuditLog({
          routeId: options.routeId,
          request,
          actor,
          outcome: "rate_limited",
          statusCode: 429,
          durationMs: Date.now() - startedAt,
          rateLimit,
        });
      } catch {
        // Guardrail logging must never break API behavior.
      }

      return rateLimitedResponse;
    }

    try {
      const response = await handler(request, context);
      setRateLimitHeaders(response, rateLimit);

      try {
        await writeAuditLog({
          routeId: options.routeId,
          request,
          actor,
          outcome: response.status >= 400 ? "error" : "success",
          statusCode: response.status,
          durationMs: Date.now() - startedAt,
          rateLimit,
        });
      } catch {
        // Guardrail logging must never break API behavior.
      }

      return response;
    } catch (error) {
      try {
        await writeAuditLog({
          routeId: options.routeId,
          request,
          actor,
          outcome: "exception",
          statusCode: 500,
          durationMs: Date.now() - startedAt,
          rateLimit,
          errorMessage: error instanceof Error ? error.message : "Unhandled exception",
        });
      } catch {
        // Guardrail logging must never break API behavior.
      }
      throw error;
    }
  };
}
