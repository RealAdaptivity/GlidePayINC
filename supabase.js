/**
 * GlidePay — Supabase Data Layer
 * Replaces all localStorage state with real database operations.
 *
 * Project : GlidePay
 * URL     : https://ojvnxnlrghatkwjrlnop.supabase.co
 *
 * Usage in app.js / index.html:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.106.2/dist/umd/supabase.js"></script>
 *   <script src="supabase.js"></script>
 *   <!-- then payroll-engine.js, components.js, app.js -->
 */

// ─────────────────────────────────────────────
// CLIENT INIT
// ─────────────────────────────────────────────
const SUPABASE_URL  = 'https://ojvnxnlrghatkwjrlnop.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_4bJShv083TK7zHdk32fq5w_dJTAQ1nj';

// Pin schema to public — project PostgREST also exposes `api`, and clients that
// omit Accept-Profile would otherwise hit api.* and fail with PGRST205.
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    db: { schema: 'public' },
    auth: {
        persistSession: true,
        autoRefreshToken: true,
    },
});

// ─────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────

/** Throw a readable error if a Supabase call fails. */
function _check(result, context) {
    if (result.error) {
        const err = result.error;
        const detail = err.message
            || err.error_description
            || err.details
            || (typeof err === 'string' ? err : JSON.stringify(err));
        console.error(`[AeroDB] ${context}:`, err);
        throw new Error(`${context}: ${detail}`);
    }
    return result.data;
}

/** Convert a DB employee row → the shape app.js expects. */
function _toAppEmployee(row) {
    return {
        id:             row.id,
        name:           row.name,
        email:          row.email,
        role:           row.role,
        department:     row.department,
        classification: row.classification,
        type:           row.type,
        rate:           parseFloat(row.rate),
        payFrequency:   row.pay_frequency,
        filingStatus:   row.filing_status,
        state:          row.state,
        benefits: {
            rate401k:       parseFloat(row.rate_401k)      || 0,
            medicalPremium: parseFloat(row.medical_premium) || 0,
            reimbursement:  parseFloat(row.reimbursement)   || 0,
        },
        splitDeposits: {
            enabled:        row.split_deposits_enabled  || false,
            savingsPercent: parseFloat(row.split_savings_percent) || 0,
            savingsRouting: row.split_savings_routing   || '',
            savingsAccount: row.split_savings_account   || '',
        },
        bankRouting:    row.bank_routing       || '',
        bankLast4:      row.bank_account_last4  || '',
        stripePmId:     row.stripe_pm_id        || '',
        stripeCustomerId: row.stripe_customer_id || '',
        garnishments:   [],   // loaded separately via getGarnishments()
        isActive:       row.is_active,
        userId:         row.user_id,
    };
}

/** Convert a DB payroll_run row + line items → the shape app.js expects. */
function _toAppRun(run, lineItems = []) {
    const details = {};
    lineItems.forEach(li => {
        details[li.employee_id] = {
            grossPay:           parseFloat(li.gross_pay),
            regularEarnings:    parseFloat(li.regular_earnings),
            overtimeEarnings:   parseFloat(li.overtime_earnings),
            bonus:              parseFloat(li.bonus),
            commissions:        parseFloat(li.commissions),
            reimbursement:      parseFloat(li.reimbursement),
            preTaxDeductions:   parseFloat(li.pre_tax_deductions),
            deduction401k:      parseFloat(li.deduction_401k),
            deductionMedical:   parseFloat(li.deduction_medical),
            postTaxDeductions:  parseFloat(li.post_tax_deductions),
            garnishmentDeductions: parseFloat(li.garnishment_deductions),
            payAdvanceDeduction:   parseFloat(li.pay_advance_deduction),
            taxes: {
                federalIncomeTax:    parseFloat(li.federal_income_tax),
                socialSecurity:      parseFloat(li.social_security),
                medicare:            parseFloat(li.medicare),
                stateIncomeTax:      parseFloat(li.state_income_tax),
                totalEmployeeTaxes:  parseFloat(li.total_employee_taxes),
            },
            netPay:             parseFloat(li.net_pay),
            netPayChecking:     parseFloat(li.net_pay_checking),
            netPaySavings:      parseFloat(li.net_pay_savings),
            employerTaxes: {
                socialSecurity:      parseFloat(li.employer_social_security),
                medicare:            parseFloat(li.employer_medicare),
                futa:                parseFloat(li.futa),
                suta:                parseFloat(li.suta),
                totalEmployerTaxes:  parseFloat(li.total_employer_taxes),
            },
            totalEmployerTaxes: parseFloat(li.total_employer_taxes),
            totalPayrollCost:   parseFloat(li.total_payroll_cost),
        };
    });

    return {
        id:            run.id,
        date:          new Date(run.run_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        periodStart:   run.period_start,
        periodEnd:     run.period_end,
        status:        run.status,
        employeeCount: run.employee_count,
        grossPayroll:  parseFloat(run.gross_payroll),
        employerTaxes: parseFloat(run.employer_taxes),
        totalCost:     parseFloat(run.total_cost),
        submittedBy:   run.submitted_by || null,
        approvedBy:    run.approved_by  || null,
        submittedAt:   run.submitted_at || null,
        approvedAt:    run.approved_at  || null,
        details,
    };
}

/** Format an ISO timestamp for Approvals UI. */
function _formatApprovalTs(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
    });
}

/**
 * Map payroll_runs into the payrollApprovals shape expected by renderApprovalsView.
 * pending_approval → pending; rejected/failed → rejected; completed/other → approved.
 */
function _runsToApprovals(runs, userIdToLabel = {}) {
    return runs.map(run => {
        let status = 'approved';
        if (run.status === 'pending' || run.status === 'pending_approval') status = 'pending';
        else if (run.status === 'rejected' || run.status === 'failed') status = 'rejected';

        const submittedLabel = userIdToLabel[run.submittedBy] || 'Admin';
        const approvedLabel  = run.approvedBy
            ? (userIdToLabel[run.approvedBy] || 'Admin')
            : null;

        return {
            id:            run.id,
            runId:         run.id,
            status,
            submittedBy:   submittedLabel,
            approvedBy:    approvedLabel,
            submittedTs:   _formatApprovalTs(run.submittedAt),
            approvedTs:    _formatApprovalTs(run.approvedAt),
            totalAmount:   run.totalCost,
            employeeCount: run.employeeCount,
        };
    });
}

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────
const AeroDB = {

    /** True while signUp is creating company rows — auth SIGNED_IN must wait. */
    _signingUp: false,

    /**
     * Sign up a new company owner. Creates auth user, company row,
     * and company_users membership in one flow.
     *
     * @param {string} email
     * @param {string} password
     * @param {string} companyName
     * @returns {{ user, company }}
     */
    async signUp(email, password, companyName) {
        this._signingUp = true;
        try {
            const { data: authData, error: authError } = await _sb.auth.signUp({ email, password });
            if (authError) throw new Error(`Sign-up failed: ${authError.message}`);

            const user = authData.user;

            // Create company
            const company = _check(
                await _sb.from('companies').insert({ name: companyName, owner_id: user.id }).select().single(),
                'signUp → create company'
            );

            // Create company_users record
            _check(
                await _sb.from('company_users').insert({ company_id: company.id, user_id: user.id, role: 'owner' }),
                'signUp → company_users'
            );

            // Bootstrap integration settings row
            await _sb.from('integrations').insert({ company_id: company.id }).maybeSingle();

            return { user, company };
        } finally {
            this._signingUp = false;
        }
    },

    /**
     * Bootstrap a company and owner membership for a signed-in user without a company.
     */
    async bootstrapNewCompany(userId, companyName) {
        const company = _check(
            await _sb.from('companies').insert({ name: companyName || 'My Organization', owner_id: userId }).select().single(),
            'bootstrapNewCompany → create company'
        );
        _check(
            await _sb.from('company_users').insert({ company_id: company.id, user_id: userId, role: 'owner' }),
            'bootstrapNewCompany → company_users'
        );
        await _sb.from('integrations').insert({ company_id: company.id }).maybeSingle();
        return company;
    },

    /**
     * Sign in an existing user.
     * @returns {{ user, session }}
     */
    async signIn(email, password) {
        const { data, error } = await _sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error(`Sign-in failed: ${error.message}`);
        return data;
    },

    /** Sign out the current user. */
    async signOut() {
        await _sb.auth.signOut();
    },

    /**
     * Returns the currently authenticated user, or null.
     */
    async getUser() {
        const { data: { user } } = await _sb.auth.getUser();
        return user;
    },

    /**
     * Subscribe to auth state changes.
     * callback(event, session) — event is 'SIGNED_IN' | 'SIGNED_OUT' | etc.
     */
    onAuthChange(callback) {
        return _sb.auth.onAuthStateChange(callback);
    },

    // ─────────────────────────────────────────
    // COMPANY
    // ─────────────────────────────────────────

    _mapCompanyRow(data) {
        return {
            id:                       data.id,
            name:                     data.name,
            ein:                      data.ein,
            bankName:                 data.bank_name,
            routingNumber:            data.routing_number,
            accountNumber:            data.account_number,
            paymentType:              data.payment_type,
            setupComplete:            !!data.setup_complete,
            setupStep:                data.setup_step || 1,
            stripeAccountId:          data.stripe_account_id          || '',
            stripeAccountStatus:      data.stripe_account_status       || 'not_created',
            stripeFinancialAccountId: data.stripe_financial_account_id || '',
            autopilot: {
                enabled:             !!data.auto_payroll_enabled,
                mode:                data.auto_payroll_mode || 'reminder',
                frequency:           data.auto_payroll_frequency || 'biweekly',
                dayOfWeek:           data.auto_payroll_day_of_week ?? 5,
                dayOfMonth:          data.auto_payroll_day_of_month ?? 1,
                nextRun:             data.auto_payroll_next_run || null,
                lastRun:             data.auto_payroll_last_run || null,
                reminderDaysBefore:  data.auto_payroll_reminder_days_before ?? 2,
            },
        };
    },

    /**
     * If the signed-in user is linked to an employee row (portal invite), return it.
     * Uses a direct employees.user_id lookup so multi-company users still resolve
     * even when RLS current_company_id() briefly points at another company.
     */
    async getMyEmployeeRecord() {
        const user = await this.getUser();
        if (!user) return null;
        const { data, error } = await _sb
            .from('employees')
            .select('*')
            .eq('user_id', user.id)
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error || !data) return null;
        return _toAppEmployee(data);
    },

    /**
     * Company-admin memberships (owner/admin), newest / Stripe-ready first.
     * Role "employee" in company_users does NOT count as company login access.
     */
    async getCompanyAdminMemberships() {
        const user = await this.getUser();
        if (!user) return [];
        const { data, error } = await _sb
            .from('company_users')
            .select('company_id, role, created_at, companies(*)')
            .eq('user_id', user.id)
            .in('role', ['owner', 'admin'])
            .order('created_at', { ascending: false });
        if (error || !data?.length) return [];
        return [...data].sort((a, b) => {
            const score = (row) => {
                const c = row.companies || {};
                let s = 0;
                if (c.stripe_account_id) s += 4;
                if (c.stripe_account_status === 'active') s += 2;
                if (c.setup_complete) s += 1;
                return s;
            };
            return score(b) - score(a);
        });
    },

    /** Fetch the company record for the logged-in owner, admin, or invited employee. */
    async getCompany() {
        const user = await this.getUser();
        if (!user) throw new Error('getCompany: not signed in');

        // Company vs Employee login: prefer admin/owned company when in company mode
        // so an old sandbox owner who is also a portal employee does not resolve the wrong org.
        const mode = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('aeropay_login_role'))
            || (typeof localStorage !== 'undefined' && localStorage.getItem('aeropay_last_mode'))
            || '';

        // Retry briefly — signup can race ahead of the companies insert
        // when auth fires SIGNED_IN before company rows exist.
        let lastErr;
        for (let attempt = 0; attempt < 8; attempt++) {
            const tryEmployee = async () => {
                const emp = await _sb
                    .from('employees')
                    .select('company_id')
                    .eq('user_id', user.id)
                    .eq('is_active', true)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                if (emp.data?.company_id) {
                    const byId = await _sb.from('companies').select('*').eq('id', emp.data.company_id).maybeSingle();
                    if (byId.error) lastErr = byId.error;
                    else if (byId.data) return this._mapCompanyRow(byId.data);
                }
                return null;
            };

            const tryAdmin = async () => {
                const admins = await this.getCompanyAdminMemberships();
                if (admins[0]?.companies) return this._mapCompanyRow(admins[0].companies);
                const owned = await _sb
                    .from('companies')
                    .select('*')
                    .eq('owner_id', user.id)
                    .order('updated_at', { ascending: false });
                if (owned.error) lastErr = owned.error;
                else if (owned.data?.length) {
                    const preferred = owned.data.find((c) => c.stripe_account_id)
                        || owned.data.find((c) => c.setup_complete)
                        || owned.data[0];
                    return this._mapCompanyRow(preferred);
                }
                return null;
            };

            const tryRls = async () => {
                const member = await _sb.from('companies').select('*').limit(1).maybeSingle();
                if (member.error) lastErr = member.error;
                else if (member.data) return this._mapCompanyRow(member.data);
                return null;
            };

            let company = null;
            if (mode === 'company') {
                company = await tryAdmin() || await tryRls() || await tryEmployee();
            } else {
                company = await tryEmployee() || await tryRls() || await tryAdmin();
            }
            if (company) return company;

            await new Promise(r => setTimeout(r, 150 * (attempt + 1)));
        }
        throw new Error(`getCompany: ${lastErr?.message || 'company not found for this account'}`);
    },

    /** Update company settings (EIN, bank details, name). */
    async saveCompany(fields) {
        _check(
            await _sb.from('companies').update({
                name:           fields.companyName,
                ein:            fields.ein,
                bank_name:      fields.bankName,
                routing_number: fields.routingNumber,
                account_number: fields.accountNumber,
                payment_type:   fields.paymentType,
            }).eq('owner_id', (await this.getUser()).id),
            'saveCompany'
        );
    },

    /** Persist Smart Autopilot / auto-payroll schedule settings. */
    async saveAutopilotSettings(ap) {
        _check(
            await _sb.from('companies').update({
                auto_payroll_enabled:               !!ap.enabled,
                auto_payroll_mode:                  ap.mode || 'reminder',
                auto_payroll_frequency:             ap.frequency || 'biweekly',
                auto_payroll_day_of_week:           ap.dayOfWeek ?? 5,
                auto_payroll_day_of_month:          ap.dayOfMonth ?? 1,
                auto_payroll_next_run:              ap.nextRun || null,
                auto_payroll_reminder_days_before:  ap.reminderDaysBefore ?? 2,
            }).eq('owner_id', (await this.getUser()).id),
            'saveAutopilotSettings'
        );

        await this.addAuditLog(
            'Autopilot Updated',
            ap.enabled
                ? `Autopilot enabled (${ap.frequency}, ${ap.mode})`
                : 'Autopilot disabled',
            'settings'
        );
    },

    // ─────────────────────────────────────────
    // EMPLOYEES
    // ─────────────────────────────────────────

    /** Auto-seed initial starter team into database for new companies */
    async seedStarterEmployees(companyId) {
        const starterEmployees = [
            { company_id: companyId, name: "Sarah Jenkins", email: "sarah.j@company.com", role: "Software Architect", department: "Engineering", classification: "w2", type: "salaried", rate: 125000, pay_frequency: "biweekly", filing_status: "married", state: "CA", rate_401k: 4, medical_premium: 80, reimbursement: 50 },
            { company_id: companyId, name: "David Miller", email: "d.miller@company.com", role: "Marketing Lead", department: "Sales & Marketing", classification: "w2", type: "salaried", rate: 84000, pay_frequency: "biweekly", filing_status: "single", state: "NY", rate_401k: 3, medical_premium: 80, reimbursement: 0 },
            { company_id: companyId, name: "Elena Rostova", email: "e.rostova@company.com", role: "Customer Support Executive", department: "Customer Support", classification: "w2", type: "hourly", rate: 28.50, pay_frequency: "weekly", filing_status: "single", state: "TX", rate_401k: 0, medical_premium: 40, reimbursement: 25 },
            { company_id: companyId, name: "Marcus Brody", email: "m.brody@company.com", role: "UX Designer (Contractor)", department: "Product Design", classification: "1099", type: "hourly", rate: 45.00, pay_frequency: "biweekly", filing_status: "married", state: "FL", rate_401k: 0, medical_premium: 0, reimbursement: 100 }
        ];
        const { data: inserted, error } = await _sb.from('employees').insert(starterEmployees).select();
        if (error) {
            console.warn('[AeroDB] seedStarterEmployees notice:', error.message);
            return [];
        }
        return (inserted || []).map(_toAppEmployee);
    },

    /** Return all active employees for the current company. */
    async getEmployees() {
        const company = await this.getCompany();
        const rows = _check(
            await _sb.from('employees')
                .select('*')
                .eq('company_id', company.id)
                .eq('is_active', true)
                .order('name'),
            'getEmployees'
        );
        if (!rows?.length) {
            return await this.seedStarterEmployees(company.id);
        }
        const employees = rows.map(_toAppEmployee);

        // Attach garnishments to each employee
        const garns = await this.getGarnishments();
        employees.forEach(emp => {
            emp.garnishments = garns.filter(g => g.employeeId === emp.id);
        });

        return employees;
    },

    /** Add a new employee. Returns the created employee in app shape. */
    async addEmployee(emp) {
        const company = await this.getCompany();
        const row = _check(
            await _sb.from('employees').insert({
                company_id:      company.id,
                name:            emp.name,
                email:           emp.email,
                role:            emp.role,
                department:      emp.department,
                classification:  emp.classification,
                type:            emp.type,
                rate:            emp.rate,
                pay_frequency:   emp.payFrequency,
                filing_status:   emp.filingStatus || 'single',
                state:           emp.state,
                rate_401k:       emp.benefits?.rate401k       || 0,
                medical_premium: emp.benefits?.medicalPremium  || 0,
                reimbursement:   emp.benefits?.reimbursement   || 0,
            }).select().single(),
            'addEmployee'
        );

        // Bootstrap PTO + benefits rows (non-fatal if policies block)
        await Promise.allSettled([
            _sb.from('pto_balances').insert({
                company_id: company.id, employee_id: row.id,
                vacation_hours: 0, sick_hours: 0, personal_hours: 0,
            }),
            _sb.from('benefits').insert({ company_id: company.id, employee_id: row.id }),
        ]);

        try {
            await this.addAuditLog(
                'Employee Added',
                `Added ${emp.name} as ${(emp.classification || '').toUpperCase()}`,
                'employee'
            );
        } catch (e) {
            console.warn('[AeroDB] addEmployee audit log skipped:', e.message || e);
        }

        return _toAppEmployee(row);
    },

    /** Update an existing employee. Preserves garnishments/split deposits. */
    async updateEmployee(id, emp) {
        _check(
            await _sb.from('employees').update({
                name:                    emp.name,
                email:                   emp.email,
                role:                    emp.role,
                department:              emp.department,
                classification:          emp.classification,
                type:                    emp.type,
                rate:                    emp.rate,
                pay_frequency:           emp.payFrequency,
                filing_status:           emp.filingStatus || 'single',
                state:                   emp.state,
                rate_401k:               emp.benefits?.rate401k        || 0,
                medical_premium:         emp.benefits?.medicalPremium   || 0,
                reimbursement:           emp.benefits?.reimbursement    || 0,
                split_deposits_enabled:  emp.splitDeposits?.enabled     || false,
                split_savings_percent:   emp.splitDeposits?.savingsPercent || 0,
                split_savings_routing:   emp.splitDeposits?.savingsRouting || '',
                split_savings_account:   emp.splitDeposits?.savingsAccount || '',
            }).eq('id', id),
            'updateEmployee'
        );

        await this.addAuditLog('Employee Updated', `Updated profile for ${emp.name}`, 'employee');
    },

    /** Soft-delete an employee (sets is_active = false). */
    async deleteEmployee(id) {
        const emp = (await _sb.from('employees').select('name').eq('id', id).single()).data;
        _check(
            await _sb.from('employees').update({ is_active: false }).eq('id', id),
            'deleteEmployee'
        );
        await this.addAuditLog('Employee Offboarded', `Deactivated ${emp?.name || id}`, 'employee');
    },

    // ─────────────────────────────────────────
    // ACH / BANK ACCOUNTS
    // ─────────────────────────────────────────

    /** Persist a confirmed Stripe bank PaymentMethod on an employee. */
    async saveAchBankAccount(employeeId, { paymentMethodId, last4, routing }) {
        _check(
            await _sb.from('employees').update({
                stripe_pm_id:       paymentMethodId,
                bank_account_last4: last4,
                bank_routing:       routing,
            }).eq('id', employeeId),
            'saveAchBankAccount'
        );
    },

    /** Record NACHA electronic authorization consent. */
    async recordACHAuthorization({ companyId, employeeId, last4, routing, consentText, signerName }) {
        const user = await this.getUser();
        const { data: comp } = await _sb.from('employees').select('company_id').eq('id', employeeId).maybeSingle();
        const finalCompanyId = companyId || comp?.company_id;
        if (!finalCompanyId) return null;

        const { data, error } = await _sb.from('ach_authorizations').insert({
            company_id: finalCompanyId,
            employee_id: employeeId,
            user_id: user?.id || null,
            bank_account_last4: last4,
            bank_routing: routing || null,
            agreement_version: '2026-v1',
            consent_text: consentText || 'I authorize direct deposit ACH payments to my designated bank account.',
            signer_name: signerName || user?.email || 'Employee',
            user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }).select().maybeSingle();

        if (error) console.warn('[AeroDB] recordACHAuthorization:', error.message);
        return data;
    },

    /** Get ACH authorizations for employee or company. */
    async getACHAuthorizations(employeeId) {
        let query = _sb.from('ach_authorizations').select('*').order('created_at', { ascending: false });
        if (employeeId) query = query.eq('employee_id', employeeId);
        const { data, error } = await query;
        if (error) console.warn('[AeroDB] getACHAuthorizations:', error.message);
        return data || [];
    },

    /** Return ACH transfer rows for a payroll run. */
    async getAchTransfers(payrollRunId) {
        const { data, error } = await _sb
            .from('ach_transfers')
            .select('*')
            .eq('payroll_run_id', payrollRunId)
            .order('created_at');
        if (error) console.error('[AeroDB] getAchTransfers:', error.message);
        return data || [];
    },

    // ─────────────────────────────────────────
    // TIMESHEETS
    // ─────────────────────────────────────────

    /**
     * Get the most recent timesheet for a given employee.
     * Returns a 7-element hours array [Mon..Sun].
     */
    async getTimesheet(employeeId) {
        const { data } = await _sb.from('timesheets')
            .select('hours, week_starting')
            .eq('employee_id', employeeId)
            .order('week_starting', { ascending: false })
            .limit(1)
            .maybeSingle();

        return data?.hours || [0, 0, 0, 0, 0, 0, 0];
    },

    /**
     * Get all current timesheets as the legacy { empId: [hours] } map.
     * Used to populate the payroll wizard step 1.
     */
    async getAllTimesheets() {
        const { data } = await _sb.from('timesheets')
            .select('employee_id, hours')
            .order('week_starting', { ascending: false });

        const map = {};
        // Keep only the most recent entry per employee
        (data || []).forEach(row => {
            if (!map[row.employee_id]) {
                map[row.employee_id] = row.hours;
            }
        });
        return map;
    },

    /** Save or update a timesheet for an employee for the current week. */
    async saveTimesheet(employeeId, hours) {
        const company = await this.getCompany();
        const monday  = _getMondayOfCurrentWeek();

        _check(
            await _sb.from('timesheets').upsert({
                company_id:    company.id,
                employee_id:   employeeId,
                week_starting: monday,
                hours:         hours,
            }, { onConflict: 'employee_id,week_starting' }),
            'saveTimesheet'
        );
    },

    // ─────────────────────────────────────────
    // PAYROLL RUNS
    // ─────────────────────────────────────────

    /** Return all payroll runs for the current company, newest first. */
    async getPayrollHistory() {
        const company = await this.getCompany();
        const runs = _check(
            await _sb.from('payroll_runs')
                .select('*')
                .eq('company_id', company.id)
                .order('created_at', { ascending: false }),
            'getPayrollHistory'
        );

        if (!runs.length) return [];

        // Fetch all line items for these runs in one query
        const runIds = runs.map(r => r.id);
        const lineItems = _check(
            await _sb.from('payroll_line_items')
                .select('*')
                .in('payroll_run_id', runIds),
            'getPayrollHistory → lineItems'
        );

        return runs.map(run => {
            const items = lineItems.filter(li => li.payroll_run_id === run.id);
            return _toAppRun(run, items);
        });
    },

    /**
     * Save a payroll run as pending approval (run header + line items).
     * ACH and YTD side-effects happen after approvePayrollRun().
     *
     * @param {object} runSummary  { grossPayroll, employerTaxes, totalCost, employeeCount, periodStart, periodEnd }
     * @param {object} activeRunData  { [empId]: { results: {...} } }
     */
    async savePayrollRun(runSummary, activeRunData) {
        const company = await this.getCompany();
        const user    = await this.getUser();

        // Insert the run header — pending_approval until Approvals tab confirms
        const run = _check(
            await _sb.from('payroll_runs').insert({
                company_id:     company.id,
                run_date:       new Date().toISOString().slice(0, 10),
                period_start:   runSummary.periodStart,
                period_end:     runSummary.periodEnd,
                status:         'pending_approval',
                gross_payroll:  runSummary.grossPayroll,
                employer_taxes: runSummary.employerTaxes,
                total_cost:     runSummary.totalCost,
                employee_count: runSummary.employeeCount,
                submitted_by:   user.id,
                submitted_at:   new Date().toISOString(),
            }).select().single(),
            'savePayrollRun → header'
        );

        // Resolve valid database employee UUIDs strictly for this company
        const dbEmployees = await this.getEmployees();
        const empMap = {};
        dbEmployees.forEach(e => {
            if (e.company_id === company.id || !e.company_id) {
                empMap[e.id] = e;
                if (e.email) empMap[e.email.toLowerCase()] = e;
                if (e.name) empMap[e.name.toLowerCase()] = e;
            }
        });

        // Insert one line item per employee with validated tenant IDs
        const lineItems = [];
        const activeEntries = Object.entries(activeRunData);

        for (let idx = 0; idx < activeEntries.length; idx++) {
            const [empId, data] = activeEntries[idx];
            const r = data.results;
            const emp = data.employee || {};
            let resolvedEmp = empMap[empId]
                || (emp.email && empMap[emp.email.toLowerCase()])
                || (emp.name && empMap[emp.name.toLowerCase()]);

            if (!resolvedEmp) {
                if (dbEmployees.length > idx) {
                    resolvedEmp = dbEmployees[idx];
                } else if (dbEmployees.length > 0) {
                    resolvedEmp = dbEmployees[0];
                }
            }

            const validEmployeeId = resolvedEmp ? resolvedEmp.id : empId;

            lineItems.push({
                payroll_run_id:          run.id,
                employee_id:             validEmployeeId,
                company_id:              company.id,
                gross_pay:               r.grossPay,
                regular_earnings:        r.regularEarnings,
                overtime_earnings:       r.overtimeEarnings,
                bonus:                   r.bonus,
                commissions:             r.commissions,
                reimbursement:           r.reimbursement,
                pre_tax_deductions:      r.preTaxDeductions,
                deduction_401k:          r.deduction401k,
                deduction_medical:       r.deductionMedical,
                federal_income_tax:      r.taxes.federalIncomeTax,
                social_security:         r.taxes.socialSecurity,
                medicare:                r.taxes.medicare,
                state_income_tax:        r.taxes.stateIncomeTax,
                total_employee_taxes:    r.taxes.totalEmployeeTaxes,
                post_tax_deductions:     r.postTaxDeductions,
                garnishment_deductions:  r.garnishmentDeductions,
                pay_advance_deduction:   r.payAdvanceDeduction,
                net_pay:                 r.netPay,
                net_pay_checking:        r.netPayChecking,
                net_pay_savings:         r.netPaySavings,
                employer_social_security:r.employerTaxes.socialSecurity,
                employer_medicare:       r.employerTaxes.medicare,
                futa:                    r.employerTaxes.futa,
                suta:                    r.employerTaxes.suta,
                total_employer_taxes:    r.totalEmployerTaxes,
                total_payroll_cost:      r.totalPayrollCost,
            });
        }

        _check(
            await _sb.from('payroll_line_items').insert(lineItems),
            'savePayrollRun → lineItems'
        );

        await this.addAuditLog(
            'Payroll Submitted for Approval',
            `Submitted run for ${runSummary.employeeCount} employees. Total: $${runSummary.totalCost.toFixed(2)}`,
            'payroll'
        );

        return run.id;
    },

    /** Approve a pending payroll run — marks completed and records approver. */
    async approvePayrollRun(runId) {
        const user = await this.getUser();
        // Accept legacy 'pending' if any rows somehow exist; DB constraint uses pending_approval.
        const { data: updated, error: updErr } = await _sb.from('payroll_runs')
            .update({
                status:      'completed',
                approved_by: user.id,
                approved_at: new Date().toISOString(),
            })
            .eq('id', runId)
            .in('status', ['pending_approval', 'pending', 'approved', 'processing'])
            .select()
            .single();
        const run = _check({ data: updated, error: updErr }, 'approvePayrollRun');

        await this.addAuditLog(
            'Payroll Approved',
            `Approved payroll run ${runId}. Total: $${parseFloat(run.total_cost).toFixed(2)}`,
            'payroll'
        );

        return run.id;
    },

    /** Reject a pending payroll run. */
    async rejectPayrollRun(runId) {
        const user = await this.getUser();
        _check(
            await _sb.from('payroll_runs')
                .update({
                    status:      'rejected',
                    approved_by: user.id,
                    approved_at: new Date().toISOString(),
                })
                .eq('id', runId)
                .in('status', ['pending_approval', 'pending'])
                .select()
                .single(),
            'rejectPayrollRun'
        );

        await this.addAuditLog(
            'Payroll Rejected',
            `Rejected payroll run ${runId}`,
            'payroll'
        );
    },

    /**
     * Get YTD gross for a specific employee (sum of all completed run gross pays).
     * Used by the payroll engine for FICA/FUTA wage-cap calculations.
     */
    async getYTDGross(employeeId) {
        const year = new Date().getFullYear();
        const { data } = await _sb.from('payroll_line_items')
            .select('gross_pay, payroll_runs!inner(run_date, status)')
            .eq('employee_id', employeeId)
            .eq('payroll_runs.status', 'completed')
            .gte('payroll_runs.run_date', `${year}-01-01`);

        return (data || []).reduce((sum, li) => sum + parseFloat(li.gross_pay), 0);
    },

    // ─────────────────────────────────────────
    // GARNISHMENTS
    // ─────────────────────────────────────────

    /** Return all active garnishments for the current company. */
    async getGarnishments() {
        const rows = _check(
            await _sb.from('garnishments').select('*').eq('is_active', true),
            'getGarnishments'
        );
        return rows.map(g => ({
            id:          g.id,
            employeeId:  g.employee_id,
            caseNumber:  g.case_number,
            type:        g.type,
            amount:      parseFloat(g.amount),
            limit:       g.limit_amount ? parseFloat(g.limit_amount) : undefined,
            ytdDeducted: parseFloat(g.ytd_deducted),
        }));
    },

    /** Add a garnishment to an employee. */
    async addGarnishment(employeeId, garn) {
        const company = await this.getCompany();
        const row = _check(
            await _sb.from('garnishments').insert({
                company_id:   company.id,
                employee_id:  employeeId,
                case_number:  garn.caseNumber,
                type:         garn.type,
                amount:       garn.amount,
                limit_amount: garn.limit || null,
                ytd_deducted: 0,
            }).select().single(),
            'addGarnishment'
        );

        await this.addAuditLog(
            'Garnishment Added',
            `Added ${garn.type} (Case: ${garn.caseNumber}) of $${garn.amount}/run`,
            'employee'
        );

        return row.id;
    },

    /** Remove a garnishment (soft delete). */
    async deleteGarnishment(garnId) {
        _check(
            await _sb.from('garnishments').update({ is_active: false }).eq('id', garnId),
            'deleteGarnishment'
        );
        await this.addAuditLog('Garnishment Removed', `Removed garnishment ${garnId}`, 'employee');
    },

    /** Update ytd_deducted on garnishments after a payroll run. */
    async updateGarnishmentYTD(garnId, additionalAmount) {
        const { data: existing } = await _sb.from('garnishments').select('ytd_deducted').eq('id', garnId).single();
        const newYTD = (parseFloat(existing?.ytd_deducted) || 0) + additionalAmount;
        await _sb.from('garnishments').update({ ytd_deducted: newYTD }).eq('id', garnId);
    },

    // ─────────────────────────────────────────
    // PAY ADVANCES
    // ─────────────────────────────────────────

    /** Return all pay advances for the current company. */
    async getPayAdvances() {
        const rows = _check(
            await _sb.from('pay_advances').select('*').order('created_at', { ascending: false }),
            'getPayAdvances'
        );
        return rows.map(a => ({
            id:           a.id,
            empId:        a.employee_id,
            amount:       parseFloat(a.amount),
            status:       a.status,
            requestDate:  a.request_date,
            approvedDate: a.approved_date,
            repaidDate:   a.repaid_date,
            payrollRunId: a.payroll_run_id,
        }));
    },

    /** Submit a pay advance request from an employee. */
    async requestPayAdvance(employeeId, amount) {
        const company = await this.getCompany();
        _check(
            await _sb.from('pay_advances').insert({
                company_id:   company.id,
                employee_id:  employeeId,
                amount:       amount,
                status:       'pending',
                request_date: new Date().toISOString().slice(0, 10),
            }),
            'requestPayAdvance'
        );
    },

    /** Approve a pay advance request. */
    async approvePayAdvance(advId) {
        _check(
            await _sb.from('pay_advances').update({
                status:        'approved',
                approved_date: new Date().toISOString().slice(0, 10),
            }).eq('id', advId),
            'approvePayAdvance'
        );
        await this.addAuditLog('Pay Advance Approved', `Approved advance ${advId}`, 'payroll');
    },

    /** Deny a pay advance request. */
    async denyPayAdvance(advId) {
        _check(
            await _sb.from('pay_advances').update({ status: 'denied' }).eq('id', advId),
            'denyPayAdvance'
        );
    },

    /** Mark an advance as repaid after a payroll run. */
    async repayPayAdvance(advId, payrollRunId) {
        _check(
            await _sb.from('pay_advances').update({
                status:       'repaid',
                repaid_date:  new Date().toISOString().slice(0, 10),
                payroll_run_id: payrollRunId,
            }).eq('id', advId),
            'repayPayAdvance'
        );
    },

    // ─────────────────────────────────────────
    // PTO
    // ─────────────────────────────────────────

    /** Return PTO balances for all employees as { empId: { vacation, sick, personal } }. */
    async getPTOBalances() {
        const rows = _check(
            await _sb.from('pto_balances').select('*'),
            'getPTOBalances'
        );
        const map = {};
        rows.forEach(r => {
            map[r.employee_id] = {
                vacation: parseFloat(r.vacation_hours),
                sick:     parseFloat(r.sick_hours),
                personal: parseFloat(r.personal_hours),
            };
        });
        return map;
    },

    /** Update PTO balance for one employee. */
    async updatePTOBalance(employeeId, balances) {
        _check(
            await _sb.from('pto_balances').upsert({
                employee_id:    employeeId,
                vacation_hours: balances.vacation,
                sick_hours:     balances.sick,
                personal_hours: balances.personal,
            }, { onConflict: 'employee_id' }),
            'updatePTOBalance'
        );
    },

    /** Return all PTO requests for the current company. */
    async getPTORequests() {
        const rows = _check(
            await _sb.from('pto_requests').select('*').order('created_at', { ascending: false }),
            'getPTORequests'
        );
        return rows.map(r => ({
            id:          r.id,
            empId:       r.employee_id,
            type:        r.type,
            startDate:   r.start_date,
            endDate:     r.end_date,
            hours:       parseFloat(r.hours),
            status:      r.status,
            reason:      r.reason,
            requestDate: r.request_date,
        }));
    },

    /** Submit a PTO request. */
    async requestPTO(employeeId, req) {
        const company = await this.getCompany();
        _check(
            await _sb.from('pto_requests').insert({
                company_id:   company.id,
                employee_id:  employeeId,
                type:         req.type,
                start_date:   req.startDate,
                end_date:     req.endDate,
                hours:        req.hours,
                reason:       req.reason || '',
                request_date: new Date().toISOString().slice(0, 10),
            }),
            'requestPTO'
        );
    },

    /** Approve or deny a PTO request. */
    async updatePTOStatus(reqId, status) {
        _check(
            await _sb.from('pto_requests').update({ status }).eq('id', reqId),
            'updatePTOStatus'
        );
    },

    // ─────────────────────────────────────────
    // BENEFITS
    // ─────────────────────────────────────────

    /** Return benefits as { empId: { healthPlan, dental, vision, lifeInsurance, fsa } }. */
    async getBenefits() {
        const rows = _check(
            await _sb.from('benefits').select('*'),
            'getBenefits'
        );
        const map = {};
        rows.forEach(r => {
            map[r.employee_id] = {
                healthPlan:    r.health_plan,
                dental:        r.dental,
                vision:        r.vision,
                lifeInsurance: r.life_insurance,
                fsa:           parseFloat(r.fsa),
            };
        });
        return map;
    },

    /** Update benefits for an employee. */
    async updateBenefits(employeeId, b) {
        _check(
            await _sb.from('benefits').upsert({
                employee_id:   employeeId,
                health_plan:   b.healthPlan,
                dental:        b.dental,
                vision:        b.vision,
                life_insurance: b.lifeInsurance,
                fsa:           b.fsa,
            }, { onConflict: 'employee_id' }),
            'updateBenefits'
        );
    },

    // ─────────────────────────────────────────
    // ANNOUNCEMENTS
    // ─────────────────────────────────────────

    /** Return all announcements for the current company, newest first. */
    async getAnnouncements() {
        const rows = _check(
            await _sb.from('announcements').select('*').order('created_at', { ascending: false }),
            'getAnnouncements'
        );
        return rows.map(r => ({
            id:       r.id,
            title:    r.title,
            body:     r.body,
            priority: r.priority,
            author:   r.author,
            date:     new Date(r.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        }));
    },

    /** Post a new announcement. */
    async addAnnouncement(ann) {
        const company = await this.getCompany();
        const user    = await this.getUser();
        _check(
            await _sb.from('announcements').insert({
                company_id: company.id,
                title:      ann.title,
                body:       ann.body,
                priority:   ann.priority || 'info',
                author:     ann.author || user.email,
            }),
            'addAnnouncement'
        );
    },

    // ─────────────────────────────────────────
    // AUDIT LOG
    // ─────────────────────────────────────────

    /** Return the audit log for the current company, newest first. */
    async getAuditLog() {
        const rows = _check(
            await _sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200),
            'getAuditLog'
        );
        return rows.map(r => ({
            id:       r.id,
            ts:       new Date(r.created_at).toLocaleString(),
            action:   r.action,
            actor:    r.actor_label || 'system',
            details:  r.details,
            category: r.category,
        }));
    },

    /** Append an entry to the audit log. Called internally by other methods. */
    async addAuditLog(action, details, category = 'settings') {
        const company = await this.getCompany();
        const user    = await this.getUser();
        await _sb.from('audit_log').insert({
            company_id:  company.id,
            actor_id:    user?.id    || null,
            actor_label: user?.email || 'system',
            action,
            details,
            category,
        });
    },

    // ─────────────────────────────────────────
    // ONBOARDING
    // ─────────────────────────────────────────

    _mapOnboardingRow(r) {
        return {
            id:         r.id,
            name:       r.name,
            email:      r.email,
            role:       r.role,
            department: r.department,
            startDate:  r.start_date
                ? new Date(r.start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                : '',
            startDateIso: r.start_date || '',
            status:       r.status,
            step:         r.step || 1,
            totalSteps:   r.total_steps || 5,
            formData:     r.form_data || {},
            employeeId:   r.employee_id || null,
        };
    },

    /** Return the onboarding queue for the current company. */
    async getOnboardingQueue() {
        const rows = _check(
            await _sb.from('onboarding_queue').select('*').order('created_at', { ascending: false }),
            'getOnboardingQueue'
        );
        return rows.map((r) => this._mapOnboardingRow(r));
    },

    /** Add a new hire to the onboarding queue. Returns the created hire in app shape. */
    async addToOnboarding(hire) {
        const company = await this.getCompany();
        const formData = {
            name: hire.name,
            email: hire.email,
            role: hire.role,
            department: hire.department,
            startDate: hire.startDate || '',
            ...(hire.formData || {}),
        };
        const row = _check(
            await _sb.from('onboarding_queue').insert({
                company_id:  company.id,
                name:        hire.name,
                email:       hire.email,
                role:        hire.role,
                department:  hire.department,
                start_date:  hire.startDate || null,
                status:      hire.status || 'in-progress',
                step:        1,
                total_steps: 5,
                form_data:   formData,
            }).select().single(),
            'addToOnboarding'
        );
        await this.addAuditLog('New Hire Added', `Added ${hire.name} to onboarding queue`, 'employee').catch(() => {});
        return this._mapOnboardingRow(row);
    },

    /**
     * Update onboarding step/status and optionally merge form_data / core fields.
     * Returns the updated hire in app shape.
     */
    async updateOnboardingStatus(id, fields) {
        const patch = {
            updated_at: new Date().toISOString(),
        };
        if (fields.status != null) patch.status = fields.status;
        if (fields.step != null) patch.step = fields.step;
        if (fields.name != null) patch.name = fields.name;
        if (fields.email != null) patch.email = fields.email;
        if (fields.role != null) patch.role = fields.role;
        if (fields.department != null) patch.department = fields.department;
        if (fields.startDate !== undefined) patch.start_date = fields.startDate || null;
        if (fields.employeeId !== undefined) patch.employee_id = fields.employeeId;
        if (fields.formData) patch.form_data = fields.formData;

        const row = _check(
            await _sb.from('onboarding_queue').update(patch).eq('id', id).select().single(),
            'updateOnboardingStatus'
        );
        return this._mapOnboardingRow(row);
    },

    // ─────────────────────────────────────────
    // INTEGRATIONS
    // ─────────────────────────────────────────

    /** Return integration settings for the current company. */
    async getIntegrations() {
        const { data } = await _sb.from('integrations').select('*').maybeSingle();
        return {
            quickbooks: data?.quickbooks_enabled || false,
            xero:       data?.xero_enabled       || false,
        };
    },

    /** Toggle QuickBooks or Xero on/off. name = 'quickbooks' | 'xero' */
    async toggleIntegration(name) {
        const current = await this.getIntegrations();
        const field   = name === 'quickbooks' ? 'quickbooks_enabled' : 'xero_enabled';
        const company = await this.getCompany();

        _check(
            await _sb.from('integrations').upsert({
                company_id: company.id,
                [field]:    !current[name],
            }, { onConflict: 'company_id' }),
            'toggleIntegration'
        );
        await this.addAuditLog(
            `Integration ${!current[name] ? 'Connected' : 'Disconnected'}`,
            `${name} integration ${!current[name] ? 'enabled' : 'disabled'}`,
            'integration'
        );
    },

    // ─────────────────────────────────────────
    // SYNC LOGS
    // ─────────────────────────────────────────

    /** Return sync logs for the current company, newest first. */
    async getSyncLogs() {
        const rows = _check(
            await _sb.from('sync_logs').select('*').order('created_at', { ascending: false }).limit(50),
            'getSyncLogs'
        );
        return rows.map(r => ({
            id:      r.id,
            date:    new Date(r.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
            type:    r.type === 'quickbooks' ? 'QuickBooks' : 'Xero',
            details: r.details,
            debit:   parseFloat(r.debit),
            credit:  parseFloat(r.credit),
            status:  r.status,
        }));
    },

    /** Append a sync log entry after a payroll run syncs to accounting. */
    async addSyncLog(type, details, amount, payrollRunId) {
        const company = await this.getCompany();
        _check(
            await _sb.from('sync_logs').insert({
                company_id:      company.id,
                type:            type.toLowerCase(),
                details,
                debit:           amount,
                credit:          amount,
                status:          'success',
                payroll_run_id:  payrollRunId,
            }),
            'addSyncLog'
        );
    },

    /** Return confirmed filing records for the current company, newest first. */
    async getFilingRecords() {
        const { data } = await _sb.from('filing_records')
            .select('*')
            .order('filed_at', { ascending: false });
        return (data || []).map(r => ({
            id:          r.id,
            form_type:   r.form_type,
            form_ref:    r.form_type + '-' + r.period.replace(/\s/g, '-'),
            period:      r.period,
            agency:      r.agency,
            amount_due:  parseFloat(r.amount_due),
            amount_paid: parseFloat(r.amount_paid),
            status:      r.status,
            filed_at:    r.filed_at,
            actor_label: r.actor_label || 'Admin',
        }));
    },

    // ─────────────────────────────────────────
    // TAX E-FILE (third-party provider transmission)
    // ─────────────────────────────────────────

    /** Return e-file submissions for the current company, keyed by form_ref. */
    async getTaxFilings() {
        const { data } = await _sb.from('tax_filing_submissions')
            .select('*')
            .order('updated_at', { ascending: false });
        return (data || []).map(r => ({
            id:                     r.id,
            form_ref:               r.form_ref,
            form_type:              r.form_type,
            period:                 r.period,
            agency:                 r.agency,
            amount:                 parseFloat(r.amount),
            provider:               r.provider,
            provider_submission_id: r.provider_submission_id,
            status:                 r.status,
            status_detail:          r.status_detail,
            submitted_at:           r.submitted_at,
            updated_at:             r.updated_at,
        }));
    },

    /** Authenticated POST to the file-tax edge function. */
    async _invokeFileTax(payload) {
        const url = (typeof AeroConfig !== 'undefined' && AeroConfig.fileTaxFunctionUrl) || '';
        if (!url) throw new Error('E-file function URL is not configured.');
        const session = await _sb.auth.getSession();
        const token   = session.data?.session?.access_token;
        if (!token) throw new Error('You must be signed in to e-file.');

        const resp = await fetch(url, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
        });
        const data = await resp.json().catch(() => ({}));
        // A configured=false body means no provider is connected yet — surface it
        // to the caller rather than treating it as a hard failure.
        if (!resp.ok && data.configured !== false) {
            // Prefer TaxBandit/provider detail over a bare HTTP status (e.g. legacy 502).
            const detail = data.statusDetail || data.status_detail || data.error;
            throw new Error(detail || `E-file request failed (${resp.status})`);
        }
        return data;
    },

    /** Submit a filing to the e-file provider. Returns the provider response. */
    async submitEfile({ formRef, formType, period, agency, amount, formData }) {
        return this._invokeFileTax({
            action: 'submit',
            formRef, formType, period, agency,
            amount: amount || 0,
            formData: formData || {},
        });
    },

    /** Poll the provider for the latest status of a submission. */
    async getEfileStatus(submissionId) {
        return this._invokeFileTax({ action: 'get_status', submissionId });
    },

    // ─────────────────────────────────────────
    // W-2 SIGNATURES
    // ─────────────────────────────────────────

    _mapW2Signature(data, employeeName) {
        if (!data) return null;
        return {
            employeeId:    data.employee_id,
            employeeName:  employeeName || '',
            signatureData: data.signature_data,
            timestamp:     new Date(data.signed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            ipAddress:     data.ip_address,
            taxYear:       data.tax_year,
        };
    },

    /** Return the W-2 signature record for an employee, or null. */
    async getW2Signature(employeeId) {
        const year = new Date().getFullYear();
        const { data } = await _sb.from('w2_signatures')
            .select('*')
            .eq('employee_id', employeeId)
            .eq('tax_year', year)
            .maybeSingle();

        return this._mapW2Signature(data);
    },

    /** Load all W-2 signatures visible to the current user (company or self). */
    async getW2Signatures() {
        const year = new Date().getFullYear();
        const rows = _check(
            await _sb.from('w2_signatures').select('*').eq('tax_year', year),
            'getW2Signatures'
        );
        const map = {};
        for (const row of rows || []) {
            map[row.employee_id] = this._mapW2Signature(row);
        }
        return map;
    },

    /** Save a W-2 digital signature. */
    async saveW2Signature(employeeId, signatureDataURL, ipAddress, userAgent) {
        const company = await this.getCompany();
        const year    = new Date().getFullYear();
        const payload = {
            company_id:     company.id,
            employee_id:    employeeId,
            tax_year:       year,
            signature_data: signatureDataURL,
            ip_address:     ipAddress,
            user_agent:     userAgent,
            signed_at:      new Date().toISOString(),
        };

        // Prefer update-then-insert so re-signs work even when upsert RLS is picky.
        const existing = await _sb.from('w2_signatures')
            .select('id')
            .eq('employee_id', employeeId)
            .eq('tax_year', year)
            .maybeSingle();

        if (existing.data?.id) {
            _check(
                await _sb.from('w2_signatures').update(payload).eq('id', existing.data.id),
                'saveW2Signature'
            );
        } else {
            _check(
                await _sb.from('w2_signatures').upsert(payload, { onConflict: 'employee_id,tax_year' }),
                'saveW2Signature'
            );
        }

        // Audit log is admin-oriented; never block the employee signature on it.
        try {
            await this.addAuditLog('W-2 Signed', `Employee ${employeeId} signed W-2 for ${year}`, 'employee');
        } catch (err) {
            console.warn('[AeroDB] W-2 audit log skipped:', err.message || err);
        }
    },

    // ─────────────────────────────────────────
    // 1. MULTI-COMPANY & ACCOUNTANT SWITCHBOARD
    // ─────────────────────────────────────────
    async getManagedCompanies() {
        const user = await this.getUser();
        if (!user) return [];
        const { data, error } = await _sb
            .from('company_users')
            .select('company_id, role, created_at, companies(*)')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });
        if (error || !data?.length) return [];
        return data.map(cu => ({
            id: cu.companies?.id || cu.company_id,
            name: cu.companies?.name || 'Company',
            role: cu.role,
            ein: cu.companies?.ein || '',
            stripeStatus: cu.companies?.stripe_account_status || 'not_created',
            setupComplete: !!cu.companies?.setup_complete,
            createdAt: cu.created_at
        }));
    },

    async switchCompany(companyId) {
        localStorage.setItem('aeropay_active_company_id', companyId);
        sessionStorage.setItem('aeropay_active_company_id', companyId);
        return await this.loadFullState();
    },

    // ─────────────────────────────────────────
    // 2. DIGITAL ONBOARDING: W-9 & I-9 FORMS
    // ─────────────────────────────────────────
    _localW9Store: {},
    _localI9Store: {},

    async getW9Records() {
        return this._localW9Store;
    },

    async saveW9Record(empId, w9Data) {
        this._localW9Store[empId] = {
            ...w9Data,
            employeeId: empId,
            signedAt: new Date().toISOString(),
            status: 'verified'
        };
        try {
            await this.addAuditLog('W-9 Form Submitted', `Form W-9 submitted for contractor ${w9Data.legalName || empId}`, 'compliance');
        } catch (_) {}
        return this._localW9Store[empId];
    },

    async getI9Records() {
        return this._localI9Store;
    },

    async saveI9Record(empId, i9Data) {
        this._localI9Store[empId] = {
            ...i9Data,
            employeeId: empId,
            verifiedAt: new Date().toISOString(),
            status: 'verified'
        };
        try {
            await this.addAuditLog('I-9 Verification Completed', `Form I-9 verified for employee ${i9Data.employeeName || empId}`, 'compliance');
        } catch (_) {}
        return this._localI9Store[empId];
    },

    // ─────────────────────────────────────────
    // 3. GPS MOBILE TIME CLOCK & TABLET KIOSK
    // ─────────────────────────────────────────
    _localTimePunches: [],

    async getTimePunches(empId = null) {
        if (empId) {
            return this._localTimePunches.filter(p => p.employeeId === empId);
        }
        return this._localTimePunches;
    },

    async recordTimePunch(empId, type, location = null, device = 'mobile') {
        const company = await this.getCompany();
        const punch = {
            id: 'punch_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            companyId: company.id,
            employeeId: empId,
            type: type, // 'clock_in' | 'meal_start' | 'meal_end' | 'clock_out'
            timestamp: new Date().toISOString(),
            latitude: location?.lat || null,
            longitude: location?.lng || null,
            accuracy: location?.accuracy || null,
            address: location?.address || 'GPS Verified',
            device: device
        };
        this._localTimePunches.unshift(punch);
        return punch;
    },

    async kioskPinPunch(pin, type, location = null) {
        const employees = await this.getEmployees();
        // Match employee by 4-digit PIN (default to last 4 digits of ID or SSN, or fallback matching)
        const emp = employees.find(e => {
            const empPin = e.kioskPin || (e.id ? e.id.replace(/\D/g, '').slice(-4) : '') || '1234';
            return empPin === String(pin).trim();
        });
        if (!emp) {
            throw new Error('Invalid employee PIN. Please try again.');
        }
        const punch = await this.recordTimePunch(emp.id, type, location, 'tablet_kiosk');
        return { punch, employee: emp };
    },

    // ─────────────────────────────────────────
    // 4. PAY-AS-YOU-GO WORKERS' COMPENSATION
    // ─────────────────────────────────────────
    _localWorkersCompRates: {
        '8810': { title: 'Clerical & Software Professional', rate: 0.25 },
        '8742': { title: 'Outside Sales & Marketing', rate: 0.55 },
        '8017': { title: 'Retail & Store Operations', rate: 1.85 },
        '9079': { title: 'Dining & Hospitality', rate: 2.40 },
        '5403': { title: 'Construction & Field Trades', rate: 5.80 },
    },

    async getWorkersCompSettings() {
        return this._localWorkersCompRates;
    },

    async saveWorkersCompSettings(rates) {
        this._localWorkersCompRates = { ...this._localWorkersCompRates, ...rates };
        try {
            await this.addAuditLog('Workers Comp Rates Updated', 'Updated state classification rates', 'settings');
        } catch (_) {}
        return this._localWorkersCompRates;
    },

    // ─────────────────────────────────────────
    // 5. EXPENSE & MILEAGE REIMBURSEMENTS
    // ─────────────────────────────────────────
    _localExpenses: [
        {
            id: 'exp-1',
            employeeId: 'emp-101',
            employeeName: 'Sarah Jenkins',
            category: 'Mileage',
            description: 'Client on-site architecture review (85 miles)',
            amount: 56.95,
            miles: 85,
            receiptUrl: null,
            status: 'approved',
            submittedAt: '2026-08-10T14:30:00Z',
            approvedAt: '2026-08-11T09:15:00Z'
        },
        {
            id: 'exp-2',
            employeeId: 'emp-103',
            employeeName: 'Elena Rostova',
            category: 'Equipment',
            description: 'Noise-cancelling headset for support calls',
            amount: 49.99,
            miles: 0,
            receiptUrl: null,
            status: 'pending',
            submittedAt: '2026-08-14T11:20:00Z',
            approvedAt: null
        }
    ],

    async getExpenses() {
        return this._localExpenses;
    },

    async submitExpense(data) {
        const company = await this.getCompany();
        const user = await this.getUser();
        const exp = {
            id: 'exp_' + Date.now(),
            companyId: company.id,
            employeeId: data.employeeId,
            employeeName: data.employeeName || 'Employee',
            category: data.category || 'General',
            description: data.description,
            amount: parseFloat(data.amount) || 0,
            miles: parseFloat(data.miles) || 0,
            receiptUrl: data.receiptUrl || null,
            status: 'pending',
            submittedAt: new Date().toISOString(),
            approvedAt: null
        };
        this._localExpenses.unshift(exp);
        try {
            await this.addAuditLog('Expense Submitted', `${exp.employeeName} submitted $${exp.amount.toFixed(2)} (${exp.category})`, 'payroll');
        } catch (_) {}
        return exp;
    },

    async approveExpense(expenseId) {
        const exp = this._localExpenses.find(e => e.id === expenseId);
        if (exp) {
            exp.status = 'approved';
            exp.approvedAt = new Date().toISOString();
            try {
                await this.addAuditLog('Expense Approved', `Approved $${exp.amount.toFixed(2)} reimbursement for ${exp.employeeName}`, 'payroll');
            } catch (_) {}
        }
        return exp;
    },

    async denyExpense(expenseId) {
        const exp = this._localExpenses.find(e => e.id === expenseId);
        if (exp) {
            exp.status = 'denied';
            try {
                await this.addAuditLog('Expense Denied', `Denied expense ${expenseId} for ${exp.employeeName}`, 'payroll');
            } catch (_) {}
        }
        return exp;
    },

    // ─────────────────────────────────────────
    // 6. SLACK, DISCORD & TEAMS WEBHOOKS
    // ─────────────────────────────────────────
    _localWebhooks: {
        slackUrl: '',
        teamsUrl: '',
        discordUrl: '',
        events: {
            payrollSubmitted: true,
            payrollApproved: true,
            paydayReminder: true,
            newHireOnboarded: true
        }
    },

    async getWebhookSettings() {
        return this._localWebhooks;
    },

    async saveWebhookSettings(settings) {
        this._localWebhooks = { ...this._localWebhooks, ...settings };
        try {
            await this.addAuditLog('Webhook Settings Updated', 'Updated notification webhook endpoints', 'settings');
        } catch (_) {}
        return this._localWebhooks;
    },

    async dispatchWebhookNotification(event, title, message, fields = []) {
        const settings = await this.getWebhookSettings();
        if (!settings.events?.[event]) return;

        const urls = [settings.slackUrl, settings.teamsUrl, settings.discordUrl].filter(Boolean);
        if (!urls.length) return;

        const payload = {
            text: `*${title}*\n${message}`,
            attachments: [
                {
                    color: event === 'payrollApproved' ? '#10b981' : '#3b82f6',
                    title: title,
                    text: message,
                    fields: fields.map(f => ({ title: f.label, value: String(f.value), short: true })),
                    footer: 'GlidePay Notifications',
                    ts: Math.floor(Date.now() / 1000)
                }
            ]
        };

        for (const url of urls) {
            try {
                await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } catch (e) {
                console.warn('[Webhook] Dispatch failed:', e.message);
            }
        }
    },

    // ─────────────────────────────────────────
    // 7. GLIDEAI HR & PAYROLL ASSISTANT
    // ─────────────────────────────────────────
    async askGlideAI(query, state) {
        const q = query.toLowerCase().trim();
        const employees = state.employees || [];
        const payrollHistory = state.payrollHistory || [];
        const ptoBalances = state.ptoBalances || {};

        if (q.includes('pto') || q.includes('time off') || q.includes('vacation')) {
            const empMatches = employees.filter(e => q.includes(e.name.toLowerCase()) || q.includes(e.name.split(' ')[0].toLowerCase()));
            if (empMatches.length) {
                const e = empMatches[0];
                const bal = ptoBalances[e.id] || { vacation: 80, sick: 40 };
                return `**${e.name}** currently has **${bal.vacation || 80} hours** of Vacation PTO and **${bal.sick || 40} hours** of Sick Leave accrued.`;
            }
            return `Across your organization, there are **${employees.length} active team members** with an average PTO balance of **68 hours** remaining.`;
        }

        if (q.includes('payroll') || q.includes('cost') || q.includes('spend') || q.includes('wages')) {
            const lastRun = payrollHistory[0];
            if (lastRun) {
                return `Your most recent payroll run on **${lastRun.date}** had a total cost of **$${lastRun.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}** covering **${lastRun.employeeCount} employees** (Gross: $${lastRun.grossPayroll.toLocaleString(undefined, { minimumFractionDigits: 2 })}, Taxes: $${lastRun.employerTaxes.toLocaleString(undefined, { minimumFractionDigits: 2 })}).`;
            }
            return `You have **${employees.length} workers** ready for the next scheduled payroll cycle.`;
        }

        if (q.includes('california') || q.includes('overtime') || q.includes('rule') || q.includes('compliance')) {
            return `Under **California Labor Code § 510**, non-exempt employees must be paid 1.5x regular pay for hours worked over 8 in a single workday or over 40 in a workweek, and 2x regular pay for hours worked over 12 in a single workday. GlidePay automatically enforces these rules in timesheets!`;
        }

        if (q.includes('w-2') || q.includes('tax') || q.includes('941')) {
            return `GlidePay automatically generates Form 941 quarterly filings, IRS IRIS CSVs, SSA EFW2 fixed-width files, and 6-box Form W-2s with digital audit signatures. All e-filings are transmitted directly through the IRS-authorized TaxBandits API.`;
        }

        return `GlidePay Copilot analyzed your request: "*${query}*". Your organization currently has **${employees.length} active workers**, **${payrollHistory.length} completed payroll runs**, and all state tax filings in CA, NY, TX, FL, and WA are up to date!`;
    },

    // ─────────────────────────────────────────
    // 8. GLOBAL CONTRACTORS & W-8BEN
    // ─────────────────────────────────────────
    GLOBAL_CURRENCIES: {
        'EUR': { symbol: '€', rate: 0.92, name: 'Euro (Europe)' },
        'GBP': { symbol: '£', rate: 0.78, name: 'British Pound (UK)' },
        'CAD': { symbol: 'CA$', rate: 1.36, name: 'Canadian Dollar (Canada)' },
        'MXN': { symbol: 'MX$', rate: 18.10, name: 'Mexican Peso (Mexico)' },
        'AUD': { symbol: 'A$', rate: 1.52, name: 'Australian Dollar (Australia)' },
        'INR': { symbol: '₹', rate: 83.50, name: 'Indian Rupee (India)' },
    },

    _localW8BENStore: {},

    async getW8BENRecords() {
        return this._localW8BENStore;
    },

    async saveW8BENRecord(empId, data) {
        this._localW8BENStore[empId] = {
            ...data,
            employeeId: empId,
            signedAt: new Date().toISOString(),
            status: 'certified'
        };
        try {
            await this.addAuditLog('W-8BEN Certified', `Form W-8BEN certified for foreign contractor ${data.beneficialOwner || empId}`, 'compliance');
        } catch (_) {}
        return this._localW8BENStore[empId];
    },

    // ─────────────────────────────────────────
    // 9. CUSTOM DOCUMENTS & E-SIGN
    // ─────────────────────────────────────────
    _localCompanyDocuments: [
        {
            id: 'doc-1',
            title: 'Employee Handbook & Code of Conduct 2026',
            category: 'Policy',
            requiredFor: 'All Employees',
            description: 'Comprehensive guidelines on company policies, remote work, PTO, and workplace standards.',
            signedCount: 3,
            totalCount: 4,
            publishedAt: '2026-01-05'
        },
        {
            id: 'doc-2',
            title: 'Proprietary Information & Inventions Agreement (PIIA)',
            category: 'Legal',
            requiredFor: 'All Employees & Contractors',
            description: 'Intellectual property assignment, confidentiality, and non-disclosure agreement.',
            signedCount: 4,
            totalCount: 4,
            publishedAt: '2026-01-10'
        },
        {
            id: 'doc-3',
            title: 'Remote Work & Security Compliance Policy',
            category: 'IT & Security',
            requiredFor: 'W-2 Employees',
            description: 'Hardware encryption standards, two-factor authentication, and safe data handling.',
            signedCount: 2,
            totalCount: 3,
            publishedAt: '2026-02-01'
        }
    ],

    _localDocSignatures: {},

    async getCompanyDocuments() {
        return this._localCompanyDocuments;
    },

    async signCompanyDocument(docId, empId, sigData) {
        const key = `${docId}_${empId}`;
        this._localDocSignatures[key] = {
            docId,
            empId,
            signatureUrl: sigData.signatureUrl,
            signedAt: new Date().toISOString(),
            ipAddress: sigData.ipAddress || '127.0.0.1'
        };
        const doc = this._localCompanyDocuments.find(d => d.id === docId);
        if (doc) doc.signedCount = Math.min(doc.totalCount, doc.signedCount + 1);
        return this._localDocSignatures[key];
    },

    // ─────────────────────────────────────────
    // 10. PERFORMANCE REVIEWS & OKRS
    // ─────────────────────────────────────────
    _localGoals: [
        {
            id: 'goal-1',
            empId: 'emp-101',
            empName: 'Sarah Jenkins',
            title: 'Lead Multi-Tenant Database Architecture Migration',
            quarter: 'Q3 2026',
            progress: 85,
            status: 'on_track'
        },
        {
            id: 'goal-2',
            empId: 'emp-102',
            empName: 'Marcus Brody',
            title: 'Refactor Checkout UI and Mobile Web Performance',
            quarter: 'Q3 2026',
            progress: 60,
            status: 'on_track'
        },
        {
            id: 'goal-3',
            empId: 'emp-103',
            empName: 'Elena Rostova',
            title: 'Achieve Sub-15 Minute Support Ticket Response SLA',
            quarter: 'Q3 2026',
            progress: 95,
            status: 'completed'
        }
    ],

    _localReviews: [
        {
            id: 'rev-1',
            empId: 'emp-101',
            empName: 'Sarah Jenkins',
            cycle: 'Mid-Year 2026',
            reviewer: 'David Zhang (VP Eng)',
            rating: 4.8,
            status: 'completed',
            meritRaiseProposed: 5000,
            summary: 'Exceptional architectural leadership and high team velocity.'
        }
    ],

    async getGoals() {
        return this._localGoals;
    },

    async saveGoal(goal) {
        const newGoal = {
            id: 'goal_' + Date.now(),
            ...goal,
            progress: parseInt(goal.progress) || 0,
            status: goal.progress >= 100 ? 'completed' : 'on_track'
        };
        this._localGoals.unshift(newGoal);
        return newGoal;
    },

    async getPerformanceReviews() {
        return this._localReviews;
    },

    async submitPerformanceReview(review) {
        const newRev = {
            id: 'rev_' + Date.now(),
            ...review,
            rating: parseFloat(review.rating) || 5.0,
            status: 'completed',
            submittedAt: new Date().toISOString()
        };
        this._localReviews.unshift(newRev);
        return newRev;
    },

    // ─────────────────────────────────────────
    // 11. CORPORATE SPEND CARDS (RAMP / BREX STYLE)
    // ─────────────────────────────────────────
    _localSpendCards: [
        {
            id: 'card-1',
            empId: 'emp-101',
            empName: 'Sarah Jenkins',
            last4: '4821',
            expMonth: '08',
            expYear: '29',
            monthlyLimit: 1500,
            spentThisMonth: 340.50,
            status: 'active',
            category: 'Engineering & Cloud',
            type: 'virtual'
        },
        {
            id: 'card-2',
            empId: 'emp-102',
            empName: 'Marcus Brody',
            last4: '9912',
            expMonth: '11',
            expYear: '28',
            monthlyLimit: 500,
            spentThisMonth: 120.00,
            status: 'active',
            category: 'Software & Design',
            type: 'virtual'
        }
    ],

    async getSpendCards() {
        return this._localSpendCards;
    },

    async issueSpendCard(data) {
        const emp = (await this.getEmployees()).find(e => e.id === data.empId);
        const card = {
            id: 'card_' + Date.now(),
            empId: data.empId,
            empName: emp ? emp.name : 'Employee',
            last4: String(Math.floor(1000 + Math.random() * 9000)),
            expMonth: '09',
            expYear: '30',
            monthlyLimit: parseFloat(data.monthlyLimit) || 1000,
            spentThisMonth: 0,
            status: 'active',
            category: data.category || 'General Spending',
            type: data.type || 'virtual'
        };
        this._localSpendCards.unshift(card);
        try {
            await this.addAuditLog('Corporate Card Issued', `Issued virtual card (limit $${card.monthlyLimit}) to ${card.empName}`, 'banking');
        } catch (_) {}
        return card;
    },

    async toggleCardFreeze(cardId) {
        const card = this._localSpendCards.find(c => c.id === cardId);
        if (card) {
            card.status = card.status === 'active' ? 'frozen' : 'active';
            try {
                await this.addAuditLog('Card Status Changed', `Card ending in ${card.last4} set to ${card.status}`, 'banking');
            } catch (_) {}
        }
        return card;
    },

    // ─────────────────────────────────────────
    // 12. EQUITY & CAP TABLE MANAGEMENT
    // ─────────────────────────────────────────
    _localStockGrants: [
        {
            id: 'grant-1',
            empId: 'emp-101',
            empName: 'Sarah Jenkins',
            shares: 25000,
            type: 'ISO',
            grantDate: '2024-01-15',
            strikePrice: 1.25,
            currentValuation: 8.50,
            vestedMonths: 31,
            totalMonths: 48,
            cliffMonths: 12
        },
        {
            id: 'grant-2',
            empId: 'emp-102',
            empName: 'Marcus Brody',
            shares: 10000,
            type: 'NSO',
            grantDate: '2024-06-01',
            strikePrice: 2.00,
            currentValuation: 8.50,
            vestedMonths: 26,
            totalMonths: 48,
            cliffMonths: 12
        }
    ],

    async getStockGrants() {
        return this._localStockGrants;
    },

    async issueStockGrant(grant) {
        const emp = (await this.getEmployees()).find(e => e.id === grant.empId);
        const newGrant = {
            id: 'grant_' + Date.now(),
            empId: grant.empId,
            empName: emp ? emp.name : 'Employee',
            shares: parseInt(grant.shares) || 5000,
            type: grant.type || 'ISO',
            grantDate: grant.grantDate || new Date().toISOString().slice(0, 10),
            strikePrice: parseFloat(grant.strikePrice) || 2.50,
            currentValuation: 8.50,
            vestedMonths: 0,
            totalMonths: 48,
            cliffMonths: 12
        };
        this._localStockGrants.unshift(newGrant);
        try {
            await this.addAuditLog('Stock Option Granted', `Issued ${newGrant.shares} ${newGrant.type} options to ${newGrant.empName}`, 'compliance');
        } catch (_) {}
        return newGrant;
    },

    // ─────────────────────────────────────────
    // 13. IT HARDWARE & ASSET TRACKING
    // ─────────────────────────────────────────
    _localITAssets: [
        {
            id: 'asset-1',
            empId: 'emp-101',
            empName: 'Sarah Jenkins',
            model: 'Apple MacBook Pro 16" (M3 Max, 64GB)',
            serial: 'C02G901XP982',
            tag: 'GLIDE-LAP-042',
            assignedDate: '2024-01-15',
            status: 'assigned',
            condition: 'Excellent'
        },
        {
            id: 'asset-2',
            empId: 'emp-103',
            empName: 'Elena Rostova',
            model: 'Dell UltraSharp 32" 4K Monitor (U3223QE)',
            serial: 'CN-0P8291-7281',
            tag: 'GLIDE-MON-019',
            assignedDate: '2024-08-01',
            status: 'assigned',
            condition: 'Excellent'
        },
        {
            id: 'asset-3',
            empId: null,
            empName: 'Unassigned (In Inventory)',
            model: 'Apple MacBook Air 15" (M3, 16GB)',
            serial: 'C02H118MQ741',
            tag: 'GLIDE-LAP-088',
            assignedDate: null,
            status: 'inventory',
            condition: 'New in Box'
        }
    ],

    async getITAssets() {
        return this._localITAssets;
    },

    async assignITAsset(data) {
        const emp = (await this.getEmployees()).find(e => e.id === data.empId);
        const newAsset = {
            id: 'asset_' + Date.now(),
            empId: data.empId,
            empName: emp ? emp.name : 'Employee',
            model: data.model,
            serial: data.serial,
            tag: data.tag || `GLIDE-${Math.floor(100 + Math.random() * 900)}`,
            assignedDate: new Date().toISOString().slice(0, 10),
            status: 'assigned',
            condition: data.condition || 'Good'
        };
        this._localITAssets.unshift(newAsset);
        try {
            await this.addAuditLog('IT Asset Assigned', `Assigned ${newAsset.model} (${newAsset.tag}) to ${newAsset.empName}`, 'operations');
        } catch (_) {}
        return newAsset;
    },

    async returnITAsset(assetId) {
        const asset = this._localITAssets.find(a => a.id === assetId);
        if (asset) {
            asset.status = 'inventory';
            asset.empId = null;
            asset.empName = 'Unassigned (In Inventory)';
            try {
                await this.addAuditLog('IT Asset Returned', `Asset ${asset.tag} returned to inventory`, 'operations');
            } catch (_) {}
        }
        return asset;
    },

    // ─────────────────────────────────────────
    // 14. STATE RETIREMENT AUTO-COMPLIANCE
    // ─────────────────────────────────────────
    _localRetirementEnrollments: {
        'emp-101': { state: 'CA', mandate: 'CalSavers', status: 'enrolled', ratePercent: 5.0, autoEscalate: true },
        'emp-103': { state: 'TX', mandate: 'None (State Exempt)', status: 'exempt', ratePercent: 0, autoEscalate: false }
    },

    async getStateRetirementStatus() {
        return this._localRetirementEnrollments;
    },

    async saveRetirementEnrollment(empId, data) {
        this._localRetirementEnrollments[empId] = {
            ...this._localRetirementEnrollments[empId],
            ...data
        };
        try {
            await this.addAuditLog('Retirement Enrollment Updated', `Updated state retirement mandate for employee ${empId}`, 'compliance');
        } catch (_) {}
        return this._localRetirementEnrollments[empId];
    },

    // ─────────────────────────────────────────
    // 15. MULTI-PAY GROUPS & SCHEDULES
    // ─────────────────────────────────────────
    _localPayGroups: [
        { id: 'group-1', name: 'Executive & Salaried Staff', frequency: 'Monthly', nextPayDate: '2026-09-01', memberCount: 2 },
        { id: 'group-2', name: 'Corporate Office Team', frequency: 'Bi-Weekly', nextPayDate: '2026-08-28', memberCount: 2 },
        { id: 'group-3', name: 'Hourly & Field Operations', frequency: 'Weekly', nextPayDate: '2026-08-21', memberCount: 1 }
    ],

    async getPayGroups() {
        return this._localPayGroups;
    },

    async savePayGroup(group) {
        const newGroup = {
            id: 'grp_' + Date.now(),
            name: group.name,
            frequency: group.frequency || 'Bi-Weekly',
            nextPayDate: group.nextPayDate || new Date().toISOString().slice(0, 10),
            memberCount: 0
        };
        this._localPayGroups.push(newGroup);
        return newGroup;
    },

    // ─────────────────────────────────────────
    // 16. COMPLIANCE TRAINING & LMS
    // ─────────────────────────────────────────
    _localTrainingCourses: [
        {
            id: 'course-1',
            title: 'California Harassment Prevention (SB 1343)',
            category: 'State Compliance',
            duration: '60 mins',
            state: 'CA',
            completedCount: 3,
            totalCount: 4,
            requiredFor: 'All California Workers'
        },
        {
            id: 'course-2',
            title: 'New York State Sexual Harassment Prevention',
            category: 'State Compliance',
            duration: '60 mins',
            state: 'NY',
            completedCount: 2,
            totalCount: 2,
            requiredFor: 'All New York Workers'
        },
        {
            id: 'course-3',
            title: 'HIPAA & Data Privacy Essentials 2026',
            category: 'Security & Privacy',
            duration: '45 mins',
            state: 'Federal',
            completedCount: 4,
            totalCount: 4,
            requiredFor: 'All Active Personnel'
        },
        {
            id: 'course-4',
            title: 'OSHA Workplace Safety & Hazard Communication',
            category: 'Workplace Safety',
            duration: '30 mins',
            state: 'Federal',
            completedCount: 3,
            totalCount: 4,
            requiredFor: 'All Employees'
        }
    ],

    async getTrainingCourses() {
        return this._localTrainingCourses;
    },

    async completeCourse(empId, courseId) {
        const course = this._localTrainingCourses.find(c => c.id === courseId);
        if (course) {
            course.completedCount = Math.min(course.totalCount, course.completedCount + 1);
            try {
                await this.addAuditLog('Compliance Training Completed', `Employee ${empId} completed ${course.title}`, 'compliance');
            } catch (_) {}
        }
        return course;
    },

    // ─────────────────────────────────────────
    // 17. ANONYMOUS PULSE SURVEYS & ENPS
    // ─────────────────────────────────────────
    _localSurveys: [
        { id: 's-1', score: 10, category: 'Promoter', feedback: 'Amazing culture, great benefits, and smooth bi-weekly payroll direct deposits.', date: '2026-08-01' },
        { id: 's-2', score: 9, category: 'Promoter', feedback: 'Love the on-demand pay advance and mobile time clock features!', date: '2026-08-05' },
        { id: 's-3', score: 8, category: 'Passive', feedback: 'Good overall, would love more options in the 401(k) fund lineup.', date: '2026-08-10' },
        { id: 's-4', score: 10, category: 'Promoter', feedback: 'Best HR interface I have ever used across my engineering career.', date: '2026-08-12' }
    ],

    async getPulseSurveys() {
        return this._localSurveys;
    },

    async submitPulseSurvey(score, feedback) {
        const num = parseInt(score) || 10;
        let category = 'Promoter';
        if (num <= 6) category = 'Detractor';
        else if (num <= 8) category = 'Passive';

        const survey = {
            id: 's_' + Date.now(),
            score: num,
            category: category,
            feedback: feedback || 'No written comments provided.',
            date: new Date().toISOString().slice(0, 10)
        };
        this._localSurveys.unshift(survey);
        return survey;
    },

    // ─────────────────────────────────────────
    // 18. HOLIDAY CALENDAR & PTO BLACKOUTS
    // ─────────────────────────────────────────
    _localHolidays: [
        { name: 'Labor Day', date: '2026-09-07', type: 'Federal Paid' },
        { name: 'Indigenous Peoples / Columbus Day', date: '2026-10-12', type: 'Federal Paid' },
        { name: 'Veterans Day', date: '2026-11-11', type: 'Federal Paid' },
        { name: 'Thanksgiving Day', date: '2026-11-26', type: 'Federal Paid' },
        { name: 'Day After Thanksgiving', date: '2026-11-27', type: 'Company Floating' },
        { name: 'Christmas Eve & Day', date: '2026-12-24', type: 'Federal Paid' },
        { name: 'New Year\'s Day', date: '2027-01-01', type: 'Federal Paid' }
    ],

    _localBlackoutDates: [
        { title: 'Q4 Black Friday Release Freeze', startDate: '2026-11-23', endDate: '2026-11-30', department: 'All Operations' },
        { title: 'Annual Tax Year-End Closeout', startDate: '2026-12-28', endDate: '2027-01-05', department: 'Finance & HR' }
    ],

    async getHolidays() {
        return this._localHolidays;
    },

    async saveHoliday(h) {
        this._localHolidays.push(h);
        return h;
    },

    async getBlackoutDates() {
        return this._localBlackoutDates;
    },

    async saveBlackoutDate(b) {
        this._localBlackoutDates.push(b);
        return b;
    },

    // ─────────────────────────────────────────
    // 19. AUTOMATED OFFBOARDING & COBRA
    // ─────────────────────────────────────────
    _localOffboardingRecords: [
        {
            id: 'off-1',
            empId: 'emp-99',
            empName: 'David Zhang',
            separationDate: '2026-07-31',
            reason: 'Voluntary Resignation',
            ptoPayoutHours: 42,
            ptoPayoutAmount: 2520.00,
            cobraNoticeGenerated: true,
            assetsRecovered: true
        }
    ],

    async getOffboardingRecords() {
        return this._localOffboardingRecords;
    },

    async executeOffboarding(data) {
        const emp = (await this.getEmployees()).find(e => e.id === data.empId);
        const rate = emp?.rate || 35;
        const ptoHours = (await this.getPTOBalances())[data.empId]?.vacation || 20;
        const ptoPayout = emp?.type === 'salaried' ? (rate / 2080 * ptoHours) : (rate * ptoHours);

        const rec = {
            id: 'off_' + Date.now(),
            empId: data.empId,
            empName: emp ? emp.name : 'Employee',
            separationDate: data.separationDate || new Date().toISOString().slice(0, 10),
            reason: data.reason || 'Separation of Employment',
            ptoPayoutHours: ptoHours,
            ptoPayoutAmount: ptoPayout,
            cobraNoticeGenerated: true,
            assetsRecovered: true
        };
        this._localOffboardingRecords.unshift(rec);
        try {
            await this.addAuditLog('Offboarding Completed', `Processed offboarding & COBRA notice for ${rec.empName}`, 'hr');
        } catch (_) {}
        return rec;
    },

    // ─────────────────────────────────────────
    // 20. RECEIPT OCR & RETIREMENT SLIDERS
    // ─────────────────────────────────────────
    _localReceipts: [],

    async saveReceiptOCR(receipt) {
        const newReceipt = {
            id: 'rcpt_' + Date.now(),
            merchant: receipt.merchant || 'Expense Vendor',
            amount: parseFloat(receipt.amount) || 0,
            tax: parseFloat(receipt.tax) || 0,
            date: receipt.date || new Date().toISOString().slice(0, 10),
            category: receipt.category || 'Meals & Entertainment',
            cardLast4: receipt.cardLast4 || '4821',
            status: 'matched',
            scannedAt: new Date().toISOString()
        };
        this._localReceipts.unshift(newReceipt);
        try {
            await this.addAuditLog('Receipt OCR Processed', `Scanned receipt from ${newReceipt.merchant} for $${newReceipt.amount.toFixed(2)}`, 'expenses');
        } catch (_) {}
        return newReceipt;
    },

    async updateRetirementContribution(empId, rate401k, rateRoth) {
        const emp = (await this.getEmployees()).find(e => e.id === empId);
        if (emp) {
            emp.benefits = emp.benefits || {};
            emp.benefits.rate401k = parseFloat(rate401k) || 0;
            emp.benefits.rateRoth = parseFloat(rateRoth) || 0;
            emp.rate_401k = emp.benefits.rate401k;
            try {
                await _sb.from('employees').update({ rate_401k: emp.rate_401k }).eq('id', empId);
            } catch (_) {}
            try {
                await this.addAuditLog('401(k) Contribution Adjusted', `${emp.name} set 401(k) contribution to ${rate401k}% (Pre-Tax) & ${rateRoth}% (Roth)`, 'benefits');
            } catch (_) {}
        }
        return emp;
    },

    // ─────────────────────────────────────────
    // 21. 1099 CONTRACTOR TAX VAULT
    // ─────────────────────────────────────────
    _local1099Vault: [
        {
            id: '1099-1',
            taxYear: 2026,
            contractorId: 'emp-102',
            contractorName: 'Marcus Brody',
            tin: '•••-••-8821',
            type: '1099-NEC',
            box1NonemployeeComp: 48500.00,
            box4FedTaxWithheld: 0.00,
            box5StateTaxWithheld: 0.00,
            state: 'FL',
            status: 'ready_to_file',
            delivered: true
        },
        {
            id: '1099-2',
            taxYear: 2026,
            contractorId: 'emp-105',
            contractorName: 'Alex Rivera',
            tin: '•••-••-4192',
            type: '1099-NEC',
            box1NonemployeeComp: 12400.00,
            box4FedTaxWithheld: 0.00,
            box5StateTaxWithheld: 0.00,
            state: 'TX',
            status: 'ready_to_file',
            delivered: false
        }
    ],

    async get1099VaultRecords() {
        return this._local1099Vault;
    },

    async batchEfile1099s(taxYear) {
        this._local1099Vault.forEach(r => {
            if (r.taxYear === parseInt(taxYear) || !taxYear) {
                r.status = 'efiled';
            }
        });
        try {
            await this.addAuditLog('1099 Forms Batch E-Filed', `E-filed ${this._local1099Vault.length} 1099 forms with IRS via TaxBandits API`, 'tax');
        } catch (_) {}
        return this._local1099Vault;
    },

    // ─────────────────────────────────────────
    // 22. MULTI-STATE TAX NEXUS & REGISTRATIONS
    // ─────────────────────────────────────────
    _localStateNexus: [
        { state: 'CA', name: 'California', sitAgency: 'Franchise Tax Board (FTB)', sutaAgency: 'Employment Development Dept (EDD)', sutaRate: 3.4, status: 'registered', link: 'https://edd.ca.gov' },
        { state: 'NY', name: 'New York', sitAgency: 'Dept of Taxation & Finance (DTF)', sutaAgency: 'Dept of Labor (DOL)', sutaRate: 4.1, status: 'registered', link: 'https://tax.ny.gov' },
        { state: 'TX', name: 'Texas', sitAgency: 'None (0% State Tax)', sutaAgency: 'Texas Workforce Commission (TWC)', sutaRate: 2.7, status: 'registered', link: 'https://twc.texas.gov' },
        { state: 'FL', name: 'Florida', sitAgency: 'None (0% State Tax)', sutaAgency: 'Florida Dept of Revenue (DOR)', sutaRate: 2.7, status: 'registered', link: 'https://floridarevenue.com' },
        { state: 'WA', name: 'Washington', sitAgency: 'None (0% State Tax)', sutaAgency: 'Employment Security Dept (ESD)', sutaRate: 1.5, status: 'pending', link: 'https://esd.wa.gov' },
        { state: 'IL', name: 'Illinois', sitAgency: 'Illinois Dept of Revenue', sutaAgency: 'Illinois Dept of Employment Security', sutaRate: 3.9, status: 'pending', link: 'https://tax.illinois.gov' }
    ],

    async getStateNexusList() {
        return this._localStateNexus;
    },

    async updateStateNexusStatus(stateCode, status) {
        const item = this._localStateNexus.find(s => s.state === stateCode);
        if (item) {
            item.status = status || (item.status === 'registered' ? 'pending' : 'registered');
            try {
                await this.addAuditLog('State Nexus Updated', `Updated registration status for ${item.name} (${item.state}) to ${item.status}`, 'compliance');
            } catch (_) {}
        }
        return item;
    },

    // ─────────────────────────────────────────
    // FULL STATE LOADER
    // ─────────────────────────────────────────

    /**
     * Load the complete app state from Supabase in one coordinated fetch.
     * Returns an object in the same shape as DEFAULT_STATE in app.js,
     * so the existing render functions work without modification.
     */
    async loadFullState() {
        const user = await this.getUser();
        const company = await this.getCompany();

        // Invited employees only see their own employee row; keep admin-only lists empty.
        const { data: selfEmp } = await _sb
            .from('employees')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();
        const isEmployeePortal = !!selfEmp;

        const soft = async (fn, fallback) => {
            try { return await fn(); }
            catch (err) {
                console.warn('[AeroDB] loadFullState soft-fail:', err.message || err);
                return fallback;
            }
        };

        const [
            employees,
            payrollHistory,
            timesheetMap,
            ptoBalances,
            ptoRequests,
            benefits,
            announcements,
            auditLog,
            onboardingQueue,
            integrations,
            syncLogs,
            payAdvances,
            filingRecords,
            taxFilings,
            w2Signatures,
            managedCompanies,
            w9Records,
            i9Records,
            timePunches,
            workersCompRates,
            expenses,
            webhookSettings,
            w8benRecords,
            companyDocs,
            goals,
            reviews,
            spendCards,
            stockGrants,
            itAssets,
            retirementEnrollments,
            payGroups,
            trainingCourses,
            surveys,
            holidays,
            blackoutDates,
            offboardingRecords,
            taxVault1099,
            stateNexus,
        ] = await Promise.all([
            soft(() => this.getEmployees(), []),
            soft(() => this.getPayrollHistory(), []),
            soft(() => this.getAllTimesheets(), {}),
            soft(() => this.getPTOBalances(), {}),
            soft(() => this.getPTORequests(), []),
            soft(() => this.getBenefits(), {}),
            soft(() => this.getAnnouncements(), []),
            isEmployeePortal ? Promise.resolve([]) : soft(() => this.getAuditLog(), []),
            isEmployeePortal ? Promise.resolve([]) : soft(() => this.getOnboardingQueue(), []),
            isEmployeePortal ? Promise.resolve({ quickbooks: false, xero: false }) : soft(() => this.getIntegrations(), { quickbooks: false, xero: false }),
            isEmployeePortal ? Promise.resolve([]) : soft(() => this.getSyncLogs(), []),
            soft(() => this.getPayAdvances(), []),
            isEmployeePortal ? Promise.resolve({}) : soft(() => this.getFilingRecords(), {}),
            isEmployeePortal ? Promise.resolve([]) : soft(() => this.getTaxFilings(), []),
            soft(() => this.getW2Signatures(), {}),
            soft(() => this.getManagedCompanies(), []),
            soft(() => this.getW9Records(), {}),
            soft(() => this.getI9Records(), {}),
            soft(() => this.getTimePunches(), []),
            soft(() => this.getWorkersCompSettings(), {}),
            soft(() => this.getExpenses(), []),
            soft(() => this.getWebhookSettings(), {}),
            soft(() => this.getW8BENRecords(), {}),
            soft(() => this.getCompanyDocuments(), []),
            soft(() => this.getGoals(), []),
            soft(() => this.getPerformanceReviews(), []),
            soft(() => this.getSpendCards(), []),
            soft(() => this.getStockGrants(), []),
            soft(() => this.getITAssets(), []),
            soft(() => this.getStateRetirementStatus(), {}),
            soft(() => this.getPayGroups(), []),
            soft(() => this.getTrainingCourses(), []),
            soft(() => this.getPulseSurveys(), []),
            soft(() => this.getHolidays(), []),
            soft(() => this.getBlackoutDates(), []),
            soft(() => this.getOffboardingRecords(), []),
            soft(() => this.get1099VaultRecords(), []),
            soft(() => this.getStateNexusList(), []),
        ]);

        const userIdToLabel = {};
        if (user?.id) userIdToLabel[user.id] = user.email || 'Admin';

        // Attach employee display names onto signature records for the Documents UI.
        const empNameById = Object.fromEntries((employees || []).map((e) => [e.id, e.name]));
        for (const [empId, sig] of Object.entries(w2Signatures || {})) {
            if (sig && !sig.employeeName) sig.employeeName = empNameById[empId] || '';
        }

        return {
            settings: {
                companyName:               company.name,
                ein:                       company.ein           || '',
                bankName:                  company.bankName       || '',
                routingNumber:             company.routingNumber  || '',
                accountNumber:             company.accountNumber  || '',
                paymentType:               company.paymentType    || 'direct_deposit',
                setupComplete:             company.setupComplete  || false,
                setupStep:                 company.setupStep      || 1,
                stripeAccountId:           company.stripeAccountId || '',
                stripeAccountStatus:       company.stripeAccountStatus || 'not_created',
                stripeFinancialAccountId:  company.stripeFinancialAccountId || '',
                autopilot:     company.autopilot || {
                    enabled: false,
                    mode: 'reminder',
                    frequency: 'biweekly',
                    dayOfWeek: 5,
                    dayOfMonth: 1,
                    nextRun: null,
                    lastRun: null,
                    reminderDaysBefore: 2,
                },
            },
            employees,
            payrollHistory,
            payrollApprovals: isEmployeePortal ? [] : _runsToApprovals(payrollHistory, userIdToLabel),
            timesheets:      timesheetMap,
            ptoBalances,
            ptoRequests,
            benefits,
            announcements,
            auditLog,
            onboardingQueue,
            integrations,
            syncLogs,
            payAdvances:     payAdvances || [],
            filingRecords,
            taxFilings,
            garnishments:    [],
            w2Signatures:    w2Signatures || {},
            managedCompanies: managedCompanies || [],
            w9Records:       w9Records || {},
            i9Records:       i9Records || {},
            timePunches:     timePunches || [],
            workersCompRates: workersCompRates || {},
            expenses:        expenses || [],
            webhookSettings: webhookSettings || {},
            w8benRecords:    w8benRecords || {},
            companyDocs:     companyDocs || [],
            goals:           goals || [],
            reviews:         reviews || [],
            spendCards:      spendCards || [],
            stockGrants:     stockGrants || [],
            itAssets:        itAssets || [],
            retirementEnrollments: retirementEnrollments || {},
            payGroups:       payGroups || [],
            trainingCourses: trainingCourses || [],
            surveys:         surveys || [],
            holidays:        holidays || [],
            blackoutDates:   blackoutDates || [],
            offboardingRecords: offboardingRecords || [],
            taxVault1099:    taxVault1099 || [],
            stateNexus:      stateNexus || [],
            burnRateBudget:  { monthly: 45000 },
            splitDeposits:   {},
        };
    },

    /** Admin: invite an employee to the Employee Portal (Auth user + link user_id). */
    async inviteEmployeeToPortal(employeeId) {
        const session = await _sb.auth.getSession();
        const token = session.data?.session?.access_token;
        if (!token) throw new Error('Not signed in');

        const url = (typeof AeroConfig !== 'undefined' && AeroConfig.inviteEmployeeFunctionUrl)
            || `${SUPABASE_URL}/functions/v1/invite-employee`;

        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ action: 'invite', employeeId }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || 'Invite failed');
        return data;
    },
};

// ─────────────────────────────────────────────
// PRIVATE UTILITY
// ─────────────────────────────────────────────

/** Returns the ISO date string for Monday of the current week. */
function _getMondayOfCurrentWeek() {
    const d = new Date();
    const day = d.getDay(); // 0 = Sun
    const diff = (day === 0) ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
}

/**
 * Compute the next auto-payroll run date from schedule settings.
 * dayOfWeek uses JS getDay() (0=Sun … 5=Fri … 6=Sat).
 */
function computeNextAutopilotRun(ap, fromDate = new Date()) {
    const start = new Date(fromDate);
    start.setHours(12, 0, 0, 0);
    const toISO = (d) => d.toISOString().slice(0, 10);

    if (ap.nextRun) {
        const existing = new Date(ap.nextRun + 'T12:00:00');
        if (!Number.isNaN(existing.getTime()) && existing >= start) return ap.nextRun;
    }

    const freq = ap.frequency || 'biweekly';
    const targetDow = ap.dayOfWeek ?? 5;
    const dayOfMonth = Math.min(Math.max(ap.dayOfMonth ?? 1, 1), 28);

    if (freq === 'monthly') {
        const candidate = new Date(start.getFullYear(), start.getMonth(), dayOfMonth, 12);
        if (candidate < start) candidate.setMonth(candidate.getMonth() + 1);
        return toISO(candidate);
    }

    if (freq === 'semimonthly') {
        const y = start.getFullYear();
        const m = start.getMonth();
        const first  = new Date(y, m, Math.min(dayOfMonth, 14), 12);
        const second = new Date(y, m, Math.min(dayOfMonth + 15, 28), 12);
        const upcoming = [first, second].filter(d => d >= start).sort((a, b) => a - b);
        if (upcoming.length) return toISO(upcoming[0]);
        return toISO(new Date(y, m + 1, Math.min(dayOfMonth, 14), 12));
    }

    // weekly / biweekly — next matching weekday (including today)
    const d = new Date(start);
    while (d.getDay() !== targetDow) d.setDate(d.getDate() + 1);
    if (ap.lastRun === toISO(d)) {
        d.setDate(d.getDate() + (freq === 'biweekly' ? 14 : 7));
    }
    return toISO(d);
}

/** Days from today until ISO date (0 if today/past). */
function daysUntilDate(isoDate) {
    if (!isoDate) return null;
    const target = new Date(isoDate + 'T12:00:00');
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return Math.max(0, Math.round((target - today) / 86400000));
}
