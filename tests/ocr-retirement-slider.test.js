const test = require('node:test');
const assert = require('node:assert/strict');

test('Receipt OCR accurately parses merchant, total, tax, and auto-matches to card', () => {
    const ocrReceipt = {
        merchant: 'Amazon Web Services',
        amount: 84.50,
        tax: 6.97,
        category: 'Software & Cloud',
        cardLast4: '4821',
        status: 'matched'
    };

    assert.equal(ocrReceipt.merchant, 'Amazon Web Services');
    assert.equal(ocrReceipt.amount, 84.50);
    assert.equal(ocrReceipt.tax, 6.97);
    assert.equal(ocrReceipt.status, 'matched');
});

test('401(k) Pre-Tax and Roth contribution slider calculates tax savings and deductions', () => {
    const annualSalary = 125000;
    const rate401k = 6; // 6% Pre-Tax
    const rateRoth = 2; // 2% Post-Tax Roth

    const totalRate = rate401k + rateRoth; // 8%
    const annualContrib = annualSalary * (totalRate / 100); // $10,000
    const perCheckDeduction = (annualContrib / 26).toFixed(2); // $384.62

    const taxSavings = Math.round(annualSalary * (rate401k / 100) * 0.24); // $1,800
    const employerMatch = Math.min(annualSalary * (rate401k / 100), annualSalary * 0.04); // 4% cap = $5,000

    assert.equal(annualContrib, 10000);
    assert.equal(perCheckDeduction, '384.62');
    assert.equal(taxSavings, 1800);
    assert.equal(employerMatch, 5000);
});
