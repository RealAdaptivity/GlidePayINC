/**
 * GlidePay — Stripe Connect Edge Function
 * supabase/functions/stripe-connect/index.ts
 *
 * Deploy:
 *   supabase functions deploy stripe-connect
 *
 * Actions:
 *   create_account        — Create a Custom connected account for a company and
 *                           return an Account Link URL for Stripe-hosted KYB onboarding.
 *   refresh_account_link  — Generate a fresh Account Link if the previous one expired.
 *   get_status            — Return current onboarding / capability / FA status.
 *   create_financial_account — Called internally (or by webhook) once capabilities are active.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import { enforceUserRateLimit, errorResponse, getCorsHeaders, getPlatformUrl, readJsonObject, RequestError, validateStripeSecretKey } from "../_shared/security.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const stripe   = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
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

    let body: any;
    try {
        body = await readJsonObject(req, 16_384);
        const requestedAction = String(body.action || "");
        if (!["create_account","refresh_account_link","get_status","create_financial_account"].includes(requestedAction)) throw new RequestError("Unknown action", 400);
        await enforceUserRateLimit(supabase, user.id, `stripe-connect:${requestedAction}`, 20);
    } catch (err) { return errorResponse(err, CORS, "stripe-connect"); }
    const action = body.action as string;

    try {
        switch (action) {
            case "create_account":         return await handleCreateAccount(user.id, body);
            case "refresh_account_link":   return await handleRefreshAccountLink(user.id);
            case "get_status":             return await handleGetStatus(user.id);
            case "create_financial_account": return await handleCreateFinancialAccount(user.id);
            default:                       return json({ error: `Unknown action: ${action}` }, 400);
        }
    } catch (err) {
        return errorResponse(err, CORS, `stripe-connect:${action}`);
    }
});

// ── Create Account ────────────────────────────────────────────────────────────
async function handleCreateAccount(userId: string, body: { companyName?: string; ein?: string }) {
    const company = await getCompanyForUser(userId);

    // Idempotent — return existing account link if we already have an account
    if (company.stripe_account_id) {
        return await buildAccountLink(company.stripe_account_id, company.id);
    }

    const account = await stripe.accounts.create(
        {
            type: "custom",
            country: "US",
            capabilities: {
                treasury:                     { requested: true },
                us_bank_account_ach_payments: { requested: true },
                transfers:                    { requested: true },
            },
            business_type: "company",
            business_profile: {
                name: company.name,
                // MCC 7372 = Prepackaged Software (payroll SaaS)
                mcc: "7372",
                url: PLATFORM_URL,
            },
            metadata: { company_id: company.id },
        },
        { idempotencyKey: `connect-account:${company.id}` },
    );

    // Persist account ID immediately so we can handle webhooks
    await supabase.from("companies").update({
        stripe_account_id:     account.id,
        stripe_account_status: "pending_onboarding",
    }).eq("id", company.id);

    await supabase.from("audit_log").insert({
        company_id:  company.id,
        actor_label: "System",
        action:      "Stripe Account Created",
        details:     `Connected account ${account.id} created — KYB onboarding required`,
        category:    "settings",
    });

    return await buildAccountLink(account.id, company.id);
}

// ── Refresh Account Link ──────────────────────────────────────────────────────
async function handleRefreshAccountLink(userId: string) {
    const company = await getCompanyForUser(userId);
    if (!company.stripe_account_id) {
        return json({ error: "No connected account found. Call create_account first." }, 400);
    }
    return await buildAccountLink(company.stripe_account_id, company.id);
}

// ── Get Status ────────────────────────────────────────────────────────────────
async function handleGetStatus(userId: string) {
    const company = await getCompanyForUser(userId);

    if (!company.stripe_account_id) {
        return json({ status: "not_created", capabilities: {}, hasFinancialAccount: false, requirementsDue: [] });
    }

    const account = await stripe.accounts.retrieve(company.stripe_account_id as string);
    const caps    = account.capabilities ?? {};
    const newStatus = deriveConnectStatus(account);

    // Persist live Stripe status so Settings reflects onboarding even if webhooks lag
    const updates: Record<string, string> = {};
    if (company.stripe_account_status !== newStatus) {
        updates.stripe_account_status = newStatus;
    }

    // Auto-create financial account once fully active
    if (newStatus === "active" && !company.stripe_financial_account_id) {
        try {
            const fa = await stripe.treasury.financialAccounts.create(
                {
                    supported_currencies: ["usd"],
                    features: {
                        inbound_transfers:   { ach: { requested: true } },
                        outbound_transfers:  { ach: { requested: true } },
                        outbound_payments:   { ach: { requested: true } },
                        financial_addresses: { aba: { requested: true } },
                        intra_stripe_flows:  { requested: true },
                    },
                },
                {
                    stripeAccount: company.stripe_account_id as string,
                    idempotencyKey: `financial-account:${company.id}`,
                },
            );
            updates.stripe_financial_account_id = fa.id;
            updates.stripe_account_status = "active";

            await supabase.from("audit_log").insert({
                company_id:  company.id,
                actor_label: "System",
                action:      "Treasury Financial Account Created",
                details:     `Financial account ${fa.id} created while syncing Connect status`,
                category:    "settings",
            });
        } catch (err) {
            console.error(`[stripe-connect] FA create on get_status:`, (err as Error).message);
        }
    }

    if (Object.keys(updates).length) {
        await supabase.from("companies").update(updates).eq("id", company.id);
    }

    const financialAccountId =
        updates.stripe_financial_account_id ||
        (company.stripe_financial_account_id as string | null) ||
        null;

    return json({
        status:              updates.stripe_account_status || company.stripe_account_status || newStatus,
        accountId:           company.stripe_account_id,
        detailsSubmitted:    !!account.details_submitted,
        capabilities: {
            treasury:                     caps.treasury,
            us_bank_account_ach_payments: caps.us_bank_account_ach_payments,
            transfers:                    caps.transfers,
        },
        requirementsDue:     [
            ...(account.requirements?.currently_due ?? []),
            ...(account.requirements?.past_due ?? []),
        ],
        hasFinancialAccount: !!financialAccountId,
        financialAccountId,
    });
}

/** Mirror webhook status derivation so UI/DB stay consistent without waiting on webhooks. */
function deriveConnectStatus(account: Stripe.Account): string {
    const caps = account.capabilities ?? {};
    const treasuryActive = caps.treasury === "active";
    const achActive      = caps.us_bank_account_ach_payments === "active";
    const due = [
        ...(account.requirements?.currently_due ?? []),
        ...(account.requirements?.past_due ?? []),
    ];
    const onboardingDone = due.length === 0 && !!account.details_submitted;

    if (onboardingDone && treasuryActive && achActive) return "active";
    if (onboardingDone) return "pending_verification";
    if (account.details_submitted || account.id) return "pending_onboarding";
    return "not_created";
}

// ── Create Financial Account ──────────────────────────────────────────────────
// Called once treasury capability is active (also triggered by webhook).
async function handleCreateFinancialAccount(userId: string) {
    const company = await getCompanyForUser(userId);

    if (!company.stripe_account_id) {
        return json({ error: "No connected account" }, 400);
    }
    if (company.stripe_financial_account_id) {
        return json({ financialAccountId: company.stripe_financial_account_id });
    }

    const fa = await stripe.treasury.financialAccounts.create(
        {
            supported_currencies: ["usd"],
            features: {
                inbound_transfers:   { ach: { requested: true } },
                outbound_transfers:  { ach: { requested: true } },
                outbound_payments:   { ach: { requested: true } },
                financial_addresses: { aba: { requested: true } },
                intra_stripe_flows:  { requested: true },
            },
        },
        {
            stripeAccount: company.stripe_account_id,
            idempotencyKey: `financial-account:${company.id}`,
        },
    );

    await supabase.from("companies").update({
        stripe_financial_account_id: fa.id,
        stripe_account_status:       "active",
    }).eq("id", company.id);

    await supabase.from("audit_log").insert({
        company_id:  company.id,
        actor_label: "System",
        action:      "Treasury Financial Account Created",
        details:     `Financial account ${fa.id} created for connected account ${company.stripe_account_id}`,
        category:    "settings",
    });

    return json({ financialAccountId: fa.id });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getCompanyForUser(userId: string) {
    const { data, error } = await supabase
        .from("company_users")
        .select("company_id, role, created_at, companies(*)")
        .eq("user_id", userId)
        .in("role", ["owner", "admin"])
        .order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (error || !data) throw new Error("Company not found for user");
    return { id: data.company_id, ...(data.companies as unknown as Record<string, unknown>) } as Record<string, any>;
}

async function buildAccountLink(stripeAccountId: string, companyId: string) {
    const link = await stripe.accountLinks.create({
        account:     stripeAccountId,
        type:        "account_onboarding",
        // Ensure bank (external_account) is collected even if other KYB was already submitted.
        collect:     "eventually_due",
        refresh_url: `${PLATFORM_URL}?connect=refresh`,
        return_url:  `${PLATFORM_URL}?connect=return`,
    });

    return json({ url: link.url, accountId: stripeAccountId });
}

function json(data: object, status = 200, corsHeaders?: Record<string, string>) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...(corsHeaders || getCorsHeaders()), "Content-Type": "application/json" },
    });
}
