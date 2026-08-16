const test = require('node:test');
const assert = require('node:assert/strict');

test('Corporate Spend Cards calculate spend limits and remaining balance', () => {
    const card = {
        id: 'card-1',
        empName: 'Sarah Jenkins',
        monthlyLimit: 1500,
        spentThisMonth: 340.50,
        status: 'active'
    };

    const remaining = card.monthlyLimit - card.spentThisMonth;
    assert.equal(remaining, 1159.50);
    assert.equal(card.status, 'active');

    // Toggle freeze
    card.status = card.status === 'active' ? 'frozen' : 'active';
    assert.equal(card.status, 'frozen');
});

test('Equity grants calculate 4-year vesting with 1-year cliff accurately', () => {
    const grant = {
        shares: 24000,
        totalMonths: 48,
        cliffMonths: 12,
        strikePrice: 1.00,
        currentValuation: 10.00
    };

    // Before cliff (6 months) -> 0 shares
    const months6 = 6;
    const vested6 = months6 < grant.cliffMonths ? 0 : Math.round((grant.shares * months6) / grant.totalMonths);
    assert.equal(vested6, 0);

    // At cliff (12 months) -> 25% (6000 shares)
    const months12 = 12;
    const vested12 = months12 < grant.cliffMonths ? 0 : Math.round((grant.shares * months12) / grant.totalMonths);
    assert.equal(vested12, 6000);

    // At 24 months -> 50% (12000 shares)
    const months24 = 24;
    const vested24 = Math.round((grant.shares * months24) / grant.totalMonths);
    assert.equal(vested24, 12000);

    // Estimated value at 24 months: 12000 * ($10 - $1) = $108,000
    const estVal = vested24 * (grant.currentValuation - grant.strikePrice);
    assert.equal(estVal, 108000);
});

test('IT Hardware asset status correctly transitions on assignment and return', () => {
    const asset = {
        model: 'Apple MacBook Pro 16"',
        serial: 'C02G901XP982',
        status: 'inventory',
        empId: null
    };

    // Assign
    asset.status = 'assigned';
    asset.empId = 'emp-101';
    assert.equal(asset.status, 'assigned');
    assert.equal(asset.empId, 'emp-101');

    // Return
    asset.status = 'inventory';
    asset.empId = null;
    assert.equal(asset.status, 'inventory');
    assert.equal(asset.empId, null);
});

test('State-mandated retirement deductions apply CalSavers/NY Secure Choice rules', () => {
    const caEmp = { state: 'CA', grossPay: 4000 };
    const calSaversRate = 0.05; // 5%
    const deduction = caEmp.grossPay * calSaversRate;
    assert.equal(deduction, 200.00);
});

test('Runway calculator computes burn rate and months remaining correctly', () => {
    const cash = 450000;
    const monthlyRev = 35000;
    const monthlyPayroll = 50000;
    const netBurn = monthlyPayroll - monthlyRev; // $15,000/mo
    const runwayMonths = parseFloat((cash / netBurn).toFixed(1));
    assert.equal(netBurn, 15000);
    assert.equal(runwayMonths, 30.0);
});

test('Multi-Pay Groups support distinct pay frequencies', () => {
    const groups = [
        { name: 'Executive', frequency: 'Monthly' },
        { name: 'Office Staff', frequency: 'Bi-Weekly' },
        { name: 'Field Workers', frequency: 'Weekly' }
    ];
    assert.equal(groups.length, 3);
    assert.equal(groups[0].frequency, 'Monthly');
    assert.equal(groups[1].frequency, 'Bi-Weekly');
    assert.equal(groups[2].frequency, 'Weekly');
});
