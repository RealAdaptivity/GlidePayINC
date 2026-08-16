/**
 * GlidePay — Free E-File Exporters
 *
 * Generates the electronic files that the *free* government systems accept, so
 * an employer can e-file without a paid provider:
 *   • W-2 / W-3  → SSA EFW2 fixed-width file, uploaded free at SSA Business
 *                  Services Online (BSO).  Spec: SSA Publication 42-007 (EFW2).
 *   • 1099-NEC   → IRS IRIS CSV, uploaded free at the IRIS Taxpayer Portal.
 *
 * These are pure functions over the app state — no network, no fees. The final
 * upload to BSO / IRIS is done by a human on the free portal.
 *
 * IMPORTANT — data prerequisites:
 *   A filable return requires employee SSN + home address and the employer
 *   address. The current data model does not store these, so the generators
 *   read them from optional fields when present (emp.ssn, emp.address, emp.city,
 *   emp.zip; company.address/city/state/zip) and otherwise emit blanks. Always
 *   run checkEfileReadiness() first, and validate an EFW2 file with SSA's free
 *   AccuWage tool before filing.
 */

// ── Field encoders ───────────────────────────────────────────────────────────
/** Alphanumeric: uppercased, left-justified, space-padded, fixed length. */
function _alpha(value, len) {
    return String(value ?? '')
        .toUpperCase()
        .replace(/[^A-Z0-9 &'\-\/.]/g, '')
        .padEnd(len, ' ')
        .slice(0, len);
}
/** Digits only, right-justified, zero-padded (SSN, EIN). */
function _digits(value, len) {
    return String(value ?? '').replace(/\D/g, '').padStart(len, '0').slice(-len);
}
/** Money → cents, right-justified, zero-padded, no decimal point. */
function _money(value, len = 11) {
    const cents = Math.max(0, Math.round((Number(value) || 0) * 100));
    return String(cents).padStart(len, '0').slice(-len);
}
/** Pad a record to the fixed EFW2 length (512). */
function _pad512(record) {
    return (record + ' '.repeat(512)).slice(0, 512);
}

function _splitName(fullName) {
    const parts = String(fullName || '').trim().split(/\s+/);
    const first = parts.shift() || '';
    const last  = parts.pop() || '';
    const middle = parts.join(' ');
    return { first, middle, last };
}

// ── Per-employee YTD aggregation (mirrors getW2HTML) ─────────────────────────
const _SS_WAGE_BASE = 176100;

function aggregateEmployeeYearTotals(state, employeeId) {
    const t = { gross: 0, fitWages: 0, ssWages: 0, medWages: 0, fit: 0, ss: 0, med: 0, sit: 0, retirement: 0 };
    (state.payrollHistory || []).forEach(run => {
        const d = run.details && run.details[employeeId];
        if (!d) return;
        t.gross     += d.grossPay || 0;
        t.fitWages  += (d.grossPay || 0) - (d.preTaxDeductions || 0);
        t.ssWages   += Math.min(d.grossPay || 0, _SS_WAGE_BASE);
        t.medWages  += d.grossPay || 0;
        t.fit       += d.taxes?.federalIncomeTax || 0;
        t.ss        += d.taxes?.socialSecurity || 0;
        t.med       += d.taxes?.medicare || 0;
        t.sit       += d.taxes?.stateIncomeTax || 0;
        t.retirement += d.deduction401k || 0;
    });
    return t;
}

// ── Readiness preflight ──────────────────────────────────────────────────────
/**
 * Inspect the data required for a free e-file and report what's missing.
 * type: 'w2' (W-2 employees) | 'nec' (1099 contractors)
 * Returns { ready, employerMissing:[], employees:[{id,name,missing:[]}] }
 */
function checkEfileReadiness(state, type = 'w2') {
    const s = state.settings || {};
    const employerMissing = [];
    if (!s.ein)                        employerMissing.push('Employer EIN');
    if (!s.companyName)                employerMissing.push('Employer name');
    if (!(s.address || s.companyAddress)) employerMissing.push('Employer address');
    if (!(s.city  || s.companyCity))   employerMissing.push('Employer city');
    if (!(s.zip   || s.companyZip))    employerMissing.push('Employer ZIP');

    const wantW2 = type === 'w2';
    const people = (state.employees || []).filter(e =>
        wantW2 ? e.classification !== '1099' : e.classification === '1099');

    const employees = people.map(e => {
        const missing = [];
        if (!e.ssn && !e.tin)  missing.push(wantW2 ? 'SSN' : 'SSN/TIN');
        if (!e.address)        missing.push('Street address');
        if (!e.city)           missing.push('City');
        if (!e.state)          missing.push('State');
        if (!e.zip)            missing.push('ZIP');
        return { id: e.id, name: e.name, missing };
    });

    const ready = employerMissing.length === 0 && employees.length > 0 &&
        employees.every(e => e.missing.length === 0);
    return { ready, employerMissing, employees, count: people.length };
}

// ── EFW2 (W-2) generator — SSA Pub 42-007 ────────────────────────────────────
/**
 * Build an EFW2 file (RA submitter, RE employer, RW employee, RT totals, RF
 * final). Money fields are cents, zero-filled, 11 wide; identity fields are
 * space-filled. Validate with SSA AccuWage before filing.
 */
function generateEFW2(state, year) {
    year = year || new Date().getFullYear();
    const s = state.settings || {};
    const ein = _digits(s.ein, 9);
    const addr  = s.address || s.companyAddress || '';
    const city  = s.city    || s.companyCity    || '';
    const st    = s.state   || s.companyState   || '';
    const zip   = _digits(s.zip || s.companyZip || '', 5);

    const lines = [];

    // RA — Submitter Record
    let ra = 'RA';
    ra += _digits(ein, 9);                 // Submitter EIN
    ra += _alpha('', 9);                    // User ID (BSO) — filled at upload
    ra += _alpha('', 5);                    // blanks / software vendor code area
    ra += _alpha(s.companyName, 57);        // Submitter name
    ra += _alpha(addr, 22);                 // Location address
    ra += _alpha('', 22);                   // Delivery address
    ra += _alpha(city, 22);                 // City
    ra += _alpha(st, 2);                    // State
    ra += zip;                              // ZIP
    lines.push(_pad512(ra));

    // RE — Employer Record
    let re = 'RE';
    re += String(year);                     // Tax year (4)
    re += _alpha('', 1);                     // Agent indicator
    re += ein;                              // Employer EIN (9)
    re += _alpha('', 9);                     // Agent-for EIN
    re += _alpha('', 1);                     // Terminating business indicator
    re += _alpha('', 4);                     // Establishment number
    re += _alpha('', 9);                     // Other EIN
    re += _alpha(s.companyName, 57);        // Employer name
    re += _alpha(addr, 22);                 // Location address
    re += _alpha('', 22);                   // Delivery address
    re += _alpha(city, 22);                 // City
    re += _alpha(st, 2);                    // State
    re += zip;                              // ZIP
    lines.push(_pad512(re));

    // RW — Employee Wage Records
    const w2Emps = (state.employees || []).filter(e => e.classification !== '1099');
    const totals = { box1: 0, box2: 0, box3: 0, box4: 0, box5: 0, box6: 0, def: 0 };
    let rwCount = 0;

    w2Emps.forEach(e => {
        const t = aggregateEmployeeYearTotals(state, e.id);
        const nm = _splitName(e.name);
        let rw = 'RW';
        rw += _digits(e.ssn || e.tin, 9);   // SSN
        rw += _alpha(nm.first, 15);
        rw += _alpha(nm.middle, 15);
        rw += _alpha(nm.last, 20);
        rw += _alpha('', 4);                 // Suffix
        rw += _alpha(e.address, 22);         // Location address
        rw += _alpha('', 22);               // Delivery address
        rw += _alpha(e.city, 22);
        rw += _alpha(e.state, 2);
        rw += _digits(e.zip, 5);
        rw += _alpha('', 4);                 // ZIP extension
        rw += _alpha('', 5);                 // blank
        rw += _alpha('', 23);               // Foreign state/province
        rw += _alpha('', 15);               // Foreign postal code
        rw += _alpha('', 2);                 // Country code
        rw += _money(t.fitWages);            // Box 1 — Wages, tips, other comp
        rw += _money(t.fit);                 // Box 2 — Federal income tax withheld
        rw += _money(t.ssWages);             // Box 3 — Social security wages
        rw += _money(t.ss);                  // Box 4 — Social security tax
        rw += _money(t.medWages);            // Box 5 — Medicare wages
        rw += _money(t.med);                 // Box 6 — Medicare tax
        rw += _money(0);                     // Box 7 — Social security tips
        rw += _money(0);                     // (obsolete advance EIC)
        rw += _money(0);                     // Box 10 — Dependent care
        rw += _money(t.retirement);          // Box 12 — Deferred comp (401k)
        lines.push(_pad512(rw));
        rwCount++;
        totals.box1 += t.fitWages; totals.box2 += t.fit;
        totals.box3 += t.ssWages;  totals.box4 += t.ss;
        totals.box5 += t.medWages; totals.box6 += t.med;
        totals.def  += t.retirement;
    });

    // RT — Total Record
    let rt = 'RT';
    rt += String(rwCount).padStart(7, '0'); // Number of RW records
    rt += _money(totals.box1, 15);
    rt += _money(totals.box2, 15);
    rt += _money(totals.box3, 15);
    rt += _money(totals.box4, 15);
    rt += _money(totals.box5, 15);
    rt += _money(totals.box6, 15);
    rt += _money(0, 15);                     // SS tips
    rt += _money(0, 15);                     // advance EIC
    rt += _money(0, 15);                     // dependent care
    rt += _money(totals.def, 15);            // deferred comp
    lines.push(_pad512(rt));

    // RF — Final Record
    let rf = 'RF';
    rf += _alpha('', 5);
    rf += String(rwCount).padStart(9, '0'); // Number of RW records in file
    lines.push(_pad512(rf));

    return lines.join('\r\n') + '\r\n';
}

// ── 1099-NEC IRIS CSV generator ──────────────────────────────────────────────
/**
 * Build a CSV for the IRS IRIS Taxpayer Portal (free 1099 e-filing). Columns
 * follow the IRIS 1099-NEC upload template; the employer uploads this at the
 * IRIS portal (a free IRIS TCC is required to enroll).
 */
function generate1099IRISCSV(state, year) {
    year = year || new Date().getFullYear();
    const s = state.settings || {};

    const headers = [
        'Tax Year', 'Payer EIN', 'Payer Name',
        'Recipient TIN', 'Recipient Name', 'Recipient Address',
        'Recipient City', 'Recipient State', 'Recipient ZIP',
        'Box 1 Nonemployee Compensation', 'Box 4 Federal Income Tax Withheld',
    ];

    const esc = v => {
        const str = String(v ?? '');
        return /[",\r\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
    };

    const rows = [headers.join(',')];
    (state.employees || [])
        .filter(e => e.classification === '1099')
        .forEach(e => {
            const t = aggregateEmployeeYearTotals(state, e.id);
            rows.push([
                year,
                s.ein || '',
                s.companyName || '',
                e.ssn || e.tin || '',
                e.name || '',
                e.address || '',
                e.city || '',
                e.state || '',
                e.zip || '',
                (t.gross || 0).toFixed(2),
                (t.fit || 0).toFixed(2),
            ].map(esc).join(','));
        });

    return rows.join('\r\n') + '\r\n';
}

// ── Pay Stub & Tax Statement Generators ──────────────────────────────────────

function _fmtCurr(val) {
    const num = Number(val) || 0;
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Generate clean, printable, professional HTML for an employee pay stub.
 */
function generatePayStubHTML(opts) {
    const { company = {}, employee = {}, run = {}, details = {}, ytd = {} } = opts;
    const gross = details.grossPay || details.gross || 0;
    const net = details.netPay || details.net || 0;
    const taxes = details.taxes || {};
    const preTax = details.preTaxDeductions || (details.deductions?.medical401k) || 0;
    const postTax = details.postTaxDeductions || 0;
    const reimbursement = details.reimbursement || 0;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Pay Stub - ${_esc(employee.name || 'Employee')} - ${_esc(run.periodEnd || run.date || '')}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        body { background: #f8fafc; color: #1e293b; padding: 24px; }
        .stub-card { max-width: 800px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
        .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0284c7; padding-bottom: 16px; margin-bottom: 20px; }
        .company-name { font-size: 22px; font-weight: 700; color: #0f172a; }
        .company-sub { font-size: 12px; color: #64748b; margin-top: 4px; }
        .stub-badge { background: #e0f2fe; color: #0369a1; font-weight: 600; font-size: 12px; padding: 4px 10px; border-radius: 12px; align-self: flex-start; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; font-size: 13px; }
        .info-block { background: #f8fafc; padding: 12px 16px; border-radius: 6px; border: 1px solid #f1f5f9; }
        .info-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
        .info-label { color: #64748b; }
        .info-val { font-weight: 600; color: #334155; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px; }
        th { background: #f1f5f9; color: #475569; text-align: left; padding: 8px 12px; font-weight: 600; border-bottom: 1px solid #cbd5e1; }
        td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
        .text-right { text-align: right; }
        .summary-box { background: #0f172a; color: #ffffff; padding: 16px 20px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
        .summary-label { font-size: 14px; opacity: 0.8; }
        .summary-amount { font-size: 24px; font-weight: 700; color: #38bdf8; }
        .footer-note { font-size: 11px; color: #94a3b8; text-align: center; margin-top: 24px; }
        @media print {
            body { background: #ffffff; padding: 0; }
            .stub-card { border: none; box-shadow: none; padding: 0; }
            .no-print { display: none; }
        }
    </style>
</head>
<body>
    <div class="stub-card">
        <div class="header">
            <div>
                <div class="company-name">${_esc(company.name || 'GlidePay Employer')}</div>
                <div class="company-sub">EIN: ${_esc(company.ein || '••-•••••••')} | Payroll Earnings Statement</div>
            </div>
            <div class="stub-badge">OFFICIAL PAY STUB</div>
        </div>

        <div class="grid-2">
            <div class="info-block">
                <div class="info-row"><span class="info-label">Employee:</span><span class="info-val">${_esc(employee.name || 'Employee')}</span></div>
                <div class="info-row"><span class="info-label">Role:</span><span class="info-val">${_esc(employee.role || employee.department || 'Staff')}</span></div>
                <div class="info-row"><span class="info-label">Classification:</span><span class="info-val">${_esc(employee.classification || 'W-2')} (${_esc(employee.type || 'Salary')})</span></div>
                <div class="info-row"><span class="info-label">State:</span><span class="info-val">${_esc(employee.state || 'US')}</span></div>
            </div>
            <div class="info-block">
                <div class="info-row"><span class="info-label">Pay Period:</span><span class="info-val">${_esc(run.periodStart || '—')} to ${_esc(run.periodEnd || '—')}</span></div>
                <div class="info-row"><span class="info-label">Pay Date:</span><span class="info-val">${_esc(run.date || new Date().toISOString().slice(0, 10))}</span></div>
                <div class="info-row"><span class="info-label">Pay Frequency:</span><span class="info-val">${_esc(employee.payFrequency || 'Biweekly')}</span></div>
                <div class="info-row"><span class="info-label">Direct Deposit:</span><span class="info-val">••••${_esc(employee.bankLast4 || employee.bank_account_last4 || 'Direct Deposit')}</span></div>
            </div>
        </div>

        <table>
            <thead>
                <tr>
                    <th>Earnings Breakdown</th>
                    <th class="text-right">Rate</th>
                    <th class="text-right">Hours</th>
                    <th class="text-right">Current Amount</th>
                    <th class="text-right">YTD Total</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>Regular Earnings</td>
                    <td class="text-right">${_fmtCurr(details.rate || employee.rate || 0)}</td>
                    <td class="text-right">${details.hours ? details.hours.toFixed(1) : '—'}</td>
                    <td class="text-right">${_fmtCurr(gross)}</td>
                    <td class="text-right">${_fmtCurr(ytd.gross || gross)}</td>
                </tr>
                ${reimbursement > 0 ? `<tr>
                    <td>Expense Reimbursement (Non-taxable)</td>
                    <td class="text-right">—</td>
                    <td class="text-right">—</td>
                    <td class="text-right">${_fmtCurr(reimbursement)}</td>
                    <td class="text-right">${_fmtCurr(reimbursement)}</td>
                </tr>` : ''}
            </tbody>
        </table>

        <table>
            <thead>
                <tr>
                    <th>Tax Deductions (Employee)</th>
                    <th class="text-right">Current</th>
                    <th class="text-right">YTD</th>
                    <th>Other Deductions</th>
                    <th class="text-right">Current</th>
                    <th class="text-right">YTD</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>Federal Income Tax (FIT)</td>
                    <td class="text-right">${_fmtCurr(taxes.federalIncomeTax || 0)}</td>
                    <td class="text-right">${_fmtCurr(ytd.fit || taxes.federalIncomeTax || 0)}</td>
                    <td>Pre-Tax Deductions (401k / Health)</td>
                    <td class="text-right">${_fmtCurr(preTax)}</td>
                    <td class="text-right">${_fmtCurr(ytd.preTax || preTax)}</td>
                </tr>
                <tr>
                    <td>Social Security (6.2%)</td>
                    <td class="text-right">${_fmtCurr(taxes.socialSecurity || 0)}</td>
                    <td class="text-right">${_fmtCurr(ytd.ss || taxes.socialSecurity || 0)}</td>
                    <td>Post-Tax Deductions / Garnishment</td>
                    <td class="text-right">${_fmtCurr(postTax)}</td>
                    <td class="text-right">${_fmtCurr(ytd.postTax || postTax)}</td>
                </tr>
                <tr>
                    <td>Medicare (1.45%)</td>
                    <td class="text-right">${_fmtCurr(taxes.medicare || 0)}</td>
                    <td class="text-right">${_fmtCurr(ytd.med || taxes.medicare || 0)}</td>
                    <td>Total Deductions</td>
                    <td class="text-right">${_fmtCurr(preTax + postTax)}</td>
                    <td class="text-right">${_fmtCurr((ytd.preTax || preTax) + (ytd.postTax || postTax))}</td>
                </tr>
                <tr>
                    <td>State Income Tax (SIT - ${_esc(employee.state || '')})</td>
                    <td class="text-right">${_fmtCurr(taxes.stateIncomeTax || 0)}</td>
                    <td class="text-right">${_fmtCurr(ytd.sit || taxes.stateIncomeTax || 0)}</td>
                    <td colspan="3"></td>
                </tr>
            </tbody>
        </table>

        <div class="summary-box">
            <div>
                <div class="summary-label">NET TAKE-HOME PAY</div>
                <div style="font-size:12px;opacity:0.8;margin-top:2px;">Disbursed via Direct Deposit (ACH)</div>
            </div>
            <div class="summary-amount">${_fmtCurr(net)}</div>
        </div>

        <div class="footer-note">
            Generated by GlidePay Payroll & Compliance Platform. Retain this statement for your tax records.
        </div>
    </div>
</body>
</html>`;
}

/**
 * Trigger browser print dialog with the rendered pay stub.
 */
function printPayStub(opts) {
    const html = generatePayStubHTML(opts);
    const printWindow = window.open('', '_blank', 'width=850,height=900');
    if (!printWindow) {
        alert('Please allow popups to print pay stubs.');
        return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
        printWindow.print();
    }, 250);
}

/**
 * Generate standard Form W-2 / 1099 Preview summary modal HTML.
 */
function generateW2SummaryHTML(employee, yearTotals, company, year) {
    year = year || new Date().getFullYear();
    const t = yearTotals || {};
    return `<div style="font-size:13px; color:#1e293b;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e2e8f0; padding-bottom:12px; margin-bottom:16px;">
            <div>
                <h4 style="font-size:16px; font-weight:700; color:#0f172a; margin:0;">Form W-2 Wage & Tax Statement (${year})</h4>
                <div style="font-size:12px; color:#64748b;">${_esc(company.name || 'Company')} — EIN: ${_esc(company.ein || '••-•••••••')}</div>
            </div>
            <span style="background:#e0f2fe; color:#0369a1; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:600;">EMPLOYEE COPY</span>
        </div>
        <div style="background:#f8fafc; padding:10px 12px; border-radius:6px; margin-bottom:14px;">
            <strong>Employee:</strong> ${_esc(employee.name)} | <strong>SSN:</strong> •••-••-${_esc(employee.bankLast4 || '••••')} | <strong>State:</strong> ${_esc(employee.state || 'US')}
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <div style="border:1px solid #e2e8f0; padding:8px 10px; border-radius:4px;"><span style="color:#64748b; font-size:11px;">1. Wages, tips, other comp:</span><br><strong>${_fmtCurr(t.box1 ?? t.gross)}</strong></div>
            <div style="border:1px solid #e2e8f0; padding:8px 10px; border-radius:4px;"><span style="color:#64748b; font-size:11px;">2. Federal income tax withheld:</span><br><strong>${_fmtCurr(t.box2 ?? t.fit)}</strong></div>
            <div style="border:1px solid #e2e8f0; padding:8px 10px; border-radius:4px;"><span style="color:#64748b; font-size:11px;">3. Social Security wages:</span><br><strong>${_fmtCurr(t.box3 ?? t.ssWages)}</strong></div>
            <div style="border:1px solid #e2e8f0; padding:8px 10px; border-radius:4px;"><span style="color:#64748b; font-size:11px;">4. Social Security tax withheld:</span><br><strong>${_fmtCurr(t.box4 ?? t.ss)}</strong></div>
            <div style="border:1px solid #e2e8f0; padding:8px 10px; border-radius:4px;"><span style="color:#64748b; font-size:11px;">5. Medicare wages and tips:</span><br><strong>${_fmtCurr(t.box5 ?? t.medWages)}</strong></div>
            <div style="border:1px solid #e2e8f0; padding:8px 10px; border-radius:4px;"><span style="color:#64748b; font-size:11px;">6. Medicare tax withheld:</span><br><strong>${_fmtCurr(t.box6 ?? t.med)}</strong></div>
            <div style="border:1px solid #e2e8f0; padding:8px 10px; border-radius:4px;"><span style="color:#64748b; font-size:11px;">12. Deferred Compensation (401k):</span><br><strong>${_fmtCurr(t.def ?? t.retirement)}</strong></div>
            <div style="border:1px solid #e2e8f0; padding:8px 10px; border-radius:4px;"><span style="color:#64748b; font-size:11px;">17. State income tax withheld (${_esc(employee.state || '')}):</span><br><strong>${_fmtCurr(t.box17 ?? t.sit)}</strong></div>
        </div>
    </div>`;
}

// Expose for both browser (window) and Node (verify/tests).
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        checkEfileReadiness, generateEFW2, generate1099IRISCSV,
        aggregateEmployeeYearTotals, generatePayStubHTML, printPayStub,
        generateW2SummaryHTML,
    };
}

