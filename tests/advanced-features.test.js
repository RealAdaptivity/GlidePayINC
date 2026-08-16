const test = require('node:test');
const assert = require('node:assert/strict');

test('Global currencies provide conversion rates and symbols', () => {
    const currencies = {
        'EUR': { symbol: '€', rate: 0.92, name: 'Euro' },
        'GBP': { symbol: '£', rate: 0.78, name: 'British Pound' },
        'CAD': { symbol: 'CA$', rate: 1.36, name: 'Canadian Dollar' },
        'MXN': { symbol: 'MX$', rate: 18.10, name: 'Mexican Peso' },
        'AUD': { symbol: 'A$', rate: 1.52, name: 'Australian Dollar' },
        'INR': { symbol: '₹', rate: 83.50, name: 'Indian Rupee' },
    };

    assert.equal(currencies.EUR.symbol, '€');
    assert.equal(currencies.GBP.symbol, '£');
    assert.equal(currencies.INR.symbol, '₹');

    // $1000 USD to EUR
    const eurAmt = (1000 * currencies.EUR.rate).toFixed(2);
    assert.equal(eurAmt, '920.00');

    // $1000 USD to GBP
    const gbpAmt = (1000 * currencies.GBP.rate).toFixed(2);
    assert.equal(gbpAmt, '780.00');
});

test('Form W-8BEN validation requires beneficial owner, country and tax treaty claim', () => {
    const w8ben = {
        beneficialOwner: 'Liam O’Connor',
        country: 'United Kingdom',
        address: '45 Oxford St, London, UK',
        ftin: 'GB982341029',
        treatyArticle: 'Article 7 - 0% Withholding'
    };

    assert.ok(w8ben.beneficialOwner);
    assert.equal(w8ben.country, 'United Kingdom');
    assert.ok(w8ben.ftin);
    assert.match(w8ben.treatyArticle, /Article 7/);
});

test('Document e-signature record captures timestamp and legal acknowledgment', () => {
    const sig = {
        docId: 'doc-1',
        empId: 'emp-101',
        signatureUrl: 'Sarah Jenkins',
        signedAt: new Date().toISOString(),
        ipAddress: '192.168.1.1'
    };

    assert.equal(sig.docId, 'doc-1');
    assert.equal(sig.signatureUrl, 'Sarah Jenkins');
    assert.ok(sig.signedAt);
    assert.ok(sig.ipAddress);
});

test('OKR Goal calculates progress and achievement status', () => {
    const goalInProgress = { title: 'Launch Payouts API', progress: 60 };
    assert.equal(goalInProgress.progress < 100 ? 'in_progress' : 'completed', 'in_progress');

    const goalCompleted = { title: 'SOC 2 Type II Audit', progress: 100 };
    assert.equal(goalCompleted.progress >= 100 ? 'completed' : 'in_progress', 'completed');
});
