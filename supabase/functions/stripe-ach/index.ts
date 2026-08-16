/**
 * GlidePay — Stripe ACH Edge Function
 * supabase/functions/stripe-ach/index.ts
 *
 * Deploy:
 *   supabase functions deploy stripe-ach
 *
 * Actions:
 *   setup_intent   — Create a Customer + SetupIntent so the frontend can collect an
 *                    employee's bank via Financial Connections (for OutboundPayments).
 *   confirm_setup  — Persist the confirmed PaymentMethod + customer on the employee,
 *                    stamp bank_account_linked_at, and email employee + admin.
 *   disburse       — Kick off OutboundPayments (Stripe Treasury) for every employee
 *                    in a payroll run, enforcing the 3-day hold for newly linked accounts.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import { enforceUserRateLimit, errorResponse, getCorsHeaders, getPlatformUrl, readJsonObject, RequestError, requireUuid, validateStripeSecretKey } from "../_shared/security.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const stripe   = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const RESEND_API_KEY  = Deno.env.get("RESEND_API_KEY") ?? "";
const PLATFORM_FROM   = Deno.env.get("PLATFORM_FROM_EMAIL") ?? "payroll@glidepay.org";
const PLATFORM_URL    = getPlatformUrl();

const HOLD_BUSINESS_DAYS = 3;

serve(async (req: Request) => {
    const CORS = getCorsHeaders(req);
    if (req.method === "OPTIONS") return ok(CORS);
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
        if (!["setup_intent","confirm_setup","disburse","release_held"].includes(requestedAction)) throw new RequestError("Unknown action", 400);
        await enforceUserRateLimit(supabase, user.id, `stripe-ach:${requestedAction}`, 20);
        if (body.employeeId !== undefined) body.employeeId = requireUuid(body.employeeId, "employeeId");
        if (body.payrollRunId !== undefined) body.payrollRunId = requireUuid(body.payrollRunId, "payrollRunId");
        if (body.paymentMethodId !== undefined && !/^pm_[A-Za-z0-9]{8,100}$/.test(String(body.paymentMethodId))) {
            throw new RequestError("Invalid paymentMethodId", 400);
        }
    } catch (err) { return errorResponse(err, CORS, "stripe-ach"); }
    const action = body.action as string;

    try {
        switch (action) {
            case "setup_intent":  return await handleSetupIntent(user.id, body);
            case "confirm_setup": return await handleConfirmSetup(user.id, body);
            case "disburse":      return await handleDisburse(user.id, body);
            case "release_held":  return await handleReleaseHeld(user.id);
            default:              return json({ error: `Unknown action: ${action}` }, 400);
        }
    } catch (err) {
        return errorResponse(err, CORS, `stripe-ach:${action}`);
    }
});

// ── Setup Intent ───────────────────────────────────────────────────────────────
async function handleSetupIntent(userId: string, body: { employeeId: string }) {
    if (!body.employeeId) return json({ error: "employeeId is required" }, 400);

    const company = await getCompany(userId, { employeeId: body.employeeId });
    const connectedAccountId = company.stripe_account_id as string | undefined;

    if (!connectedAccountId) {
        return json({ error: "Stripe connected account not set up. Complete onboarding first." }, 400);
    }

    const { data: emp, error: empErr } = await supabase
        .from("employees")
        .select("id, name, email, stripe_customer_id, company_id, user_id")
        .eq("id", body.employeeId)
        .eq("company_id", company.id)
        .single();
    if (empErr || !emp) return json({ error: "Employee not found" }, 404);

    // Employees may only link their own bank account.
    if (emp.user_id && emp.user_id !== userId && company._membershipRole === "employee") {
        return json({ error: "Not allowed to link bank for another employee" }, 403);
    }

    const customerId = await ensureEmployeeCustomer(emp, connectedAccountId);

    const intent = await stripe.setupIntents.create(
        {
            customer: customerId,
            payment_method_types: ["us_bank_account"],
            payment_method_options: {
                us_bank_account: {
                    financial_connections: { permissions: ["payment_method"] },
                    verification_method: "instant",
                },
            },
            metadata: {
                company_id:  company.id,
                employee_id: body.employeeId,
            },
        },
        { stripeAccount: connectedAccountId },
    );

    return json({ client_secret: intent.client_secret, customer_id: customerId });
}

// ── Confirm Setup ──────────────────────────────────────────────────────────────
async function handleConfirmSetup(userId: string, body: {
    employeeId:      string;
    paymentMethodId: string;
}) {
    if (!body.employeeId || !body.paymentMethodId) {
        return json({ error: "employeeId and paymentMethodId are required" }, 400);
    }

    const company = await getCompany(userId, { employeeId: body.employeeId });
    const connectedAccountId = company.stripe_account_id as string | undefined;

    if (!connectedAccountId) {
        return json({ error: "Stripe connected account not set up." }, 400);
    }

    const { data: empBefore } = await supabase
        .from("employees")
        .select("name, email, bank_account_last4, stripe_customer_id, company_id, user_id")
        .eq("id", body.employeeId)
        .eq("company_id", company.id)
        .single();
    if (!empBefore) return json({ error: "Employee not found" }, 404);

    if (empBefore.user_id && empBefore.user_id !== userId && company._membershipRole === "employee") {
        return json({ error: "Not allowed to link bank for another employee" }, 403);
    }

    const customerId = await ensureEmployeeCustomer(
        { ...empBefore, id: body.employeeId },
        connectedAccountId,
    );

    const pm = await stripe.paymentMethods.retrieve(
        body.paymentMethodId,
        {},
        { stripeAccount: connectedAccountId },
    );

    // Attach if SetupIntent did not already (idempotent when already attached).
    if (pm.customer !== customerId) {
        try {
            await stripe.paymentMethods.attach(
                body.paymentMethodId,
                { customer: customerId },
                { stripeAccount: connectedAccountId },
            );
        } catch (err) {
            const msg = (err as Error).message || "";
            if (!/already been attached/i.test(msg)) throw err;
        }
    }

    const last4   = (pm as any).us_bank_account?.last4 ?? "";
    const routing = (pm as any).us_bank_account?.routing_number ?? "";
    const linkedAt = new Date().toISOString();

    const { error } = await supabase.from("employees").update({
        stripe_pm_id:           body.paymentMethodId,
        stripe_customer_id:     customerId,
        bank_account_last4:     last4,
        bank_routing:           routing,
        bank_account_linked_at: linkedAt,
    }).eq("id", body.employeeId);

    if (error) throw error;

    const prevLast4 = empBefore?.bank_account_last4;
    await supabase.from("audit_log").insert({
        company_id:  company.id,
        actor_label: "System",
        action:      prevLast4 ? "Bank Account Changed" : "Bank Account Linked",
        details:     prevLast4
            ? `${empBefore?.name} changed direct deposit from ••••${prevLast4} to ••••${last4}. 3-day hold applied.`
            : `${empBefore?.name} linked direct deposit account ••••${last4}. 3-day hold applied.`,
        category:    "employee",
    });

    const companyName = (company.name as string) ?? "Your employer";
    await Promise.allSettled([
        empBefore?.email ? sendEmail({
            to:      empBefore.email,
            subject: "Your direct deposit account was updated",
            html: `
                <p>Hi ${empBefore.name},</p>
                <p>Your direct deposit bank account on GlidePay has been updated to the account ending in <strong>••••${last4}</strong>.</p>
                <p>Your first payroll deposit to this account will be held for <strong>3 business days</strong> as a security measure. ${prevLast4 ? `Your previous account (••••${prevLast4}) has been removed.` : ""}</p>
                <p>If you did not make this change, contact your payroll administrator immediately.</p>
                <p style="color:#6b7280;font-size:12px;">— GlidePay on behalf of ${companyName}</p>
            `,
        }) : Promise.resolve(),
        company.admin_email ? sendEmail({
            to:      company.admin_email as string,
            subject: `[GlidePay] Bank account changed — ${empBefore?.name}`,
            html: `
                <p>This is an automated security alert from GlidePay.</p>
                <p><strong>${empBefore?.name}</strong> updated their direct deposit to the account ending in <strong>••••${last4}</strong>${prevLast4 ? ` (previously ••••${prevLast4})` : ""}.</p>
                <p>A <strong>3-business-day hold</strong> has been applied before the first disbursement to this account.</p>
                <p>If this change was not authorized, log in to GlidePay immediately and contact support.</p>
                <p style="color:#6b7280;font-size:12px;"><a href="${PLATFORM_URL}">Open GlidePay</a></p>
            `,
        }) : Promise.resolve(),
    ]).then(results => {
        results.forEach((r, i) => {
            if (r.status === "rejected") console.warn(`[stripe-ach] email ${i} failed:`, r.reason);
        });
    });

    return json({ ok: true, last4, routing, linkedAt, customerId });
}

// ── Disburse ──────────────────────────────────────────────────────────────────
async function handleDisburse(userId: string, body: {
    payrollRunId:   string;
}) {
    if (!body.payrollRunId) {
        return json({ error: "payrollRunId is required" }, 400);
    }

    const { data: run, error: runError } = await supabase
        .from("payroll_runs")
        .select("id, company_id, status")
        .eq("id", body.payrollRunId)
        .single();
    if (runError || !run) return json({ error: "Payroll run not found" }, 404);
    if (run.status !== "completed") {
        return json({ error: "Payroll must be approved before disbursement" }, 409);
    }

    const { data: membership } = await supabase
        .from("company_users")
        .select("role")
        .eq("company_id", run.company_id)
        .eq("user_id", userId)
        .in("role", ["owner", "admin"])
        .maybeSingle();
    if (!membership) return json({ error: "Owner or admin access required" }, 403);

    const { data: company, error: companyError } = await supabase
        .from("companies")
        .select("id, stripe_financial_account_id, stripe_account_id")
        .eq("id", run.company_id)
        .single();
    if (companyError || !company) return json({ error: "Company not found" }, 404);

    const financialAccountId = company.stripe_financial_account_id as string | undefined;
    const connectedAccountId = company.stripe_account_id as string | undefined;
    const now = Date.now();

    const { data: lines, error: lineErr } = await supabase
        .from("payroll_line_items")
        .select("employee_id, net_pay")
        .eq("payroll_run_id", body.payrollRunId)
        .eq("company_id", company.id);
    if (lineErr) throw new Error(lineErr.message);

    const disbursements = (lines || []).map((line) => ({
        employeeId: line.employee_id as string,
        netPayCents: Math.round(Number(line.net_pay || 0) * 100),
    }));

    const results: Array<{ employeeId: string; status: string; transferId?: string; heldUntil?: string; error?: string }> = [];

    for (const d of disbursements) {
        if (d.netPayCents <= 0) continue;
        const operationKey = `payroll:${body.payrollRunId}:employee:${d.employeeId}`;

        const { data: emp } = await supabase
            .from("employees")
            .select("stripe_pm_id, stripe_customer_id, bank_account_last4, name, email, bank_account_linked_at")
            .eq("id", d.employeeId)
            .eq("company_id", company.id)
            .single();

        if (!emp) {
            results.push({ employeeId: d.employeeId, status: "failed", error: "Employee not found" });
            continue;
        }

        const { data: existing } = await supabase
            .from("ach_transfers")
            .select("id, status, stripe_transfer_id, failure_message")
            .eq("operation_key", operationKey)
            .maybeSingle();

        if (existing && ["processing", "succeeded"].includes(existing.status)) {
            results.push({
                employeeId: d.employeeId,
                status: existing.status,
                transferId: existing.stripe_transfer_id || undefined,
                error: existing.failure_message || undefined,
            });
            continue;
        }

        let transferRowId = existing?.id as string | undefined;
        if (!transferRowId) {
            const { data: reserved, error: reserveError } = await supabase
                .from("ach_transfers")
                .insert({
                    company_id: company.id,
                    payroll_run_id: body.payrollRunId,
                    employee_id: d.employeeId,
                    operation_key: operationKey,
                    amount_cents: d.netPayCents,
                    status: "pending",
                })
                .select("id")
                .single();

            if (reserveError) {
                const { data: concurrent } = await supabase
                    .from("ach_transfers")
                    .select("id, status, stripe_transfer_id, failure_message")
                    .eq("operation_key", operationKey)
                    .single();
                if (!concurrent) throw new Error(reserveError.message);
                results.push({
                    employeeId: d.employeeId,
                    status: concurrent.status,
                    transferId: concurrent.stripe_transfer_id || undefined,
                    error: concurrent.failure_message || undefined,
                });
                continue;
            }
            transferRowId = reserved.id as string;
        }

        const linkedAt = emp?.bank_account_linked_at ? new Date(emp.bank_account_linked_at) : null;
        const holdUntil = linkedAt ? addBusinessDays(linkedAt, HOLD_BUSINESS_DAYS) : null;
        const inHoldWindow = holdUntil !== null && now < holdUntil.getTime();
        const heldUntil = inHoldWindow ? holdUntil!.toISOString() : undefined;

        if (inHoldWindow) {
            const { error: holdError } = await supabase.from("ach_transfers").update({
                status:         "held",
                failure_message: `New bank account ••••${emp?.bank_account_last4} is within the 3-business-day security hold. Funds will be released on ${holdUntil!.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`,
                updated_at:     new Date().toISOString(),
            }).eq("id", transferRowId);
            if (holdError) throw new Error(holdError.message);
            results.push({ employeeId: d.employeeId, status: "held", heldUntil });
            continue;
        }

        let stripeTransferId: string | undefined;
        let status = "processing";
        let failureMessage: string | null = null;

        if (emp?.stripe_pm_id && emp?.stripe_customer_id && financialAccountId && connectedAccountId) {
            try {
                const payment = await stripe.treasury.outboundPayments.create(
                    {
                        financial_account:          financialAccountId,
                        amount:                     d.netPayCents,
                        currency:                   "usd",
                        customer:                   emp.stripe_customer_id,
                        destination_payment_method: emp.stripe_pm_id,
                        description:                `GlidePay payroll — run ${body.payrollRunId}`,
                        statement_descriptor:       "PAYROLL",
                        metadata: {
                            company_id:     company.id,
                            employee_id:    d.employeeId,
                            payroll_run_id: body.payrollRunId,
                        },
                    },
                    {
                        stripeAccount: connectedAccountId,
                        idempotencyKey: operationKey,
                    },
                );
                stripeTransferId = payment.id;
            } catch (err) {
                status = "failed";
                failureMessage = (err as Error).message;
                console.warn(`[stripe-ach] OutboundPayment failed for ${d.employeeId}:`, failureMessage);
            }
        } else {
            status = "failed";
            failureMessage = !emp?.stripe_pm_id
                ? "Employee has no linked bank account"
                : !emp?.stripe_customer_id
                ? "Employee Stripe customer missing — re-link bank account"
                : "Company financial account not ready";
        }

        const { error: insertErr } = await supabase.from("ach_transfers").update({
            stripe_transfer_id: stripeTransferId ?? null,
            amount_cents:       d.netPayCents,
            status,
            failure_message:    failureMessage,
            updated_at:         new Date().toISOString(),
        }).eq("id", transferRowId);

        if (insertErr) throw new Error(`Update ach_transfers: ${insertErr.message}`);

        results.push({
            employeeId: d.employeeId,
            status,
            transferId: stripeTransferId,
            error: failureMessage || undefined,
        });
    }

    return json({ results });
}

async function handleReleaseHeld(userId: string) {
    const { data: memberships, error: membershipError } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", userId)
        .in("role", ["owner", "admin"]);
    if (membershipError) throw new Error(membershipError.message);
    if (!memberships?.length) return json({ results: [] });

    const companyIds = memberships.map((membership) => membership.company_id);
    const { data: held, error: heldError } = await supabase
        .from("ach_transfers")
        .select("payroll_run_id")
        .in("company_id", companyIds)
        .eq("status", "held")
        .not("payroll_run_id", "is", null);
    if (heldError) throw new Error(heldError.message);

    const runIds = [...new Set((held || []).map((row) => row.payroll_run_id as string))];
    const released = [];
    for (const payrollRunId of runIds) {
        const response = await handleDisburse(userId, { payrollRunId });
        const payload = await response.json();
        released.push({ payrollRunId, ...payload });
    }
    return json({ results: released });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function addBusinessDays(start: Date, days: number): Date {
    const result = new Date(start);
    let remaining = days;
    while (remaining > 0) {
        result.setUTCDate(result.getUTCDate() + 1);
        const day = result.getUTCDay();
        if (day !== 0 && day !== 6) remaining -= 1;
    }
    return result;
}

async function ensureEmployeeCustomer(
    emp: { id: string; name?: string | null; email?: string | null; stripe_customer_id?: string | null },
    connectedAccountId: string,
): Promise<string> {
    if (emp.stripe_customer_id) {
        try {
            await stripe.customers.retrieve(
                emp.stripe_customer_id,
                {},
                { stripeAccount: connectedAccountId },
            );
            return emp.stripe_customer_id;
        } catch {
            // Recreate if missing on the connected account
        }
    }

    const customer = await stripe.customers.create(
        {
            name:  emp.name || undefined,
            email: emp.email || undefined,
            metadata: { employee_id: emp.id },
        },
        {
            stripeAccount: connectedAccountId,
            idempotencyKey: `employee-customer:${emp.id}`,
        },
    );

    await supabase.from("employees").update({
        stripe_customer_id: customer.id,
    }).eq("id", emp.id);

    return customer.id;
}

/**
 * Resolve the company for a user.
 * Users can belong to multiple companies (e.g. old sandbox + current employer);
 * `.single()` fails in that case — prefer the company tied to employeeId / portal link.
 */
async function getCompany(userId: string, opts: { employeeId?: string } = {}) {
    const userRes = await supabase.auth.admin.getUserById(userId);
    const adminEmail = userRes.data?.user?.email ?? null;

    let preferredCompanyId: string | null = null;

    if (opts.employeeId) {
        const { data: emp } = await supabase
            .from("employees")
            .select("company_id, user_id")
            .eq("id", opts.employeeId)
            .maybeSingle();
        if (emp?.company_id) preferredCompanyId = emp.company_id as string;
    }

    if (!preferredCompanyId) {
        const { data: selfEmp } = await supabase
            .from("employees")
            .select("company_id")
            .eq("user_id", userId)
            .eq("is_active", true)
            .maybeSingle();
        if (selfEmp?.company_id) preferredCompanyId = selfEmp.company_id as string;
    }

    const { data: memberships, error } = await supabase
        .from("company_users")
        .select("company_id, role, companies(*)")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

    if (error) throw new Error(`Company lookup failed: ${error.message}`);

    const rows = memberships || [];
    let chosen = preferredCompanyId
        ? rows.find((r) => r.company_id === preferredCompanyId)
        : null;

    // Fallbacks: Stripe-ready company, then newest membership.
    if (!chosen) {
        chosen = rows.find((r) => !!(r.companies as any)?.stripe_account_id) || rows[0] || null;
    }

    // Employee portal user with no company_users row — resolve via employees → companies.
    if (!chosen && preferredCompanyId) {
        const { data: company } = await supabase
            .from("companies")
            .select("*")
            .eq("id", preferredCompanyId)
            .single();
        if (company) {
            return {
                id: company.id,
                admin_email: adminEmail,
                _membershipRole: "employee",
                ...company,
            };
        }
    }

    if (!chosen?.companies) throw new Error("Company not found for user");

    return {
        id:          chosen.company_id,
        admin_email: adminEmail,
        _membershipRole: (chosen.role as string) || "member",
        ...(chosen.companies as unknown as Record<string, unknown>),
    };
}

async function sendEmail(opts: { to: string; subject: string; html: string }) {
    if (!RESEND_API_KEY) return;
    const resp = await fetch("https://api.resend.com/emails", {
        method:  "POST",
        headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type":  "application/json",
        },
        body: JSON.stringify({
            from:    PLATFORM_FROM,
            to:      opts.to,
            subject: opts.subject,
            html:    opts.html,
        }),
    });
    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Resend API error: ${err}`);
    }
}

function json(data: object, status = 200, corsHeaders?: Record<string, string>) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...(corsHeaders || getCorsHeaders()), "Content-Type": "application/json" },
    });
}

function ok(corsHeaders?: Record<string, string>) {
    return new Response("ok", { headers: corsHeaders || getCorsHeaders() });
}
