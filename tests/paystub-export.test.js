const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const { generatePayStubHTML, generateW2SummaryHTML } = require(join(root, "efile-exports.js"));

test("generatePayStubHTML creates full-featured printable pay stub", () => {
    const html = generatePayStubHTML({
        company: { name: "Acme Payroll Inc", ein: "12-3456789" },
        employee: { name: "Jane Doe", role: "Engineer", classification: "w2", type: "salaried", rate: 100000, state: "CA", bankLast4: "4321" },
        run: { periodStart: "2026-05-01", periodEnd: "2026-05-15", date: "2026-05-15" },
        details: {
            grossPay: 3846.15,
            rate: 100000,
            preTaxDeductions: 200,
            postTaxDeductions: 50,
            reimbursement: 25,
            taxes: {
                federalIncomeTax: 350.00,
                socialSecurity: 238.46,
                medicare: 55.77,
                stateIncomeTax: 120.00,
            },
            netPay: 2887.38,
        },
        ytd: {
            gross: 38461.50,
            fit: 3500.00,
            ss: 2384.60,
            med: 557.70,
            sit: 1200.00,
        },
    });

    assert.match(html, /Acme Payroll Inc/);
    assert.match(html, /12-3456789/);
    assert.match(html, /Jane Doe/);
    assert.match(html, /4321/);
    assert.match(html, /Federal Income Tax \(FIT\)/);
    assert.match(html, /Social Security/);
    assert.match(html, /Medicare/);
    assert.match(html, /State Income Tax/);
    assert.match(html, /NET TAKE-HOME PAY/);
    assert.match(html, /2,887\.38/);
    assert.match(html, /38,461\.50/);
});

test("generateW2SummaryHTML creates 6-box tax statement layout", () => {
    const html = generateW2SummaryHTML(
        { name: "John Smith", state: "NY", bankLast4: "9876" },
        { box1: 50000, box2: 6000, box3: 50000, box4: 3100, box5: 50000, box6: 725, def: 2500, box17: 2100 },
        { name: "Tech Corp", ein: "98-7654321" },
        2026,
    );

    assert.match(html, /Form W-2 Wage & Tax Statement/);
    assert.match(html, /John Smith/);
    assert.match(html, /Tech Corp/);
    assert.match(html, /\$50,000\.00/);
    assert.match(html, /\$6,000\.00/);
    assert.match(html, /\$3,100\.00/);
});

test("PWA manifest.json is valid and contains required standalone properties", () => {
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    assert.equal(manifest.name, "GlidePay — Enterprise Payroll & Compliance");
    assert.equal(manifest.short_name, "GlidePay");
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.theme_color, "#0284c7");
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
});

test("Service worker sw.js caches application shell assets", () => {
    const swSource = readFileSync(join(root, "sw.js"), "utf8");
    assert.match(swSource, /CACHE_NAME/);
    assert.match(swSource, /STATIC_ASSETS/);
    assert.match(swSource, /caches\.open/);
    assert.match(swSource, /caches\.match/);
});
