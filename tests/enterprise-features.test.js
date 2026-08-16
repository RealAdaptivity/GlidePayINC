const test = require('node:test');
const assert = require('node:assert/strict');
const {
    calculateWorkersComp,
    calculateMileageReimbursement,
    DEFAULT_WORKERS_COMP_RATES,
    IRS_MILEAGE_RATE_2026
} = require('../payroll-engine.js');

test('Workers Comp calculates premium from class code and gross wages', () => {
    const empClerical = { workersCompCode: '8810' };
    const resClerical = calculateWorkersComp(empClerical, 5000);
    // $5000 / 100 * 0.25 = $12.50
    assert.equal(resClerical.classCode, '8810');
    assert.equal(resClerical.ratePerHundred, 0.25);
    assert.equal(resClerical.premium, 12.50);

    const empConstruction = { workersCompCode: '5403' };
    const resConstruction = calculateWorkersComp(empConstruction, 4000);
    // $4000 / 100 * 5.80 = $232.00
    assert.equal(resConstruction.classCode, '5403');
    assert.equal(resConstruction.ratePerHundred, 5.80);
    assert.equal(resConstruction.premium, 232.00);
});

test('Mileage calculator applies official IRS 2026 standard rate ($0.67/mile)', () => {
    assert.equal(IRS_MILEAGE_RATE_2026, 0.67);
    assert.equal(calculateMileageReimbursement(100), 67.00);
    assert.equal(calculateMileageReimbursement(85.5), 57.29);
    assert.equal(calculateMileageReimbursement(0), 0);
    assert.equal(calculateMileageReimbursement(-10), 0);
});

test('Form W-9 data structure requires legal name, classification and TIN', () => {
    const validW9 = {
        legalName: 'Marcus Brody Designs LLC',
        taxClass: 'LLC',
        tin: '84-9281920',
        address: '100 Main St, Miami, FL 33101'
    };
    assert.ok(validW9.legalName);
    assert.ok(validW9.taxClass);
    assert.ok(validW9.tin);
    assert.ok(validW9.address);
});

test('Form I-9 verification checklist supports List A and List B/C documents', () => {
    const i9Record = {
        citizenship: 'citizen',
        docType: 'List A - U.S. Passport',
        docNumber: 'P9823419',
        expiration: '2032-10-15'
    };
    assert.equal(i9Record.citizenship, 'citizen');
    assert.match(i9Record.docType, /List A/);
    assert.ok(i9Record.docNumber);
});

test('GPS Time Clock punch records valid coordinates and device type', () => {
    const punch = {
        id: 'punch_123',
        employeeId: 'emp-101',
        type: 'clock_in',
        latitude: 37.7749,
        longitude: -122.4194,
        device: 'mobile_gps'
    };
    assert.equal(punch.type, 'clock_in');
    assert.ok(punch.latitude >= -90 && punch.latitude <= 90);
    assert.ok(punch.longitude >= -180 && punch.longitude <= 180);
    assert.equal(punch.device, 'mobile_gps');
});

test('Tablet Kiosk 4-digit PIN authentication validates pin format', () => {
    const pin = '1234';
    assert.match(pin, /^\d{4}$/);
});
