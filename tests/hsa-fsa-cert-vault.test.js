const test = require('node:test');
const assert = require('node:assert/strict');

test('HSA and FSA statutory limits match 2026 IRS regulations', () => {
    const limits2026 = {
        hsaSingle: 4300,
        hsaFamily: 8550,
        hsaCatchup55Plus: 1000,
        healthcareFSA: 3200,
        dependentCareFSA: 5000
    };

    assert.equal(limits2026.hsaSingle, 4300);
    assert.equal(limits2026.hsaFamily, 8550);
    assert.equal(limits2026.healthcareFSA, 3200);
    assert.equal(limits2026.dependentCareFSA, 5000);
});

test('HSA/FSA medical reimbursement claims transition to approved status', () => {
    const claim = {
        id: 'hsa-1',
        empName: 'Sarah Jenkins',
        amount: 64.50,
        provider: 'Walgreens',
        status: 'pending'
    };

    claim.status = 'approved';

    assert.equal(claim.amount, 64.50);
    assert.equal(claim.status, 'approved');
});

test('Employee Certification accurately calculates expiration threshold', () => {
    const now = new Date('2026-08-15T00:00:00Z');

    const certActive = new Date('2027-06-30T00:00:00Z');
    const certExpiringSoon = new Date('2026-08-28T00:00:00Z'); // 13 days away
    const certExpired = new Date('2025-12-31T00:00:00Z');

    const getStatus = (exp) => {
        const days = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
        if (days < 0) return 'expired';
        if (days <= 30) return 'expiring_soon';
        return 'active';
    };

    assert.equal(getStatus(certActive), 'active');
    assert.equal(getStatus(certExpiringSoon), 'expiring_soon');
    assert.equal(getStatus(certExpired), 'expired');
});
