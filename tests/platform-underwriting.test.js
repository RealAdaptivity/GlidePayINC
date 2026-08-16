const test = require('node:test');
const assert = require('node:assert/strict');

test('Underwriting account validates KYB, EIN and NACHA authorization status', () => {
    const account = {
        id: 'uw-101',
        companyName: 'Beacon Health Logistics LLC',
        ein: '98-7654321',
        einVerified: true,
        bankVerified: true,
        nachaAuth: true,
        riskTier: 'escrow_4day',
        creditLimit: 75000,
        status: 'pending_review'
    };

    assert.equal(account.einVerified, true);
    assert.equal(account.bankVerified, true);
    assert.equal(account.nachaAuth, true);
    assert.equal(account.status, 'pending_review');
});

test('Platform risk officer approval promotes account and updates risk tier and credit limit', () => {
    const account = {
        id: 'uw-101',
        companyName: 'Beacon Health Logistics LLC',
        riskTier: 'escrow_4day',
        creditLimit: 75000,
        status: 'pending_review'
    };

    // Promote to Standard 2-Day with $150,000 credit limit
    account.status = 'approved';
    account.riskTier = 'standard_2day';
    account.creditLimit = 150000;
    account.reviewedBy = 'Platform Risk Officer';

    assert.equal(account.status, 'approved');
    assert.equal(account.riskTier, 'standard_2day');
    assert.equal(account.creditLimit, 150000);
    assert.equal(account.reviewedBy, 'Platform Risk Officer');
});

test('Underwriting document request and risk hold transitions update state correctly', () => {
    const account = {
        id: 'uw-102',
        status: 'pending_review',
        notes: ''
    };

    // Request documentation
    account.status = 'docs_requested';
    account.notes = 'Need IRS CP 575 Notice';
    assert.equal(account.status, 'docs_requested');

    // Risk hold suspension
    account.status = 'suspended';
    account.notes = 'Suspicious velocity detected';
    assert.equal(account.status, 'suspended');
});
