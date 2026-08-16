/**
 * GlidePay — Environment Configuration
 *
 * Selects sandbox or live configuration from a strict hostname allowlist.
 * localhost / 127.0.0.1 / *.local URLs → sandbox.
 * Everything else (including previews) → live. If live keys/prices are still
 * placeholders, Checkout is disabled rather than falling back to sandbox.
 *
 * Browser URL parameters and local storage cannot override the environment.
 */

function resolveAeroEnvironment(hostname) {
    const SANDBOX_HOSTS = ["localhost", "127.0.0.1"];
    return SANDBOX_HOSTS.includes(hostname) || hostname.endsWith(".local")
        ? "sandbox"
        : "live";
}

function isAeroBillingConfigured(cfg) {
    return !!cfg.stripePublishableKey
        && !cfg.stripePublishableKey.includes("REPLACE")
        && !!cfg.priceBaseId
        && !cfg.priceBaseId.includes("REPLACE")
        && !!cfg.priceSeatId
        && !cfg.priceSeatId.includes("REPLACE");
}

// Use for every untrusted value interpolated into generated markup. Attribute
// escaping is intentionally the same strict encoding because templates use
// quoted attributes throughout the application.
function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
    return escapeHTML(value).replace(/`/g, "&#96;");
}

const AeroConfig = typeof location !== "undefined" ? (() => {

    // ── Sandbox (test-mode) config ────────────────────────────────────────────
    // GlidePay Test sandbox — acct_1TkoX1PRpbEk768f
    const SANDBOX = {
        stripePublishableKey: "pk_test_51TkoX1PRpbEk768feMSeb421QiukgyWZWnCZYDWWL2JfITA2u3avgXpxJg04QqKz30ahNJo1DUOKPfbMxNhCNx4V006xpYCW68",
        priceBaseId:          "price_1U4rgjPRpbEk768foydvNiUB",
        priceSeatId:          "price_1U4rgnPRpbEk768fM4vBzhV2",
        trialDays:            14,
        supabaseUrl:          "https://ojvnxnlrghatkwjrlnop.supabase.co",
        // Edge functions are the same URL; secrets on the Supabase side switch
        // between live and test keys via `supabase secrets set`.
        checkoutFunctionUrl:  "https://ojvnxnlrghatkwjrlnop.supabase.co/functions/v1/stripe-checkout",
        portalFunctionUrl:    "https://ojvnxnlrghatkwjrlnop.supabase.co/functions/v1/stripe-portal",
        achFunctionUrl:       "https://ojvnxnlrghatkwjrlnop.supabase.co/functions/v1/stripe-ach",
        connectFunctionUrl:   "https://ojvnxnlrghatkwjrlnop.supabase.co/functions/v1/stripe-connect",
        fileTaxFunctionUrl:   "https://ojvnxnlrghatkwjrlnop.supabase.co/functions/v1/file-tax",
        inviteEmployeeFunctionUrl: "https://ojvnxnlrghatkwjrlnop.supabase.co/functions/v1/invite-employee",
    };

    // ── Live config ───────────────────────────────────────────────────────────
    // Fresh Stripe account — fill via scripts/setup-stripe.sh after `stripe login`.
    // Do not reuse keys from a prior AeroPay account.
    const LIVE = {
        stripePublishableKey: "pk_live_REPLACE_WITH_FRESH_ACCOUNT_KEY",
        priceBaseId:          "price_REPLACE_WITH_LIVE_BASE_PRICE",
        priceSeatId:          "price_REPLACE_WITH_LIVE_SEAT_PRICE",
        trialDays:            14,
        supabaseUrl:          "https://ojvnxnlrghatkwjrlnop.supabase.co",
        checkoutFunctionUrl:  "https://ojvnxnlrghatkwjrlnop.supabase.co/functions/v1/stripe-checkout",
        portalFunctionUrl:    "https://ojvnxnlrghatkwjrlnop.supabase.co/functions/v1/stripe-portal",
        achFunctionUrl:       "https://ojvnxnlrghatkwjrlnop.supabase.co/functions/v1/stripe-ach",
        connectFunctionUrl:   "https://ojvnxnlrghatkwjrlnop.supabase.co/functions/v1/stripe-connect",
        fileTaxFunctionUrl:   "https://ojvnxnlrghatkwjrlnop.supabase.co/functions/v1/file-tax",
        inviteEmployeeFunctionUrl: "https://ojvnxnlrghatkwjrlnop.supabase.co/functions/v1/invite-employee",
    };

    const env = resolveAeroEnvironment(location.hostname);

    const cfg = env === "sandbox" ? SANDBOX : LIVE;

    if (env === "sandbox") {
        console.info(
            "%c[GlidePay] Running in SANDBOX mode — no real money will move.",
            "background:#f59e0b;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold;"
        );
    }

    const billingConfigured = isAeroBillingConfigured(cfg);
    if (!billingConfigured) {
        console.error(`[GlidePay] ${env} billing is not configured; checkout is disabled.`);
    }

    return { env, billingConfigured, ...cfg };
})() : null;

if (typeof module !== "undefined" && module.exports) {
    module.exports = { resolveAeroEnvironment, isAeroBillingConfigured, escapeHTML, escapeAttr };
}
