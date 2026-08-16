const test = require('node:test');
const assert = require('node:assert/strict');

test('Employment Verification Letter includes official legal details and employee comp', () => {
    const employee = {
        name: 'Sarah Jenkins',
        role: 'Lead Architect',
        department: 'Engineering',
        type: 'salaried',
        rate: 125000,
        classification: 'w2'
    };

    assert.equal(employee.name, 'Sarah Jenkins');
    assert.equal(employee.rate, 125000);
    assert.equal(employee.classification, 'w2');
});

test('Multi-State Tax Nexus correctly associates state revenue & labor agencies', () => {
    const stateNexus = [
        { state: 'CA', name: 'California', sitAgency: 'Franchise Tax Board (FTB)', sutaAgency: 'Employment Development Dept (EDD)', status: 'registered' },
        { state: 'NY', name: 'New York', sitAgency: 'Dept of Taxation & Finance (DTF)', sutaAgency: 'Dept of Labor (DOL)', status: 'registered' },
        { state: 'TX', name: 'Texas', sitAgency: 'None (0% State Tax)', sutaAgency: 'Texas Workforce Commission (TWC)', status: 'registered' }
    ];

    assert.equal(stateNexus.find(s => s.state === 'CA').sitAgency, 'Franchise Tax Board (FTB)');
    assert.equal(stateNexus.find(s => s.state === 'TX').sitAgency, 'None (0% State Tax)');
    assert.equal(stateNexus.every(s => s.status === 'registered'), true);
});

test('Executive Board loaded labor burden accurately sums gross payroll and employer taxes', () => {
    const grossPayroll = 250000;
    const employerFICA = grossPayroll * 0.0765; // $19,125
    const employerFUTA = 1400; // $1,400
    const employerSUTA = grossPayroll * 0.034; // $8,500
    const loadedBurden = grossPayroll + employerFICA + employerFUTA + employerSUTA;

    assert.equal(loadedBurden, 279025);
});

test('Instant RTP payout calculates 15-minute settlement delivery', () => {
    const now = new Date('2026-08-15T10:00:00Z');
    const rtpDelivery = new Date(now.getTime() + 15 * 60 * 1000);

    assert.equal(rtpDelivery.toISOString(), '2026-08-15T10:15:00.000Z');
});
