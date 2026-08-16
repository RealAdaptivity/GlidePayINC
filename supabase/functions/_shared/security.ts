export async function readJsonObject(req: Request, maxBytes = 32_768): Promise<Record<string, unknown>> {
    const declared = Number(req.headers.get("content-length") || "0");
    if (Number.isFinite(declared) && declared > maxBytes) throw new RequestError("Request body too large", 413);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new RequestError("Request body too large", 413);
    if (!raw.trim()) return {};
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new RequestError("Invalid JSON body", 400); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new RequestError("JSON body must be an object", 400);
    }
    return parsed as Record<string, unknown>;
}

export async function enforceUserRateLimit(
    client: any,
    userId: string,
    action: string,
    maxRequests: number,
    windowSeconds = 60,
): Promise<void> {
    const { data, error } = await client.rpc("consume_edge_rate_limit", {
        actor_id: userId,
        action_name: action,
        max_requests: maxRequests,
        window_seconds: windowSeconds,
    });
    if (error) throw new Error(`Rate limiter unavailable: ${error.message || "unknown error"}`);
    if (data !== true) throw new RequestError("Too many requests. Try again shortly.", 429);
}

export function requireUuid(value: unknown, field: string): string {
    const text = typeof value === "string" ? value : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
        throw new RequestError(`${field} must be a valid UUID`, 400);
    }
    return text;
}

export class RequestError extends Error {
    constructor(message: string, public status: number) { super(message); }
}

export function getCorsHeaders(req?: Request): Record<string, string> {
    const origin = req ? (req.headers.get("origin") || "") : "";
    const configuredOrigin = Deno.env.get("CORS_ALLOWED_ORIGIN") || "";
    const configuredPlatform = Deno.env.get("PLATFORM_URL") || "";

    const allowedOrigins = new Set([
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:3000",
        "https://glidepay.org",
        ...(configuredOrigin ? [configuredOrigin.replace(/\/$/, "")] : []),
        ...(configuredPlatform ? [configuredPlatform.replace(/\/$/, "")] : []),
    ]);

    const resolvedOrigin = allowedOrigins.has(origin)
        ? origin
        : (configuredOrigin || (Deno.env.get("ENVIRONMENT") === "production" ? "https://glidepay.org" : "http://localhost:5500"));

    return {
        "Access-Control-Allow-Origin": resolvedOrigin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin",
    };
}

export function getPlatformUrl(): string {
    const envUrl = Deno.env.get("PLATFORM_URL");
    if (envUrl && envUrl.trim()) return envUrl.replace(/\/$/, "");
    return Deno.env.get("ENVIRONMENT") === "production"
        ? "https://glidepay.org"
        : "http://localhost:5500";
}

export function validateStripeSecretKey(secretKey: string): boolean {
    const isProduction = Deno.env.get("ENVIRONMENT") === "production" || Deno.env.get("PLATFORM_URL")?.includes("glidepay.org");
    if (isProduction) {
        return /^(sk|rk)_(test|live)_/.test(secretKey);
    }
    return /^(sk|rk)_test_/.test(secretKey);
}

export function errorResponse(err: unknown, cors: Record<string, string>, context: string): Response {
    const requestId = crypto.randomUUID();
    if (err instanceof RequestError) {
        return new Response(JSON.stringify({ error: err.message, requestId }), {
            status: err.status,
            headers: { ...cors, "Content-Type": "application/json" },
        });
    }
    console.error(`[${context}] requestId=${requestId}`, err);
    return new Response(JSON.stringify({ error: "Internal server error", requestId }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
    });
}
