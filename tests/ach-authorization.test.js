const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");

test("NACHA ACH direct deposit authorization migration exists with strict RLS", () => {
    const migration = readFileSync(
        join(root, "supabase", "migrations", "20260816000000_ach_authorizations.sql"),
        "utf8",
    );
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.ach_authorizations/);
    assert.match(migration, /bank_account_last4 TEXT NOT NULL CHECK \(char_length\(bank_account_last4\) = 4\)/);
    assert.match(migration, /agreement_version TEXT NOT NULL/);
    assert.match(migration, /consent_text TEXT NOT NULL/);
    assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
    assert.match(migration, /ach_authorizations_admin_select/);
    assert.match(migration, /ach_authorizations_employee_select/);
    assert.match(migration, /idx_ach_authorizations_company_emp/);
});

test("AeroDB implements NACHA ACH authorization recording", () => {
    const source = readFileSync(join(root, "supabase.js"), "utf8");
    assert.match(source, /recordACHAuthorization/);
    assert.match(source, /getACHAuthorizations/);
    assert.match(source, /_sb\.from\('ach_authorizations'\)/);
});

test("bank linking flow records electronic ACH authorization consent", () => {
    const appSource = readFileSync(join(root, "app.js"), "utf8");
    assert.match(appSource, /recordACHAuthorization/);
    assert.match(appSource, /authorize GlidePay and my employer to initiate/);
});
