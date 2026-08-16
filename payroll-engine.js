/**
 * GlidePay Payroll Engine
 * Sandbox payroll estimator. Production use requires independent tax-provider
 * certification and annual table updates.
 */

const PAY_FREQUENCIES = {
    weekly: 52,
    biweekly: 26,
    semimonthly: 24,
    monthly: 12
};

const ZERO_SIT_STATES = ['TX', 'FL', 'NV', 'WA', 'TN', 'SD', 'WY', 'AK', 'NH'];
const SUPPORTED_TAX_STATES = ['CA', 'NY', ...ZERO_SIT_STATES];

// 2026 Federal Income Tax Brackets (Adjusted for inflation)
const FED_BRACKETS = {
    single: {
        standardDeduction: 15000,
        rates: [
            { limit: 11925, rate: 0.10 },
            { limit: 48475, rate: 0.12 },
            { limit: 103350, rate: 0.22 },
            { limit: 197300, rate: 0.24 },
            { limit: 250525, rate: 0.32 },
            { limit: 626350, rate: 0.35 },
            { limit: Infinity, rate: 0.37 }
        ]
    },
    married: {
        standardDeduction: 30000,
        rates: [
            { limit: 23850, rate: 0.10 },
            { limit: 96950, rate: 0.12 },
            { limit: 206700, rate: 0.22 },
            { limit: 394600, rate: 0.24 },
            { limit: 501050, rate: 0.32 },
            { limit: 751600, rate: 0.35 },
            { limit: Infinity, rate: 0.37 }
        ]
    }
};

// California State Income Tax Brackets (Progressive)
const CA_BRACKETS = {
    single: {
        standardDeduction: 5200,
        rates: [
            { limit: 10412, rate: 0.01 },
            { limit: 24684, rate: 0.02 },
            { limit: 38959, rate: 0.04 },
            { limit: 54000, rate: 0.06 },
            { limit: 68263, rate: 0.08 },
            { limit: 348737, rate: 0.093 },
            { limit: 418484, rate: 0.103 },
            { limit: 697474, rate: 0.113 },
            { limit: Infinity, rate: 0.123 }
        ]
    },
    married: {
        standardDeduction: 10400,
        rates: [
            { limit: 20824, rate: 0.01 },
            { limit: 49368, rate: 0.02 },
            { limit: 77918, rate: 0.04 },
            { limit: 108000, rate: 0.06 },
            { limit: 136526, rate: 0.08 },
            { limit: 697474, rate: 0.093 },
            { limit: 836968, rate: 0.103 },
            { limit: 1394948, rate: 0.113 },
            { limit: Infinity, rate: 0.123 }
        ]
    }
};

// New York State Income Tax Brackets (Progressive)
const NY_BRACKETS = {
    single: {
        standardDeduction: 8000,
        rates: [
            { limit: 8500, rate: 0.04 },
            { limit: 11700, rate: 0.045 },
            { limit: 13900, rate: 0.0525 },
            { limit: 80650, rate: 0.0585 },
            { limit: 215400, rate: 0.0625 },
            { limit: 1077550, rate: 0.0685 },
            { limit: 5000000, rate: 0.0965 },
            { limit: 25000000, rate: 0.103 },
            { limit: Infinity, rate: 0.109 }
        ]
    },
    married: {
        standardDeduction: 16050,
        rates: [
            { limit: 17150, rate: 0.04 },
            { limit: 23600, rate: 0.045 },
            { limit: 27900, rate: 0.0525 },
            { limit: 161550, rate: 0.0585 },
            { limit: 323200, rate: 0.0625 },
            { limit: 2155350, rate: 0.0685 },
            { limit: 5000000, rate: 0.0965 },
            { limit: 25000000, rate: 0.103 },
            { limit: Infinity, rate: 0.109 }
        ]
    }
};

/**
 * Calculates progressive tax on a given income using a standard bracket structure.
 */
function calculateProgressiveTax(taxableIncome, bracketConfig) {
    if (taxableIncome <= 0) return 0;
    
    let tax = 0;
    let prevLimit = 0;
    
    for (const bracket of bracketConfig.rates) {
        const taxableInBracket = Math.min(taxableIncome - prevLimit, bracket.limit - prevLimit);
        if (taxableInBracket > 0) {
            tax += taxableInBracket * bracket.rate;
        }
        prevLimit = bracket.limit;
        if (taxableIncome <= bracket.limit) break;
    }
    
    return tax;
}

/**
 * Main calculation engine.
 * Computes all payroll details for an employee's single pay period.
 * 
 * @param {Object} employee - Employee master record (salary/rate, pay type, withholding settings)
 * @param {Object} currentRun - Current period specific additions (hours worked, overtime, bonus, commissions, health deduction, 401k deduction)
 * @param {number} ytdGross - Year-to-date gross earnings BEFORE this run (used for FICA/FUTA cap checks)
 */
function calculatePayroll(employee, currentRun, ytdGross = 0) {
    const payFrequency = employee.payFrequency || 'biweekly';
    const periodsPerYear = PAY_FREQUENCIES[payFrequency];
    
    // 1. Calculate Gross Pay
    let regularEarnings = 0;
    let overtimeEarnings = 0;
    const is1099 = employee.classification === '1099';
    
    if (employee.type === 'hourly') {
        const hourlyRate = parseFloat(employee.rate) || 0;
        const regHours = parseFloat(currentRun.hours) || 0;
        const otHours = parseFloat(currentRun.overtimeHours) || 0;
        
        regularEarnings = regHours * hourlyRate;
        if (is1099) {
            overtimeEarnings = otHours * hourlyRate; // straight hourly rate for contractors
        } else {
            overtimeEarnings = otHours * (hourlyRate * 1.5);
        }
    } else {
        // salaried
        const annualSalary = parseFloat(employee.rate) || 0;
        if (is1099) {
            regularEarnings = annualSalary; // Flat fee per period
        } else {
            regularEarnings = annualSalary / periodsPerYear;
        }
    }
    
    const bonus = parseFloat(currentRun.bonus) || 0;
    const commissions = parseFloat(currentRun.commissions) || 0;
    const grossPay = regularEarnings + overtimeEarnings + bonus + commissions;
    const reimbursement = parseFloat(currentRun.reimbursement) || 0;
    
    if (is1099) {
        return {
            grossPay: round(grossPay),
            regularEarnings: round(regularEarnings),
            overtimeEarnings: round(overtimeEarnings),
            bonus: round(bonus),
            commissions: round(commissions),
            reimbursement: round(reimbursement),
            
            preTaxDeductions: 0,
            deduction401k: 0,
            deductionMedical: 0,
            postTaxDeductions: 0,
            
            taxes: {
                federalIncomeTax: 0,
                socialSecurity: 0,
                medicare: 0,
                stateIncomeTax: 0,
                totalEmployeeTaxes: 0
            },
            
            netPay: round(grossPay + reimbursement),
            
            employerTaxes: {
                socialSecurity: 0,
                medicare: 0,
                futa: 0,
                suta: 0,
                totalEmployerTaxes: 0
            },
            
            totalEmployerTaxes: 0,
            totalPayrollCost: round(grossPay + reimbursement)
        };
    }
    
    // 2. Pre-Tax Deductions (reduces taxable gross)
    const deduction401k = parseFloat(currentRun.deduction401k) || 0;
    const medicalDeduction = parseFloat(currentRun.deductionMedical) || 0;
    const preTaxDeductions = deduction401k + medicalDeduction;
    
    // Taxable wages for Federal Income Tax (FIT)
    const fitTaxableWages = Math.max(0, grossPay - preTaxDeductions);
    
    // 3. FICA (Federal Insurance Contributions Act) calculations
    const socialSecurityRate = 0.062;
    const medicareRate = 0.0145;
    const ssWageLimit = 176100;
    
    // Employee SS
    let ssTaxable = 0;
    if (ytdGross < ssWageLimit) {
        ssTaxable = Math.min(grossPay, ssWageLimit - ytdGross);
    }
    const ssWithholding = ssTaxable * socialSecurityRate;
    
    // Employee Medicare
    const medWithholding = grossPay * medicareRate;
    // Additional Medicare Tax (0.9% on earnings > $200k Single, $250k Married filing jointly)
    let additionalMedicare = 0;
    const medLimit = (employee.filingStatus === 'married') ? 250000 : 200000;
    if (ytdGross + grossPay > medLimit) {
        const medExcess = Math.max(0, (ytdGross + grossPay) - Math.max(ytdGross, medLimit));
        additionalMedicare = medExcess * 0.009;
    }
    const totalMedicareWithholding = medWithholding + additionalMedicare;
    const totalFICAWithholding = ssWithholding + totalMedicareWithholding;
    
    // 4. Federal Income Tax (FIT) - exact annualized method
    const filingStatus = employee.filingStatus || 'single';
    const fedConfig = FED_BRACKETS[filingStatus];
    const annualizedFitGross = fitTaxableWages * periodsPerYear;
    const annualizedFitTaxable = Math.max(0, annualizedFitGross - fedConfig.standardDeduction);
    const annualizedFit = calculateProgressiveTax(annualizedFitTaxable, fedConfig);
    const fitWithholding = annualizedFit / periodsPerYear;
    
    // 5. State Income Tax (SIT) - progressive or flat
    const state = employee.state || 'TX';
    let sitWithholding = 0;
    
    if (state === 'CA') {
        const caConfig = CA_BRACKETS[filingStatus];
        const annualizedSitGross = fitTaxableWages * periodsPerYear;
        const annualizedSitTaxable = Math.max(0, annualizedSitGross - caConfig.standardDeduction);
        const annualizedSit = calculateProgressiveTax(annualizedSitTaxable, caConfig);
        sitWithholding = annualizedSit / periodsPerYear;
    } else if (state === 'NY') {
        const nyConfig = NY_BRACKETS[filingStatus];
        const annualizedSitGross = fitTaxableWages * periodsPerYear;
        const annualizedSitTaxable = Math.max(0, annualizedSitGross - nyConfig.standardDeduction);
        const annualizedSit = calculateProgressiveTax(annualizedSitTaxable, nyConfig);
        sitWithholding = annualizedSit / periodsPerYear;
    } else if (ZERO_SIT_STATES.includes(state)) {
        sitWithholding = 0; // No state income tax
    } else {
        throw new Error(`State tax calculation is not supported for ${state}. Do not run this payroll.`);
    }
    
    // 6. Post-Tax Deductions (does NOT reduce taxable income, e.g. Roth 401k, garnish)
    let postTaxDeductions = parseFloat(currentRun.deductionPostTax) || 0;
    
    // Garnishments
    let garnishmentDeduction = 0;
    if (employee.garnishments && employee.garnishments.length > 0) {
        employee.garnishments.forEach(g => {
            let deduct = parseFloat(g.amount) || 0;
            if (g.limit !== undefined && g.ytdDeducted !== undefined) {
                const remaining = g.limit - g.ytdDeducted;
                if (remaining <= 0) deduct = 0;
                else deduct = Math.min(deduct, remaining);
            }
            garnishmentDeduction += deduct;
        });
    }
    
    // Pay advance deduction
    let payAdvanceDeduction = parseFloat(currentRun.payAdvanceDeduction) || 0;
    
    postTaxDeductions += garnishmentDeduction + payAdvanceDeduction;
    
    // 7. Calculate Net Pay
    // Round each tax component to cents first, then sum — this ensures the
    // paystub reconciles: reported line items add up to the reported total.
    const roundedFit  = round(fitWithholding);
    const roundedSS   = round(ssWithholding);
    const roundedMed  = round(totalMedicareWithholding);
    const roundedSit  = round(sitWithholding);
    const totalTaxes  = roundedFit + roundedSS + roundedMed + roundedSit;
    const netPay = Math.max(0, grossPay - preTaxDeductions - totalTaxes - postTaxDeductions + reimbursement);
    
    // Direct deposit split calculations (if enabled)
    let netPayChecking = netPay;
    let netPaySavings = 0;
    let hasSplit = false;
    
    if (employee.splitDeposits && employee.splitDeposits.enabled) {
        const pct = parseFloat(employee.splitDeposits.savingsPercent) || 0;
        if (pct > 0 && pct <= 100) {
            netPaySavings = netPay * (pct / 100);
            netPayChecking = netPay - netPaySavings;
            hasSplit = true;
        }
    }
    
    // 8. Employer Payroll Taxes
    // Employer FICA Match (regular rates, employer doesn't match additional Medicare)
    const employerSS = ssWithholding;
    const employerMedicare = medWithholding;
    const employerFICA = employerSS + employerMedicare;
    
    // FUTA (Federal Unemployment Tax) - 0.6% on first $7,000 of calendar wages
    let futaTaxable = 0;
    const futaWageLimit = 7000;
    if (ytdGross < futaWageLimit) {
        futaTaxable = Math.min(grossPay, futaWageLimit - ytdGross);
    }
    const futaTax = futaTaxable * 0.006;
    
    // SUTA (State Unemployment Tax) - estimated at 2.7% on first $10,000 of calendar wages
    let sutaTaxable = 0;
    const sutaWageLimit = 10000;
    if (ytdGross < sutaWageLimit) {
        sutaTaxable = Math.min(grossPay, sutaWageLimit - ytdGross);
    }
    const sutaTax = sutaTaxable * 0.027;
    
    const totalEmployerTaxes = employerFICA + futaTax + sutaTax;
    const totalPayrollCost = grossPay + totalEmployerTaxes + reimbursement;
    
    return {
        grossPay: round(grossPay),
        regularEarnings: round(regularEarnings),
        overtimeEarnings: round(overtimeEarnings),
        bonus: round(bonus),
        commissions: round(commissions),
        reimbursement: round(reimbursement),
        
        preTaxDeductions: round(preTaxDeductions),
        deduction401k: round(deduction401k),
        deductionMedical: round(medicalDeduction),
        postTaxDeductions: round(postTaxDeductions),
        
        garnishmentDeductions: round(garnishmentDeduction),
        payAdvanceDeduction: round(payAdvanceDeduction),
        
        netPayChecking: round(netPayChecking),
        netPaySavings: round(netPaySavings),
        hasSplit: hasSplit,
        
        taxes: {
            federalIncomeTax: roundedFit,
            socialSecurity:   roundedSS,
            medicare:         roundedMed,
            stateIncomeTax:     roundedSit,
            totalEmployeeTaxes: totalTaxes
        },
        
        netPay: round(netPay),
        
        employerTaxes: {
            socialSecurity: round(employerSS),
            medicare: round(employerMedicare),
            futa: round(futaTax),
            suta: round(sutaTax),
            totalEmployerTaxes: round(totalEmployerTaxes)
        },
        
        totalEmployerTaxes: round(totalEmployerTaxes),
        totalPayrollCost: round(totalPayrollCost)
    };
}

const DEFAULT_WORKERS_COMP_RATES = {
    '8810': { title: 'Clerical & Software Professional', rate: 0.25 },
    '8742': { title: 'Outside Sales & Marketing', rate: 0.55 },
    '8017': { title: 'Retail & Store Operations', rate: 1.85 },
    '9079': { title: 'Dining & Hospitality', rate: 2.40 },
    '5403': { title: 'Construction & Field Trades', rate: 5.80 },
    'default': { title: 'General Operations', rate: 0.75 }
};

const IRS_MILEAGE_RATE_2026 = 0.67; // $0.67 per business mile

function calculateWorkersComp(emp, grossPay, customRates = {}) {
    const code = emp.workersCompCode || '8810';
    const rateConfig = customRates[code] || DEFAULT_WORKERS_COMP_RATES[code] || DEFAULT_WORKERS_COMP_RATES['default'];
    const rate = rateConfig.rate || 0.75;
    const premium = round((grossPay / 100) * rate);
    return {
        classCode: code,
        title: rateConfig.title,
        ratePerHundred: rate,
        premium: premium
    };
}

function calculateMileageReimbursement(miles) {
    const m = Math.max(0, parseFloat(miles) || 0);
    return round(m * IRS_MILEAGE_RATE_2026);
}

function round(val) {
    return Math.round((val + Number.EPSILON) * 100) / 100;
}

// Export functions for browser environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calculatePayroll,
        calculateWorkersComp,
        calculateMileageReimbursement,
        DEFAULT_WORKERS_COMP_RATES,
        IRS_MILEAGE_RATE_2026,
        PAY_FREQUENCIES,
        FED_BRACKETS,
        CA_BRACKETS,
        NY_BRACKETS,
        SUPPORTED_TAX_STATES
    };
}

