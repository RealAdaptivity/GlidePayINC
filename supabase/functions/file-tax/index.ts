/**
 * GlidePay — Tax E-File Edge Function
 * supabase/functions/file-tax/index.ts
 *
 * Deploy:
 *   supabase functions deploy file-tax
 *
 * Providers (checked in order):
 *   1. TaxBandit — when TAXBANDIT_CLIENT_ID / SECRET / USER_TOKEN are set
 *   2. Generic REST — when EFILE_API_URL + EFILE_API_KEY are set
 *
 * TaxBandit sandbox secrets:
 *   TAXBANDIT_CLIENT_ID
 *   TAXBANDIT_CLIENT_SECRET
 *   TAXBANDIT_USER_TOKEN
 *   TAXBANDIT_AUTH_URL   (optional, default testoauth)
 *   TAXBANDIT_API_BASE   (optional, default testapi v1.7.3)
 *   EFILE_PROVIDER       (optional display name, default "TaxBandit")
 *
 * Actions: submit | get_status | list
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import { enforceUserRateLimit, errorResponse, getCorsHeaders, getPlatformUrl, readJsonObject, RequestError, requireUuid } from "../_shared/security.ts";

const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const EFILE_API_URL  = Deno.env.get("EFILE_API_URL")  ?? "";
const EFILE_API_KEY  = Deno.env.get("EFILE_API_KEY")  ?? "";
const EFILE_PROVIDER = Deno.env.get("EFILE_PROVIDER") ?? "";

const TB_CLIENT_ID     = Deno.env.get("TAXBANDIT_CLIENT_ID")     ?? "";
const TB_CLIENT_SECRET = Deno.env.get("TAXBANDIT_CLIENT_SECRET") ?? "";
const TB_USER_TOKEN    = Deno.env.get("TAXBANDIT_USER_TOKEN")    ?? "";
const TB_AUTH_URL      = Deno.env.get("TAXBANDIT_AUTH_URL")
    ?? "https://testoauth.expressauth.net/v2/tbsauth";
const TB_API_BASE      = (Deno.env.get("TAXBANDIT_API_BASE")
    ?? "https://testapi.taxbandits.com/v1.7.3").replace(/\/$/, "");

const useTaxBandit = !!(TB_CLIENT_ID && TB_CLIENT_SECRET && TB_USER_TOKEN);
const useGeneric   = !!(EFILE_API_URL && EFILE_API_KEY);
const providerName = EFILE_PROVIDER
    || (useTaxBandit ? "TaxBandit" : "E-File Provider");

let cachedAccessToken: { token: string; exp: number } | null = null;

function normalizeStatus(raw: string | undefined): string {
    const s = (raw ?? "").toLowerCase();
    if (["accepted", "acknowledged", "ack", "complete", "completed", "success", "efile_success"].includes(s)) {
        return "accepted";
    }
    if (["rejected", "denied", "failed", "error", "efile_rejected"].includes(s)) return "rejected";
    if (["submitted", "transmitted", "pending", "processing", "queued", "received", "created", "under_process"].includes(s)) {
        return "submitted";
    }
    return "submitted";
}

serve(async (req: Request) => {
    const CORS = getCorsHeaders(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, CORS);

    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized" }, 401, CORS);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401, CORS);

    if (!useTaxBandit && !useGeneric) {
        return json({
            configured: false,
            provider: providerName,
            hint: "Set TAXBANDIT_CLIENT_ID, TAXBANDIT_CLIENT_SECRET, and TAXBANDIT_USER_TOKEN (sandbox) as Supabase secrets.",
        }, 200, CORS);
    }

    let body: any;
    try {
        body = await readJsonObject(req, 262_144);
        const requestedAction = String(body.action || "");
        if (!["submit","get_status","list","probe"].includes(requestedAction)) throw new RequestError("Unknown action", 400);
        await enforceUserRateLimit(supabase, user.id, `file-tax:${requestedAction}`, 10);
        if (body.submissionId !== undefined) body.submissionId = requireUuid(body.submissionId, "submissionId");
    } catch (err) { return errorResponse(err, CORS, "file-tax"); }
    const action = body.action as string;

    try {
        switch (action) {
            case "submit":     return await handleSubmit(user.id, body);
            case "get_status": return await handleGetStatus(user.id, body);
            case "list":       return await handleList(user.id);
            case "probe":      return await handleProbe(user.id, body);
            default:           return json({ error: `Unknown action: ${action}` }, 400);
        }
    } catch (err) {
        return errorResponse(err, CORS, `file-tax:${action}`);
    }
});

// ── Submit ──────────────────────────────────────────────────────────────────────
async function handleSubmit(userId: string, body: {
    formRef?: string; formType?: string; period?: string;
    agency?: string; amount?: number; formData?: Record<string, unknown>;
}) {
    const company = await getCompanyForUser(userId);

    if (!body.formRef || !body.formType) {
        return json({ error: "formRef and formType are required" }, 400);
    }
    const formRef = String(body.formRef).trim();
    const formType = String(body.formType).trim();
    const period = String(body.period ?? "").trim();
    const agency = String(body.agency ?? "").trim();
    const amount = Number(body.amount ?? 0);
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._\-/]{0,99}$/.test(formRef)) throw new RequestError("Invalid formRef", 400);
    if (formType.length < 1 || formType.length > 100) throw new RequestError("Invalid formType", 400);
    if (period.length > 50 || agency.length > 100) throw new RequestError("Invalid filing metadata", 400);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1000000000) throw new RequestError("Invalid filing amount", 400);

    const { data: row, error: upErr } = await supabase
        .from("tax_filing_submissions")
        .upsert({
            company_id:    company.id,
            form_ref:      formRef,
            form_type:     formType,
            period,
            agency,
            amount,
            provider:      providerName,
            status:        "submitting",
            status_detail: null,
            submitted_at:  new Date().toISOString(),
            updated_at:    new Date().toISOString(),
            filed_by:      userId,
        }, { onConflict: "company_id,form_ref" })
        .select()
        .single();

    if (upErr) throw new Error(upErr.message);

    let providerSubmissionId: string | null = null;
    let status = "submitted";
    let detail: string | null = null;

    try {
        const result = useTaxBandit
            ? await submitTaxBandit(company, body)
            : await submitGeneric(company, body);
        providerSubmissionId = result.submissionId;
        status = result.status;
        detail = result.detail;
    } catch (err) {
        status = "error";
        detail = (err as Error).message;
    }

    // Sandbox re-file of the same EIN+quarter → treat as already filed, not a hard failure.
    if (status === "error" && detail && /Duplicate Return/i.test(detail)) {
        status = "submitted";
        detail = `Already filed in TaxBandit for this EIN and quarter (${body.period}). Re-file skipped.`;
    }

    const { data: updated } = await supabase
        .from("tax_filing_submissions")
        .update({
            provider_submission_id: providerSubmissionId,
            status,
            status_detail: detail,
            updated_at:    new Date().toISOString(),
        })
        .eq("id", row.id)
        .select()
        .single();

    await supabase.from("audit_log").insert({
        company_id:  company.id,
        actor_label: "System",
        action:      status === "error" ? "Tax E-File Failed" : "Tax E-File Submitted",
        details:     `${body.formType} (${body.period}) — ${providerName}` +
                     (status === "error" ? `: ${detail}` : ` → ${status}`),
        category:    "payroll",
    });

    // Always 200 with a status field — HTTP 502 hid TaxBandit validation messages in the UI.
    return json({
        submissionId:         row.id,
        providerSubmissionId,
        status,
        statusDetail:         detail,
        submission:           updated ?? row,
    }, 200);
}

// ── Get Status ────────────────────────────────────────────────────────────────
async function handleGetStatus(userId: string, body: { submissionId?: string }) {
    const company = await getCompanyForUser(userId);
    if (!body.submissionId) return json({ error: "submissionId is required" }, 400);

    const { data: row, error } = await supabase
        .from("tax_filing_submissions")
        .select("*")
        .eq("id", body.submissionId)
        .eq("company_id", company.id)
        .single();

    if (error || !row) return json({ error: "Submission not found" }, 404);

    if (!row.provider_submission_id || row.status === "accepted" || row.status === "rejected") {
        return json({ status: row.status, statusDetail: row.status_detail, submission: row });
    }

    let status = row.status;
    let detail = row.status_detail;
    try {
        const polled = useTaxBandit
            ? await pollTaxBandit(row.form_type as string, row.provider_submission_id)
            : await pollGeneric(row.provider_submission_id);
        status = polled.status;
        detail = polled.detail ?? detail;
    } catch (err) {
        detail = (err as Error).message;
    }

    const { data: updated } = await supabase
        .from("tax_filing_submissions")
        .update({ status, status_detail: detail, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .select()
        .single();

    return json({ status, statusDetail: detail, submission: updated ?? row });
}

async function handleList(userId: string) {
    const company = await getCompanyForUser(userId);
    const { data } = await supabase
        .from("tax_filing_submissions")
        .select("*")
        .eq("company_id", company.id)
        .order("updated_at", { ascending: false });
    return json({ submissions: data ?? [], provider: providerName, configured: true });
}

/** Sandbox diagnostics — exercises TaxBandit auth + Business + Form941 Create/Transmit. */
async function handleProbe(userId: string, body: { formType?: string; period?: string }) {
    const company = await getCompanyForUser(userId);
    const steps: Record<string, unknown> = {
        apiBase: TB_API_BASE,
        authUrl: TB_AUTH_URL,
        company: { id: company.id, name: company.name, ein: company.ein },
    };

    try {
        const token = await getTaxBanditAccessToken();
        steps.auth = { ok: true, tokenPrefix: token.slice(0, 12) + "…" };
    } catch (err) {
        steps.auth = { ok: false, error: (err as Error).message };
        return json({ steps }, 200);
    }

    try {
        const createRaw = await tbFetch("Business/Create", {
            method: "POST",
            body: JSON.stringify(businessPayload(company)),
        });
        steps.businessCreate = {
            ok: true,
            businessId: createRaw.BusinessId,
            statusMessage: createRaw.StatusMessage,
            errors: createRaw.Errors,
        };
    } catch (err) {
        steps.businessCreate = { ok: false, error: (err as Error).message };
    }

    try {
        const list = await tbFetch(businessListQuery(), { method: "GET" });
        steps.businessList = {
            ok: true,
            count: ((list.Businesses || list.Business || []) as any[]).length,
            sample: ((list.Businesses || list.Business || []) as any[]).slice(0, 3),
        };
    } catch (err) {
        steps.businessList = { ok: false, error: (err as Error).message };
    }

    try {
        const bizId = await ensureTaxBanditBusiness(company);
        steps.business = { ok: true, businessId: bizId };
    } catch (err) {
        steps.business = { ok: false, error: (err as Error).message };
        // Continue — Form941 Create can embed full Business without BusinessId.
    }

    const formType = body.formType || "941";
    const period = body.period || "2025-Q3";
    const route = formRoute(formType);
    if (!route) return json({ steps, error: "unsupported form" }, 400);

    const { taxYr, qtr } = parsePeriod(period);
    const createBody = buildCreatePayload(formType, String((steps.business as any).businessId), company, taxYr, qtr, {
        amount: 1200,
        formData: { wagesAmt: 20000, fedIncomeTaxWHAmt: 2400, employeeCnt: 1 },
    });
    steps.createRequestKeys = Object.keys(createBody);

    try {
        const created = await tbFetch(route.create, {
            method: "POST",
            body: JSON.stringify(createBody),
        });
        const formBucket = (created.Form941Records || created.Form940Records ||
            created.FormW2Records || created.Form1099NECRecords) as any;
        const successRecs = formBucket?.SuccessRecords || [];
        const recordIds = successRecs.map((r: any) => r?.RecordId).filter(Boolean);
        const submissionId = created.SubmissionId || successRecs[0]?.SubmissionId || null;
        steps.create = {
            ok: true,
            statusCode: created.StatusCode,
            statusMessage: created.StatusMessage,
            submissionId,
            recordIds,
            errorRecords: formBucket?.ErrorRecords ?? created.Errors ?? null,
        };

        if (submissionId) {
            try {
                const transmitBody: Record<string, unknown> = { SubmissionId: submissionId };
                if (recordIds.length) transmitBody.RecordIds = recordIds;
                const tx = await tbFetch(route.transmit, {
                    method: "POST",
                    body: JSON.stringify(transmitBody),
                });
                steps.transmit = {
                    ok: true,
                    statusCode: tx.StatusCode,
                    statusMessage: tx.StatusMessage,
                    records: tx.Form941Records || tx.Form940Records || null,
                };
            } catch (err) {
                steps.transmit = { ok: false, error: (err as Error).message };
            }
        }
    } catch (err) {
        steps.create = { ok: false, error: (err as Error).message };
    }

    return json({ steps }, 200);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TaxBandit
// ═══════════════════════════════════════════════════════════════════════════════

async function getTaxBanditAccessToken(): Promise<string> {
    if (cachedAccessToken && cachedAccessToken.exp > Date.now() + 60_000) {
        return cachedAccessToken.token;
    }

    const jws = await createTaxBanditJws(TB_CLIENT_ID, TB_CLIENT_SECRET, TB_USER_TOKEN);
    const resp = await fetch(TB_AUTH_URL, {
        method:  "GET",
        headers: { "Authentication": jws, "Content-Type": "application/json" },
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.AccessToken) {
        throw new Error(
            data.StatusMessage || data.message ||
            `TaxBandit OAuth failed (${resp.status})`,
        );
    }

    // Access tokens are typically ~1 hour; refresh a few minutes early.
    cachedAccessToken = { token: data.AccessToken, exp: Date.now() + 50 * 60_000 };
    return data.AccessToken;
}

async function createTaxBanditJws(clientId: string, clientSecret: string, userToken: string): Promise<string> {
    const enc = new TextEncoder();
    const b64url = (input: string | ArrayBuffer) => {
        const bytes = typeof input === "string" ? enc.encode(input) : new Uint8Array(input);
        let bin = "";
        for (const b of bytes) bin += String.fromCharCode(b);
        return btoa(bin).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    };

    const header  = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = b64url(JSON.stringify({
        iss: clientId,
        sub: clientId,
        aud: userToken,
        iat: Math.floor(Date.now() / 1000),
    }));
    const signingInput = `${header}.${payload}`;

    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(clientSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(signingInput));
    return `${signingInput}.${b64url(sig)}`;
}

async function tbFetch(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const token = await getTaxBanditAccessToken();
    const url = path.startsWith("http") ? path : `${TB_API_BASE}/${path.replace(/^\//, "")}`;
    const resp = await fetch(url, {
        ...init,
        headers: {
            "Authorization": `Bearer ${token}`,
            "Accept":        "application/json",
            "Content-Type":  "application/json",
            ...(init.headers || {}),
        },
    });
    const text = await resp.text();
    let data: Record<string, unknown> = {};
    try { data = text ? JSON.parse(text) : {}; } catch {
        data = { StatusMessage: text.slice(0, 300) };
    }
    if (!resp.ok) {
        const msg = extractTbError(data) || `TaxBandit ${path} failed (HTTP ${resp.status})`;
        throw new Error(`${msg} [${path}]`);
    }
    // TaxBandit often returns 200 with StatusCode != 1 for validation errors
    const code = data.StatusCode ?? data.Status ?? data.statusCode;
    if (code != null && Number(code) !== 1 && Number(code) !== 200) {
        throw new Error(
            (extractTbError(data) || `TaxBandit StatusCode ${code}`) + ` [${path}]`,
        );
    }
    return data;
}

function formatErrorList(errors: unknown): string | null {
    if (!Array.isArray(errors) || !errors.length) return null;
    return errors.map((e: any) => {
        const id = e.Id || e.id || "";
        const name = e.Name || e.name || "";
        const msg = e.Message || e.message || JSON.stringify(e);
        return [id, name, msg].filter(Boolean).join(": ");
    }).join("; ");
}

function extractTbError(data: Record<string, unknown>): string | null {
    // Prefer structured Errors over generic StatusMessage ("Validation error has occurred").
    const topErrors = formatErrorList(data.Errors || data.errors || data.ErrorRecords);
    if (topErrors) return topErrors;

    const formRecords = (data.Form941Records || data.Form940Records || data.FormW2Records ||
        data.Form1099NECRecords) as Record<string, unknown> | undefined;
    const nestedErrors = formRecords?.ErrorRecords;
    if (Array.isArray(nestedErrors) && nestedErrors.length) {
        return nestedErrors.map((rec: any) => {
            return formatErrorList(rec.Errors) || rec.Message || JSON.stringify(rec);
        }).join(" | ");
    }

    if (typeof data.StatusMessage === "string" && data.StatusMessage) return data.StatusMessage;
    if (typeof data.message === "string" && data.message) return data.message;
    if (typeof data.ErrorMessage === "string" && data.ErrorMessage) return data.ErrorMessage;
    return null;
}

function digitsOnly(value: unknown, fallback = ""): string {
    return String(value ?? "").replace(/\D/g, "") || fallback;
}

function formatEin(company: Record<string, any>): string {
    const ein = digitsOnly(company.ein, "000000000").slice(0, 9);
    return ein.length === 9 ? `${ein.slice(0, 2)}-${ein.slice(2)}` : ein;
}

function businessPayload(company: Record<string, any>) {
    const phone = digitsOnly(company.phone, "3025550100").slice(0, 10);
    return {
        BusinessNm:         company.name || "GlidePay Company",
        PayerRef:           String(company.id).slice(0, 50),
        IsDefaultBusiness:  true,
        IsEIN:              true,
        EINorSSN:           formatEin(company),
        Email:              company.ownerEmail || "owner@glidepay.org",
        ContactNm:          String(company.name || "Owner").slice(0, 27),
        Phone:              phone,
        IsForeign:          false,
        IsBusinessTerminated: false,
        BusinessType:       "ESTE",
        KindOfEmployer:     "NONEAPPLY",
        KindOfPayer:        "REGULAR941",
        SigningAuthority: {
            Name:               "Authorized Signer",
            Phone:              phone,
            BusinessMemberType: "ADMINISTRATOR",
        },
        USAddress: {
            Address1: "1 Main St",
            City:     "Wilmington",
            State:    "DE",
            ZipCd:    "19801",
        },
    };
}

function businessListQuery(): string {
    // TaxBandit requires FromDate/ToDate (MM/DD/YYYY) on Business/List.
    // Keep slashes unencoded — their samples use FromDate=08/01/2024.
    const to = new Date();
    const from = new Date(to.getFullYear() - 2, to.getMonth(), to.getDate());
    const fmt = (d: Date) =>
        `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
    // Wide window — sandbox businesses may predate the company row.
    return `Business/List?Page=1&PageSize=100&FromDate=01/01/2020&ToDate=${fmt(to)}`;
}

async function ensureTaxBanditBusiness(company: Record<string, any>): Promise<string> {
    const payerRef = String(company.id).slice(0, 50);
    const ein = formatEin(company);

    // Resolve existing business first (Create returns Duplicate EIN once it exists).
    for (const path of [
        `Business/Get?TIN=${ein}`,
        `Business/Get?PayerRef=${payerRef}`,
        `Business/Get?TIN=${digitsOnly(company.ein)}`,
    ]) {
        try {
            const got = await tbFetch(path, { method: "GET" });
            const nested = (got as any).Business || {};
            const id = (got.BusinessId || nested.BusinessId) as string | undefined;
            if (id) return String(id);
        } catch {
            // try next lookup
        }
    }

    try {
        const created = await tbFetch("Business/Create", {
            method: "POST",
            body:   JSON.stringify(businessPayload(company)),
        });
        const id = (created.BusinessId || (created as any).businessId) as string | undefined;
        if (id) return String(id);
    } catch (err) {
        console.warn("[file-tax] Business/Create:", (err as Error).message);
    }

    try {
        const list = await tbFetch(businessListQuery(), { method: "GET" });
        const rows = (list.Businesses || list.Business || list.businesses || list.BusinessList || []) as any[];
        const einDigits = digitsOnly(company.ein);
        const match = rows.find((b) =>
            String(b.PayerRef || "") === company.id ||
            String(b.EINorSSN || "").replace(/\D/g, "") === einDigits ||
            String(b.BusinessNm || "") === company.name,
        );
        if (match?.BusinessId) return String(match.BusinessId);
    } catch (err) {
        console.warn("[file-tax] Business/List:", (err as Error).message);
    }

    // Form941 Create accepts a full Business object without BusinessId.
    return "";
}

function parsePeriod(period: string | undefined): { taxYr: string; qtr: string } {
    const now = new Date();
    const fallbackYr = String(now.getFullYear());
    const fallbackQ  = `Q${Math.floor(now.getMonth() / 3) + 1}`;
    if (!period) return { taxYr: fallbackYr, qtr: fallbackQ };

    const qMatch = period.match(/Q([1-4])/i);
    const yMatch = period.match(/(20\d{2})/);
    return {
        taxYr: yMatch ? yMatch[1] : fallbackYr,
        qtr:   qMatch ? `Q${qMatch[1]}` : fallbackQ,
    };
}

function formRoute(formType: string): { create: string; transmit: string; status: string } | null {
    const t = formType.toLowerCase();
    if (t.includes("941")) {
        return { create: "Form941/Create", transmit: "Form941/Transmit", status: "Form941/Status" };
    }
    if (t.includes("940")) {
        return { create: "Form940/Create", transmit: "Form940/Transmit", status: "Form940/Status" };
    }
    if (t.includes("w-2") || t.includes("w2") || t.includes("w-3")) {
        return { create: "FormW2/Create", transmit: "FormW2/Transmit", status: "FormW2/Status" };
    }
    if (t.includes("1099")) {
        return { create: "Form1099NEC/Create", transmit: "Form1099NEC/Transmit", status: "Form1099NEC/Status" };
    }
    return null;
}

async function submitTaxBandit(
    company: Record<string, any>,
    body: { formType?: string; period?: string; amount?: number; formData?: Record<string, unknown> },
): Promise<{ submissionId: string | null; status: string; detail: string | null }> {
    const route = formRoute(body.formType || "");
    if (!route) {
        throw new Error(`Unsupported form type for TaxBandit: ${body.formType}`);
    }

    const businessId = await ensureTaxBanditBusiness(company);
    const { taxYr, qtr } = parsePeriod(body.period);
    const createBody = buildCreatePayload(body.formType || "", businessId, company, taxYr, qtr, body);

    const created = await tbFetch(route.create, {
        method: "POST",
        body:   JSON.stringify(createBody),
    });

    const formBucket = (created.Form941Records || created.Form940Records ||
        created.FormW2Records || created.Form1099NECRecords) as any;
    const successRecs = (formBucket?.SuccessRecords || []) as any[];
    const successRec = successRecs[0];
    const recordIds = successRecs
        .map((r) => r?.RecordId)
        .filter(Boolean)
        .map(String);

    const submissionId = String(
        created.SubmissionId ||
        created.submissionId ||
        (created as any).SubmissionManifest?.SubmissionId ||
        successRec?.SubmissionId ||
        "",
    ) || null;

    if (!submissionId) {
        return {
            submissionId: null,
            status: "error",
            detail: extractTbError(created) || "TaxBandit Create returned no SubmissionId",
        };
    }

    // Transmit to IRS/SSA simulation in sandbox (requires RecordIds per TaxBandit docs)
    try {
        const transmitBody: Record<string, unknown> = { SubmissionId: submissionId };
        if (recordIds.length) transmitBody.RecordIds = recordIds;

        await tbFetch(route.transmit, {
            method: "POST",
            body:   JSON.stringify(transmitBody),
        });
        return {
            submissionId,
            status: "submitted",
            detail: `Created & transmitted via TaxBandit (${taxYr} ${qtr})`,
        };
    } catch (err) {
        // Create succeeded; transmit may need signature / more data — keep for retry/status
        return {
            submissionId,
            status: "submitted",
            detail: `Created in TaxBandit; transmit pending: ${(err as Error).message}`,
        };
    }
}

function buildCreatePayload(
    formType: string,
    businessId: string,
    company: Record<string, any>,
    taxYr: string,
    qtr: string,
    body: { amount?: number; formData?: Record<string, unknown> },
): Record<string, unknown> {
    const t = formType.toLowerCase();
    const fd = body.formData || {};
    const wages = Number(fd.wagesAmt ?? fd.grossPayroll ?? body.amount ?? 0);
    const fit   = Number(fd.fedIncomeTaxWHAmt ?? fd.federalWithheld ?? wages * 0.12);
    const empCnt = Number(fd.employeeCnt ?? fd.employeeCount ?? 1);

    if (t.includes("941")) {
        const ssWages = Number(fd.ssWages ?? wages);
        const medWages = Number(fd.medicareWages ?? wages);
        const ssTax = Math.round(ssWages * 0.124 * 100) / 100;
        const medTax = Math.round(medWages * 0.029 * 100) / 100;
        const totalTax = Math.round((fit + ssTax + medTax) * 100) / 100;
        const biz = businessPayload(company);
        // IRS: under $2,500 → MINTAXLIABILITY; otherwise MONTHLY (split across 3 months).
        const isMinLiability = totalTax < 2500;
        const monthShare = Math.round((totalTax / 3) * 100) / 100;
        const month3 = Math.round((totalTax - monthShare * 2) * 100) / 100;
        const depositSchedule = isMinLiability
            ? {
                DepositorType: "MINTAXLIABILITY",
                TotalQuarterTaxLiabilityAmt: totalTax,
            }
            : {
                DepositorType: "MONTHLY",
                MonthlyDepositor: {
                    TaxLiabilityMonth1: monthShare,
                    TaxLiabilityMonth2: monthShare,
                    TaxLiabilityMonth3: month3,
                },
                TotalQuarterTaxLiabilityAmt: totalTax,
            };
        return {
            Form941Records: [{
                SequenceId: "001",
                ReturnHeader: {
                    ReturnType: "FORM941",
                    TaxYr: taxYr,
                    Qtr:   qtr,
                    Business: {
                        ...(businessId ? { BusinessId: businessId } : {}),
                        BusinessNm: biz.BusinessNm,
                        PayerRef:   biz.PayerRef,
                        IsEIN:      true,
                        EINorSSN:   biz.EINorSSN,
                        Email:      biz.Email,
                        ContactNm:  biz.ContactNm,
                        Phone:      biz.Phone,
                        BusinessType: biz.BusinessType,
                        SigningAuthority: biz.SigningAuthority,
                        KindOfEmployer: biz.KindOfEmployer,
                        KindOfPayer: biz.KindOfPayer,
                        IsBusinessTerminated: false,
                        IsForeign: false,
                        USAddress: biz.USAddress,
                    },
                    BusinessStatusDetails: {
                        IsBusinessClosed: false,
                        IsBusinessTransferred: false,
                        IsSeasonalEmployer: false,
                    },
                    IsThirdPartyDesignee: false,
                    SignatureDetails: {
                        // 10-digit IRS Online Signature PIN — enables Transmit without Form 8453 EMP PDF upload.
                        SignatureType: "ONLINE_SIGN_PIN",
                        OnlineSignaturePIN: { PIN: "1234567890" },
                    },
                },
                ReturnData: {
                    Form941: {
                        EmployeeCnt: empCnt,
                        WagesAmt: wages,
                        FedIncomeTaxWHAmt: fit,
                        WagesNotSubjToSSMedcrTaxInd: false,
                        SocialSecurityTaxCashWagesAmt_Col1: ssWages,
                        TaxableSocSecTipsAmt_Col1: 0,
                        TaxableMedicareWagesTipsAmt_Col1: medWages,
                        TxblWageTipsSubjAddnlMedcrAmt_Col1: 0,
                        SocialSecurityTaxAmt_Col2: ssTax,
                        TaxOnSocialSecurityTipsAmt_Col2: 0,
                        TaxOnMedicareWagesTipsAmt_Col2: medTax,
                        TaxOnWageTipsSubjAddnlMedcrAmt_Col2: 0,
                        TotSSMdcrTaxAmt: Math.round((ssTax + medTax) * 100) / 100,
                        TaxOnUnreportedTips3121qAmt: 0,
                        TotalTaxBeforeAdjustmentAmt: totalTax,
                        CurrentQtrFractionsCentsAmt: 0,
                        CurrentQuarterSickPaymentAmt: 0,
                        CurrQtrTipGrpTermLifeInsAdjAmt: 0,
                        TotalTaxAfterAdjustmentAmt: totalTax,
                        PayrollTaxCreditAmt: 0,
                        IsPayrollTaxCredit: false,
                        TotTaxAfterAdjustmentAndNonRfdCr: totalTax,
                        TotTaxDepositAmt: totalTax,
                        BalanceDueAmt: 0,
                        OverpaidAmt: 0,
                    },
                    IRSPaymentType: "EFTPS",
                    DepositScheduleType: depositSchedule,
                },
            }],
        };
    }

    if (t.includes("940")) {
        return {
            Form940Records: [{
                SequenceId: "001",
                ReturnHeader: {
                    TaxYr: taxYr,
                    Business: { BusinessId: businessId },
                    SignatureDetails: {
                        SignatureType: "ONLINE_SIGN_PIN",
                        OnlineSignaturePIN: { PIN: "1234567890" },
                    },
                },
                ReturnData: {
                    Form940: {
                        WagesAmt: wages,
                        TaxableWagesAmt: wages,
                        FUTATaxBeforeAdjustmentAmt: Math.round(wages * 0.006 * 100) / 100,
                        TotalTaxAmt: Math.round(wages * 0.006 * 100) / 100,
                    },
                },
            }],
        };
    }

    if (t.includes("w-2") || t.includes("w2") || t.includes("w-3")) {
        const employees = (fd.employees as any[]) || [{
            firstName: "Test", lastName: "Employee", ssn: "000000000",
            wages, federalWithheld: fit,
        }];
        return {
            SubmissionManifest: {
                TaxYear: taxYr,
                IsFederalFiling: true,
                IsStateFiling: false,
                IsPostal: false,
                IsOnlineAccess: false,
            },
            ReturnHeader: { Business: { BusinessId: businessId } },
            ReturnData: employees.map((e, i) => ({
                SequenceId: String(i + 1),
                Employee: {
                    FirstNm: e.firstName || e.FirstNm || "Test",
                    LastNm:  e.lastName  || e.LastNm  || "Employee",
                    SSN:     String(e.ssn || e.SSN || "000000000").replace(/\D/g, ""),
                },
                W2FormData: {
                    WagesAmt: Number(e.wages ?? wages),
                    FedIncomeTaxWHAmt: Number(e.federalWithheld ?? fit),
                    SocialSecurityWagesAmt: Number(e.wages ?? wages),
                    SocialSecurityTaxAmt: Math.round(Number(e.wages ?? wages) * 0.062 * 100) / 100,
                    MedicareWagesAmt: Number(e.wages ?? wages),
                    MedicareTaxAmt: Math.round(Number(e.wages ?? wages) * 0.0145 * 100) / 100,
                },
            })),
        };
    }

    // 1099-NEC
    const recipients = (fd.recipients as any[]) || [{
        firstName: "Test", lastName: "Contractor", tin: "000000000",
        amount: wages || Number(body.amount || 0),
    }];
    return {
        SubmissionManifest: {
            TaxYear: taxYr,
            IsFederalFiling: true,
            IsStateFiling: false,
            IsPostal: false,
            IsOnlineAccess: false,
        },
        ReturnHeader: { Business: { BusinessId: businessId } },
        ReturnData: recipients.map((r, i) => ({
            SequenceId: String(i + 1),
            Recipient: {
                FirstNm: r.firstName || r.FirstNm || "Test",
                LastNm:  r.lastName  || r.LastNm  || "Contractor",
                TIN:     String(r.tin || r.TIN || r.ssn || "000000000").replace(/\D/g, ""),
                IsTINValid: true,
            },
            NECFormData: {
                B1NEC: Number(r.amount ?? wages ?? body.amount ?? 0),
                Is2ndTINNotice: false,
            },
        })),
    };
}

async function pollTaxBandit(formType: string, submissionId: string) {
    const route = formRoute(formType);
    if (!route) return { status: "submitted", detail: null as string | null };

    const data = await tbFetch(`${route.status}?SubmissionId=${encodeURIComponent(submissionId)}`, {
        method: "GET",
    });

    const records = (data.Form941Records || data.Form940Records || data.FormW2Records ||
        data.Form1099NECRecords || data.Records || []) as any[];
    const rawStatus =
        data.Status ||
        data.FilingStatus ||
        records[0]?.Status ||
        records[0]?.FederalReturn?.Status ||
        "submitted";

    return {
        status: normalizeStatus(String(rawStatus)),
        detail: extractTbError(data) || String(rawStatus),
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Generic provider (legacy)
// ═══════════════════════════════════════════════════════════════════════════════

async function submitGeneric(
    company: Record<string, any>,
    body: { formType?: string; period?: string; agency?: string; amount?: number; formData?: Record<string, unknown>; formRef?: string },
) {
    const resp = await fetch(`${EFILE_API_URL.replace(/\/$/, "")}/filings`, {
        method:  "POST",
        headers: {
            "Authorization": `Bearer ${EFILE_API_KEY}`,
            "Content-Type":  "application/json",
        },
        body: JSON.stringify({
            form_type:   body.formType,
            tax_period:  body.period,
            agency:      body.agency,
            payer:       { name: company.name, ein: company.ein },
            amount:      body.amount ?? 0,
            form_data:   body.formData ?? {},
            external_id: `${company.id}:${body.formRef}`,
        }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        return {
            submissionId: null,
            status: "error",
            detail: data.error || data.message || `Provider returned ${resp.status}`,
        };
    }
    return {
        submissionId: data.id ?? data.submission_id ?? data.filing_id ?? null,
        status: normalizeStatus(data.status),
        detail: data.message ?? null,
    };
}

async function pollGeneric(providerSubmissionId: string) {
    const resp = await fetch(
        `${EFILE_API_URL.replace(/\/$/, "")}/filings/${providerSubmissionId}`,
        { headers: { "Authorization": `Bearer ${EFILE_API_KEY}` } },
    );
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return { status: "submitted", detail: null as string | null };
    return {
        status: normalizeStatus(data.status),
        detail: data.message ?? data.rejection_reason ?? null,
    };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getCompanyForUser(userId: string) {
    const { data, error } = await supabase
        .from("company_users")
        .select("company_id, role, created_at, companies(*)")
        .eq("user_id", userId)
        .in("role", ["owner", "admin", "accountant"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error || !data) {
        // Fallback: owner_id on companies
        const { data: owned, error: ownedErr } = await supabase
            .from("companies")
            .select("*")
            .eq("owner_id", userId)
            .maybeSingle();
        if (ownedErr || !owned) throw new Error("Company not found for user");
        const { data: authUser } = await supabase.auth.admin.getUserById(userId);
        return { ...owned, ownerEmail: authUser?.user?.email };
    }

    const company = { id: data.company_id, ...(data.companies as unknown as Record<string, unknown>) } as Record<string, any>;
    const { data: authUser } = await supabase.auth.admin.getUserById(userId);
    company.ownerEmail = authUser?.user?.email;
    return company;
}

function json(data: object, status = 200, corsHeaders?: Record<string, string>) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...(corsHeaders || getCorsHeaders()), "Content-Type": "application/json" },
    });
}
