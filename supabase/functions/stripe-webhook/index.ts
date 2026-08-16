/**
 * GlidePay — Stripe Webhook Handler
 * Supabase Edge Function: supabase/functions/stripe-webhook/index.ts
 *
 * Deploy:
 *   supabase functions deploy stripe-webhook --no-verify-jwt
 *
 * Set secrets:
 *   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
 *   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
 *
 * Register this URL in Stripe Dashboard → Webhooks:
 *   https://ojvnxnlrghatkwjrlnop.supabase.co/functions/v1/stripe-webhook
 *
 * Events to enable in Stripe:
 *   customer.subscription.created
 *   customer.subscription.updated
 *   customer.subscription.deleted
 *   invoice.payment_succeeded
 *   invoice.payment_failed
 *   customer.updated
 *   treasury.outbound_transfer.posted
 *   treasury.outbound_transfer.failed
 *   treasury.outbound_transfer.returned
 *   account.updated  (Connect — capability grants, onboarding completion)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import { validateStripeSecretKey } from "../_shared/security.ts";

// ── Environment ──────────────────────────────────────────────
const STRIPE_SECRET_KEY      = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET  = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SUPABASE_URL           = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// Service-role client bypasses RLS so webhook can write freely
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Handler ──────────────────────────────────────────────────
serve(async (req: Request) => {
    if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }
    if (!validateStripeSecretKey(STRIPE_SECRET_KEY) && !/^(sk|rk)_test_/.test(STRIPE_SECRET_KEY)) {
        return new Response("Sandbox deployment requires a Stripe test key", { status: 503 });
    }

    const signature = req.headers.get("stripe-signature");
    if (!signature) {
        return new Response("Missing stripe-signature header", { status: 400 });
    }

    let event: Stripe.Event;
    const body = await req.text();

    try {
        event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error("[webhook] Signature verification failed:", (err as Error).message);
        return new Response("Invalid webhook signature", { status: 400 });
    }

    console.log(`[webhook] Received: ${event.type}`);

    try {
        const shouldProcess = await claimEvent(event);
        if (!shouldProcess) {
            return new Response(JSON.stringify({ received: true, duplicate: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
    } catch (err) {
        console.error(`[webhook] Could not claim ${event.id}:`, err);
        return new Response(JSON.stringify({ error: "Could not claim webhook event" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        switch (event.type) {
            case "customer.subscription.created":
            case "customer.subscription.updated":
                await handleSubscriptionUpsert(event.data.object as Stripe.Subscription);
                break;

            case "customer.subscription.deleted":
                await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
                break;

            case "invoice.payment_succeeded":
                await handleInvoicePaid(event.data.object as Stripe.Invoice);
                break;

            case "invoice.payment_failed":
                await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
                break;

            case "treasury.outbound_transfer.posted":
            case "treasury.outbound_payment.posted":
                await handleOutboundTransfer(event.data.object as any, "succeeded");
                break;

            case "treasury.outbound_transfer.failed":
            case "treasury.outbound_transfer.returned":
            case "treasury.outbound_payment.failed":
            case "treasury.outbound_payment.returned":
            case "treasury.outbound_payment.canceled":
                await handleOutboundTransfer(event.data.object as any, "failed");
                break;

            case "account.updated":
                await handleAccountUpdated(event.data.object as Stripe.Account);
                break;

            default:
                console.log(`[webhook] Unhandled event type: ${event.type}`);
        }
        await markEventProcessed(event.id);
    } catch (err) {
        console.error(`[webhook] Error handling ${event.type}:`, err);
        await markEventFailed(event.id, (err as Error).message).catch((markErr) => {
            console.error(`[webhook] Could not mark ${event.id} failed:`, markErr);
        });
        // Retry transient processing failures. Returning 200 here can silently
        // lose billing or transfer state.
        return new Response(JSON.stringify({ error: "Webhook processing failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
});

// ── Helpers ───────────────────────────────────────────────────

/**
 * Upsert subscription record when created or updated.
 * Resolves company_id from stripe_customer_id stored in the subscriptions table
 * or from the customer's metadata (set during Checkout).
 */
async function claimEvent(event: Stripe.Event): Promise<boolean> {
    const object = event.data.object as { id?: unknown };
    const objectId = typeof object?.id === "string" ? object.id : null;
    const now = new Date().toISOString();
    const { error: insertError } = await supabase.from("stripe_webhook_events").insert({
        event_id: event.id,
        event_type: event.type,
        object_id: objectId,
        status: "processing",
        updated_at: now,
    });
    if (!insertError) return true;
    if (insertError.code !== "23505") throw insertError;

    const { data: existing, error: fetchError } = await supabase
        .from("stripe_webhook_events")
        .select("status, attempts, updated_at")
        .eq("event_id", event.id)
        .single();
    if (fetchError || !existing) throw fetchError ?? new Error("Webhook event claim missing");
    if (existing.status === "processed") return false;

    const isStale = new Date(existing.updated_at).getTime() < Date.now() - 5 * 60 * 1000;
    if (existing.status === "processing" && !isStale) return false;

    const { error: retryError } = await supabase
        .from("stripe_webhook_events")
        .update({
            status: "processing",
            attempts: Number(existing.attempts || 1) + 1,
            last_error: null,
            updated_at: now,
        })
        .eq("event_id", event.id);
    if (retryError) throw retryError;
    return true;
}

async function markEventProcessed(eventId: string) {
    const now = new Date().toISOString();
    const { error } = await supabase.from("stripe_webhook_events").update({
        status: "processed",
        processed_at: now,
        last_error: null,
        updated_at: now,
    }).eq("event_id", eventId);
    if (error) throw error;
}

async function markEventFailed(eventId: string, message: string) {
    const { error } = await supabase.from("stripe_webhook_events").update({
        status: "failed",
        last_error: message.slice(0, 2000),
        updated_at: new Date().toISOString(),
    }).eq("event_id", eventId);
    if (error) throw error;
}

async function handleSubscriptionUpsert(sub: Stripe.Subscription) {
    const customerId = sub.customer as string;
    const companyId  = await resolveCompanyId(customerId, sub);

    if (!companyId) {
        console.warn(`[webhook] No company found for Stripe customer ${customerId} / sub ${sub.id}`);
        return;
    }

    // Count seats from the per-seat price item quantity (fallback: max item qty)
    let seatCount = 1;
    for (const item of sub.items.data) {
        const meta = item.price?.metadata;
        if (meta?.type === "per_seat") {
            seatCount = item.quantity ?? 1;
            break;
        }
        if ((item.quantity ?? 1) > seatCount) seatCount = item.quantity ?? 1;
    }

    // Newer Stripe API versions put billing period on items, not the subscription.
    const { start: periodStart, end: periodEnd } = subscriptionPeriod(sub);

    const { error } = await supabase.from("subscriptions").upsert({
        company_id:              companyId,
        stripe_customer_id:      customerId,
        stripe_subscription_id:  sub.id,
        status:                  sub.status,
        seat_count:              seatCount,
        current_period_start:    periodStart,
        current_period_end:      periodEnd,
        cancel_at_period_end:    !!sub.cancel_at_period_end,
        canceled_at:             unixToIso(sub.canceled_at),
        trial_end:               unixToIso(sub.trial_end),
        updated_at:              new Date().toISOString(),
    }, { onConflict: "company_id" });

    if (error) throw error;

    console.log(`[webhook] Subscription ${sub.id} → ${sub.status} for company ${companyId}`);
}

/** Billing period: prefer subscription fields, else first subscription item. */
function subscriptionPeriod(sub: Stripe.Subscription): { start: string | null; end: string | null } {
    const item = sub.items?.data?.[0] as { current_period_start?: number; current_period_end?: number } | undefined;
    const startUnix = (sub as any).current_period_start ?? item?.current_period_start ?? null;
    const endUnix   = (sub as any).current_period_end   ?? item?.current_period_end   ?? null;
    return { start: unixToIso(startUnix), end: unixToIso(endUnix) };
}

function unixToIso(unix: number | null | undefined): string | null {
    if (unix == null || !Number.isFinite(Number(unix))) return null;
    return new Date(Number(unix) * 1000).toISOString();
}

/**
 * Mark subscription as canceled when deleted.
 */
async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
    const { error } = await supabase
        .from("subscriptions")
        .update({
            status:      "canceled",
            canceled_at: new Date().toISOString(),
        })
        .eq("stripe_subscription_id", sub.id);

    if (error) throw error;
    console.log(`[webhook] Subscription ${sub.id} canceled.`);
}

/**
 * On successful invoice payment, ensure subscription status is active
 * and log to the audit trail.
 */
async function handleInvoicePaid(invoice: Stripe.Invoice) {
    if (!invoice.subscription) return;

    const { data: subRow } = await supabase
        .from("subscriptions")
        .select("company_id")
        .eq("stripe_subscription_id", invoice.subscription)
        .single();

    if (!subRow) return;

    // Mark active in case it was past_due
    await supabase
        .from("subscriptions")
        .update({ status: "active" })
        .eq("stripe_subscription_id", invoice.subscription as string);

    // Write audit log
    await supabase.from("audit_log").insert({
        company_id:  subRow.company_id,
        actor_label: "Stripe",
        action:      "Invoice Paid",
        details:     `Invoice ${invoice.number} paid — $${((invoice.amount_paid ?? 0) / 100).toFixed(2)}`,
        category:    "settings",
    });

    console.log(`[webhook] Invoice ${invoice.id} paid for company ${subRow.company_id}.`);
}

/**
 * On payment failure, flip subscription to past_due and log it.
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    if (!invoice.subscription) return;

    const { data: subRow } = await supabase
        .from("subscriptions")
        .select("company_id")
        .eq("stripe_subscription_id", invoice.subscription)
        .single();

    if (!subRow) return;

    await supabase
        .from("subscriptions")
        .update({ status: "past_due" })
        .eq("stripe_subscription_id", invoice.subscription as string);

    await supabase.from("audit_log").insert({
        company_id:  subRow.company_id,
        actor_label: "Stripe",
        action:      "Payment Failed",
        details:     `Invoice ${invoice.number} payment failed — $${((invoice.amount_due ?? 0) / 100).toFixed(2)}. Stripe will retry automatically.`,
        category:    "settings",
    });

    console.log(`[webhook] Payment failed for company ${subRow.company_id}.`);
}

/**
 * Update ach_transfers row when Stripe Treasury confirms or rejects a transfer.
 */
async function handleOutboundTransfer(transfer: any, status: "succeeded" | "failed") {
    const { error } = await supabase
        .from("ach_transfers")
        .update({
            status,
            failure_message: status === "failed" ? (transfer.returned_details?.code ?? "transfer_failed") : null,
            updated_at: new Date().toISOString(),
        })
        .eq("stripe_transfer_id", transfer.id);

    if (error) throw error;

    const companyId = transfer.metadata?.company_id;
    if (companyId) {
        await supabase.from("audit_log").insert({
            company_id:  companyId,
            actor_label: "Stripe",
            action:      status === "succeeded" ? "ACH Transfer Sent" : "ACH Transfer Failed",
            details:     `ACH payout ${transfer.id} — $${((transfer.amount ?? 0) / 100).toFixed(2)} — ${status}`,
            category:    "payroll",
        });
    }

    console.log(`[webhook] ACH payout ${transfer.id} → ${status}`);
}

/**
 * When a connected account's capabilities change, update our status and
 * auto-provision a Treasury Financial Account once treasury capability is active.
 */
async function handleAccountUpdated(account: Stripe.Account) {
    const companyId = account.metadata?.company_id;
    if (!companyId) {
        console.warn(`[webhook] account.updated for ${account.id} has no company_id metadata`);
        return;
    }

    const caps           = account.capabilities ?? {};
    const treasuryActive = caps.treasury === "active";
    const achActive      = caps.us_bank_account_ach_payments === "active";
    const due = [
        ...(account.requirements?.currently_due ?? []),
        ...(account.requirements?.past_due ?? []),
    ];
    const onboardingDone  = due.length === 0 && !!account.details_submitted;

    let newStatus = "pending_onboarding";
    if (onboardingDone && treasuryActive && achActive) {
        newStatus = "active";
    } else if (onboardingDone) {
        newStatus = "pending_verification";
    } else if (account.details_submitted || account.id) {
        newStatus = "pending_onboarding";
    }

    await supabase.from("companies")
        .update({ stripe_account_status: newStatus })
        .eq("id", companyId);

    // Auto-create financial account once treasury is fully active
    if (newStatus === "active") {
        const { data: company } = await supabase
            .from("companies")
            .select("stripe_financial_account_id")
            .eq("id", companyId)
            .single();

        if (!company?.stripe_financial_account_id) {
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
                        stripeAccount: account.id,
                        idempotencyKey: `financial-account:${companyId}`,
                    },
                );

                await supabase.from("companies")
                    .update({ stripe_financial_account_id: fa.id })
                    .eq("id", companyId);

                await supabase.from("audit_log").insert({
                    company_id:  companyId,
                    actor_label: "Stripe",
                    action:      "Treasury Financial Account Created",
                    details:     `Financial account ${fa.id} auto-provisioned after capabilities approved`,
                    category:    "settings",
                });

                console.log(`[webhook] Financial account ${fa.id} created for company ${companyId}`);
            } catch (err) {
                console.error(`[webhook] Failed to create financial account for ${companyId}:`, (err as Error).message);
            }
        }
    }

    console.log(`[webhook] account.updated ${account.id} → status=${newStatus}`);
}

/**
 * Resolve company_id from subscription metadata, existing row, or customer metadata.
 */
async function resolveCompanyId(
    customerId: string,
    sub?: Stripe.Subscription,
): Promise<string | null> {
    const fromSubMeta = sub?.metadata?.company_id;
    if (fromSubMeta) return fromSubMeta;

    const { data: existing } = await supabase
        .from("subscriptions")
        .select("company_id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();

    if (existing?.company_id) return existing.company_id;

    const customer = await stripe.customers.retrieve(customerId);
    if ("deleted" in customer) return null;

    return (customer as Stripe.Customer).metadata?.company_id ?? null;
}
