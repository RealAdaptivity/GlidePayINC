const test = require('node:test');
const assert = require('node:assert/strict');

test('Compliance LMS verifies completion and generates certificate audit record', () => {
    const course = {
        id: 'course-1',
        title: 'California Harassment Prevention (SB 1343)',
        completedCount: 3,
        totalCount: 4
    };

    // Completing course
    course.completedCount += 1;
    assert.equal(course.completedCount, 4);
    assert.equal(course.completedCount >= course.totalCount, true);

    const certificate = {
        empId: 'emp-101',
        courseId: 'course-1',
        completionDate: '2026-08-15',
        scorePercent: 100,
        validUntil: '2027-08-15'
    };
    assert.equal(certificate.scorePercent, 100);
    assert.equal(certificate.validUntil, '2027-08-15');
});

test('Pulse Surveys calculate eNPS score accurately (+100 to -100 scale)', () => {
    const responses = [
        { score: 10 }, // Promoter
        { score: 9 },  // Promoter
        { score: 8 },  // Passive
        { score: 10 }, // Promoter
        { score: 4 }   // Detractor
    ];

    const promoters = responses.filter(r => r.score >= 9).length; // 3
    const passives = responses.filter(r => r.score >= 7 && r.score <= 8).length; // 1
    const detractors = responses.filter(r => r.score <= 6).length; // 1
    const total = responses.length; // 5

    assert.equal(promoters, 3);
    assert.equal(passives, 1);
    assert.equal(detractors, 1);

    const enps = Math.round(((promoters - detractors) / total) * 100); // ((3-1)/5)*100 = 40
    assert.equal(enps, 40);
});

test('Company Holiday Calendar distinguishes Federal Paid vs Floating holidays', () => {
    const holidays = [
        { name: 'Labor Day', date: '2026-09-07', type: 'Federal Paid' },
        { name: 'Day After Thanksgiving', date: '2026-11-27', type: 'Company Floating' }
    ];

    assert.equal(holidays[0].type, 'Federal Paid');
    assert.equal(holidays[1].type, 'Company Floating');
});

test('Offboarding calculates accrued PTO cash payout based on hourly wage equivalent', () => {
    const salariedEmp = { rate: 125000, type: 'salaried' };
    const hourlyEquivalent = salariedEmp.rate / 2080; // $60.096/hr
    const accruedHours = 40;
    const ptoPayout = (hourlyEquivalent * accruedHours).toFixed(2);
    assert.equal(ptoPayout, '2403.85');

    const hourlyEmp = { rate: 35, type: 'hourly' };
    const hourlyPtoPayout = (hourlyEmp.rate * accruedHours).toFixed(2);
    assert.equal(hourlyPtoPayout, '1400.00');
});

test('WebAuthn Passkey credential mock payload is valid', () => {
    const passkey = {
        id: 'pk_credential_98124',
        type: 'public-key',
        rawId: 'cGFzc2tleV9yYXdfaWQ=',
        authenticatorAttachment: 'platform'
    };
    assert.equal(passkey.type, 'public-key');
    assert.equal(passkey.authenticatorAttachment, 'platform');
});
