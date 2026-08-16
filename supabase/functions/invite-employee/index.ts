/**
 * GlidePay — Invite Employee to Portal
 *
 * Deploy:
 *   supabase functions deploy invite-employee
 *
 * Actions:
 *   invite  — Create/invite Auth user for an employee, link employees.user_id,
 *             and ensure a company_users row with role "employee".
 *   status  — Return portal-link status for one employee.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import { enforceUserRateLimit, errorResponse, getCorsHeaders, getPlatformUrl, readJsonObject, RequestError, requireUuid } from "../_shared/security.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLATFORM_URL         = getPlatformUrl();
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY") ?? "";
const PLATFORM_FROM_EMAIL  = Deno.env.get("PLATFORM_FROM_EMAIL") ?? "payroll@glidepay.org";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

serve(async (req: Request) => {
    const CORS = getCorsHeaders(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, CORS);

    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const { data: { user }, error: authErr } = await admin.auth.getUser(jwt);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    let body: any;
    try {
        body = await readJsonObject(req, 16_384);
        const requestedAction = String(body.action || "invite");
        if (!["invite","status"].includes(requestedAction)) throw new RequestError("Unknown action", 400);
        await enforceUserRateLimit(admin, user.id, `invite-employee:${requestedAction}`, 10);
        if (body.employeeId !== undefined) body.employeeId = requireUuid(body.employeeId, "employeeId");
    } catch (err) { return errorResponse(err, CORS, "invite-employee"); }
    const action = (body.action as string) || "invite";

    try {
        switch (action) {
            case "invite": return await handleInvite(user.id, body);
            case "status": return await handleStatus(user.id, body);
            default:       return json({ error: `Unknown action: ${action}` }, 400);
        }
    } catch (err) {
        return errorResponse(err, CORS, `invite-employee:${action}`);
    }
});

async function assertAdminCompany(userId: string, companyId: string) {
    const { data: membership } = await admin
        .from("company_users")
        .select("company_id")
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .in("role", ["owner", "admin", "accountant"])
        .maybeSingle();

    if (!membership) throw new Error("Only company admins can invite employees.");
    return membership.company_id as string;
}

async function getEmployee(employeeId: string) {
    const { data, error } = await admin
        .from("employees")
        .select("id, name, email, user_id, company_id, is_active")
        .eq("id", employeeId)
        .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || data.is_active === false) throw new Error("Employee not found.");
    if (!data.email) throw new Error("Employee needs an email address before invite.");
    return data;
}

async function handleStatus(userId: string, body: { employeeId?: string }) {
    if (!body.employeeId) return json({ error: "employeeId required" }, 400);
    const emp = await getEmployee(body.employeeId);
    await assertAdminCompany(userId, emp.company_id);
    return json({
        employeeId: emp.id,
        email: emp.email,
        linked: !!emp.user_id,
        userId: emp.user_id,
    });
}

async function handleInvite(userId: string, body: { employeeId?: string }) {
    if (!body.employeeId) return json({ error: "employeeId required" }, 400);
    const emp = await getEmployee(body.employeeId);
    const companyId = await assertAdminCompany(userId, emp.company_id);
    const email = String(emp.email).trim().toLowerCase();
    const redirectTo = PLATFORM_URL;

    let authUserId = emp.user_id as string | null;
    let inviteLink: string | null = null;
    let mode: "invited" | "linked_existing" | "reinvited" = "invited";

    if (authUserId) {
        // Already linked — send a fresh magic link / recovery link
        const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
            type: "magiclink",
            email,
            options: { redirectTo },
        });
        if (linkErr) throw new Error(linkErr.message);
        inviteLink = linkData?.properties?.action_link ?? null;
        mode = "reinvited";
    } else {
        // Try invite (creates user + emails via Supabase Auth)
        const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
            redirectTo,
            data: {
                full_name: emp.name,
                company_id: companyId,
                employee_id: emp.id,
                role: "employee",
            },
        });

        if (!inviteErr && invited?.user?.id) {
            authUserId = invited.user.id;
            mode = "invited";
            // Also generate a link admins can copy if email delivery is flaky
            const { data: linkData } = await admin.auth.admin.generateLink({
                type: "invite",
                email,
                options: { redirectTo },
            });
            inviteLink = linkData?.properties?.action_link ?? null;
        } else {
            const msg = (inviteErr?.message || "").toLowerCase();
            const already = msg.includes("already") || msg.includes("registered") || msg.includes("exists");
            if (!already) throw new Error(inviteErr?.message || "Invite failed");

            // Existing Auth user — link + magic link
            const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
                type: "magiclink",
                email,
                options: { redirectTo },
            });
            if (linkErr) throw new Error(linkErr.message);
            authUserId = linkData?.user?.id ?? null;
            inviteLink = linkData?.properties?.action_link ?? null;
            mode = "linked_existing";
            if (!authUserId) throw new Error("Could not resolve existing Auth user for this email.");
        }
    }

    // Link employee ↔ auth user
    const { error: linkEmpErr } = await admin
        .from("employees")
        .update({ user_id: authUserId, updated_at: new Date().toISOString() })
        .eq("id", emp.id);
    if (linkEmpErr) throw new Error(linkEmpErr.message);

    // Membership enables member-scoped reads; the employee role has no admin privileges.
    const { data: existingMember } = await admin
        .from("company_users")
        .select("id, role")
        .eq("company_id", companyId)
        .eq("user_id", authUserId)
        .maybeSingle();

    if (!existingMember) {
        const { error: memErr } = await admin.from("company_users").insert({
            company_id: companyId,
            user_id: authUserId,
            role: "employee",
        });
        if (memErr) throw new Error(memErr.message);
    } else if (["owner", "admin", "accountant"].includes(existingMember.role)) {
        // Don't downgrade admins who also have an employee row
    }

    await admin.from("audit_log").insert({
        company_id:  companyId,
        actor_id:    userId,
        actor_label: "Admin",
        action:      "Employee Portal Invite",
        details:     `Invited ${emp.name} (${email}) — ${mode}`,
        category:    "employee",
    });

    // Optional Resend copy (Supabase also emails on inviteUserByEmail)
    if (RESEND_API_KEY && inviteLink) {
        await sendInviteEmail(email, emp.name, inviteLink).catch((e) =>
            console.warn("[invite-employee] Resend skipped:", e.message)
        );
    }

    return json({
        ok: true,
        mode,
        employeeId: emp.id,
        email,
        userId: authUserId,
        inviteLink,
        portalUrl: PLATFORM_URL,
        message: mode === "invited"
            ? "Invite sent. Employee can set a password from the email link, then sign in on the Employee tab."
            : mode === "reinvited"
            ? "Portal already linked — a fresh sign-in link was generated."
            : "Existing account linked to this employee. Share the sign-in link if they need it.",
    });
}

async function sendInviteEmail(to: string, name: string, link: string) {
    const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            from: PLATFORM_FROM_EMAIL,
            to: [to],
            subject: "You're invited to the GlidePay Employee Portal",
            html: `
              <p>Hi ${escapeHtml(name)},</p>
              <p>Your employer invited you to the GlidePay Employee Portal to view pay stubs, log time, and manage direct deposit.</p>
              <p><a href="${link}">Accept invite / sign in</a></p>
              <p style="color:#6b7280;font-size:12px;">Or open <a href="${PLATFORM_URL}">${PLATFORM_URL}</a> and use the Employee tab after setting your password.</p>
            `,
        }),
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Resend ${resp.status}: ${text.slice(0, 200)}`);
    }
}

function escapeHtml(s: string) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function json(data: object, status = 200, corsHeaders?: Record<string, string>) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...(corsHeaders || getCorsHeaders()), "Content-Type": "application/json" },
    });
}
