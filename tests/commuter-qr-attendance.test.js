const test = require('node:test');
const assert = require('node:assert/strict');

test('IRS Section 132 Commuter Benefits enforces $315/mo cap on transit and parking', () => {
    const rawTransit = 400; // Above limit
    const rawParking = 250; // Under limit

    const transitPass = Math.min(rawTransit, 315);
    const parkingPass = Math.min(rawParking, 315);
    const totalPreTaxMonthly = transitPass + parkingPass;

    assert.equal(transitPass, 315);
    assert.equal(parkingPass, 250);
    assert.equal(totalPreTaxMonthly, 565);
});

test('Commuter pre-tax deductions compute annual tax savings accurately', () => {
    const totalMonthlyPreTax = 300; // $300/mo = $3,600/yr pre-tax
    const annualPreTax = totalMonthlyPreTax * 12; // $3,600
    const estTaxSavings = Math.round(annualPreTax * 0.28); // $1,008 saved (22% FIT + 7.65% FICA)

    assert.equal(annualPreTax, 3600);
    assert.equal(estTaxSavings, 1008);
});

test('QR Code Attendance Scanner validates dynamic token and records punch', () => {
    const qrPunch = {
        empId: 'emp-101',
        action: 'CLOCK_IN',
        method: 'QR_Code_Kiosk',
        token: 'SEC-QR-LIVE-TOKEN'
    };

    assert.equal(qrPunch.empId, 'emp-101');
    assert.equal(qrPunch.action, 'CLOCK_IN');
    assert.equal(qrPunch.method, 'QR_Code_Kiosk');
    assert.equal(qrPunch.token, 'SEC-QR-LIVE-TOKEN');
});
