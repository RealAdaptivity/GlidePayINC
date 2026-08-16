/**
 * GlidePay — Stripe Customer Portal Edge Function
 * supabase/functions/stripe-portal/index.ts
 *
 * Deploy:
 *   supabase functions deploy stripe-portal
 *
 * Opens the Stripe-hosted Customer Portal for the authenticated company.
 * Customers can update payment methods, view invoices, and cancel.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import { enforceUserRateLimit, errorResponse, getCorsHeaders, getPlatformUrl, readJsonObject, validateStripeSecretKey } from "../_shared/security.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const stripe   = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const PLATFORM_URL = getPlatformUrl();

serve(async (req: Request) => {
    const CORS = getCorsHeaders(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, CORS);
    if (!validateStripeSecretKey(STRIPE_SECRET_KEY) && !/^(sk|rk)_test_/.test(STRIPE_SECRET_KEY)) {
        return json({ error: "Sandbox deployment requires a Stripe test key" }, 503, CORS);
    }

    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    try {
        await readJsonObject(req, 4_096);
        await enforceUserRateLimit(supabase, user.id, "stripe-portal:create", 10);
    } catch (err) { return errorResponse(err, CORS, "stripe-portal"); }

    try {
        // Resolve company for this user
        const { data: companyUser } = await supabase
            .from("company_users")
            .select("company_id, role, created_at")
            .eq("user_id", user.id)
            .in("role", ["owner", "admin"])
            .order("created_at", { ascending: false }).limit(1).maybeSingle();

        if (!companyUser) return json({ error: "Company not found" }, 404);

        // Get Stripe customer ID from subscription table
        const { data: sub } = await supabase
            .from("subscriptions")
            .select("stripe_customer_id")
            .eq("company_id", companyUser.company_id)
            .maybeSingle();

        if (!sub?.stripe_customer_id) {
            return json({ error: "No Stripe customer found. Please subscribe first." }, 404);
        }

        const portalSession = await stripe.billingPortal.sessions.create({
            customer:   sub.stripe_customer_id,
            return_url: PLATFORM_URL,
        });

        return json({ url: portalSession.url });
    } catch (err) {
        return errorResponse(err, CORS, "stripe-portal:create");
    }
});

function json(data: object, status = 200, corsHeaders?: Record<string, string>) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...(corsHeaders || getCorsHeaders()), "Content-Type": "application/json" },
    });
}
