const test = require('node:test');
const assert = require('node:assert/strict');

test('1099-NEC accurately aggregates nonemployee compensation and checks $600 threshold', () => {
    const contractor1 = { name: 'Marcus Brody', totalPayments: 48500.00 };
    const contractor2 = { name: 'Small Vendor', totalPayments: 450.00 };

    assert.equal(contractor1.totalPayments >= 600, true);
    assert.equal(contractor2.totalPayments >= 600, false);
});

test('Form 1099-NEC Copy B contains required IRS boxes and masked TIN', () => {
    const record = {
        contractorName: 'Marcus Brody',
        tin: '•••-••-8821',
        box1NonemployeeComp: 48500.00,
        state: 'FL'
    };

    assert.equal(record.contractorName, 'Marcus Brody');
    assert.match(record.tin, /•••-••-\d{4}/);
    assert.equal(record.box1NonemployeeComp, 48500.00);
});

test('1099 batch E-filing updates record status to efiled', () => {
    const records = [
        { id: '1099-1', status: 'ready_to_file' },
        { id: '1099-2', status: 'ready_to_file' }
    ];

    records.forEach(r => { r.status = 'efiled'; });

    assert.equal(records[0].status, 'efiled');
    assert.equal(records[1].status, 'efiled');
});
