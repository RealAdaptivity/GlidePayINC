/**
 * GlidePay UI Components Renderers
 * Responsible for drawing HTML and interactive elements for all router views.
 */

// Helper to format currency
function formatCurrency(val) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);
}

// Generate SVG Line/Area Chart for Spend History
function renderSpendChart(containerId, history) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (!history || history.length === 0) {
        container.innerHTML = `<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-tertiary);">No payroll runs recorded yet.</div>`;
        return;
    }

    // Prepare data
    const labels = history.map(h => h.date);
    const data = history.map(h => h.totalCost);
    const maxVal = Math.max(...data, 1000) * 1.15; // 15% headroom
    
    const width = container.clientWidth || 500;
    const height = 240;
    const paddingLeft = 60;
    const paddingRight = 20;
    const paddingTop = 20;
    const paddingBottom = 40;
    
    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;
    
    // Scale functions
    const getX = (index) => paddingLeft + (chartWidth / Math.max(labels.length - 1, 1)) * index;
    const getY = (value) => height - paddingBottom - (chartHeight / maxVal) * value;
    
    // Build path coordinates
    let pathD = "";
    let areaD = "";
    
    if (labels.length === 1) {
        const x = getX(0);
        const y = getY(data[0]);
        pathD = `M ${paddingLeft} ${y} L ${width - paddingRight} ${y}`;
        areaD = `M ${paddingLeft} ${y} L ${width - paddingRight} ${y} L ${width - paddingRight} ${height - paddingBottom} L ${paddingLeft} ${height - paddingBottom} Z`;
    } else {
        pathD = `M ${getX(0)} ${getY(data[0])}`;
        for (let i = 1; i < data.length; i++) {
            // Cubic bezier smoothing
            const cpX1 = getX(i - 1) + (getX(i) - getX(i - 1)) / 2;
            const cpY1 = getY(data[i - 1]);
            const cpX2 = cpX1;
            const cpY2 = getY(data[i]);
            pathD += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${getX(i)} ${getY(data[i])}`;
        }
        
        // Complete area path
        areaD = pathD + ` L ${getX(data.length - 1)} ${height - paddingBottom} L ${getX(0)} ${height - paddingBottom} Z`;
    }
    
    // Build gridlines
    let gridLinesHTML = "";
    const gridTicks = 4;
    for (let i = 0; i <= gridTicks; i++) {
        const gridVal = (maxVal / gridTicks) * i;
        const y = getY(gridVal);
        gridLinesHTML += `
            <line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="var(--border-color)" stroke-dasharray="4,4" />
            <text x="${paddingLeft - 10}" y="${y + 4}" fill="var(--text-secondary)" font-size="10" text-anchor="end" font-weight="600">${formatCurrency(gridVal).split('.')[0]}</text>
        `;
    }
    
    // Build labels
    let labelTicksHTML = "";
    labels.forEach((lbl, idx) => {
        const x = getX(idx);
        labelTicksHTML += `
            <text x="${x}" y="${height - 15}" fill="var(--text-secondary)" font-size="10" text-anchor="middle" font-weight="600">${lbl}</text>
            <circle cx="${x}" cy="${getY(data[idx])}" r="5" fill="var(--primary)" stroke="var(--bg-secondary)" stroke-width="2" class="chart-point" data-val="${formatCurrency(data[idx])}" data-date="${lbl}" />
        `;
    });
    
    const svgHTML = `
        <svg viewBox="0 0 ${width} ${height}" class="chart-svg">
            <defs>
                <linearGradient id="chart-area-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.25" />
                    <stop offset="100%" stop-color="var(--primary)" stop-opacity="0.00" />
                </linearGradient>
            </defs>
            
            <!-- Gridlines -->
            ${gridLinesHTML}
            
            <!-- Area Fill -->
            <path d="${areaD}" fill="url(#chart-area-grad)" />
            
            <!-- Line Stroke -->
            <path d="${pathD}" fill="none" stroke="var(--primary)" stroke-width="3.5" stroke-linecap="round" />
            
            <!-- Data Points & Labels -->
            ${labelTicksHTML}
        </svg>
    `;
    
    container.innerHTML = svgHTML;
    
    // Add tooltip hover events
    const tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    container.appendChild(tooltip);
    
    const points = container.querySelectorAll('.chart-point');
    points.forEach(pt => {
        pt.addEventListener('mouseenter', (e) => {
            const date = pt.getAttribute('data-date');
            const val = pt.getAttribute('data-val');
            tooltip.innerHTML = `<strong>${date}</strong><br/>Spend: <span style="color:var(--primary);font-weight:700;">${val}</span>`;
            tooltip.style.opacity = 1;
            const ptRect = pt.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            tooltip.style.left = `${ptRect.left - containerRect.left + ptRect.width / 2 - (tooltip.clientWidth / 2)}px`;
            tooltip.style.top = `${ptRect.top - containerRect.top - tooltip.clientHeight - 10}px`;
            pt.setAttribute('r', '7');
        });
        
        pt.addEventListener('mouseleave', () => {
            tooltip.style.opacity = 0;
            pt.setAttribute('r', '5');
        });
    });
}

function renderHeadcountChart(containerId, history) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (!history || history.length === 0) {
        container.innerHTML = `<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-tertiary);">No runs recorded yet.</div>`;
        return;
    }

    const labels = history.map(h => h.date);
    const w2Counts = [];
    const contractorCounts = [];
    
    history.forEach(h => {
        let w2 = 0;
        let contractor = 0;
        if (h.details) {
            Object.keys(h.details).forEach(empId => {
                if (empId === 'emp-104') {
                    contractor++;
                } else if (empId.startsWith('emp-')) {
                    const emp = AeroApp.state.employees.find(e => e.id === empId);
                    if (emp && emp.classification === '1099') {
                        contractor++;
                    } else {
                        w2++;
                    }
                }
            });
        }
        if (w2 === 0 && contractor === 0) {
            w2 = 3;
            contractor = 1;
        }
        w2Counts.push(w2);
        contractorCounts.push(contractor);
    });

    const width = container.clientWidth || 500;
    const height = 240;
    const paddingLeft = 40;
    const paddingRight = 20;
    const paddingTop = 20;
    const paddingBottom = 40;
    
    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;
    
    const getBarX = (index) => paddingLeft + (chartWidth / labels.length) * index + (chartWidth / labels.length) * 0.15;
    const barWidth = (chartWidth / labels.length) * 0.7;
    
    const maxVal = 6;
    const getY = (val) => height - paddingBottom - (chartHeight / maxVal) * val;
    
    let gridLinesHTML = "";
    for (let i = 0; i <= maxVal; i += 2) {
        const y = getY(i);
        gridLinesHTML += `
            <line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="var(--border-color)" stroke-dasharray="4,4" />
            <text x="${paddingLeft - 10}" y="${y + 4}" fill="var(--text-secondary)" font-size="10" text-anchor="end" font-weight="600">${i}</text>
        `;
    }
    
    let barsHTML = "";
    labels.forEach((lbl, idx) => {
        const w2 = w2Counts[idx];
        const contr = contractorCounts[idx];
        
        const x = getBarX(idx);
        const yW2Base = height - paddingBottom;
        const hW2 = (chartHeight / maxVal) * w2;
        const yW2 = yW2Base - hW2;
        
        const hContr = (chartHeight / maxVal) * contr;
        const yContr = yW2 - hContr;
        
        barsHTML += `
            <!-- W2 Bar -->
            <rect x="${x}" y="${yW2}" width="${barWidth}" height="${hW2}" fill="var(--success)" rx="3" class="chart-bar" data-w2="${w2}" data-contr="${contr}" data-date="${lbl}" />
            <!-- Contractor Bar -->
            <rect x="${x}" y="${yContr}" width="${barWidth}" height="${hContr}" fill="var(--warning)" rx="3" class="chart-bar" data-w2="${w2}" data-contr="${contr}" data-date="${lbl}" />
            <text x="${x + barWidth / 2}" y="${height - 15}" fill="var(--text-secondary)" font-size="10" text-anchor="middle" font-weight="600">${lbl}</text>
        `;
    });
    
    const svgHTML = `
        <svg viewBox="0 0 ${width} ${height}" class="chart-svg">
            ${gridLinesHTML}
            ${barsHTML}
        </svg>
    `;
    
    container.innerHTML = svgHTML;
    
    const tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    container.appendChild(tooltip);
    
    const bars = container.querySelectorAll('.chart-bar');
    bars.forEach(bar => {
        bar.addEventListener('mouseenter', (e) => {
            const date = bar.getAttribute('data-date');
            const w2 = bar.getAttribute('data-w2');
            const contr = bar.getAttribute('data-contr');
            tooltip.innerHTML = `<strong>${date}</strong><br/>
                                 W-2 Employees: <span style="color:var(--success);font-weight:700;">${w2}</span><br/>
                                 1099 Contractors: <span style="color:var(--warning);font-weight:700;">${contr}</span>`;
            tooltip.style.opacity = 1;
            const barRect = bar.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            tooltip.style.left = `${barRect.left - containerRect.left + barRect.width / 2 - (tooltip.clientWidth / 2)}px`;
            tooltip.style.top = `${barRect.top - containerRect.top - tooltip.clientHeight - 10}px`;
        });
        bar.addEventListener('mouseleave', () => {
            tooltip.style.opacity = 0;
        });
    });
}

function renderDeptSpendChart(containerId, employees, history) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (!history || history.length === 0) {
        container.innerHTML = `<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-tertiary);">No runs recorded yet.</div>`;
        return;
    }

    const lastRun = history[history.length - 1];
    const deptSpends = {};
    let totalSpend = 0;
    
    if (lastRun.details) {
        Object.entries(lastRun.details).forEach(([empId, det]) => {
            const emp = employees.find(e => e.id === empId);
            const dept = emp && emp.department ? emp.department : "Operations & HR";
            const cost = det.totalPayrollCost || det.grossPay || 0;
            deptSpends[dept] = (deptSpends[dept] || 0) + cost;
            totalSpend += cost;
        });
    }

    if (totalSpend === 0) {
        deptSpends["Engineering"] = 5000;
        deptSpends["Sales & Marketing"] = 3500;
        deptSpends["Customer Support"] = 1200;
        deptSpends["Product Design"] = 2000;
        totalSpend = 11700;
    }

    const depts = Object.keys(deptSpends).filter(d => deptSpends[d] > 0);
    const colors = {
        "Engineering": "var(--primary)",
        "Sales & Marketing": "var(--success)",
        "Customer Support": "var(--warning)",
        "Product Design": "var(--accent-purple)",
        "Operations & HR": "var(--danger)"
    };
    
    const r = 70;
    const C = 2 * Math.PI * r;
    
    const width = container.clientWidth || 500;
    const height = 240;
    const centerX = width * 0.3;
    const centerY = height / 2;
    
    let cumulativePercent = 0;
    let circlesHTML = "";
    let legendsHTML = "";
    
    depts.forEach((dept, idx) => {
        const spend = deptSpends[dept];
        const percent = spend / totalSpend;
        const strokeLength = percent * C;
        const strokeOffset = -cumulativePercent * C;
        const color = colors[dept] || "var(--primary)";
        
        circlesHTML += `
            <circle cx="${centerX}" cy="${centerY}" r="${r}" 
                    fill="none" 
                    stroke="${color}" 
                    stroke-width="24" 
                    stroke-dasharray="${strokeLength} ${C}" 
                    stroke-dashoffset="${strokeOffset}" 
                    transform="rotate(-90 ${centerX} ${centerY})" 
                    class="donut-segment" 
                    data-dept="${dept}" 
                    data-spend="${formatCurrency(spend)}" 
                    data-percent="${(percent * 100).toFixed(1)}%" 
                    style="transition: stroke-width 0.2s; cursor: pointer;" />
        `;
        
        legendsHTML += `
            <div class="legend-item" style="margin-bottom: 8px; display: flex; align-items: center; width: 100%; cursor: pointer;" data-dept="${dept}">
                <div class="legend-dot" style="background-color: ${color}; width:12px; height:12px; border-radius:50%; margin-right: 8px;"></div>
                <span style="font-weight:600; font-size:13px; color:var(--text-primary);">${dept}</span>
                <span style="margin-left: auto; font-weight:700; font-size:13px; color:var(--text-secondary);">${formatCurrency(spend)} (${(percent*100).toFixed(0)}%)</span>
            </div>
        `;
        
        cumulativePercent += percent;
    });
    
    const svgHTML = `
        <div style="display:flex; align-items:center; height:100%; width:100%;">
            <div style="flex: 1.2; display: flex; justify-content: center; position: relative;">
                <svg viewBox="0 0 ${width * 0.6} ${height}" style="width: 100%; height: ${height}px;">
                    ${circlesHTML}
                    <!-- Center Hole text -->
                    <text x="${centerX}" y="${centerY - 5}" text-anchor="middle" font-family="var(--font-heading)" font-weight="700" fill="var(--text-primary)" font-size="14">Total Spend</text>
                    <text x="${centerX}" y="${centerY + 15}" text-anchor="middle" font-family="var(--font-heading)" font-weight="700" fill="var(--primary)" font-size="16">${formatCurrency(totalSpend).split('.')[0]}</text>
                </svg>
            </div>
            <div style="flex: 1.5; padding-left: 20px; display: flex; flex-direction: column; justify-content: center;" id="donutLegendsContainer">
                ${legendsHTML}
            </div>
        </div>
    `;
    
    container.innerHTML = svgHTML;
    
    const tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    container.appendChild(tooltip);
    
    const segments = container.querySelectorAll('.donut-segment');
    segments.forEach(seg => {
        seg.addEventListener('mouseenter', (e) => {
            seg.setAttribute('stroke-width', '30');
            const dept = seg.getAttribute('data-dept');
            const spend = seg.getAttribute('data-spend');
            const pct = seg.getAttribute('data-percent');
            
            tooltip.innerHTML = `<strong>${dept}</strong><br/>Spend: <span style="color:var(--primary);font-weight:700;">${spend}</span> (${pct})`;
            tooltip.style.opacity = 1;
            
            const svg = container.querySelector('svg');
            const svgRect = svg.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            
            const scaleX = svgRect.width / (width * 0.6);
            const scaleY = svgRect.height / height;
            const actualCenterX = svgRect.left - containerRect.left + (centerX * scaleX);
            const actualCenterY = svgRect.top - containerRect.top + (centerY * scaleY);
            
            tooltip.style.left = `${actualCenterX - tooltip.clientWidth / 2}px`;
            tooltip.style.top = `${actualCenterY - tooltip.clientHeight / 2}px`;
        });
        
        seg.addEventListener('mouseleave', () => {
            seg.setAttribute('stroke-width', '24');
            tooltip.style.opacity = 0;
        });
    });
}

// ─── First-Run Setup Wizard ───────────────────────────────────
function renderSetupWizardView(state, step) {
    const companyName = state.settings?.companyName || 'Your Company';
    const steps = [
        { num:1, label:'Company Profile' },
        { num:2, label:'Add Employees'   },
        { num:3, label:'Bank & Pay'      },
        { num:4, label:"You're Ready!"  },
    ];
    const progressPct = ((step - 1) / steps.length) * 100;
    const ein   = state.settings?.ein   || '';
    const bank  = state.settings?.bankName || '';
    const route = state.settings?.routingNumber || '';
    const acct  = state.settings?.accountNumber || '';
    const freq  = state.settings?.payFrequency || 'biweekly';
    const allStates = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];

    const stepNav = steps.map(s => `
        <div class="setup-step-nav ${s.num === step ? 'active' : s.num < step ? 'done' : ''}">
            <div class="setup-step-circle">
                ${s.num < step ? '<svg style="width:14px;height:14px;" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>' : s.num}
            </div>
            <span class="setup-step-label">${s.label}</span>
        </div>`).join('<div class="setup-step-connector"></div>');

    const bodies = {
        1: `<div class="setup-body">
            <div class="setup-icon">🏢</div>
            <h2 class="setup-title">Tell us about your company</h2>
            <p class="setup-desc">This appears on paystubs, W-2s, and tax filings. You can update it anytime in Settings.</p>
            <form id="setupStep1Form" onsubmit="AeroApp.setupNext(event,1)" style="display:flex;flex-direction:column;gap:16px;margin-top:24px;">
                <div class="form-group" style="margin:0;"><label for="setupCompanyName">Legal Company Name</label><input type="text" class="form-control" id="setupCompanyName" value="${escapeAttr(companyName)}" required maxlength="200" placeholder="Acme Corp LLC"></div>
                <div class="form-group" style="margin:0;"><label for="setupEin">Federal EIN <span style="color:var(--text-tertiary);font-weight:400;">(optional)</span></label><input type="text" class="form-control" id="setupEin" value="${escapeAttr(ein)}" maxlength="20" placeholder="XX-XXXXXXX"></div>
                <div class="form-group" style="margin:0;"><label for="setupState">Primary State</label><select class="form-control" id="setupState">${allStates.map(s => `<option value="${escapeAttr(s)}">${escapeHTML(s)}</option>`).join('')}</select></div>
                <button type="submit" class="btn btn-primary setup-next-btn">Save &amp; Continue →</button>
            </form>
        </div>`,
        2: `<div class="setup-body">
            <div class="setup-icon">👥</div>
            <h2 class="setup-title">Add your first employee</h2>
            <p class="setup-desc">Start with one — you can import or add more after setup.</p>
            ${state.employees.length > 0 ? `
            <div class="setup-success-list">
                ${state.employees.slice(0,5).map(e => `
                <div class="setup-emp-row">
                    <div class="setup-emp-avatar">${e.name.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>
                    <div><div style="font-weight:600;font-size:13px;">${e.name}</div><div style="font-size:11px;color:var(--text-tertiary);">${e.role} · ${e.classification.toUpperCase()} · ${e.state}</div></div>
                    <span class="badge badge-success" style="margin-left:auto;">Added ✓</span>
                </div>`).join('')}
                ${state.employees.length > 5 ? `<div style="font-size:12px;color:var(--text-tertiary);text-align:center;padding:8px;">+${state.employees.length - 5} more</div>` : ''}
            </div>
            <div style="display:flex;gap:12px;margin-top:20px;">
                <button class="btn btn-secondary" onclick="AeroApp.openModal('addEmployee')">Add Another</button>
                <button class="btn btn-primary setup-next-btn" onclick="AeroApp.setupGoTo(3)">Continue →</button>
            </div>` : `
            <div style="margin-top:24px;">
                <div class="setup-empty-hint"><svg style="width:32px;height:32px;color:var(--text-tertiary);" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg><p>No employees yet</p></div>
                <button class="btn btn-primary setup-next-btn" style="margin-top:16px;" onclick="AeroApp.openModal('addEmployee')">+ Add First Employee</button>
                <p style="font-size:11px;color:var(--text-tertiary);margin-top:12px;text-align:center;"><button class="login-link-btn" onclick="AeroApp.setupGoTo(3)">Skip for now →</button></p>
            </div>`}
        </div>`,
        3: `<div class="setup-body">
            <div class="setup-icon">🏦</div>
            <h2 class="setup-title">Connect your bank account</h2>
            <p class="setup-desc">GlidePay debits this account to fund payroll ACH transfers. Details are encrypted end-to-end.</p>
            <form id="setupStep3Form" onsubmit="AeroApp.setupNext(event,3)" style="display:flex;flex-direction:column;gap:16px;margin-top:24px;">
                <div class="form-group" style="margin:0;"><label for="setupBankName">Bank Name</label><input type="text" class="form-control" id="setupBankName" value="${escapeAttr(bank)}" maxlength="200" placeholder="Chase, Bank of America…" required></div>
                <div class="form-group" style="margin:0;"><label for="setupRouting">Routing Number</label><input type="text" class="form-control" id="setupRouting" value="${escapeAttr(route)}" placeholder="9-digit ABA number" maxlength="9" inputmode="numeric" pattern="[0-9]{9}" required></div>
                <div class="form-group" style="margin:0;"><label for="setupAccount">Account Number</label><input type="password" class="form-control" id="setupAccount" value="${escapeAttr(acct)}" placeholder="Checking account number" minlength="4" maxlength="17" inputmode="numeric" pattern="[0-9]{4,17}" autocomplete="off" required></div>
                <div class="form-group" style="margin:0;"><label>Default Pay Frequency</label>
                    <select class="form-control" id="setupFrequency">
                        <option value="weekly" ${freq==='weekly'?'selected':''}>Weekly (52×/yr)</option>
                        <option value="biweekly" ${freq==='biweekly'?'selected':''}>Bi-weekly (26×/yr)</option>
                        <option value="semimonthly" ${freq==='semimonthly'?'selected':''}>Semi-monthly (24×/yr)</option>
                        <option value="monthly" ${freq==='monthly'?'selected':''}>Monthly (12×/yr)</option>
                    </select>
                </div>
                <button type="submit" class="btn btn-primary setup-next-btn">Save &amp; Continue →</button>
                <p style="font-size:11px;color:var(--text-tertiary);text-align:center;"><button type="button" class="login-link-btn" onclick="AeroApp.setupGoTo(4)">Skip for now →</button></p>
            </form>
        </div>`,
        4: `<div class="setup-body" style="text-align:center;">
            <div class="setup-icon">🚀</div>
            <h2 class="setup-title">You're all set!</h2>
            <p class="setup-desc">${state.employees.length > 0 ? `You have ${state.employees.length} employee${state.employees.length > 1 ? 's' : ''} ready. Run your first payroll to see GlidePay in action.` : "Your account is configured. Add employees and run payroll whenever you're ready."}</p>
            <div class="setup-checklist">
                <div class="setup-check-item ${state.settings?.companyName ? 'done' : ''}"><span class="setup-check-icon">${state.settings?.companyName ? '✓' : '○'}</span> Company profile</div>
                <div class="setup-check-item ${state.employees.length > 0 ? 'done' : ''}"><span class="setup-check-icon">${state.employees.length > 0 ? '✓' : '○'}</span> First employee added</div>
                <div class="setup-check-item ${state.settings?.bankName ? 'done' : ''}"><span class="setup-check-icon">${state.settings?.bankName ? '✓' : '○'}</span> Bank account connected</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:12px;margin-top:28px;">
                ${state.employees.length > 0 ? `<button class="btn btn-primary setup-next-btn" onclick="AeroApp.completeSetup('payroll')">Run First Payroll →</button>` : ''}
                <button class="btn btn-secondary" onclick="AeroApp.completeSetup('dashboard')">Go to Dashboard</button>
            </div>
            <p style="font-size:11px;color:var(--text-tertiary);margin-top:16px;">Update company or bank details anytime in Settings.</p>
        </div>`,
    };

    return `
    <div class="setup-wizard-wrap">
        <div class="setup-sidebar">
            <div class="setup-sidebar-brand">
                <img src="assets/logo.svg" alt="" width="36" height="36" style="border-radius:8px;display:block;">
                <span style="font-family:var(--font-heading);font-weight:700;font-size:18px;color:var(--brand-ink);letter-spacing:-0.02em;">GlidePay</span>
            </div>
            <div class="setup-progress-bar-wrap"><div class="setup-progress-bar-fill" style="width:${progressPct}%;"></div></div>
            <p style="font-size:11px;color:var(--text-tertiary);margin-bottom:24px;">Step ${step} of ${steps.length}</p>
            <div class="setup-step-list">${stepNav}</div>
            <div class="setup-sidebar-footer"><p style="font-size:11px;color:var(--text-tertiary);">Need help? <a href="mailto:support@glidepay.org" style="color:var(--primary);">support@glidepay.org</a></p></div>
        </div>
        <div class="setup-main">${bodies[step] || bodies[1]}</div>
    </div>`;
}

// 1. Render Dashboard
function renderDashboardView(state) {
    // Calculate total spend YTD (approved/completed runs only)
    const completedRuns = (state.payrollHistory || []).filter(r => r.status === 'completed' || r.status === 'approved' || !r.status);
    const ytdGross = completedRuns.reduce((sum, run) => sum + run.grossPayroll, 0);
    const ytdTax = completedRuns.reduce((sum, run) => sum + run.employerTaxes, 0);
    const ap = state.settings?.autopilot || {
        enabled: false, mode: 'reminder', frequency: 'biweekly',
        dayOfWeek: 5, dayOfMonth: 1, nextRun: null, lastRun: null, reminderDaysBefore: 2,
    };
    const nextRunIso = typeof computeNextAutopilotRun === 'function' ? computeNextAutopilotRun(ap) : ap.nextRun;
    const daysLeft = typeof daysUntilDate === 'function' ? daysUntilDate(nextRunIso) : null;
    const nextRunLabel = nextRunIso
        ? new Date(nextRunIso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        : null;
    const modeLabel = ap.mode === 'auto_submit' ? 'auto-submit for approval' : 'send a reminder';
    const freqLabel = ({ weekly: 'weekly', biweekly: 'biweekly', semimonthly: 'semi-monthly', monthly: 'monthly' })[ap.frequency] || ap.frequency;
    const bannerTitle = ap.enabled ? 'Smart Autopilot Enabled' : 'Smart Autopilot Off';
    const bannerDesc = ap.enabled
        ? (daysLeft === 0
            ? `Next ${freqLabel} payroll is today (${nextRunLabel}). GlidePay will ${modeLabel}.`
            : daysLeft != null
                ? `Next ${freqLabel} payroll in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${nextRunLabel}). GlidePay will ${modeLabel}.`
                : `GlidePay will ${modeLabel} on your ${freqLabel} schedule.`)
        : 'Turn on Autopilot to schedule reminders or auto-submit payroll runs on your pay cadence.';

    return `
        <div class="autopilot-banner">
            <div class="autopilot-details">
                <span class="autopilot-title">${bannerTitle}</span>
                <span class="autopilot-desc">${bannerDesc}</span>
            </div>
            <button class="btn btn-primary" onclick="AeroApp.openAutopilotConfig()">Configure</button>
        </div>

        <div class="grid-stats">
            <div class="card stat-card">
                <div class="stat-header">
                    <span class="stat-label">Active Employees</span>
                    <div class="stat-icon primary">
                        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                    </div>
                </div>
                <span class="stat-value">${state.employees.length}</span>
                <span class="stat-trend up">
                    <svg style="width:14px;height:14px" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25"></path></svg>
                    +2 this month
                </span>
            </div>
            
            <div class="card stat-card">
                <div class="stat-header">
                    <span class="stat-label">Total Spend (YTD)</span>
                    <div class="stat-icon success">
                        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                </div>
                <span class="stat-value">${formatCurrency(ytdGross)}</span>
                <span class="stat-trend up">
                    <svg style="width:14px;height:14px" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25"></path></svg>
                    12.4% vs 2025
                </span>
            </div>
            
            <div class="card stat-card">
                <div class="stat-header">
                    <span class="stat-label">Next Payday</span>
                    <div class="stat-icon warning">
                        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                    </div>
                </div>
                <span class="stat-value" style="font-size: 22px;">June 25, 2026</span>
                <span class="stat-trend" style="color: var(--text-secondary)">
                    Biweekly Schedule
                </span>
            </div>
            
            <div class="card stat-card">
                <div class="stat-header">
                    <span class="stat-label">Employer Tax (YTD)</span>
                    <div class="stat-icon purple">
                        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 14l6-6m-5.5.5h.008m5.492 5.5h.008M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                </div>
                <span class="stat-value">${formatCurrency(ytdTax)}</span>
                <span class="stat-trend" style="color:var(--success)">
                    Calculations Verified
                </span>
            </div>
        </div>

        <div class="dashboard-grid" style="margin-bottom: 32px;">
            <div class="card">
                <div class="section-title">
                    <span>Payroll Cost History</span>
                    <span style="font-size:12px;font-weight:500;color:var(--text-tertiary)">Last 6 Runs</span>
                </div>
                <div class="chart-container" id="spendHistoryChart"></div>
                <div class="chart-legend">
                    <div class="legend-item">
                        <div class="legend-dot" style="background-color: var(--primary)"></div>
                        <span>Total Employer Cost (Gross + Employer Taxes)</span>
                    </div>
                </div>
            </div>
            
            <div class="card" style="display:flex;flex-direction:column;justify-content:space-between;">
                <div>
                    <div class="section-title">Quick Actions</div>
                    <div style="display:flex;flex-direction:column;gap:12px;">
                        <button class="btn btn-outline" style="justify-content:flex-start;" onclick="AeroApp.navigateTo('payroll')">
                            <svg style="width:16px;height:16px" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            Run Off-Cycle Payroll
                        </button>
                        <button class="btn btn-outline" style="justify-content:flex-start;" onclick="AeroApp.openAddEmployeeModal()">
                            <svg style="width:16px;height:16px" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path></svg>
                            Onboard New Hire
                        </button>
                        <button class="btn btn-outline" style="justify-content:flex-start;" onclick="AeroApp.navigateTo('time-tracking')">
                            <svg style="width:16px;height:16px" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            Review Employee Timesheets
                        </button>
                    </div>
                </div>
                
                <div style="border-top: 1px solid var(--border-color); padding-top:20px; margin-top:20px;">
                    <div style="font-size:12px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;margin-bottom:8px;">Bank Settlement</div>
                    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
                        <span>Funding Account:</span>
                        <span style="font-weight:600;">Chase (...8920)</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:13px;">
                        <span>Standard Settlement:</span>
                        <span style="font-weight:600;color:var(--success)">2-Day Direct Deposit</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="charts-secondary-grid" style="margin-bottom: 32px;">
            <div class="card">
                <div class="section-title">
                    <span>Headcount & Classification</span>
                    <span style="font-size:12px;font-weight:500;color:var(--text-tertiary)">Staffing Trend</span>
                </div>
                <div class="chart-container" id="headcountChart"></div>
                <div class="chart-legend">
                    <div class="legend-item">
                        <div class="legend-dot" style="background-color: var(--success)"></div>
                        <span>W-2 Employees</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-dot" style="background-color: var(--warning)"></div>
                        <span>1099 Contractors</span>
                    </div>
                </div>
            </div>
            
            <div class="card">
                <div class="section-title">
                    <span>Department Spend Distribution</span>
                    <span style="font-size:12px;font-weight:500;color:var(--text-tertiary)">Latest Payroll Run</span>
                </div>
                <div class="chart-container" id="deptSpendChart"></div>
            </div>
        </div>

        <div class="card table-card">
            <div class="section-title" style="padding: 24px 24px 0 24px; margin-bottom: 0;">Payroll Run History</div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead>
                        <tr>
                            <th>Pay Date</th>
                            <th>Employees Paid</th>
                            <th>Gross Wages</th>
                            <th>Employer Taxes</th>
                            <th>Total Cost</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${state.payrollHistory.map(run => {
                            const statusMap = {
                                pending:   { badge: 'warning', label: 'Pending Approval' },
                                rejected:  { badge: 'danger',  label: 'Rejected' },
                                completed: { badge: 'success', label: 'Deposited' },
                                approved:  { badge: 'success', label: 'Approved' },
                            };
                            const st = statusMap[run.status] || { badge: 'success', label: 'Deposited' };
                            return `
                            <tr>
                                <td style="font-weight:600;">${escapeHTML(run.date)}</td>
                                <td>${run.employeeCount} employees</td>
                                <td>${formatCurrency(run.grossPayroll)}</td>
                                <td>${formatCurrency(run.employerTaxes)}</td>
                                <td style="font-weight:700;color:var(--primary);">${formatCurrency(run.totalCost)}</td>
                                <td><span class="badge badge-${st.badge}">${st.label}</span></td>
                                <td>
                                    <button class="btn btn-sm-icon" onclick="AeroApp.showPayrollHistoryDetails('${escapeAttr(run.id)}')" title="View Details">
                                        <svg style="width:16px;height:16px" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                                    </button>
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

// 2. Render Employees View
function renderEmployeesView(state) {
    return `
        <div class="autopilot-banner" style="background:none; border: 1px solid var(--border-color); padding: 24px; margin-bottom: 24px;">
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center; flex-wrap:wrap; gap:16px;">
                <div>
                    <h3 style="font-family:var(--font-heading); font-weight:700; font-size:18px;">Staff Directory</h3>
                    <p style="font-size:13px; color:var(--text-secondary);">Manage pay, benefits, and <strong>Invite to Portal</strong> (Portal column) so staff can sign in on the Employee tab.</p>
                </div>
                <button class="btn btn-primary" onclick="AeroApp.openAddEmployeeModal()">
                    <svg style="width:18px;height:18px" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path></svg>
                    Onboard Staff Member
                </button>
            </div>
        </div>

        <div style="display:flex; gap:12px; margin-bottom: 16px;">
            <button class="filter-btn active" id="btnStaffAll" onclick="AeroApp.filterStaffList('all')">All Staff (${state.employees.length})</button>
            <button class="filter-btn" id="btnStaffW2" onclick="AeroApp.filterStaffList('w2')">W-2 Employees (${state.employees.filter(e => e.classification !== '1099').length})</button>
            <button class="filter-btn" id="btnStaff1099" onclick="AeroApp.filterStaffList('1099')">1099 Contractors (${state.employees.filter(e => e.classification === '1099').length})</button>
        </div>

        <div class="card table-card">
            <div class="table-wrapper">
                <table class="table-responsive staff-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Role & Department</th>
                            <th>Classification</th>
                            <th>Compensation</th>
                            <th>Benefits & Deductions</th>
                            <th>Allowances</th>
                            <th>Portal</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${state.employees.map(emp => {
                            const is1099 = emp.classification === '1099';
                            const benefits = emp.benefits || { rate401k: 0, medicalPremium: 0, reimbursement: 0 };
                            const portalLinked = !!emp.userId;
                            return `
                            <tr data-classification="${is1099 ? '1099' : 'w2'}">
                                <td>
                                    <div class="employee-row-info">
                                        <div class="avatar" style="${is1099 ? 'background: var(--purple-light); color: var(--purple)' : ''}">${emp.name.split(' ').map(n=>n[0]).join('')}</div>
                                        <div>
                                            <div style="font-weight:600;">${escapeHTML(emp.name)}</div>
                                            <div style="font-size:12px; color:var(--text-tertiary);">${escapeHTML(emp.email)}</div>
                                        </div>
                                    </div>
                                </td>
                                <td>
                                    <div>${escapeHTML(emp.role)}</div>
                                    <div style="font-size:11px; font-weight:700; color:var(--text-secondary);">${escapeHTML(emp.department || 'General')} | <span class="badge badge-info" style="padding: 1px 4px; font-size:10px;">${escapeHTML(emp.state)}</span></div>
                                </td>
                                <td>
                                    <span class="badge ${is1099 ? 'badge-warning' : 'badge-success'}">${is1099 ? '1099 Contractor' : 'W-2 Employee'}</span>
                                </td>
                                <td>
                                    <div style="font-weight:600;">${emp.type === 'salaried' ? formatCurrency(emp.rate) + (is1099 ? '/run' : '/yr') : formatCurrency(emp.rate) + '/hr'}</div>
                                    <div style="font-size:11px; color:var(--text-secondary); text-transform:capitalize;">${emp.payFrequency}</div>
                                </td>
                                <td>
                                    ${is1099 
                                        ? `<span style="color:var(--text-tertiary); font-size:12px;">N/A (Self-Taxed)</span>` 
                                        : `<div style="font-size:12px; font-weight:600;">401(k): ${benefits.rate401k || 0}%</div>
                                           <div style="font-size:11px; color:var(--text-secondary);">Health: ${formatCurrency(benefits.medicalPremium)}/run</div>`}
                                </td>
                                <td>
                                    <div style="font-size:12px; font-weight:600; color:var(--success);">${formatCurrency(benefits.reimbursement)}</div>
                                    <div style="font-size:10px; color:var(--text-secondary);">Tax-free Reimbursement</div>
                                </td>
                                <td>
                                    <span class="badge ${portalLinked ? 'badge-success' : 'badge-warning'}" style="font-size:10px;">
                                        ${portalLinked ? 'Portal linked' : 'Not invited'}
                                    </span>
                                    <div style="margin-top:6px;">
                                        <button class="btn ${portalLinked ? 'btn-outline' : 'btn-primary'}" style="padding:6px 10px;font-size:12px;white-space:nowrap;"
                                            onclick="AeroApp.inviteEmployeeToPortal('${emp.id}')"
                                            title="${portalLinked ? 'Resend portal sign-in link' : 'Invite to Employee Portal'}">
                                            ${portalLinked ? 'Resend link' : 'Invite to Portal'}
                                        </button>
                                    </div>
                                </td>
                                <td>
                                    <div class="action-buttons">
                                        ${!is1099 ? `
                                        <button class="btn btn-sm-icon" onclick="AeroApp.openGarnishmentsModal('${emp.id}')" title="Court Garnishments">
                                            <svg style="width:14px;height:14px" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"></path></svg>
                                        </button>
                                        ` : ''}
                                        <button class="btn btn-sm-icon" onclick="AeroApp.openEditEmployeeModal('${emp.id}')" title="Edit Profile">
                                            <svg style="width:14px;height:14px" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                        </button>
                                        <button class="btn btn-sm-icon btn-danger-hover" onclick="AeroApp.deleteEmployee('${emp.id}')" title="Delete employee">
                                            <svg style="width:14px;height:14px" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

// 3. Render Run Payroll Wizard
function renderRunPayrollView(state) {
    return `
        <div class="card" style="padding: 32px;">
            <div class="wizard-steps">
                <div class="wizard-progress-bar" id="wizardProgressBar"></div>
                <div class="wizard-step active" id="stepIndicator1">
                    <div class="step-circle">1</div>
                    <span class="step-label">Enter Hours & Wages</span>
                </div>
                <div class="wizard-step" id="stepIndicator2">
                    <div class="step-circle">2</div>
                    <span class="step-label">Review Taxes & Benefits</span>
                </div>
                <div class="wizard-step" id="stepIndicator3">
                    <div class="step-circle">3</div>
                    <span class="step-label">Approve & Deposit</span>
                </div>
            </div>

            <div class="wizard-view active" id="wizardView1">
                <div class="section-title">Step 1: Record Hours and Additional Earnings</div>
                <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 20px;">
                    Review payroll wages for the current cycle. Weekly timesheet hours have been pre-filled if logged. You can add one-time bonuses or commissions directly.
                </p>
                
                <div class="table-wrapper" style="margin-bottom: 24px; border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden;">
                    <table class="table-responsive">
                        <thead style="background-color: var(--bg-tertiary);">
                            <tr>
                                <th>Employee</th>
                                <th>Pay Basis</th>
                                <th>Regular Hours</th>
                                <th>Overtime Hours</th>
                                <th>Bonus ($)</th>
                                <th>Commissions ($)</th>
                                <th>401(k) (%)</th>
                                <th>Medical ($)</th>
                                <th>Reimbursement ($)</th>
                                <th style="text-align: right;">Gross Pay (Est)</th>
                            </tr>
                        </thead>
                        <tbody id="wizardHoursTableBody">
                            <!-- Dynamic Rows filled in app.js -->
                        </tbody>
                    </table>
                </div>

                <div style="display:flex; justify-content:flex-end;">
                    <button class="btn btn-primary" onclick="AeroApp.wizardGoToStep(2)">
                        Continue to Tax Review
                        <svg style="width:16px;height:16px" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"></path></svg>
                    </button>
                </div>
            </div>

            <div class="wizard-view" id="wizardView2">
                <div class="section-title">Step 2: Review Tax Withholding & Deductions</div>
                <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 20px;">
                    Below is the mathematically exact breakdown of employee tax withholdings, pre-tax/post-tax benefits deductions, and employer payroll contributions. Click any employee row to preview the generated pay stub.
                </p>
                
                <div class="table-wrapper" style="margin-bottom: 24px; border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden;">
                    <table class="table-responsive">
                        <thead style="background-color: var(--bg-tertiary);">
                            <tr>
                                <th>Employee</th>
                                <th>Gross Pay</th>
                                <th>FIT Withheld</th>
                                <th>FICA Withheld</th>
                                <th>SIT Withheld</th>
                                <th>Deductions</th>
                                <th style="color:var(--success)">Net Pay</th>
                                <th style="text-align: right;">Total Employer Cost</th>
                            </tr>
                        </thead>
                        <tbody id="wizardTaxTableBody">
                            <!-- Dynamic Rows filled in app.js -->
                        </tbody>
                    </table>
                </div>

                <div style="display:flex; justify-content:space-between;">
                    <button class="btn btn-secondary" onclick="AeroApp.wizardGoToStep(1)">
                        <svg style="width:16px;height:16px" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"></path></svg>
                        Back
                    </button>
                    <button class="btn btn-primary" onclick="AeroApp.wizardGoToStep(3)">
                        Proceed to Deposit Confirmation
                        <svg style="width:16px;height:16px" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"></path></svg>
                    </button>
                </div>
            </div>

            <div class="wizard-view" id="wizardView3">
                <div class="section-title">Step 3: Direct Deposit and Submission</div>
                <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 24px;">
                    Review funding requirements for this pay cycle. Clicking "Submit Payroll" triggers direct deposit and files your withholding liabilities.
                </p>
                
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 32px;">
                    <div class="card" style="background-color:var(--bg-tertiary); border: 1px solid var(--border-color);">
                        <h4 style="font-family:var(--font-heading); margin-bottom: 12px;">Funding Summary</h4>
                        <div style="display:flex; flex-direction:column; gap:12px; font-size:14px;">
                            <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding-bottom:8px;">
                                <span>Total Net Wages (Direct Deposit):</span>
                                <span style="font-weight:700;" id="wizardNetWagesSum">$0.00</span>
                            </div>
                            <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding-bottom:8px;">
                                <span>Total Tax Liabilities (FICA/FIT/SIT):</span>
                                <span style="font-weight:700;" id="wizardTaxLiabilitiesSum">$0.00</span>
                            </div>
                            <div style="display:flex; justify-content:space-between; font-weight:700; color:var(--primary); font-size:16px; padding-top:4px;">
                                <span>Total Debit Amount:</span>
                                <span id="wizardTotalDebitSum">$0.00</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="card" style="background-color:var(--bg-tertiary); border: 1px solid var(--border-color); display:flex; flex-direction:column; justify-content:space-between;">
                        <div>
                            <h4 style="font-family:var(--font-heading); margin-bottom: 12px;">Timeline & Settlement</h4>
                            <div style="font-size:13px; color:var(--text-secondary); line-height:1.6;">
                                <p><strong>Funding Account:</strong> Chase Bank Account Ending in ...8920</p>
                                <p><strong>Initiation Date:</strong> Today, June 14, 2026</p>
                                <p><strong>Settlement / Pay Date:</strong> June 16, 2026 (2-Day Direct Deposit)</p>
                            </div>
                        </div>
                        <div class="badge badge-success" style="align-self:flex-start; margin-top:12px;">Bank Connection Secure</div>
                    </div>
                </div>

                <div style="display:flex; justify-content:space-between;">
                    <button class="btn btn-secondary" onclick="AeroApp.wizardGoToStep(2)">
                        <svg style="width:16px;height:16px" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"></path></svg>
                        Back
                    </button>
                    <button class="btn btn-success" onclick="AeroApp.submitPayrollRun()">
                        Submit for Approval
                        <svg style="width:16px;height:16px" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"></path></svg>
                    </button>
                </div>
            </div>
        </div>
    `;
}

// 4. Render Time Tracking timesheet scheduler
function renderTimeTrackingView(state) {
    return `
        <div class="card" style="padding:32px;">
            <div class="section-title">Weekly Timesheet Scheduler</div>
            <p style="font-size:13px; color:var(--text-secondary); margin-bottom: 24px;">
                Enter hours worked for hourly staff. Overtime is automatically calculated for hours exceeding 40 per week. Salaried employees are auto-processed at standard rates.
            </p>
            
            <div style="display:flex; gap:16px; align-items:center; margin-bottom:24px;">
                <div class="form-group" style="width: 250px;">
                    <label for="timesheetEmployeeSelect">Select Hourly Employee</label>
                    <select class="form-control" id="timesheetEmployeeSelect" onchange="AeroApp.loadEmployeeTimesheet()">
                        <!-- Options filled in app.js -->
                    </select>
                </div>
                <div style="padding-top:20px;">
                    <span class="badge badge-info" id="timesheetPayRateBadge">$0.00/hr pay rate</span>
                </div>
            </div>

            <div class="timesheet-grid" id="timesheetInputsContainer">
                <!-- Day cells filled dynamically -->
            </div>
            
            <div class="live-calc-box">
                <div>
                    <span class="live-calc-label">Total Hours:</span>
                    <span style="font-weight:700; margin-left:8px;" id="timesheetTotalHrs">0 hrs</span>
                </div>
                <div>
                    <span class="live-calc-label">Regular / Overtime:</span>
                    <span style="font-weight:700; margin-left:8px; color:var(--success);" id="timesheetBreakdownHrs">0h Reg / 0h OT</span>
                </div>
                <div>
                    <span class="live-calc-label">Estimated Gross:</span>
                    <span class="live-calc-value" id="timesheetEstGross">$0.00</span>
                </div>
            </div>
            
            <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
                <button class="btn btn-secondary" onclick="AeroApp.resetTimesheet()">Reset Hours</button>
                <button class="btn btn-primary" onclick="AeroApp.saveTimesheet()">Save & Sync with Payroll</button>
            </div>
        </div>
    `;
}

// 5. Render Tax Compliance view
// ─── State portal links for all 50 states ─────────────────────
const STATE_PORTAL_DATA = {
    AL: { wh: { name: 'AL DOR',     url: 'https://myalabamataxes.alabama.gov' },                  suta: { name: 'AL DOL',  url: 'https://labor.alabama.gov/uc/taxinfo.aspx' } },
    AK: { wh: null,                                                                                 suta: { name: 'AK DOL',  url: 'https://labor.alaska.gov/estax/home.htm' } },
    AZ: { wh: { name: 'AZ DOR',     url: 'https://aztaxes.gov' },                                  suta: { name: 'AZ DES',  url: 'https://des.az.gov/RA-taxes' } },
    AR: { wh: { name: 'AR DFA',     url: 'https://atap.arkansas.gov' },                            suta: { name: 'AR DWS',  url: 'https://www.dws.arkansas.gov/employers' } },
    CA: { wh: { name: 'CA EDD',     url: 'https://edd.ca.gov/en/payroll_taxes/e-services_for_business' }, suta: { name: 'CA EDD', url: 'https://edd.ca.gov/en/payroll_taxes/e-services_for_business' } },
    CO: { wh: { name: 'CO DOR',     url: 'https://tax.colorado.gov/business' },                    suta: { name: 'CO CDLE', url: 'https://uitax.colorado.gov' } },
    CT: { wh: { name: 'CT DRS',     url: 'https://myconnect.ct.gov' },                             suta: { name: 'CT DOL',  url: 'https://www.ctdol.state.ct.us/uitax' } },
    DE: { wh: { name: 'DE DOF',     url: 'https://revenue.delaware.gov' },                         suta: { name: 'DE DOL',  url: 'https://ui.delawareworks.com' } },
    FL: { wh: null,                                                                                 suta: { name: 'FL DEO',  url: 'https://connect.myflorida.com' } },
    GA: { wh: { name: 'GA DOR',     url: 'https://gtc.dor.ga.gov' },                              suta: { name: 'GA DOL',  url: 'https://www.dol.state.ga.us/em' } },
    HI: { wh: { name: 'HI DOTAX',  url: 'https://hitax.hawaii.gov' },                             suta: { name: 'HI DLIR', url: 'https://huiclaims3.hawaii.gov' } },
    ID: { wh: { name: 'ID STC',     url: 'https://idaho.gov/taxes' },                              suta: { name: 'ID DOL',  url: 'https://labor.idaho.gov/dnn/Businesses/Taxes' } },
    IL: { wh: { name: 'IL DOR',     url: 'https://mytax.illinois.gov' },                           suta: { name: 'IL IDES', url: 'https://www2.illinois.gov/ides/Pages/Employer_UI_Obligations.aspx' } },
    IN: { wh: { name: 'IN DOR',     url: 'https://intime.dor.in.gov' },                            suta: { name: 'IN DWD',  url: 'https://uplink.in.gov' } },
    IA: { wh: { name: 'IA DOR',     url: 'https://tax.iowa.gov' },                                 suta: { name: 'IA IWD',  url: 'https://uiclaims.iwd.iowa.gov' } },
    KS: { wh: { name: 'KS DOR',     url: 'https://www.ksrevenue.gov/businesstax.html' },           suta: { name: 'KS DOL',  url: 'https://www.getkansasbenefits.gov' } },
    KY: { wh: { name: 'KY DOR',     url: 'https://revenue.ky.gov/Business' },                     suta: { name: 'KY EMS',  url: 'https://kewes.ky.gov' } },
    LA: { wh: { name: 'LA DOR',     url: 'https://latap.revenue.louisiana.gov' },                  suta: { name: 'LA LWC',  url: 'https://www.louisianaworks.net/hire' } },
    ME: { wh: { name: 'ME DOR',     url: 'https://www.maine.gov/revenue/taxes/income-estate-taxes/withholding' }, suta: { name: 'ME DOL', url: 'https://reemployme.maine.gov' } },
    MD: { wh: { name: 'MD COMP',    url: 'https://interactive.marylandtaxes.gov' },                suta: { name: 'MD DUI',  url: 'https://www.mdunemployment.com' } },
    MA: { wh: { name: 'MA DOR',     url: 'https://mtc.dor.state.ma.us' },                         suta: { name: 'MA DUA',  url: 'https://uionline.detma.org' } },
    MI: { wh: { name: 'MI Treasury',url: 'https://www.michigan.gov/taxes' },                       suta: { name: 'MI UIA',  url: 'https://miwam.michigan.gov' } },
    MN: { wh: { name: 'MN DOR',     url: 'https://www.revenue.state.mn.us/businesses' },           suta: { name: 'MN DEED', url: 'https://uistax.minnesota.gov' } },
    MS: { wh: { name: 'MS DOR',     url: 'https://tap.dor.ms.gov' },                              suta: { name: 'MS DES',  url: 'https://www.mdes.ms.gov/employers' } },
    MO: { wh: { name: 'MO DOR',     url: 'https://mytax.mo.gov' },                                suta: { name: 'MO LES',  url: 'https://labor.mo.gov/DES' } },
    MT: { wh: { name: 'MT DOR',     url: 'https://tap.dor.mt.gov' },                              suta: { name: 'MT UI',   url: 'https://uid.dli.mt.gov/employers' } },
    NE: { wh: { name: 'NE DOR',     url: 'https://www.revenue.nebraska.gov/businesses.html' },     suta: { name: 'NE DOL',  url: 'https://NEworks.nebraska.gov' } },
    NV: { wh: null,                                                                                 suta: { name: 'NV DETR', url: 'https://ui.nv.gov/employers.html' } },
    NH: { wh: null,                                                                                 suta: { name: 'NH NHES', url: 'https://www.nhes.nh.gov/services/employers' } },
    NJ: { wh: { name: 'NJ Treasury',url: 'https://www.state.nj.us/treasury/taxation/businesses' }, suta: { name: 'NJ DOL',  url: 'https://www.nj.gov/labor/ea/employer-services' } },
    NM: { wh: { name: 'NM TRD',     url: 'https://tap.state.nm.us' },                             suta: { name: 'NM DWS',  url: 'https://www.dws.state.nm.us/Employers' } },
    NY: { wh: { name: 'NY DTF',     url: 'https://www.tax.ny.gov/online' },                       suta: { name: 'NY DOL',  url: 'https://www.labor.ny.gov/ui/bnyservices' } },
    NC: { wh: { name: 'NC DOR',     url: 'https://www.ncdor.gov/file-pay' },                      suta: { name: 'NC DES',  url: 'https://des.nc.gov/employers' } },
    ND: { wh: { name: 'ND OTC',     url: 'https://www.nd.gov/tax/user/businesses' },              suta: { name: 'ND JS',   url: 'https://www.jobsnd.com/employers' } },
    OH: { wh: { name: 'OH DOR',     url: 'https://gateway.ohio.gov' },                            suta: { name: 'OH JFS',  url: 'https://unemployment.ohio.gov/employers' } },
    OK: { wh: { name: 'OK OTC',     url: 'https://oktap.tax.ok.gov' },                            suta: { name: 'OK OES',  url: 'https://oesc.ok.gov/employers' } },
    OR: { wh: { name: 'OR DOR',     url: 'https://www.oregon.gov/dor/programs/businesses' },       suta: { name: 'OR OED',  url: 'https://www.oregon.gov/employ/Businesses' } },
    PA: { wh: { name: 'PA DOR',     url: 'https://mypath.pa.gov' },                               suta: { name: 'PA UC',   url: 'https://www.uc.pa.gov/employers-uc-services-ucms' } },
    RI: { wh: { name: 'RI DOR',     url: 'https://taxportal.ri.gov' },                            suta: { name: 'RI DOL',  url: 'https://uionline.detma.org/Claimant/Core/Login.ASPX' } },
    SC: { wh: { name: 'SC DOR',     url: 'https://mydorway.dor.sc.gov' },                         suta: { name: 'SC DEW',  url: 'https://uiutax.sc.gov' } },
    SD: { wh: null,                                                                                 suta: { name: 'SD DOL',  url: 'https://dlr.sd.gov/ra/employers' } },
    TN: { wh: null,                                                                                 suta: { name: 'TN DOL',  url: 'https://www.tn.gov/workforce/employers.html' } },
    TX: { wh: null,                                                                                 suta: { name: 'TX TWC',  url: 'https://www.twc.texas.gov/businesses/unemployment-tax-services-uts' } },
    UT: { wh: { name: 'UT TC',      url: 'https://tap.utah.gov' },                                suta: { name: 'UT DWS',  url: 'https://jobs.utah.gov/employer' } },
    VT: { wh: { name: 'VT DOR',     url: 'https://myvtax.vermont.gov' },                          suta: { name: 'VT DOL',  url: 'https://www.vermontjoblink.com/employers' } },
    VA: { wh: { name: 'VA TAX',     url: 'https://www.business.tax.virginia.gov' },               suta: { name: 'VA VEC',  url: 'https://www.vec.virginia.gov/employers' } },
    WA: { wh: null,                                                                                 suta: { name: 'WA ESD',  url: 'https://secure.esd.wa.gov/home' } },
    WV: { wh: { name: 'WV DOR',     url: 'https://mytaxes.wvtax.gov' },                           suta: { name: 'WV WFW',  url: 'https://workforcewv.org/employers' } },
    WI: { wh: { name: 'WI DOR',     url: 'https://tap.revenue.wi.gov' },                          suta: { name: 'WI DWD',  url: 'https://dwd.wisconsin.gov/uitax' } },
    WY: { wh: null,                                                                                 suta: { name: 'WY DOW',  url: 'https://dows.wyo.gov/employers' } },
    DC: { wh: { name: 'DC OTR',     url: 'https://mytax.dc.gov' },                                suta: { name: 'DC DOES', url: 'https://does.dc.gov/service/employer-tax-information' } },
};

// ─── Build the 2026 federal filing calendar ───────────────────
function _buildFilingCalendar(state) {
    const now   = new Date();
    const year  = now.getFullYear();

    // Derive active states from employee roster
    const activeStates = [...new Set(state.employees.map(e => e.state).filter(Boolean))];

    // Calculate real liabilities from payroll history
    let totalGross = 0, totalFIT = 0, totalSS = 0, totalMed = 0, totalFUTA = 0;
    let stateLiabilities = {};

    state.employees.forEach(emp => {
        let empGross = 0;
        state.payrollHistory.forEach(h => {
            if (h.details && h.details[emp.id]) {
                const d = h.details[emp.id];
                totalGross += d.grossPay || 0;
                totalFIT   += d.taxes?.federalIncomeTax || 0;
                totalSS    += (d.taxes?.socialSecurity || 0) + (d.employerTaxes?.socialSecurity || 0);
                totalMed   += (d.taxes?.medicare || 0) + (d.employerTaxes?.medicare || 0);
                totalFUTA  += d.employerTaxes?.futa || 0;
                empGross   += d.grossPay || 0;

                // State withholding
                const st = emp.state;
                if (!stateLiabilities[st]) stateLiabilities[st] = { wh: 0, suta: 0 };
                stateLiabilities[st].wh   += d.taxes?.stateIncomeTax || 0;
                stateLiabilities[st].suta += d.employerTaxes?.suta || 0;
            }
        });
    });

    const q = Math.ceil((now.getMonth() + 1) / 3); // current quarter
    const quarterLabel = `Q${q} ${year}`;
    const nextQuarter  = q === 4 ? `Q1 ${year+1}` : `Q${q+1} ${year}`;

    // 941 deadlines: Apr 30, Jul 31, Oct 31, Jan 31
    const deadlines941 = [
        { period: `Q1 ${year}`, due: new Date(year, 3, 30) },
        { period: `Q2 ${year}`, due: new Date(year, 6, 31) },
        { period: `Q3 ${year}`, due: new Date(year, 9, 31) },
        { period: `Q4 ${year}`, due: new Date(year+1, 0, 31) },
    ];

    // EFTPS semi-weekly or monthly deposit — show monthly for simplicity
    // Monthly depositors pay by the 15th of the following month
    const thisMonth = now.getMonth();
    const eftpsDeadline = new Date(year, thisMonth + 1, 15);

    const filings = [];

    // ── Federal filings ──
    deadlines941.forEach(({ period, due }) => {
        const status = _deadlineStatus(due, now);
        filings.push({
            id:         `941-${period}`,
            form:       'Form 941',
            period,
            agency:     'IRS',
            amount:     totalFIT + totalSS + totalMed,
            due,
            status,
            portalUrl:  'https://www.eftps.gov/eftps',
            portalName: 'Pay via EFTPS',
            category:   'federal',
            description:'Quarterly Employer Federal Tax Return — wages, FIT, FICA',
        });
    });

    // FUTA 940 (annual, due Jan 31)
    const futa940Due = new Date(year + 1, 0, 31);
    filings.push({
        id:         `940-${year}`,
        form:       'Form 940',
        period:     `Annual ${year}`,
        agency:     'IRS',
        amount:     totalFUTA,
        due:        futa940Due,
        status:     _deadlineStatus(futa940Due, now),
        portalUrl:  'https://www.eftps.gov/eftps',
        portalName: 'Pay via EFTPS',
        category:   'federal',
        description:'Annual Federal Unemployment (FUTA) Tax Return',
    });

    // EFTPS monthly deposit
    filings.push({
        id:         `eftps-${year}-${thisMonth+1}`,
        form:       'EFTPS Deposit',
        period:     now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        agency:     'IRS / EFTPS',
        amount:     totalFIT + totalSS + totalMed,
        due:        eftpsDeadline,
        status:     _deadlineStatus(eftpsDeadline, now),
        portalUrl:  'https://www.eftps.gov/eftps',
        portalName: 'Pay via EFTPS',
        category:   'federal',
        description:'Monthly federal tax deposit (FIT + employee & employer FICA)',
    });

    // W-2 deadline (Jan 31)
    const w2Due = new Date(year + 1, 0, 31);
    filings.push({
        id:         `w2-${year}`,
        form:       'W-2 / W-3',
        period:     `Annual ${year}`,
        agency:     'SSA / IRS',
        amount:     0,
        due:        w2Due,
        status:     _deadlineStatus(w2Due, now),
        portalUrl:  'https://www.ssa.gov/employer/businessservices.htm',
        portalName: 'File via SSA Business Services',
        category:   'federal',
        description:'Annual Wage and Tax Statements — distribute to employees + file with SSA',
    });

    // 1099-NEC deadline (Jan 31)
    const contractors = state.employees.filter(e => e.classification === '1099');
    if (contractors.length > 0) {
        const necDue = new Date(year + 1, 0, 31);
        filings.push({
            id:         `1099-nec-${year}`,
            form:       '1099-NEC',
            period:     `Annual ${year}`,
            agency:     'IRS',
            amount:     0,
            due:        necDue,
            status:     _deadlineStatus(necDue, now),
            portalUrl:  'https://www.irs.gov/filing/e-file-options',
            portalName: 'E-File via IRS FIRE',
            category:   'federal',
            description:`Non-employee compensation for ${contractors.length} contractor${contractors.length > 1 ? 's' : ''}`,
        });
    }

    // ── State filings ──
    activeStates.forEach(st => {
        const portal = STATE_PORTAL_DATA[st];
        if (!portal) return;
        const liab   = stateLiabilities[st] || { wh: 0, suta: 0 };

        // State withholding — monthly, due 15th of following month
        if (portal.wh) {
            const whDue = new Date(year, thisMonth + 1, 15);
            filings.push({
                id:         `${st}-wh-${year}-${thisMonth+1}`,
                form:       `${st} State Withholding`,
                period:     now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
                agency:     portal.wh.name,
                amount:     liab.wh,
                due:        whDue,
                status:     _deadlineStatus(whDue, now),
                portalUrl:  portal.wh.url,
                portalName: `Pay via ${portal.wh.name}`,
                category:   'state',
                description:`${st} employee income tax withholding deposit`,
            });
        }

        // SUTA — quarterly
        const sutaDeadlines = [
            { period: `Q1 ${year}`, due: new Date(year, 3, 30) },
            { period: `Q2 ${year}`, due: new Date(year, 6, 31) },
            { period: `Q3 ${year}`, due: new Date(year, 9, 31) },
            { period: `Q4 ${year}`, due: new Date(year+1, 0, 31) },
        ];
        sutaDeadlines.forEach(({ period, due }) => {
            filings.push({
                id:         `${st}-suta-${period}`,
                form:       `${st} SUTA`,
                period,
                agency:     portal.suta.name,
                amount:     liab.suta,
                due,
                status:     _deadlineStatus(due, now),
                portalUrl:  portal.suta.url,
                portalName: `Pay via ${portal.suta.name}`,
                category:   'state',
                description:`${st} State Unemployment (SUTA) quarterly deposit`,
            });
        });
    });

    // Sort by due date
    filings.sort((a, b) => a.due - b.due);

    return { filings, totalGross, totalFIT, totalSS, totalMed, totalFUTA, stateLiabilities, activeStates };
}

function _deadlineStatus(due, now) {
    const diff = (due - now) / (1000 * 60 * 60 * 24);
    if (diff < 0)  return 'overdue';
    if (diff <= 14) return 'pending';
    return 'upcoming';
}

function _statusPill(status, filed) {
    if (filed) return `<span class="filing-pill filed">✓ Filed</span>`;
    const map = {
        overdue:  `<span class="filing-pill overdue">Overdue</span>`,
        pending:  `<span class="filing-pill pending">Due Soon</span>`,
        upcoming: `<span class="filing-pill upcoming">Upcoming</span>`,
    };
    return map[status] || '';
}

// Forms transmittable through the connected e-file provider.
const EFILE_SUPPORTED_FORMS = new Set(['Form 941', 'Form 940', 'W-2 / W-3', '1099-NEC']);

function _efilePill(status) {
    const map = {
        submitting: `<span class="filing-pill transmitting">Transmitting…</span>`,
        submitted:  `<span class="filing-pill efiled">E-Filed · Pending</span>`,
        accepted:   `<span class="filing-pill filed">✓ Accepted · E-Filed</span>`,
        rejected:   `<span class="filing-pill overdue">E-File Rejected</span>`,
        error:      `<span class="filing-pill overdue">E-File Error</span>`,
    };
    return map[status] || '';
}

function _daysLabel(due, now) {
    const diff = Math.round((due - now) / (1000 * 60 * 60 * 24));
    if (diff < 0)  return `${Math.abs(diff)}d overdue`;
    if (diff === 0) return 'Due today';
    if (diff === 1) return 'Due tomorrow';
    return `${diff}d left`;
}

function renderTaxComplianceView(state) {
    const now = new Date();
    const { filings, totalFIT, totalSS, totalMed, totalFUTA, activeStates } = _buildFilingCalendar(state);

    const overdue  = filings.filter(f => f.status === 'overdue' && !f.filed);
    const pending  = filings.filter(f => f.status === 'pending' && !f.filed);
    const upcoming = filings.filter(f => f.status === 'upcoming' && !f.filed);
    const filed    = (state.filingRecords || []);

    const nextFiling = [...pending, ...upcoming][0];
    const totalOwed  = filings.reduce((s, f) => s + (f.amount || 0), 0);

    // Mark which filings are already confirmed filed
    const filedIds = new Set((state.filingRecords || []).map(r => r.form_ref));
    // Index e-file submissions by the filing-calendar id (form_ref)
    const efileByRef = new Map((state.taxFilings || []).map(s => [s.form_ref, s]));

    function renderFilingRow(f) {
        const efile     = efileByRef.get(f.id);
        const efileDone = efile && efile.status === 'accepted';
        const isFiled   = filedIds.has(f.id) || efileDone;
        const daysLeft  = _daysLabel(f.due, now);
        const pill      = efile ? _efilePill(efile.status) : _statusPill(f.status, isFiled);
        const amtStr    = f.amount > 0 ? formatCurrency(f.amount) : '—';
        const rowBorder = f.status === 'overdue' && !isFiled ? 'border-left: 3px solid var(--danger);' :
                          f.status === 'pending'  && !isFiled ? 'border-left: 3px solid var(--warning);' : '';
        const canEfile  = EFILE_SUPPORTED_FORMS.has(f.form);
        const efileArgs = `'${f.id}', '${f.form}', '${f.period}', '${f.agency}', ${f.amount}`;

        // Determine the action cluster based on filing / e-file state.
        let actions;
        if (efileDone) {
            actions = `<span style="font-size:12px; color:var(--success); font-weight:600;">✓ Accepted · E-Filed via ${efile.provider || 'provider'}</span>`;
        } else if (efile && (efile.status === 'submitting' || efile.status === 'submitted')) {
            actions = `<span style="font-size:12px; color:var(--primary); font-weight:600; white-space:nowrap;">
                ${efile.status === 'submitting' ? 'Transmitting…' : 'E-Filed — awaiting acknowledgement'}</span>`;
        } else if (isFiled) {
            actions = `<span style="font-size:12px; color:var(--success); font-weight:600;">✓ Confirmed Filed</span>`;
        } else {
            const retry = efile && (efile.status === 'rejected' || efile.status === 'error');
            actions = `
                ${canEfile ? `
                <button class="btn btn-primary" style="font-size:12px; padding:6px 12px; white-space:nowrap;"
                    onclick="AeroApp.submitEfile(${efileArgs})">
                    ${retry ? 'Retry E-File' : 'E-File'} ↑
                </button>` : ''}
                <a href="${f.portalUrl}" target="_blank" rel="noopener" class="btn btn-outline" style="font-size:12px; padding:6px 12px; white-space:nowrap;">
                    ${f.portalName} ↗
                </a>
                <button class="btn btn-secondary" style="font-size:12px; padding:6px 12px; white-space:nowrap;"
                    onclick="AeroApp.markFiled('${f.id}', '${f.form}', '${f.period}', '${f.agency}', ${f.amount})">
                    Mark Filed ✓
                </button>`;
        }

        // Meta line: show e-file rejection/error detail when present.
        const metaStatus = efile
            ? (efile.status === 'rejected' || efile.status === 'error'
                ? `<span style="color:var(--danger);">${efile.status_detail || 'E-file failed'}</span>`
                : `<span style="color:var(--primary);">${efile.provider || 'E-file provider'}</span>`)
            : `<span style="color:${f.status === 'overdue' && !isFiled ? 'var(--danger)' : f.status === 'pending' && !isFiled ? 'var(--warning)' : 'var(--text-tertiary)'};">${isFiled ? 'Filed' : daysLeft}</span>`;

        return `
        <div class="filing-row" style="${rowBorder}">
            <div class="filing-row-main">
                <div class="filing-row-left">
                    <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                        <span class="filing-form-badge ${f.category}">${f.form}</span>
                        ${pill}
                    </div>
                    <div class="filing-row-title">${f.description}</div>
                    <div class="filing-row-meta">
                        <span>${f.agency}</span>
                        <span>·</span>
                        <span>${f.period}</span>
                        <span>·</span>
                        ${metaStatus}
                        ${f.amount > 0 ? `<span>·</span><span style="font-weight:600;color:var(--text-primary);">${amtStr}</span>` : ''}
                    </div>
                </div>
                <div class="filing-row-actions">
                    ${actions}
                </div>
            </div>
        </div>`;
    }

    const federalFilings = filings.filter(f => f.category === 'federal');
    const stateFilings   = filings.filter(f => f.category === 'state');

    return `
    <!-- Alert banner for overdue -->
    ${overdue.length > 0 ? `
    <div style="background:var(--danger-light); border:1px solid var(--danger); border-radius:var(--radius-md);
                padding:12px 16px; display:flex; align-items:center; gap:12px; margin-bottom:20px; flex-wrap:wrap;">
        <svg style="width:18px;height:18px;color:var(--danger);flex-shrink:0;" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
        </svg>
        <span style="font-size:13px; font-weight:600; color:var(--danger);">
            ${overdue.length} filing${overdue.length > 1 ? 's' : ''} overdue — action required immediately to avoid IRS penalties.
        </span>
    </div>` : ''}

    <!-- Stat cards -->
    <div class="grid-stats" style="margin-bottom:28px;">
        <div class="card stat-card">
            <span class="stat-label">Next Deadline</span>
            <span class="stat-value" style="font-size:18px;">${nextFiling ? nextFiling.due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</span>
            <span class="stat-trend" style="color:var(--text-secondary);">${nextFiling ? nextFiling.form + ' · ' + nextFiling.period : 'All caught up'}</span>
        </div>
        <div class="card stat-card">
            <span class="stat-label">Overdue</span>
            <span class="stat-value" style="color:${overdue.length > 0 ? 'var(--danger)' : 'var(--success)'};">${overdue.length}</span>
            <span class="stat-trend" style="color:var(--text-secondary);">${pending.length} due within 14 days</span>
        </div>
        <div class="card stat-card">
            <span class="stat-label">Accrued FICA (YTD)</span>
            <span class="stat-value" id="complianceAccruedFica">${formatCurrency(totalSS + totalMed)}</span>
            <span class="stat-trend up">Employee + Employer share</span>
        </div>
        <div class="card stat-card">
            <span class="stat-label">FUTA Liability (YTD)</span>
            <span class="stat-value" id="complianceFutaLiability">${formatCurrency(totalFUTA)}</span>
            <span class="badge badge-success" style="align-self:flex-start; margin-top:4px;">Credited at 5.4%</span>
        </div>
    </div>

    <!-- Tab nav -->
    <div style="display:flex; gap:4px; margin-bottom:20px; background:var(--bg-tertiary); border-radius:var(--radius-md); padding:4px; width:fit-content;">
        <button class="compliance-tab active" id="tabFederal" onclick="AeroApp.switchComplianceTab('federal')">Federal (${federalFilings.length})</button>
        <button class="compliance-tab" id="tabState" onclick="AeroApp.switchComplianceTab('state')">State (${stateFilings.length})</button>
        <button class="compliance-tab" id="tabForms" onclick="AeroApp.switchComplianceTab('forms')">Tax Forms</button>
        <button class="compliance-tab" id="tabHistory" onclick="AeroApp.switchComplianceTab('history')">Filing History</button>
    </div>

    <!-- Federal tab -->
    <div id="complianceTabFederal" class="compliance-tab-panel active">
        <div class="card" style="padding:0; overflow:hidden;">
            <div style="padding:16px 20px; border-bottom:1px solid var(--border-color);">
                <div class="section-title" style="margin:0;">Federal Tax Filings — ${new Date().getFullYear()}</div>
                <p style="font-size:12px; color:var(--text-tertiary); margin-top:4px;">
                    E-File to transmit electronically through your connected provider, or use a portal link and Mark as Filed for manual submissions.
                </p>
            </div>
            <div class="filing-list">
                ${federalFilings.map(renderFilingRow).join('')}
            </div>
        </div>
    </div>

    <!-- State tab -->
    <div id="complianceTabState" class="compliance-tab-panel" style="display:none;">
        ${activeStates.length === 0 ? `
        <div class="card" style="text-align:center; padding:40px;">
            <p style="color:var(--text-tertiary);">No employees added yet — state filings will appear once you add employees with state assignments.</p>
        </div>` : `
        <div class="card" style="padding:0; overflow:hidden;">
            <div style="padding:16px 20px; border-bottom:1px solid var(--border-color);">
                <div class="section-title" style="margin:0;">State Tax Filings — ${activeStates.join(', ')}</div>
                <p style="font-size:12px; color:var(--text-tertiary); margin-top:4px;">
                    Portal links open the official state tax payment page in a new tab.
                </p>
            </div>
            <div class="filing-list">
                ${stateFilings.map(renderFilingRow).join('')}
            </div>
        </div>`}
    </div>

    <!-- Forms tab -->
    <div id="complianceTabForms" class="compliance-tab-panel" style="display:none;">
        <div class="card">
            <div class="section-title">Generate Tax Forms</div>
            <p style="font-size:13px; color:var(--text-secondary); margin-bottom:20px;">
                Pre-populated from your payroll run data. Download, review, then submit via the portal links above.
            </p>
            <div style="display:flex; flex-direction:column; gap:16px;">
                <div class="filing-form-row">
                    <div>
                        <div style="font-weight:600;">Form 941 — Quarterly Federal Tax Return</div>
                        <div style="font-size:12px; color:var(--text-tertiary);">Wages, FIT withheld, employee & employer FICA. File with IRS quarterly.</div>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <a href="https://www.eftps.gov/eftps" target="_blank" rel="noopener" class="btn btn-outline" style="font-size:12px;">Pay via EFTPS ↗</a>
                        <button class="btn btn-primary" style="font-size:12px;" onclick="AeroApp.simulateForm941()">Preview Form 941</button>
                    </div>
                </div>
                <div class="filing-form-row">
                    <div>
                        <div style="font-weight:600;">Form W-2 — Wage & Tax Statement</div>
                        <div style="font-size:12px; color:var(--text-tertiary);">Annual statement for W-2 employees. Due Jan 31. File Copy A with SSA — <strong>free</strong> via the EFW2 file below.</div>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <select class="form-control" style="width:150px; font-size:12px;" id="w2EmployeeSelect"></select>
                        <button class="btn btn-primary" style="font-size:12px;" onclick="AeroApp.generateW2()">Preview W-2</button>
                        <button class="btn btn-secondary" style="font-size:12px;" onclick="AeroApp.downloadEFW2()">Download EFW2 e-file ↓</button>
                        <a href="https://www.ssa.gov/employer/businessservices.htm" target="_blank" rel="noopener" class="btn btn-outline" style="font-size:12px;">Upload free at SSA BSO ↗</a>
                    </div>
                </div>
                <div class="filing-form-row">
                    <div>
                        <div style="font-weight:600;">Form 1099-NEC — Nonemployee Compensation</div>
                        <div style="font-size:12px; color:var(--text-tertiary);">Annual form for contractors paid $600+. Due Jan 31. File <strong>free</strong> via the IRS IRIS CSV below (a free IRIS TCC is required).</div>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <select class="form-control" style="width:150px; font-size:12px;" id="necContractorSelect"></select>
                        <button class="btn btn-primary" style="font-size:12px;" onclick="AeroApp.generate1099()">Preview 1099-NEC</button>
                        <button class="btn btn-secondary" style="font-size:12px;" onclick="AeroApp.download1099CSV()">Download IRIS CSV ↓</button>
                        <a href="https://www.irs.gov/filing/e-file-information-returns-with-iris" target="_blank" rel="noopener" class="btn btn-outline" style="font-size:12px;">Upload free at IRS IRIS ↗</a>
                    </div>
                </div>
                <div class="filing-form-row">
                    <div>
                        <div style="font-weight:600;">Form 940 — Annual FUTA Return</div>
                        <div style="font-size:12px; color:var(--text-tertiary);">Annual federal unemployment tax. Due Jan 31. Pay via EFTPS.</div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <a href="https://www.eftps.gov/eftps" target="_blank" rel="noopener" class="btn btn-outline" style="font-size:12px;">Pay via EFTPS ↗</a>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- History tab -->
    <div id="complianceTabHistory" class="compliance-tab-panel" style="display:none;">
        <div class="card" style="padding:0; overflow:hidden;">
            <div style="padding:16px 20px; border-bottom:1px solid var(--border-color);">
                <div class="section-title" style="margin:0;">Filing History</div>
            </div>
            ${(state.filingRecords || []).length === 0 ? `
            <div style="padding:40px; text-align:center; color:var(--text-tertiary); font-size:13px;">
                No filings confirmed yet. Click "Mark Filed" on any item above after submitting to the agency portal.
            </div>` : `
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr>
                        <th>Form</th><th>Period</th><th>Agency</th><th>Amount</th><th>Filed At</th><th>Confirmed By</th>
                    </tr></thead>
                    <tbody>
                        ${(state.filingRecords || []).map(r => `
                        <tr>
                            <td style="font-weight:600;">${r.form_type}</td>
                            <td>${r.period}</td>
                            <td>${r.agency}</td>
                            <td>${r.amount_paid > 0 ? formatCurrency(r.amount_paid) : '—'}</td>
                            <td>${r.filed_at ? new Date(r.filed_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '—'}</td>
                            <td style="color:var(--text-tertiary);">${r.actor_label || 'Admin'}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`}
        </div>
    </div>`;
}

// 6. Render Accounting Integrations
function renderIntegrationsView(state) {
    const isQBConnected = state.integrations.quickbooks;
    const isXeroConnected = state.integrations.xero;
    
    return `
        <div class="integration-grid">
            <div class="card integration-card">
                <div>
                    <div class="integration-header">
                        <div class="integration-logo qb">QB</div>
                        <div>
                            <span class="integration-name">QuickBooks Online</span>
                            <div class="integration-status">${isQBConnected ? '<span style="color:var(--success)">Connected</span>' : 'Not Connected'}</div>
                        </div>
                    </div>
                    <div class="integration-body">
                        Sync payroll liabilities, gross salaries, and employer tax cost journal entries directly to your QuickBooks chart of accounts.
                    </div>
                </div>
                <button class="btn ${isQBConnected ? 'btn-secondary' : 'btn-primary'}" onclick="AeroApp.toggleIntegration('quickbooks')">
                    ${isQBConnected ? 'Disconnect' : 'Connect QuickBooks'}
                </button>
            </div>
            
            <div class="card integration-card">
                <div>
                    <div class="integration-header">
                        <div class="integration-logo xero">X</div>
                        <div>
                            <span class="integration-name">Xero Accounting</span>
                            <div class="integration-status">${isXeroConnected ? '<span style="color:var(--success)">Connected</span>' : 'Not Connected'}</div>
                        </div>
                    </div>
                    <div class="integration-body">
                        Map gross pay, employer taxes, benefits adjustments, and banking debits straight to your Xero accounting ledgers.
                    </div>
                </div>
                <button class="btn ${isXeroConnected ? 'btn-secondary' : 'btn-primary'}" onclick="AeroApp.toggleIntegration('xero')">
                    ${isXeroConnected ? 'Disconnect' : 'Connect Xero'}
                </button>
            </div>
        </div>

        <div class="card table-card" style="margin-top: 32px;">
            <div class="section-title" style="padding: 24px 24px 0 24px; margin-bottom: 0;">Ledger Sync Logs</div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead>
                        <tr>
                            <th>Sync Date</th>
                            <th>Integration</th>
                            <th>Entry Details</th>
                            <th>Debit Amount</th>
                            <th>Credit Amount</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody id="integrationSyncLogsBody">
                        <!-- Filled in app.js -->
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

// 7. Render Settings View
function _connectStatusBadge(status) {
    const map = {
        not_created:          { label: 'Not Set Up',            color: 'var(--text-tertiary)', bg: 'var(--bg-tertiary)' },
        pending_onboarding:   { label: 'Onboarding Required',   color: 'var(--warning)',        bg: 'var(--warning-light)' },
        pending_verification: { label: 'Under Review',          color: '#3b82f6',               bg: '#eff6ff' },
        active:               { label: 'Active',                color: 'var(--success)',         bg: 'var(--success-light)' },
    };
    const s = map[status] || map.not_created;
    return `<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:var(--radius-full);background:${s.bg};color:${s.color};">${s.label}</span>`;
}

function renderSettingsView(state) {
    const connectStatus = state.settings?.stripeAccountStatus || 'not_created';
    const faId          = state.settings?.stripeFinancialAccountId || '';
    const accountId     = state.settings?.stripeAccountId || '';
    const requirements  = state.settings?.stripeRequirementsDue || [];
    const detailsSubmitted = !!state.settings?.stripeDetailsSubmitted;

    const reqList = requirements.length
        ? `<ul style="margin:8px 0 0 18px;font-size:12px;color:var(--text-secondary);">
            ${requirements.slice(0, 8).map(r => `<li style="margin-bottom:2px;"><code>${r}</code></li>`).join('')}
            ${requirements.length > 8 ? `<li>…and ${requirements.length - 8} more</li>` : ''}
           </ul>`
        : '';

    return `
        <!-- Treasury / ACH Onboarding Card -->
        <div class="card" style="padding:32px; max-width:800px; margin-bottom:24px;">
            <div class="section-title" style="margin-bottom:4px; display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
                <span>ACH Direct Deposit — Stripe Connect</span>
                ${_connectStatusBadge(connectStatus)}
            </div>
            <p style="font-size:13px; color:var(--text-secondary); margin-bottom:20px;">
                GlidePay uses Stripe Treasury to send ACH direct deposits to your employees. Complete Stripe's one-time onboarding to activate.
            </p>

            ${connectStatus === 'not_created' ? `
            <div style="display:flex; gap:12px; align-items:flex-start; background:var(--bg-secondary); padding:16px; border-radius:var(--radius-sm); border:1px solid var(--border-color); margin-bottom:16px;">
                <div>
                    <p style="font-weight:600; margin:0 0 4px;">Activate ACH Payroll Disbursements</p>
                    <p style="font-size:13px; color:var(--text-secondary); margin:0;">Stripe will verify your business identity (KYB). Your employees can link bank accounts once onboarding is complete.</p>
                </div>
            </div>
            <button class="btn btn-primary" onclick="AeroApp.startConnectOnboarding()">Start Stripe Onboarding</button>
            ` : connectStatus === 'pending_onboarding' ? `
            <div style="background:var(--bg-secondary); padding:16px; border-radius:var(--radius-sm); border:1px solid var(--border-color); margin-bottom:16px;">
                <p style="font-weight:600; margin:0 0 4px;">${detailsSubmitted ? 'Additional information required' : 'Onboarding in progress'}</p>
                <p style="font-size:13px; color:var(--text-secondary); margin:0;">
                    ${detailsSubmitted
                        ? 'Your Stripe connected account is saved, but Stripe still needs more details before ACH/Treasury can activate.'
                        : 'Onboarding has been started. Continue where you left off — your connected account is already linked to this company.'}
                </p>
                ${accountId ? `<p style="font-size:12px;color:var(--text-tertiary);margin:10px 0 0;font-family:monospace;">Account: ${accountId}</p>` : ''}
                ${reqList}
            </div>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
                <button class="btn btn-primary" onclick="AeroApp.startConnectOnboarding()">Continue Onboarding</button>
                <button class="btn btn-outline" onclick="AeroApp.syncConnectStatus()">Refresh Status</button>
            </div>
            ` : connectStatus === 'pending_verification' ? `
            <div style="background:var(--bg-secondary); padding:16px; border-radius:var(--radius-sm); border:1px solid var(--border-color); margin-bottom:16px;">
                <p style="font-size:13px; color:var(--text-secondary); margin:0;">Onboarding submitted — Stripe is reviewing your business information and activating Treasury/ACH capabilities. This typically takes 1–2 business days.</p>
                ${accountId ? `<p style="font-size:12px;color:var(--text-tertiary);margin:10px 0 0;font-family:monospace;">Account: ${accountId}</p>` : ''}
            </div>
            <button class="btn btn-outline" onclick="AeroApp.syncConnectStatus()">Refresh Status</button>
            ` : `
            <div style="display:flex; flex-direction:column; gap:8px; font-size:13px; color:var(--text-secondary);">
                <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                    <span>Connected Account</span>
                    <span style="font-weight:600; color:var(--text-primary); font-family:monospace;">${accountId}</span>
                </div>
                <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                    <span>Treasury Financial Account</span>
                    <span style="font-weight:600; color:var(--text-primary); font-family:monospace;">${faId || '—'}</span>
                </div>
                <div style="display:flex; justify-content:space-between;">
                    <span>ACH Cutoff (standard)</span>
                    <span style="font-weight:600; color:var(--text-primary);">8:30 PM ET</span>
                </div>
                <div style="display:flex; justify-content:space-between;">
                    <span>ACH Cutoff (same-day)</span>
                    <span style="font-weight:600; color:var(--text-primary);">1:00 PM ET</span>
                </div>
            </div>
            <div style="margin-top:16px;">
                <button class="btn btn-outline" onclick="AeroApp.syncConnectStatus()">Refresh Status</button>
            </div>
            `}
        </div>

        <div class="card" style="padding: 32px; max-width:800px;">
            <div class="section-title">Company Profile & Banking</div>
            <p style="font-size:13px; color:var(--text-secondary); margin-bottom:24px;">Configure your federal employer ID (EIN), state UI account details, funding bank numbers, and payroll configurations.</p>
            
            <form id="settingsForm" onsubmit="AeroApp.saveSettings(event)">
                <div class="form-grid" style="margin-bottom:24px;">
                    <div class="form-group">
                        <label for="companyName">Legal Company Name</label>
                        <input type="text" class="form-control" id="companyName" value="${state.settings.companyName}">
                    </div>
                    <div class="form-group">
                        <label for="companyEin">Federal Employer ID (EIN)</label>
                        <input type="text" class="form-control" id="companyEin" value="${state.settings.ein}" placeholder="XX-XXXXXXX">
                    </div>
                    <div class="form-group">
                        <label for="bankName">Funding Bank Name</label>
                        <input type="text" class="form-control" id="bankName" value="${state.settings.bankName}">
                    </div>
                    <div class="form-group">
                        <label for="bankRouting">Bank Routing Number</label>
                        <input type="text" class="form-control" id="bankRouting" value="${state.settings.routingNumber}">
                    </div>
                    <div class="form-group">
                        <label for="bankAccount">Bank Account Number</label>
                        <input type="password" class="form-control" id="bankAccount" value="${state.settings.accountNumber}">
                    </div>
                    <div class="form-group">
                        <label for="paymentType">Payment Type</label>
                        <select class="form-control" id="paymentType">
                            <option value="direct_deposit" ${state.settings.paymentType === 'direct_deposit' ? 'selected' : ''}>Direct Deposit (ACH)</option>
                            <option value="paper_check" ${state.settings.paymentType === 'paper_check' ? 'selected' : ''}>Paper Check Printing</option>
                        </select>
                    </div>
                </div>
                
                <div style="display:flex; justify-content:flex-end; gap:12px;">
                    <button type="submit" class="btn btn-primary">Save Settings</button>
                </div>
            </form>
        </div>
    `;
}

// 8. Generate Printable Pay Stub Markup
function getPaystubHTML(employee, calcDetails, dateRange) {
    const payFrequency = employee.payFrequency || 'biweekly';
    const totalDeductions = calcDetails.preTaxDeductions + calcDetails.postTaxDeductions;
    const taxes = calcDetails.taxes;
    
    return `
        <div class="paystub-container">
            <div class="paystub-header">
                <div>
                    <div style="font-size:22px; font-weight:700; color:#1e3a8a; font-family:'Outfit'">${employee.name.toUpperCase()}</div>
                    <div style="font-size:12px; color:#64748b; font-weight:600;">State Residence: ${employee.state}</div>
                </div>
                <div style="text-align:right;">
                    <div class="paystub-title">Pay Statement</div>
                    <div style="font-size:12px; color:#64748b; font-weight:600;">GlidePay Automated File</div>
                </div>
            </div>
            
            <div class="paystub-meta-grid">
                <div class="paystub-meta-item">
                    <span class="paystub-meta-label">Employee ID</span>
                    <span class="paystub-meta-val">EMP-${employee.id.substring(0,6)}</span>
                </div>
                <div class="paystub-meta-item">
                    <span class="paystub-meta-label">Pay Period</span>
                    <span class="paystub-meta-val">${dateRange}</span>
                </div>
                <div class="paystub-meta-item">
                    <span class="paystub-meta-label">Payment Date</span>
                    <span class="paystub-meta-val">June 16, 2026</span>
                </div>
                <div class="paystub-meta-item">
                    <span class="paystub-meta-label">Filing Status</span>
                    <span class="paystub-meta-val">${employee.filingStatus === 'married' ? 'Married filing jointly' : 'Single'}</span>
                </div>
                <div class="paystub-meta-item">
                    <span class="paystub-meta-label">Pay Frequency</span>
                    <span class="paystub-meta-val" style="text-transform:capitalize;">${payFrequency}</span>
                </div>
                <div class="paystub-meta-item">
                    <span class="paystub-meta-label">Payment Method</span>
                    <span class="paystub-meta-val">Direct Deposit (ACH)</span>
                </div>
            </div>
            
            <table class="paystub-table">
                <thead>
                    <tr>
                        <th>Earnings</th>
                        <th>Rate / Salary Basis</th>
                        <th>Hours</th>
                        <th style="text-align: right;">This Period</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="font-weight:600;">Regular Wages</td>
                        <td>${employee.type === 'salaried' ? formatCurrency(employee.rate) + '/yr' : formatCurrency(employee.rate) + '/hr'}</td>
                        <td>${employee.type === 'salaried' ? '--' : (calcDetails.regularEarnings / employee.rate).toFixed(1)}</td>
                        <td style="text-align: right; font-weight:600;">${formatCurrency(calcDetails.regularEarnings)}</td>
                    </tr>
                    ${calcDetails.overtimeEarnings > 0 ? `
                        <tr>
                            <td style="font-weight:600;">Overtime Wages (1.5x)</td>
                            <td>${formatCurrency(employee.rate * 1.5)}/hr</td>
                            <td>${(calcDetails.overtimeEarnings / (employee.rate * 1.5)).toFixed(1)}</td>
                            <td style="text-align: right; font-weight:600;">${formatCurrency(calcDetails.overtimeEarnings)}</td>
                        </tr>
                    ` : ''}
                    ${calcDetails.bonus > 0 ? `
                        <tr>
                            <td style="font-weight:600;">Bonus</td>
                            <td>One-time</td>
                            <td>--</td>
                            <td style="text-align: right; font-weight:600;">${formatCurrency(calcDetails.bonus)}</td>
                        </tr>
                    ` : ''}
                    ${calcDetails.commissions > 0 ? `
                        <tr>
                            <td style="font-weight:600;">Commissions</td>
                            <td>Calculated</td>
                            <td>--</td>
                            <td style="text-align: right; font-weight:600;">${formatCurrency(calcDetails.commissions)}</td>
                        </tr>
                    ` : ''}
                    <tr class="total-row">
                        <td colspan="3">Total Gross Earnings</td>
                        <td style="text-align: right;">${formatCurrency(calcDetails.grossPay)}</td>
                    </tr>
                </tbody>
            </table>
            
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px;">
                <div>
                    <table class="paystub-table" style="margin-bottom:0;">
                        <thead>
                            <tr>
                                <th>Statutory Taxes</th>
                                <th style="text-align: right;">Withheld</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Federal Income Tax (FIT)</td>
                                <td style="text-align: right; font-weight:600;">${formatCurrency(taxes.federalIncomeTax)}</td>
                            </tr>
                            <tr>
                                <td>Social Security Tax (FICA)</td>
                                <td style="text-align: right; font-weight:600;">${formatCurrency(taxes.socialSecurity)}</td>
                            </tr>
                            <tr>
                                <td>Medicare Tax (FICA)</td>
                                <td style="text-align: right; font-weight:600;">${formatCurrency(taxes.medicare)}</td>
                            </tr>
                            <tr>
                                <td>State Income Tax (SIT - ${employee.state})</td>
                                <td style="text-align: right; font-weight:600;">${formatCurrency(taxes.stateIncomeTax)}</td>
                            </tr>
                            <tr class="total-row">
                                <td>Total Taxes</td>
                                <td style="text-align: right;">${formatCurrency(taxes.totalEmployeeTaxes)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                
                <div>
                    <table class="paystub-table" style="margin-bottom:0;">
                        <thead>
                            <tr>
                                <th>Benefit Deductions</th>
                                <th style="text-align: right;">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Traditional 401(k) (Pre-tax)</td>
                                <td style="text-align: right; font-weight:600;">${formatCurrency(calcDetails.deduction401k)}</td>
                            </tr>
                            <tr>
                                <td>Medical Insurance (Pre-tax)</td>
                                <td style="text-align: right; font-weight:600;">${formatCurrency(calcDetails.deductionMedical)}</td>
                            </tr>
                            ${(calcDetails.garnishmentDeductions > 0) ? `
                            <tr>
                                <td>Court-Ordered Garnishment</td>
                                <td style="text-align: right; font-weight:600; color: var(--danger);">${formatCurrency(calcDetails.garnishmentDeductions)}</td>
                            </tr>
                            ` : ''}
                            ${(calcDetails.payAdvanceDeduction > 0) ? `
                            <tr>
                                <td>Pay Advance Repayment</td>
                                <td style="text-align: right; font-weight:600; color: var(--danger);">${formatCurrency(calcDetails.payAdvanceDeduction)}</td>
                            </tr>
                            ` : ''}
                            <tr>
                                <td>Post-tax Deductions / Roth</td>
                                <td style="text-align: right; font-weight:600;">${formatCurrency(Math.max(0, calcDetails.postTaxDeductions - (calcDetails.garnishmentDeductions || 0) - (calcDetails.payAdvanceDeduction || 0)))}</td>
                            </tr>
                            <tr class="total-row">
                                <td>Total Deductions</td>
                                <td style="text-align: right;">${formatCurrency(totalDeductions)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            
            <div class="paystub-summary-box" style="display:flex; flex-direction:column; gap:12px;">
                <div class="paystub-net-pay-card">
                    <div class="paystub-net-pay-title">Net Take-Home Pay</div>
                    <div class="paystub-net-pay-amount">${formatCurrency(calcDetails.netPay)}</div>
                </div>
                ${calcDetails.hasSplit ? `
                <div style="display:flex; justify-content:space-between; width:100%; font-size:12px; color:#475569; padding: 8px 16px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0; font-family:'Outfit';">
                    <div>
                        <span style="font-weight:600;">Checking Direct Deposit:</span> 
                        <span>${formatCurrency(calcDetails.netPayChecking)}</span>
                    </div>
                    <div>
                        <span style="font-weight:600;">Savings Direct Deposit (${employee.splitDeposits.savingsPercent}%):</span> 
                        <span>${formatCurrency(calcDetails.netPaySavings)}</span>
                    </div>
                </div>
                ` : ''}
            </div>
            
            <div style="border-top:1px dashed #cbd5e1; margin-top:30px; padding-top:15px; font-size:10px; color:#64748b; text-align:center;">
                GlidePay Payroll Systems Inc. - Secure Automated Direct Deposit Statement - Keep for your records.
            </div>
        </div>
    `;
}

// 9. Generate Mock Form 941
function getForm941HTML(state) {
    // Aggregated numbers from completed/approved payroll history
    const allRuns = (state.payrollHistory || []).filter(r => r.status === 'completed' || r.status === 'approved' || !r.status);
    const grossWages = allRuns.reduce((sum, run) => sum + run.grossPayroll, 0);
    const fitWithheld = allRuns.reduce((sum, run) => sum + (run.grossPayroll * 0.12), 0); // Est 12% average FIT
    const ssEmployee = allRuns.reduce((sum, run) => sum + (run.grossPayroll * 0.062), 0);
    const ssEmployer = ssEmployee;
    const medEmployee = allRuns.reduce((sum, run) => sum + (run.grossPayroll * 0.0145), 0);
    const medEmployer = medEmployee;
    
    const totalSS = ssEmployee + ssEmployer;
    const totalMed = medEmployee + medEmployer;
    const totalFICA = totalSS + totalMed;
    const totalTaxes = fitWithheld + totalFICA;
    
    return `
        <div style="background-color:white; color:black; padding:32px; border:2px solid black; font-family:'Outfit',sans-serif; max-width:800px; margin:0 auto; font-size:12px;">
            <div style="display:flex; justify-content:space-between; border-bottom:3px solid black; padding-bottom:16px; margin-bottom:16px;">
                <div>
                    <div style="font-size:24px; font-weight:800; font-family:var(--font-heading)">Form 941</div>
                    <div style="font-size:10px;">Employer's QUARTERLY Federal Tax Return</div>
                    <div style="font-size:9px;">Department of the Treasury - Internal Revenue Service</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:18px; font-weight:800;">2026</div>
                    <div style="font-size:10px; font-weight:600;">GlidePay E-File Pre-populated</div>
                </div>
            </div>
            
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; border:1px solid black; padding:12px; margin-bottom:16px; background-color:#f8fafc;">
                <div>
                    <div style="font-weight:700;">Employer Identification Number (EIN)</div>
                    <div style="font-size:14px; font-weight:600; letter-spacing:2px; margin-top:4px;">${state.settings.ein || 'XX-XXXXXXX'}</div>
                    <div style="font-weight:700; margin-top:8px;">Name</div>
                    <div>${state.settings.companyName}</div>
                </div>
                <div>
                    <div style="font-weight:700;">Report for this Quarter</div>
                    <div style="font-size:14px; font-weight:600; margin-top:4px;">2nd Quarter (Apr, May, Jun 2026)</div>
                    <div style="font-weight:700; margin-top:8px;">Trade Name</div>
                    <div>GlidePay Client Account</div>
                </div>
            </div>
            
            <div style="font-weight:800; font-size:13px; border-bottom:2px solid black; padding-bottom:4px; margin-bottom:8px;">Part 1: Answer these questions for this quarter.</div>
            
            <div style="display:flex; flex-direction:column; gap:8px;">
                <div style="display:flex; justify-content:space-between; border-bottom:1px solid #e2e8f0; padding-bottom:4px;">
                    <span>1. Number of employees who received wages, tips, or other compensation for the pay period:</span>
                    <span style="font-weight:700;">${state.employees.length}</span>
                </div>
                <div style="display:flex; justify-content:space-between; border-bottom:1px solid #e2e8f0; padding-bottom:4px;">
                    <span>2. Wages, tips, and other compensation:</span>
                    <span style="font-weight:700;">${formatCurrency(grossWages)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; border-bottom:1px solid #e2e8f0; padding-bottom:4px;">
                    <span>3. Federal income tax withheld from wages, tips, and other compensation:</span>
                    <span style="font-weight:700;">${formatCurrency(fitWithheld)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; border-bottom:1px solid #e2e8f0; padding-bottom:4px;">
                    <span>5a. Taxable Social Security wages (Total x 12.4%):</span>
                    <span style="font-weight:700;">${formatCurrency(grossWages)} x 0.124 = ${formatCurrency(totalSS)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; border-bottom:1px solid #e2e8f0; padding-bottom:4px;">
                    <span>5c. Taxable Medicare wages & tips (Total x 2.9%):</span>
                    <span style="font-weight:700;">${formatCurrency(grossWages)} x 0.029 = ${formatCurrency(totalMed)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; border-bottom:1px solid #e2e8f0; padding-bottom:4px;">
                    <span>6. Total taxes before adjustments (Add lines 3, 5a, and 5c):</span>
                    <span style="font-weight:700; color:#1e3a8a;">${formatCurrency(totalTaxes)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; border-bottom:1px solid #e2e8f0; padding-bottom:4px;">
                    <span>10. Total taxes after adjustments:</span>
                    <span style="font-weight:700;">${formatCurrency(totalTaxes)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; border-bottom:1px solid #e2e8f0; padding-bottom:4px;">
                    <span>12. Total deposits for this quarter, including overpayments applied from prior quarters:</span>
                    <span style="font-weight:700; color:var(--success);">${formatCurrency(totalTaxes)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-weight:700; font-size:13px; color:var(--success); border-top:1px solid black; padding-top:4px;">
                    <span>Balance Due / Overpayment:</span>
                    <span>$0.00 (Paid via direct ACH debit)</span>
                </div>
            </div>
            
            <div style="margin-top:20px; font-size:10px; color:#64748b; line-height:1.5; font-style:italic; border-top:1px dashed #cbd5e1; padding-top:10px;">
                This form has been compiled using exact federal brackets and FICA guidelines. Signatures are simulated for review.
            </div>
        </div>
    `;
}

// 10. Generate W-2 Form Mockup
function getW2HTML(employee, state, sigRecord) {
    // Aggregate wages and taxes for this employee from state
    // Let's estimate based on history or calculate
    const payFreq = employee.payFrequency || 'biweekly';
    const frequencyFactor = PAY_FREQUENCIES[payFreq];
    
    // Simulate typical annual numbers if there are no processed runs, else sum them
    let grossWages = 0;
    let fitWages = 0;
    let ssWages = 0;
    let medWages = 0;
    
    let fitTax = 0;
    let ssTax = 0;
    let medTax = 0;
    let sitTax = 0;
    
    // Find all processed runs matching this employee
    const filteredRuns = [];
    state.payrollHistory.forEach(historyRun => {
        if (historyRun.details && historyRun.details[employee.id]) {
            filteredRuns.push(historyRun.details[employee.id]);
        }
    });
    
    if (filteredRuns.length > 0) {
        filteredRuns.forEach(r => {
            grossWages += r.grossPay;
            fitWages += r.grossPay - r.preTaxDeductions;
            ssWages += Math.min(r.grossPay, 176100);
            medWages += r.grossPay;
            
            fitTax += r.taxes.federalIncomeTax;
            ssTax += r.taxes.socialSecurity;
            medTax += r.taxes.medicare;
            sitTax += r.taxes.stateIncomeTax;
        });
    } else {
        // Fallback: estimate based on annual salary
        const estimatedAnnual = employee.type === 'salaried' ? employee.rate : employee.rate * 40 * 52;
        grossWages = estimatedAnnual * 0.45; // Assume 45% of year has passed for demo
        fitWages = grossWages * 0.95; // pre-tax deductions offset
        ssWages = Math.min(grossWages, 176100);
        medWages = grossWages;
        
        fitTax = fitWages * 0.12;
        ssTax = ssWages * 0.062;
        medTax = medWages * 0.0145;
        sitTax = employee.state === 'CA' ? fitWages * 0.04 : (employee.state === 'NY' ? fitWages * 0.045 : 0);
    }
    
    return `
        <div style="background-color:#fffdf5; color:black; border:2px solid #b45309; padding:24px; font-family:'Plus Jakarta Sans',sans-serif; font-size:11px; max-width:800px; margin:0 auto; box-shadow:var(--shadow-md);">
            <div style="display:flex; justify-content:space-between; border-bottom:2px solid #b45309; padding-bottom:8px; margin-bottom:12px;">
                <div>
                    <span style="font-size:18px; font-weight:800; color:#b45309;">Form W-2</span>
                    <span style="font-size:11px; font-weight:600; margin-left:8px;">Wage and Tax Statement</span>
                </div>
                <div style="text-align:right; font-weight:800; font-size:14px; color:#b45309;">2026</div>
            </div>
            
            <div style="display:grid; grid-template-columns: 1.2fr 1fr; gap:12px; border:1px solid #b45309;">
                <div style="border-right:1px solid #b45309;">
                    <div style="border-bottom:1px solid #b45309; padding:6px;">
                        <span style="font-weight:700; color:#92400e; font-size:9px; display:block;">a. Employee's social security number</span>
                        <span style="font-weight:600;">XXX-XX-4928</span>
                    </div>
                    <div style="border-bottom:1px solid #b45309; padding:6px;">
                        <span style="font-weight:700; color:#92400e; font-size:9px; display:block;">b. Employer identification number (EIN)</span>
                        <span style="font-weight:600;">${state.settings.ein || 'XX-XXXXXXX'}</span>
                    </div>
                    <div style="border-bottom:1px solid #b45309; padding:6px;">
                        <span style="font-weight:700; color:#92400e; font-size:9px; display:block;">c. Employer's name, address, and ZIP code</span>
                        <span style="font-weight:600;">${state.settings.companyName}<br/>GlidePay Registered Suite 200</span>
                    </div>
                    <div style="padding:6px;">
                        <span style="font-weight:700; color:#92400e; font-size:9px; display:block;">e. Employee's name</span>
                        <span style="font-weight:600;">${employee.name}</span>
                    </div>
                </div>
                
                <div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; border-bottom:1px solid #b45309;">
                        <div style="border-right:1px solid #b45309; padding:6px;">
                            <span style="font-weight:700; color:#92400e; font-size:9px; display:block;">1. Wages, tips, other comp</span>
                            <span style="font-weight:600;">${formatCurrency(grossWages)}</span>
                        </div>
                        <div style="padding:6px;">
                            <span style="font-weight:700; color:#92400e; font-size:9px; display:block;">2. Federal income tax withheld</span>
                            <span style="font-weight:600;">${formatCurrency(fitTax)}</span>
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; border-bottom:1px solid #b45309;">
                        <div style="border-right:1px solid #b45309; padding:6px;">
                            <span style="font-weight:700; color:#92400e; font-size:9px; display:block;">3. Social Security wages</span>
                            <span style="font-weight:600;">${formatCurrency(ssWages)}</span>
                        </div>
                        <div style="padding:6px;">
                            <span style="font-weight:700; color:#92400e; font-size:9px; display:block;">4. Social Security tax withheld</span>
                            <span style="font-weight:600;">${formatCurrency(ssTax)}</span>
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; border-bottom:1px solid #b45309;">
                        <div style="border-right:1px solid #b45309; padding:6px;">
                            <span style="font-weight:700; color:#92400e; font-size:9px; display:block;">5. Medicare wages and tips</span>
                            <span style="font-weight:600;">${formatCurrency(medWages)}</span>
                        </div>
                        <div style="padding:6px;">
                            <span style="font-weight:700; color:#92400e; font-size:9px; display:block;">6. Medicare tax withheld</span>
                            <span style="font-weight:600;">${formatCurrency(medTax)}</span>
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; padding:6px;">
                        <div style="border-right:1px solid #b45309; padding:6px;">
                            <span style="font-weight:700; color:#92400e; font-size:9px; display:block;">15. State / Employer's State ID</span>
                            <span style="font-weight:600;">${employee.state} / 9999-ST</span>
                        </div>
                        <div style="padding:6px;">
                            <span style="font-weight:700; color:#92400e; font-size:9px; display:block;">16. State income tax withheld</span>
                            <span style="font-weight:600;">${formatCurrency(sitTax)}</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <div style="margin-top:12px; text-align:center; font-size:9px; color:#6b7280;">
                Copy B - To be filed with employee's Federal Tax Return. Pre-populated automatically by GlidePay.
            </div>

            ${sigRecord ? `
            <!-- Digital Signature Block -->
            <div style="margin-top:18px; border-top:2px solid #b45309; padding-top:12px; display:flex; align-items:flex-start; justify-content:space-between; gap:20px;">
                <div style="flex:1;">
                    <div style="font-size:9px; font-weight:700; color:#92400e; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">Employee Electronic Signature</div>
                    <div style="border:1.5px solid #b45309; border-radius:4px; background:#fffbf0; padding:6px; min-height:64px; display:flex; align-items:center; justify-content:center;">
                        <img src="${sigRecord.signatureData}" style="max-height:56px; max-width:280px; object-fit:contain;" alt="Signature" />
                    </div>
                    <div style="font-size:9px; color:#4b5563; margin-top:4px;">
                        Signed by: <strong>${sigRecord.employeeName}</strong>
                    </div>
                </div>
                <div style="text-align:right; min-width:200px;">
                    <div style="font-size:9px; font-weight:700; color:#92400e; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">Attestation</div>
                    <div style="font-size:9px; color:#374151; line-height:1.5;">
                        I certify that to the best of my knowledge, the information on this Form W-2 is true, correct, and complete.
                    </div>
                    <div style="margin-top:6px; font-size:9px; color:#4b5563;">
                        <strong>Date & Time:</strong> ${sigRecord.timestamp}<br/>
                        <strong>IP Address:</strong> ${sigRecord.ipAddress}<br/>
                        <strong>Verification ID:</strong> ARP-${sigRecord.employeeId.toUpperCase()}-2026
                    </div>
                    <div style="margin-top:8px; display:inline-block; background:#d1fae5; border:1px solid #10b981; color:#065f46; padding:3px 10px; border-radius:4px; font-size:9px; font-weight:700;">
                        ✓ LEGALLY SIGNED
                    </div>
                </div>
            </div>` : `
            <!-- Unsigned Notice -->
            <div style="margin-top:16px; border-top:2px dashed #d97706; padding-top:12px; display:flex; align-items:center; gap:12px;">
                <div style="flex:1; border:1.5px dashed #d97706; border-radius:4px; background:#fffbeb; padding:10px; text-align:center;">
                    <div style="font-size:9px; font-weight:700; color:#92400e; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Employee Signature Required</div>
                    <div style="font-size:9px; color:#4b5563;">Employee has not yet digitally signed this W-2. Please log in to the Employee Portal to review and sign.</div>
                </div>
            </div>`}
        </div>
    `;
}

// 10b. Signature Pad UI for W-2 Digital Signing
function getW2SignaturePadHTML(employee) {
    return `
        <div style="font-family:var(--font-body);">
            <!-- Legal Disclosure -->
            <div style="background:var(--primary-light); border:1px solid var(--primary); border-radius:var(--radius-md); padding:14px 18px; margin-bottom:20px;">
                <div style="font-weight:700; font-size:13px; color:var(--primary); margin-bottom:6px; display:flex; align-items:center; gap:6px;">
                    <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    Electronic Signature Legal Disclosure
                </div>
                <p style="font-size:12px; color:var(--text-secondary); line-height:1.6; margin:0;">
                    By signing below, <strong>${escapeHTML(employee.name)}</strong> certifies that the information on IRS Form W-2 is accurate and consents to use of an electronic signature in lieu of a wet-ink signature. This signature is legally binding under the ESIGN Act (15 U.S.C. § 7001).
                </p>
            </div>

            <!-- Employee Info -->  
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:20px; font-size:13px;">
                <div style="background:var(--bg-tertiary); border-radius:var(--radius-sm); padding:10px 14px;">
                    <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-tertiary); margin-bottom:2px;">Employee</div>
                    <div style="font-weight:700;">${escapeHTML(employee.name)}</div>
                </div>
                <div style="background:var(--bg-tertiary); border-radius:var(--radius-sm); padding:10px 14px;">
                    <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-tertiary); margin-bottom:2px;">Tax Year</div>
                    <div style="font-weight:700;">2026 Form W-2</div>
                </div>
            </div>

            <!-- Signature Canvas Area -->
            <div style="margin-bottom:16px;">
                <label style="font-size:13px; font-weight:600; color:var(--text-primary); margin-bottom:8px; display:block;">
                    Draw Your Signature Below
                </label>
                <div style="position:relative; border:2px solid var(--border-hover); border-radius:var(--radius-md); background:#ffffff; overflow:hidden;">
                    <canvas id="w2SignatureCanvas" style="display:block; width:100%; height:140px; cursor:crosshair;"></canvas>
                    <!-- Baseline -->
                    <div style="position:absolute; bottom:30px; left:20px; right:20px; border-bottom:1px solid #cbd5e1; pointer-events:none;"></div>
                    <div style="position:absolute; bottom:10px; left:20px; font-size:10px; color:var(--text-tertiary); pointer-events:none;">Sign above this line</div>
                    <!-- Watermark -->
                    <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); font-size:48px; color:#e2e8f0; font-weight:800; pointer-events:none; user-select:none; white-space:nowrap;">SIGN HERE</div>
                </div>
                <div style="display:flex; justify-content:flex-end; margin-top:8px;">
                    <button onclick="AeroApp.clearSignaturePad()" style="background:none; border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:5px 12px; font-size:12px; color:var(--text-secondary); cursor:pointer; font-family:var(--font-body);">
                        Clear
                    </button>
                </div>
            </div>

            <!-- Agreement Checkbox -->
            <div style="display:flex; align-items:flex-start; gap:10px; padding:14px; background:var(--bg-tertiary); border-radius:var(--radius-md); margin-bottom:20px;">
                <input type="checkbox" id="w2AgreeCheck" style="margin-top:2px; width:16px; height:16px; flex-shrink:0; cursor:pointer;"
                       onchange="document.getElementById('w2SignSubmitBtn').disabled = !this.checked || !AeroApp._hasSignatureStrokes();">
                <label for="w2AgreeCheck" style="font-size:12px; color:var(--text-secondary); line-height:1.5; cursor:pointer;">
                    I have reviewed my 2026 IRS Form W-2 and confirm all information is correct. I agree to sign electronically and understand this is legally equivalent to a handwritten signature.
                </label>
            </div>

            <!-- Action Buttons -->
            <div style="display:flex; justify-content:flex-end; gap:12px;">
                <button class="btn btn-secondary" onclick="AeroApp.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="w2SignSubmitBtn" disabled onclick="AeroApp.submitW2Signature()">
                    <svg style="width:16px;height:16px;margin-right:6px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    Submit Digital Signature
                </button>
            </div>
        </div>
    `;
}

// 11. Render Landing / Marketing Page
function renderLandingPageView(state) {
    return `
        <div class="landing-page">
            <header class="landing-header">
                <div class="landing-logo">
                    <div class="logo-box"><img src="assets/logo.svg" alt="" width="40" height="40"></div>
                    <div class="logo-text">GlidePay</div>
                </div>
                <nav class="landing-nav" aria-label="Product">
                    <a href="#product" class="landing-nav-link">Product</a>
                    <a href="#payroll" class="landing-nav-link">Payroll</a>
                    <a href="#tax" class="landing-nav-link">Tax</a>
                    <a href="#how" class="landing-nav-link">How it works</a>
                    <a href="#login" class="landing-nav-cta" onclick="document.getElementById('login')?.scrollIntoView({behavior:'smooth'})">Sign in</a>
                </nav>
                <div>
                    <button class="btn-icon-only theme-toggle-landing" onclick="AeroApp.toggleTheme()" title="Toggle Light/Dark Theme" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:var(--radius-md); padding:10px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; color:#e2e8f0;">
                        <svg style="width:20px;height:20px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
                    </button>
                </div>
            </header>

            <main class="landing-hero-container" id="login">
                <div class="landing-hero-text landing-reveal">
                    <h1 class="landing-title">GlidePay</h1>
                    <p class="landing-title-sub">Payroll control. Tax certainty.</p>
                    <p class="landing-desc">
                        One ops surface for ACH payday, Form 941 e-file, and deposit tracking — so finance and compliance stay on the same clock.
                    </p>
                    <div class="landing-hero-actions">
                        <a href="#product" class="btn btn-primary">See the product</a>
                        <button type="button" class="btn btn-outline landing-hero-secondary" onclick="AeroApp.switchLoginTab('register')">Start free trial</button>
                    </div>
                </div>

                <!-- Auth Card -->
                <div class="login-card landing-reveal landing-reveal-delay">
                    <div class="login-header-text">
                        <h2 class="login-title" id="loginCardTitle">Secure Login Portal</h2>
                        <p class="login-subtitle" id="loginCardSubtitle">Authenticate to view payroll data</p>
                    </div>
                    <div class="login-tabs" style="grid-template-columns:1fr 1fr 1fr;">
                        <button class="login-tab-btn active" id="btnTabCompany"  onclick="AeroApp.switchLoginTab('company')">Company</button>
                        <button class="login-tab-btn"        id="btnTabEmployee" onclick="AeroApp.switchLoginTab('employee')">Employee</button>
                        <button class="login-tab-btn"        id="btnTabRegister" onclick="AeroApp.switchLoginTab('register')">Register</button>
                    </div>

                    <!-- Company Login -->
                    <form id="formCompanyLogin" class="login-form-container active" onsubmit="AeroApp.handleLogin(event,'company')">
                        <div class="form-group">
                            <label class="login-label">Corporate Email</label>
                            <input type="email" class="form-control" id="companyEmailInput" placeholder="you@company.com" required autocomplete="email">
                        </div>
                        <div class="form-group">
                            <label class="login-label">Password</label>
                            <div class="login-password-wrap">
                                <input type="password" class="form-control" id="companyPasswordInput" placeholder="••••••••" required autocomplete="current-password">
                                <button type="button" class="login-eye-btn" onclick="AeroApp.togglePasswordVisibility('companyPasswordInput',this)" tabindex="-1">
                                    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                                </button>
                            </div>
                        </div>
                        <div style="text-align:right;margin-top:-8px;">
                            <button type="button" class="login-link-btn" onclick="AeroApp.handleForgotPassword()">Forgot password?</button>
                        </div>
                        <button type="submit" class="btn btn-primary login-submit-btn" id="btnCompanySignIn">
                            <span class="login-btn-text">Sign In to Dashboard</span>
                            <span class="login-spinner" style="display:none;"><svg style="width:18px;height:18px;animation:spin 0.8s linear infinite;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg></span>
                        </button>
                        <p style="text-align:center;font-size:12px;color:var(--text-tertiary);margin-top:-8px;">
                            No account? <button type="button" class="login-link-btn" onclick="AeroApp.switchLoginTab('register')">Create one free →</button>
                        </p>
                    </form>

                    <!-- Employee Login -->
                    <form id="formEmployeeLogin" class="login-form-container" onsubmit="AeroApp.handleLogin(event,'employee')">
                        <div class="form-group">
                            <label class="login-label">Work Email</label>
                            <input type="email" class="form-control" id="employeeEmailInput" placeholder="you@company.com" required autocomplete="email">
                        </div>
                        <div class="form-group">
                            <label class="login-label">Password</label>
                            <div class="login-password-wrap">
                                <input type="password" class="form-control" id="employeePINInput" placeholder="••••••••" required autocomplete="current-password">
                                <button type="button" class="login-eye-btn" onclick="AeroApp.togglePasswordVisibility('employeePINInput',this)" tabindex="-1">
                                    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                                </button>
                            </div>
                        </div>
                        <div style="text-align:right;margin-top:-8px;">
                            <button type="button" class="login-link-btn" onclick="AeroApp.handleForgotPassword()">Forgot password?</button>
                        </div>
                        <button type="submit" class="btn btn-primary login-submit-btn" id="btnEmployeeSignIn">
                            <span class="login-btn-text">Sign In to Employee Portal</span>
                            <span class="login-spinner" style="display:none;"><svg style="width:18px;height:18px;animation:spin 0.8s linear infinite;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg></span>
                        </button>
                    </form>

                    <!-- Registration -->
                    <form id="formRegister" class="login-form-container" onsubmit="AeroApp.handleSignUp(event)">
                        <div id="regStep1">
                            <p class="login-step-label">Step 1 of 2 — Your Account</p>
                            <div class="login-step-progress"><div class="login-step-bar" style="width:50%;"></div></div>
                            <div style="display:flex;flex-direction:column;gap:14px;margin-top:16px;">
                                <div class="form-group" style="margin:0;"><label class="login-label">Full Name</label><input type="text" class="form-control" id="regName" placeholder="Jane Smith" required autocomplete="name"></div>
                                <div class="form-group" style="margin:0;"><label class="login-label">Work Email</label><input type="email" class="form-control" id="regEmail" placeholder="jane@company.com" required autocomplete="email"></div>
                                <div class="form-group" style="margin:0;">
                                    <label class="login-label">Password</label>
                                    <div class="login-password-wrap">
                                        <input type="password" class="form-control" id="regPassword" placeholder="At least 8 characters" required minlength="8" autocomplete="new-password" oninput="AeroApp.updatePasswordStrength(this.value)">
                                        <button type="button" class="login-eye-btn" onclick="AeroApp.togglePasswordVisibility('regPassword',this)" tabindex="-1"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg></button>
                                    </div>
                                    <div id="passwordStrengthBar" style="height:3px;border-radius:2px;background:var(--border-color);margin-top:6px;overflow:hidden;"><div id="passwordStrengthFill" style="height:100%;width:0%;transition:width 0.3s,background 0.3s;border-radius:2px;"></div></div>
                                    <span id="passwordStrengthLabel" style="font-size:11px;color:var(--text-tertiary);"></span>
                                </div>
                                <div class="form-group" style="margin:0;"><label class="login-label">Confirm Password</label><div class="login-password-wrap"><input type="password" class="form-control" id="regPasswordConfirm" placeholder="Re-enter password" required autocomplete="new-password"><button type="button" class="login-eye-btn" onclick="AeroApp.togglePasswordVisibility('regPasswordConfirm',this)" tabindex="-1"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg></button></div></div>
                            </div>
                            <button type="button" class="btn btn-primary login-submit-btn" style="margin-top:20px;" onclick="AeroApp.regNextStep()">Continue to Company Details →</button>
                        </div>
                        <div id="regStep2" style="display:none;">
                            <p class="login-step-label">Step 2 of 2 — Your Company</p>
                            <div class="login-step-progress"><div class="login-step-bar" style="width:100%;"></div></div>
                            <div style="display:flex;flex-direction:column;gap:14px;margin-top:16px;">
                                <div class="form-group" style="margin:0;"><label class="login-label">Company Legal Name</label><input type="text" class="form-control" id="regCompanyName" placeholder="Acme Corp LLC" required></div>
                                <div class="form-group" style="margin:0;"><label class="login-label">EIN / Tax ID <span style="color:var(--text-tertiary);font-weight:400;">(optional)</span></label><input type="text" class="form-control" id="regEIN" placeholder="XX-XXXXXXX"></div>
                                <label class="login-tos-row"><input type="checkbox" id="regTOS" required><span>I agree to GlidePay's <a href="#" onclick="event.preventDefault();AeroApp.navigateTo('terms-of-service');" style="color:var(--primary);">Terms of Service</a> and <a href="#" onclick="event.preventDefault();AeroApp.navigateTo('privacy-policy');" style="color:var(--primary);">Privacy Policy</a></span></label>
                            </div>
                            <div style="display:flex;gap:10px;margin-top:20px;">
                                <button type="button" class="btn btn-secondary" style="flex:0 0 auto;" onclick="AeroApp.regPrevStep()">← Back</button>
                                <button type="submit" class="btn btn-primary login-submit-btn" id="btnRegSubmit" style="flex:1;">
                                    <span class="login-btn-text">Create My Account</span>
                                    <span class="login-spinner" style="display:none;"><svg style="width:18px;height:18px;animation:spin 0.8s linear infinite;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg></span>
                                </button>
                            </div>
                        </div>
                        <div id="regSuccess" style="display:none;text-align:center;padding:20px 0;">
                            <div style="width:56px;height:56px;background:var(--success-light);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
                                <svg style="width:28px;height:28px;color:var(--success);" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                            </div>
                            <h3 style="font-family:var(--font-heading);font-size:18px;margin-bottom:8px;">Account Created!</h3>
                            <p style="font-size:13px;color:var(--text-secondary);margin-bottom:6px;">Check your inbox for a confirmation email, then sign in to start your payroll setup.</p>
                            <p id="regSuccessEmail" style="font-size:12px;color:var(--text-tertiary);"></p>
                            <button type="button" class="btn btn-primary" style="margin-top:20px;width:100%;" onclick="AeroApp.switchLoginTab('company')">Go to Sign In →</button>
                        </div>
                        <p style="text-align:center;font-size:12px;color:var(--text-tertiary);margin-top:-4px;" id="regHaveAccount">
                            Already have an account? <button type="button" class="login-link-btn" onclick="AeroApp.switchLoginTab('company')">Sign in →</button>
                        </p>
                    </form>

                    <div class="login-security-row">
                        <span class="login-security-badge"><svg style="width:12px;height:12px;" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg> 256-bit SSL</span>
                        <span class="login-security-badge"><svg style="width:12px;height:12px;" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg> SOC 2 Ready</span>
                        <span class="login-security-badge"><svg style="width:12px;height:12px;" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg> Stripe + TaxBandit</span>
                    </div>
                </div>
            </main>

            <!-- Product overview -->
            <section class="lp-section lp-product" id="product">
                <div class="lp-section-inner landing-reveal">
                    <h2 class="lp-heading">The compliance ops desk</h2>
                    <p class="lp-lead">GlidePay is B2B payroll software for companies that need ACH deposits and tax filings in one place — not a pile of HR tools bolted together after payday.</p>
                </div>
                <figure class="lp-shot lp-shot-hero landing-reveal landing-reveal-delay">
                    <img src="assets/marketing/product-dashboard.jpg" alt="GlidePay dashboard showing next payday, payroll spend, and ACH run status" width="1400" height="788" loading="lazy">
                </figure>
            </section>

            <!-- Run payroll -->
            <section class="lp-section lp-feature" id="payroll">
                <div class="lp-feature-grid">
                    <div class="lp-feature-copy landing-reveal">
                        <h2 class="lp-heading">Run payroll like a control tower</h2>
                        <p class="lp-lead">Enter hours, review withholdings, approve the run, and transmit ACH from a single wizard. Net pay, employer tax, and deposit totals stay visible while you work.</p>
                        <ul class="lp-points">
                            <li>W-2 and 1099 in the same run</li>
                            <li>Stripe Connect + Treasury for employee ACH</li>
                            <li>Approval queue before money moves</li>
                        </ul>
                    </div>
                    <figure class="lp-shot landing-reveal landing-reveal-delay">
                        <img src="assets/marketing/product-payroll.jpg" alt="GlidePay Run Payroll wizard with employee hours grid and transmit panel" width="1400" height="788" loading="lazy">
                    </figure>
                </div>
            </section>

            <!-- Tax -->
            <section class="lp-section lp-feature lp-feature-alt" id="tax">
                <div class="lp-feature-grid lp-feature-grid-reverse">
                    <div class="lp-feature-copy landing-reveal">
                        <h2 class="lp-heading">File taxes from the same surface</h2>
                        <p class="lp-lead">Form 941 quarters, e-file status, and tax deposit timing sit next to payroll — so filing day is not a separate product you only open in a panic.</p>
                        <ul class="lp-points">
                            <li>TaxBandit e-file for Form 941 (sandbox &amp; live)</li>
                            <li>Filing queue with EIN, quarter, and status</li>
                            <li>Audit trail when transmits succeed or fail</li>
                        </ul>
                    </div>
                    <figure class="lp-shot landing-reveal landing-reveal-delay">
                        <img src="assets/marketing/product-tax.jpg" alt="GlidePay Tax Compliance Hub with Form 941 filing queue" width="1400" height="788" loading="lazy">
                    </figure>
                </div>
            </section>

            <!-- How it works -->
            <section class="lp-section lp-how" id="how">
                <div class="lp-section-inner landing-reveal">
                    <h2 class="lp-heading">How GlidePay works</h2>
                    <p class="lp-lead">Three steps from company setup to payday and filings.</p>
                    <ol class="lp-steps">
                        <li>
                            <span class="lp-step-num">01</span>
                            <div>
                                <h3>Connect the company</h3>
                                <p>Create your account, add your EIN, complete Stripe Connect onboarding, and invite employees to the portal.</p>
                            </div>
                        </li>
                        <li>
                            <span class="lp-step-num">02</span>
                            <div>
                                <h3>Run and approve payroll</h3>
                                <p>Pull hours, calculate taxes and benefits, send for approval, then disburse ACH to verified employee bank accounts.</p>
                            </div>
                        </li>
                        <li>
                            <span class="lp-step-num">03</span>
                            <div>
                                <h3>E-file and track deposits</h3>
                                <p>Prepare Form 941 for the quarter, transmit electronically, and keep deposit and acknowledgement status visible.</p>
                            </div>
                        </li>
                    </ol>
                </div>
            </section>

            <!-- Competitor Comparison Section -->
            <section class="comparison-section" id="compare">
                <div class="comparison-header">
                    <h2 class="comparison-section-title">Built to replace legacy payroll stacks</h2>
                    <p class="landing-desc" style="max-width:700px; margin: 0 auto;">
                        Side-by-side with Gusto, ADP, Rippling, and Paychex on price, ACH speed, and compliance automation.
                    </p>
                    <div class="comparison-filters">
                        <button class="filter-btn active" id="btnFilterAll" onclick="AeroApp.filterComparisonTable('all')">Show All Features</button>
                        <button class="filter-btn" id="btnFilterSpeedPrice" onclick="AeroApp.filterComparisonTable('speed-price')">Speed & Pricing</button>
                        <button class="filter-btn" id="btnFilterComplianceAPI" onclick="AeroApp.filterComparisonTable('compliance-api')">Compliance & APIs</button>
                    </div>
                </div>

                <div class="comparison-table-wrapper">
                    <table class="comp-table">
                        <thead>
                            <tr>
                                <th>Capabilities & Features</th>
                                <th style="color: var(--primary);">GlidePay</th>
                                <th>Gusto</th>
                                <th>ADP Run</th>
                                <th>Rippling</th>
                                <th>Paychex Flex</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr class="highlight-row" data-category="speed-price">
                                <td><strong>Base Monthly Price</strong></td>
                                <td class="aeropay-cell">$29 / mo</td>
                                <td>$40 / mo</td>
                                <td>$79 / mo (Est.)</td>
                                <td>$35 / mo</td>
                                <td>$39 / mo</td>
                            </tr>
                            <tr class="highlight-row" data-category="speed-price">
                                <td><strong>Per-Employee Monthly Fee</strong></td>
                                <td class="aeropay-cell">$4 / user</td>
                                <td>$6 / user</td>
                                <td>$8 / user (Est.)</td>
                                <td>$8 / user</td>
                                <td>$5 / user</td>
                            </tr>
                            <tr data-category="speed-price">
                                <td><strong>ACH Settlement Speed</strong></td>
                                <td class="aeropay-cell">
                                    <span class="status-badge-custom yes">
                                        <svg style="width:14px;height:14px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>
                                        Same-Day / Instant
                                    </span>
                                </td>
                                <td>2-4 Days (Standard)</td>
                                <td>2-4 Days (Standard)</td>
                                <td>2-4 Days (Standard)</td>
                                <td>2-4 Days (Standard)</td>
                            </tr>
                            <tr data-category="compliance-api">
                                <td><strong>50-State Auto Tax Filings</strong></td>
                                <td class="aeropay-cell">
                                    <span class="status-badge-custom yes">
                                        <svg style="width:14px;height:14px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>
                                        Free & Automated
                                    </span>
                                </td>
                                <td>Included (Select Tiers)</td>
                                <td>Available (Extra Cost)</td>
                                <td>Included</td>
                                <td>Available (Extra Cost)</td>
                            </tr>
                            <tr data-category="compliance-api">
                                <td><strong>Open REST APIs & Webhooks</strong></td>
                                <td class="aeropay-cell">
                                    <span class="status-badge-custom yes">
                                        <svg style="width:14px;height:14px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>
                                        Included (Free)
                                    </span>
                                </td>
                                <td>Partner Only</td>
                                <td style="color:var(--text-tertiary);">Custom Setup Fee</td>
                                <td>App Store Limit</td>
                                <td style="color:var(--text-tertiary);">Unavailable</td>
                            </tr>
                            <tr data-category="compliance-api">
                                <td><strong>Integrated Time Tracking</strong></td>
                                <td class="aeropay-cell">
                                    <span class="status-badge-custom yes">
                                        <svg style="width:14px;height:14px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>
                                        Included (Free)
                                    </span>
                                </td>
                                <td>Paid Add-on ($4/u)</td>
                                <td>Paid Add-on</td>
                                <td>Paid Add-on ($5/u)</td>
                                <td>Paid Add-on</td>
                            </tr>
                            <tr data-category="compliance-api">
                                <td><strong>Real-time Accounting Ledger Sync</strong></td>
                                <td class="aeropay-cell">
                                    <span class="status-badge-custom yes">
                                        <svg style="width:14px;height:14px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>
                                        Instant Sync
                                    </span>
                                </td>
                                <td>Manual Sync Trigger</td>
                                <td>Manual Sync Trigger</td>
                                <td>Sync Connector</td>
                                <td>Custom Sync Tool</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            <section class="lp-cta-band">
                <div class="lp-section-inner landing-reveal">
                    <h2 class="lp-heading">Ready to run payroll with tax on the same desk?</h2>
                    <p class="lp-lead">Open a free trial, connect Stripe, and process your first sandbox payday in minutes.</p>
                    <a href="#login" class="btn btn-primary" onclick="document.getElementById('login')?.scrollIntoView({behavior:'smooth'}); AeroApp.switchLoginTab('register'); return false;">Create your company account</a>
                </div>
            </section>
        </div>
    `;
}

// 11b. Render Privacy Policy (public, standalone page)
function renderPrivacyPolicyView(state) {
    const lastUpdated = "July 2, 2026";
    return `
        <div class="landing-page">
            <header class="landing-header">
                <div class="landing-logo" style="cursor:pointer;" onclick="AeroApp.navigateTo('landing')">
                    <div class="logo-box"><img src="assets/logo.svg" alt="" width="40" height="40"></div>
                    <div class="logo-text">GlidePay</div>
                </div>
                <div style="display:flex;align-items:center;gap:12px;">
                    <button class="btn btn-outline" onclick="AeroApp.navigateTo('landing')" style="display:inline-flex;align-items:center;gap:6px;">
                        <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                        Back
                    </button>
                    <button class="btn-icon-only theme-toggle-landing" onclick="AeroApp.toggleTheme()" title="Toggle Light/Dark Theme" style="background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:10px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;">
                        <svg style="width:20px;height:20px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
                    </button>
                </div>
            </header>

            <main class="legal-page-container">
                <div class="legal-doc card">
                    <span class="landing-badge">Legal</span>
                    <h1 class="legal-title">Privacy Policy</h1>
                    <p class="legal-updated">Last updated: ${lastUpdated}</p>

                    <p class="legal-intro">
                        GlidePay ("GlidePay," "we," "us," or "our") provides an automated payroll, tax
                        compliance, and workforce management platform. This Privacy Policy explains how we
                        collect, use, disclose, and safeguard information when you use our website,
                        applications, and related services (collectively, the "Services"). Because payroll
                        inherently involves sensitive personal and financial data, we treat the protection
                        of this information as a core responsibility.
                    </p>

                    <h2 class="legal-heading">1. Information We Collect</h2>
                    <p>We collect information in the following categories:</p>
                    <ul class="legal-list">
                        <li><strong>Account &amp; company data:</strong> Your name, work email, password, company legal name, and Employer Identification Number (EIN) / Tax ID provided during registration and setup.</li>
                        <li><strong>Employee &amp; contractor data:</strong> Names, contact details, worker classification (W-2 / 1099), compensation rates, tax withholding elections, and state tax residency that administrators enter to run payroll.</li>
                        <li><strong>Sensitive financial &amp; identity data:</strong> Bank account and routing numbers, Social Security Numbers or Tax IDs, and tax documents (e.g., Form W-2, Form 941) required to process direct deposits and file taxes.</li>
                        <li><strong>Usage &amp; log data:</strong> Time-tracking entries, PTO and benefits selections, audit-log activity, device and browser information, and IP addresses.</li>
                        <li><strong>Payments data:</strong> Billing and subscription information processed through our payment provider.</li>
                    </ul>

                    <h2 class="legal-heading">2. How We Use Your Information</h2>
                    <ul class="legal-list">
                        <li>To provide, operate, and maintain the Services, including running payroll, calculating and filing taxes, and settling direct deposits.</li>
                        <li>To authenticate users, manage accounts, and enforce role-based access (administrator vs. employee).</li>
                        <li>To generate tax filings and compliance documents in all 50 states.</li>
                        <li>To provide customer support and communicate service, security, and account notices.</li>
                        <li>To detect, investigate, and prevent fraud, unauthorized access, and other misuse.</li>
                        <li>To comply with legal, regulatory, tax, and audit obligations.</li>
                    </ul>

                    <h2 class="legal-heading">3. How We Share Information</h2>
                    <p>We do not sell your personal information. We share information only as needed to operate the Services, including with:</p>
                    <ul class="legal-list">
                        <li><strong>Government &amp; tax authorities</strong> (e.g., the IRS and state agencies) to file required payroll tax returns.</li>
                        <li><strong>Financial institutions and ACH networks</strong> to process direct deposits and settlements.</li>
                        <li><strong>Service providers &amp; sub-processors</strong> (such as cloud hosting, database, and payment providers) who process data on our behalf under contractual confidentiality and security obligations.</li>
                        <li><strong>Accounting integrations</strong> (e.g., QuickBooks Online or Xero) only when you connect them.</li>
                        <li><strong>Legal or safety recipients</strong> when required by law, subpoena, or to protect rights, property, or safety.</li>
                    </ul>

                    <h2 class="legal-heading">4. Data Security</h2>
                    <p>
                        We use industry-standard safeguards to protect your data, including encryption in
                        transit (256-bit SSL/TLS), encryption at rest for sensitive fields, role-based
                        access controls, and audit logging. We maintain administrative, technical, and
                        physical controls aligned with SOC 2 principles. No method of transmission or
                        storage is completely secure, but we continually work to protect your information.
                    </p>

                    <h2 class="legal-heading">5. Data Retention</h2>
                    <p>
                        We retain payroll, tax, and employment records for as long as your account is active
                        and for the periods required by applicable tax and employment law (often several
                        years after a transaction). When data is no longer required, we securely delete or
                        anonymize it.
                    </p>

                    <h2 class="legal-heading">6. Your Rights &amp; Choices</h2>
                    <p>
                        Depending on your jurisdiction, you may have the right to access, correct, export,
                        or request deletion of your personal information, and to object to or restrict
                        certain processing. Employees should direct requests to their employer (the account
                        administrator), who controls the payroll data. You may also contact us directly
                        using the details below. Note that we may be legally required to retain certain
                        payroll and tax records even after a deletion request.
                    </p>

                    <h2 class="legal-heading">7. Cookies &amp; Tracking</h2>
                    <p>
                        We use cookies and similar technologies to keep you signed in, remember preferences
                        (such as light/dark theme), and understand how the Services are used. You can control
                        cookies through your browser settings, though some features may not function properly
                        without them.
                    </p>

                    <h2 class="legal-heading">8. Children's Privacy</h2>
                    <p>
                        The Services are intended for use by businesses and their workers and are not
                        directed to children under 16. We do not knowingly collect personal information from
                        children.
                    </p>

                    <h2 class="legal-heading">9. Changes to This Policy</h2>
                    <p>
                        We may update this Privacy Policy from time to time. When we make material changes,
                        we will update the "Last updated" date above and, where appropriate, provide
                        additional notice. Your continued use of the Services after changes take effect
                        constitutes acceptance of the revised policy.
                    </p>

                    <h2 class="legal-heading">10. Contact Us</h2>
                    <p>
                        If you have questions about this Privacy Policy or how we handle your data, contact
                        our privacy team at <a href="mailto:privacy@glidepay.org" style="color:var(--primary);">privacy@glidepay.org</a>.
                    </p>

                    <div class="legal-footer-actions">
                        <button class="btn btn-primary" onclick="AeroApp.navigateTo('landing')">← Return to GlidePay</button>
                    </div>
                </div>
            </main>
        </div>
    `;
}

// 11c. Render Terms of Service (public, standalone page)
function renderTermsOfServiceView(state) {
    const lastUpdated = "July 2, 2026";
    return `
        <div class="landing-page">
            <header class="landing-header">
                <div class="landing-logo" style="cursor:pointer;" onclick="AeroApp.navigateTo('landing')">
                    <div class="logo-box"><img src="assets/logo.svg" alt="" width="40" height="40"></div>
                    <div class="logo-text">GlidePay</div>
                </div>
                <div style="display:flex;align-items:center;gap:12px;">
                    <button class="btn btn-outline" onclick="AeroApp.navigateTo('landing')" style="display:inline-flex;align-items:center;gap:6px;">
                        <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                        Back
                    </button>
                    <button class="btn-icon-only theme-toggle-landing" onclick="AeroApp.toggleTheme()" title="Toggle Light/Dark Theme" style="background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:10px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;">
                        <svg style="width:20px;height:20px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
                    </button>
                </div>
            </header>

            <main class="legal-page-container">
                <div class="legal-doc card">
                    <span class="landing-badge">Legal</span>
                    <h1 class="legal-title">Terms of Service</h1>
                    <p class="legal-updated">Last updated: ${lastUpdated}</p>

                    <p class="legal-intro">
                        These Terms of Service ("Terms") govern your access to and use of the GlidePay
                        payroll, tax compliance, and workforce management platform, including our website,
                        applications, and related services (collectively, the "Services") provided by
                        GlidePay ("GlidePay," "we," "us," or "our"). By creating an account, checking the box
                        to accept these Terms, or otherwise using the Services, you agree to be bound by
                        these Terms. If you are entering into these Terms on behalf of a company, you
                        represent that you have authority to bind that company.
                    </p>

                    <h2 class="legal-heading">1. Eligibility &amp; Accounts</h2>
                    <ul class="legal-list">
                        <li>You must be at least 18 years old and able to form a binding contract to use the Services.</li>
                        <li>You are responsible for the accuracy of the company, employee, and tax information you provide.</li>
                        <li>You are responsible for safeguarding your login credentials and for all activity that occurs under your account, and must notify us promptly of any unauthorized use.</li>
                        <li>Administrators are responsible for managing the access and permissions of employees and other users they invite.</li>
                    </ul>

                    <h2 class="legal-heading">2. Description of the Services</h2>
                    <p>
                        GlidePay provides tools to run payroll, calculate and file payroll taxes, settle
                        direct deposits, track time, and manage benefits, PTO, and related workforce data.
                        Features, availability, and pricing may change over time. We may modify, suspend, or
                        discontinue any part of the Services with reasonable notice where practicable.
                    </p>

                    <h2 class="legal-heading">3. Your Responsibilities</h2>
                    <ul class="legal-list">
                        <li><strong>Accurate data:</strong> You are responsible for entering correct employee classifications, compensation, tax elections, bank details, and hours. GlidePay relies on the data you provide to run payroll and file taxes.</li>
                        <li><strong>Sufficient funds:</strong> You must ensure sufficient funds are available to cover payroll runs, taxes, and applicable fees on scheduled dates.</li>
                        <li><strong>Legal compliance:</strong> You are responsible for complying with applicable employment, wage-and-hour, and tax laws that apply to your business.</li>
                        <li><strong>Timely review:</strong> You are responsible for reviewing and approving payroll runs and filings before they are finalized.</li>
                    </ul>

                    <h2 class="legal-heading">4. Fees &amp; Payment</h2>
                    <p>
                        You agree to pay the subscription and per-employee fees described at sign-up or in
                        your plan, along with any applicable taxes. Fees are billed on a recurring basis and
                        are non-refundable except where required by law. We may update pricing with advance
                        notice; continued use after a price change constitutes acceptance. Failure to pay
                        may result in suspension or termination of the Services.
                    </p>

                    <h2 class="legal-heading">5. Tax Filings &amp; Payments</h2>
                    <p>
                        Where you enable automated tax filing, you authorize GlidePay to prepare, file, and
                        remit payroll taxes to applicable federal, state, and local authorities based on the
                        information you provide. You remain responsible for the accuracy of that information
                        and for any liabilities arising from data you supply. GlidePay is not liable for
                        penalties or interest resulting from inaccurate or untimely information provided by
                        you, insufficient funds, or filings outside the scope of the Services.
                    </p>

                    <h2 class="legal-heading">6. Acceptable Use</h2>
                    <p>You agree not to:</p>
                    <ul class="legal-list">
                        <li>Use the Services for any unlawful, fraudulent, or unauthorized purpose.</li>
                        <li>Attempt to gain unauthorized access to the Services, other accounts, or our systems.</li>
                        <li>Interfere with or disrupt the integrity or performance of the Services.</li>
                        <li>Reverse engineer, resell, or misuse the Services except as expressly permitted.</li>
                        <li>Upload malicious code or submit data you do not have the right to provide.</li>
                    </ul>

                    <h2 class="legal-heading">7. Intellectual Property</h2>
                    <p>
                        The Services, including all software, design, and content provided by GlidePay, are
                        owned by GlidePay or its licensors and are protected by intellectual property laws.
                        We grant you a limited, non-exclusive, non-transferable right to use the Services for
                        your internal business purposes during your subscription. You retain ownership of the
                        data you submit ("Customer Data") and grant us the rights necessary to process it to
                        provide the Services.
                    </p>

                    <h2 class="legal-heading">8. Privacy</h2>
                    <p>
                        Your use of the Services is also governed by our
                        <a href="#" onclick="event.preventDefault();AeroApp.navigateTo('privacy-policy');" style="color:var(--primary);">Privacy Policy</a>,
                        which explains how we collect, use, and protect personal and financial data. By using
                        the Services, you consent to those practices.
                    </p>

                    <h2 class="legal-heading">9. Third-Party Services</h2>
                    <p>
                        The Services may integrate with third-party providers (such as banking/ACH networks,
                        payment processors, and accounting platforms like QuickBooks or Xero). Your use of
                        those integrations may be subject to the third party's own terms, and we are not
                        responsible for third-party services.
                    </p>

                    <h2 class="legal-heading">10. Disclaimers</h2>
                    <p>
                        The Services are provided "as is" and "as available" without warranties of any kind,
                        whether express or implied, including warranties of merchantability, fitness for a
                        particular purpose, and non-infringement. GlidePay does not provide legal, tax, or
                        accounting advice, and the Services are not a substitute for professional advice.
                    </p>

                    <h2 class="legal-heading">11. Limitation of Liability</h2>
                    <p>
                        To the maximum extent permitted by law, GlidePay will not be liable for any indirect,
                        incidental, special, consequential, or punitive damages, or for lost profits or
                        revenues. Our aggregate liability arising out of or relating to the Services will not
                        exceed the fees you paid to us in the twelve (12) months preceding the event giving
                        rise to the claim.
                    </p>

                    <h2 class="legal-heading">12. Termination</h2>
                    <p>
                        You may stop using the Services and cancel your subscription at any time. We may
                        suspend or terminate your access if you breach these Terms, fail to pay fees, or use
                        the Services in a way that creates risk or legal exposure. Upon termination, your
                        right to use the Services ends, though certain provisions (such as fees owed,
                        disclaimers, and limitations of liability) survive. We will make Customer Data
                        available for export for a reasonable period as described in our Privacy Policy and
                        applicable law.
                    </p>

                    <h2 class="legal-heading">13. Changes to These Terms</h2>
                    <p>
                        We may update these Terms from time to time. When we make material changes, we will
                        update the "Last updated" date above and, where appropriate, provide additional
                        notice. Your continued use of the Services after changes take effect constitutes
                        acceptance of the revised Terms.
                    </p>

                    <h2 class="legal-heading">14. Governing Law</h2>
                    <p>
                        These Terms are governed by the laws of the United States and the state in which
                        GlidePay is organized, without regard to conflict-of-laws principles. Any disputes
                        will be resolved in the courts located in that jurisdiction, unless otherwise
                        required by applicable law.
                    </p>

                    <h2 class="legal-heading">15. Contact Us</h2>
                    <p>
                        If you have questions about these Terms, contact us at
                        <a href="mailto:legal@glidepay.org" style="color:var(--primary);">legal@glidepay.org</a>.
                    </p>

                    <div class="legal-footer-actions">
                        <button class="btn btn-primary" onclick="AeroApp.navigateTo('landing')">← Return to GlidePay</button>
                    </div>
                </div>
            </main>
        </div>
    `;
}

// 12. Render Employee Self-Service Dashboard
function renderEmployeeDashboardView(state, employeeId) {
    const employee = state.employees.find(e => e.id === employeeId);
    if (!employee) return `<div class="card">Error: Employee profile not found.</div>`;

    // Calculate details from history
    let ytdGross = 0;
    let ytdNet = 0;
    let ytdTaxes = 0;
    let latestNet = 0;
    let latestPayDate = "No processed payments";
    
    // Find all runs that have details for this employee
    const processedRuns = [];
    state.payrollHistory.forEach(run => {
        if (run.details && run.details[employeeId]) {
            const detail = run.details[employeeId];
            processedRuns.push({
                runId: run.id,
                date: run.date,
                detail: detail
            });
            ytdGross += detail.grossPay;
            ytdNet += detail.netPay;
            ytdTaxes += detail.taxes.totalEmployeeTaxes;
        }
    });

    if (processedRuns.length > 0) {
        // Sort descending by date
        processedRuns.reverse();
        latestNet = processedRuns[0].detail.netPay;
        latestPayDate = processedRuns[0].date;
    } else {
        // Estimate demo YTD numbers if history is empty
        const estimatedAnnual = employee.type === 'salaried' ? employee.rate : employee.rate * 40 * 52;
        ytdGross = estimatedAnnual * 0.45;
        ytdNet = ytdGross * 0.82;
        ytdTaxes = ytdGross * 0.18;
        latestNet = ytdNet / 12; // fake biweekly estimate
        latestPayDate = "June 10, 2026";
    }

    // Get timesheet hours logged
    const loggedHours = state.timesheets[employeeId] || [0, 0, 0, 0, 0, 0, 0];
    const totalHours = loggedHours.reduce((sum, h) => sum + h, 0);

    // Build paystub list rows
    let paystubRows = "";
    if (processedRuns.length > 0) {
        processedRuns.forEach(runItem => {
            paystubRows += `
                <tr>
                    <td style="font-weight:600;">${runItem.date}</td>
                    <td>${formatCurrency(runItem.detail.grossPay)}</td>
                    <td>${formatCurrency(runItem.detail.taxes.totalEmployeeTaxes)}</td>
                    <td style="font-weight:700; color:var(--success);">${formatCurrency(runItem.detail.netPay)}</td>
                    <td><span class="badge badge-success">Deposited</span></td>
                    <td style="text-align:right;">
                        <button class="btn btn-outline" onclick="AeroApp.previewEmployeePaystubFromId('${employeeId}', '${runItem.runId}')" style="padding: 6px 12px; font-size:12px;">
                            View Statement
                        </button>
                    </td>
                </tr>
            `;
        });
    } else {
        // Render fallback seed stubs
        paystubRows += `
            <tr>
                <td style="font-weight:600;">June 10, 2026</td>
                <td>${formatCurrency(ytdGross / 3)}</td>
                <td>${formatCurrency(ytdTaxes / 3)}</td>
                <td style="font-weight:700; color:var(--success);">${formatCurrency(latestNet)}</td>
                <td><span class="badge badge-success">Deposited</span></td>
                <td style="text-align:right;">
                    <button class="btn btn-outline" onclick="AeroApp.showToast('Archived paystub loaded!', 'info')" style="padding: 6px 12px; font-size:12px;">
                        Request Copy
                    </button>
                </td>
            </tr>
            <tr>
                <td style="font-weight:600;">May 30, 2026</td>
                <td>${formatCurrency(ytdGross / 3)}</td>
                <td>${formatCurrency(ytdTaxes / 3)}</td>
                <td style="font-weight:700; color:var(--success);">${formatCurrency(latestNet)}</td>
                <td><span class="badge badge-success">Deposited</span></td>
                <td style="text-align:right;">
                    <button class="btn btn-outline" onclick="AeroApp.showToast('Archived paystub loaded!', 'info')" style="padding: 6px 12px; font-size:12px;">
                        Request Copy
                    </button>
                </td>
            </tr>
            <tr>
                <td style="font-weight:600;">May 15, 2026</td>
                <td>${formatCurrency(ytdGross / 3)}</td>
                <td>${formatCurrency(ytdTaxes / 3)}</td>
                <td style="font-weight:700; color:var(--success);">${formatCurrency(latestNet)}</td>
                <td><span class="badge badge-success">Deposited</span></td>
                <td style="text-align:right;">
                    <button class="btn btn-outline" onclick="AeroApp.showToast('Archived paystub loaded!', 'info')" style="padding: 6px 12px; font-size:12px;">
                        Request Copy
                    </button>
                </td>
            </tr>
        `;
    }

    return `
        <div class="employee-header-card">
            <div class="employee-profile-summary">
                <div class="employee-avatar-large">${employee.name.split(' ').map(n=>n[0]).join('')}</div>
                <div class="employee-meta-info">
                    <h2 class="employee-name-title">Welcome back, ${escapeHTML(employee.name)}!</h2>
                    <div style="display:flex; gap:8px; align-items:center; margin-top:4px;">
                        <span class="employee-role-badge">${escapeHTML(employee.role)}</span>
                        <span style="font-size:13px; opacity:0.8;">Tax Residence: ${employee.state} | filing: W-4 ${employee.filingStatus}</span>
                    </div>
                </div>
            </div>
            <div class="employee-salary-card">
                <span style="font-size:12px; opacity:0.8; text-transform:uppercase; font-weight:700; letter-spacing:0.5px;">Annualized Compensation</span>
                <span style="font-family:var(--font-heading); font-size:24px; font-weight:700;">${formatCurrency(employee.rate)}${employee.type==='hourly'?'/hr':'/yr'}</span>
            </div>
        </div>

        <div class="grid-stats">
            <div class="card stat-card">
                <div class="stat-header">
                    <span class="stat-label">Last Net Deposit</span>
                    <div class="stat-icon success">
                        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                    </div>
                </div>
                <span class="stat-value">${formatCurrency(latestNet)}</span>
                <span class="stat-trend" style="color:var(--text-secondary)">
                    Paid on ${latestPayDate}
                </span>
            </div>

            <div class="card stat-card">
                <div class="stat-header">
                    <span class="stat-label">YTD Net Earnings</span>
                    <div class="stat-icon primary">
                        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                </div>
                <span class="stat-value">${formatCurrency(ytdNet)}</span>
                <span class="stat-trend up">
                    Gross YTD: ${formatCurrency(ytdGross)}
                </span>
            </div>

            <div class="card stat-card">
                <div class="stat-header">
                    <span class="stat-label">Timecard Hours (Current Period)</span>
                    <div class="stat-icon warning">
                        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                </div>
                <span class="stat-value">${totalHours.toFixed(2)} hrs</span>
                <span class="stat-trend" style="color:var(--primary); cursor:pointer; font-weight:700;" onclick="AeroApp.navigateTo('employee-timecard')">
                    Log Hours &rarr;
                </span>
            </div>
        </div>

        <div class="dashboard-grid">
            <!-- Left Column: Pay Stub Statements -->
            <div class="card">
                <div class="section-title">
                    <span>Recent Pay Stub Statements</span>
                    <span style="font-size:12px;font-weight:500;color:var(--text-tertiary)">Direct Deposit Receipts</span>
                </div>
                <div class="table-wrapper">
                    <table class="table-responsive">
                        <thead>
                            <tr>
                                <th>Pay Date</th>
                                <th>Gross Salary</th>
                                <th>Taxes Withheld</th>
                                <th>Net Deposit</th>
                                <th>ACH Status</th>
                                <th style="text-align:right;">Statement</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${paystubRows}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Right Column: Direct Deposit Allocation & On-Demand Pay Advance -->
            <div style="display:flex; flex-direction:column; gap:24px;">
                <!-- Card 0: ACH Bank Account Linking -->
                <div class="card" style="padding:24px;">
                    <div class="section-title" style="margin-bottom:12px; display:flex; flex-direction:column; align-items:flex-start; gap:4px;">
                        <span style="font-size:16px;">Direct Deposit — Bank Account</span>
                        <p style="font-size:12px; color:var(--text-secondary); margin:0;">Link a checking account to receive net pay via ACH on payday.</p>
                    </div>
                    ${employee.bankLast4 ? `
                    <div style="display:flex; align-items:center; justify-content:space-between; background:var(--bg-secondary); padding:12px 16px; border-radius:var(--radius-sm); border:1px solid var(--border-color); margin-bottom:12px;">
                        <div>
                            <p style="margin:0; font-weight:600; font-size:14px;">Bank account ending in ••••${employee.bankLast4}</p>
                            <p style="margin:0; font-size:12px; color:var(--text-secondary);">Routing: ${employee.bankRouting || '—'}</p>
                        </div>
                        <span style="font-size:11px; font-weight:700; padding:3px 10px; border-radius:var(--radius-full); background:var(--success-light); color:var(--success);">Linked</span>
                    </div>
                    <button class="btn btn-secondary" style="width:100%; justify-content:center;" onclick="AeroApp.linkAchBankAccount('${employee.id}')">Replace Bank Account</button>
                    ` : `
                    <button class="btn btn-primary" style="width:100%; justify-content:center; padding:10px 0;" onclick="AeroApp.linkAchBankAccount('${employee.id}')">
                        Link Bank Account for ACH Deposit
                    </button>
                    `}
                </div>

                <!-- Card 1: Direct Deposit Allocation -->
                <div class="card" style="padding:24px;">
                    <div class="section-title" style="margin-bottom:12px; display:flex; flex-direction:column; align-items:flex-start; gap:4px;">
                        <span style="font-size:16px;">Direct Deposit Splits</span>
                        <p style="font-size:12px; color:var(--text-secondary); margin:0;">Allocate a percentage of your net paycheck to a secondary savings account.</p>
                    </div>
                    <form id="directDepositSplitForm" onsubmit="AeroApp.saveDirectDepositSplit(event)" style="display:flex; flex-direction:column; gap:16px;">
                        <div style="display:flex; align-items:center; justify-content:space-between; background:var(--bg-secondary); padding:12px 16px; border-radius:var(--radius-sm); border:1px solid var(--border-color);">
                            <label for="splitEnabled" style="font-weight:600; cursor:pointer; margin:0; font-size:14px;">Enable Split Allocation</label>
                            <input type="checkbox" id="splitEnabled" ${employee.splitDeposits && employee.splitDeposits.enabled ? 'checked' : ''} style="width:20px; height:20px; cursor:pointer;" onchange="const fields = document.getElementById('splitFields'); fields.style.display = this.checked ? 'flex' : 'none';">
                        </div>

                        <div id="splitFields" style="display:${employee.splitDeposits && employee.splitDeposits.enabled ? 'flex' : 'none'}; flex-direction:column; gap:12px;">
                            <div class="form-group">
                                <label for="splitSavingsPercent" style="font-size:12px; font-weight:600; color:var(--text-secondary);">Percent to Savings (%)</label>
                                <input type="number" min="0" max="100" class="form-control" id="splitSavingsPercent" value="${employee.splitDeposits ? employee.splitDeposits.savingsPercent : 0}" placeholder="e.g. 20" style="padding:8px 12px; background:var(--bg-secondary);">
                            </div>
                            <div class="form-group">
                                <label for="splitSavingsRouting" style="font-size:12px; font-weight:600; color:var(--text-secondary);">Savings Routing Number</label>
                                <input type="text" class="form-control" id="splitSavingsRouting" value="${escapeAttr(employee.splitDeposits ? (employee.splitDeposits.savingsRouting || '') : '')}" maxlength="9" inputmode="numeric" placeholder="9-digit Routing Number" style="padding:8px 12px; background:var(--bg-secondary);">
                            </div>
                            <div class="form-group">
                                <label for="splitSavingsAccount" style="font-size:12px; font-weight:600; color:var(--text-secondary);">Savings Account Number</label>
                                <input type="text" class="form-control" id="splitSavingsAccount" value="${escapeAttr(employee.splitDeposits ? (employee.splitDeposits.savingsAccount || '') : '')}" maxlength="17" inputmode="numeric" placeholder="Account Number" style="padding:8px 12px; background:var(--bg-secondary);">
                            </div>
                        </div>

                        <button type="submit" class="btn btn-primary" style="width:100%; justify-content:center; padding:10px 0;">Save Allocation Preferences</button>
                    </form>
                </div>

                <!-- Card 2: On-Demand Pay Advance (W-2 only) -->
                ${employee.classification === 'w2' ? `
                <div class="card" style="padding:24px;">
                    <div class="section-title" style="margin-bottom:12px; display:flex; flex-direction:column; align-items:flex-start; gap:4px;">
                        <span style="font-size:16px;">On-Demand Pay Advance</span>
                        <p style="font-size:12px; color:var(--text-secondary); margin:0;">Request an early post-tax advance of up to $200. Automatically recovered on your next paycheck.</p>
                    </div>

                    ${(() => {
                        const activeAdv = state.payAdvances.find(adv => adv.empId === employeeId && (adv.status === 'pending' || adv.status === 'approved'));
                        if (activeAdv) {
                            const statusColor = activeAdv.status === 'approved' ? 'var(--success)' : 'var(--primary)';
                            return `
                            <div style="background:var(--bg-secondary); padding:16px; border-radius:var(--radius-sm); border:1px solid var(--border-color); text-align:center;">
                                <div style="font-size:12px; color:var(--text-tertiary); font-weight:700; text-transform:uppercase;">Active Request</div>
                                <div style="font-size:24px; font-weight:800; color:${statusColor}; margin:8px 0;">${formatCurrency(activeAdv.amount)}</div>
                                <span class="badge ${activeAdv.status === 'approved' ? 'badge-success' : 'badge-primary'}" style="text-transform:capitalize; padding:4px 8px; font-size:11px;">
                                    ${activeAdv.status === 'approved' ? 'Approved & En Route' : 'Pending Admin Review'}
                                </span>
                                <div style="font-size:11px; color:var(--text-secondary); margin-top:12px;">
                                    Requested on ${activeAdv.requestDate}
                                    ${activeAdv.approvedDate ? `<br>Approved on ${activeAdv.approvedDate}` : ''}
                                </div>
                            </div>
                            `;
                        } else {
                            return `
                            <form id="payAdvanceForm" onsubmit="AeroApp.requestPayAdvance(event)" style="display:flex; flex-direction:column; gap:16px;">
                                <div class="form-group">
                                    <label for="advanceReqAmount" style="font-size:12px; font-weight:600; color:var(--text-secondary);">Request Amount ($ max $200)</label>
                                    <input type="number" min="10" max="200" step="any" class="form-control" id="advanceReqAmount" required placeholder="Enter amount between $10 and $200" style="padding:8px 12px; background:var(--bg-secondary);">
                                </div>
                                <button type="submit" class="btn btn-secondary" style="width:100%; justify-content:center; padding:10px 0; background:var(--primary); color:white; border:none;">Submit Advance Request</button>
                            </form>
                            `;
                        }
                    })()}
                </div>
                ` : ''}
            </div>
        </div>
    `;
}

// 13. Render Employee Time Card logging view
function renderEmployeeTimecardView(state, employeeId) {
    const employee = state.employees.find(e => e.id === employeeId);
    if (!employee) return `<div class="card">Error: Employee profile not found.</div>`;

    if (employee.type === 'salaried') {
        return `
            <div class="card" style="max-width: 600px; margin: 0 auto; text-align:center; padding: 40px; display:flex; flex-direction:column; gap:20px;">
                <div style="width:60px; height:60px; border-radius:50%; background-color:var(--primary-light); color:var(--primary); display:inline-flex; align-items:center; justify-content:center; margin:0 auto;">
                    <svg style="width:30px; height:30px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                </div>
                <h3 style="font-family:var(--font-heading); font-size:20px; font-weight:700;">Salaried Staff Autopilot</h3>
                <p style="color:var(--text-secondary); line-height:1.6; font-size:14px;">
                    As a <strong>Salaried employee</strong>, your pay is auto-calculated using your fixed salary of <strong>${formatCurrency(employee.rate)}/yr</strong> divided equally into your pay periods. You are not required to log hourly time cards.
                </p>
                <button class="btn btn-primary" onclick="AeroApp.navigateTo('employee-dashboard')" style="align-self:center;">Return to Dashboard</button>
            </div>
        `;
    }

    const hours = state.timesheets[employeeId] || [0, 0, 0, 0, 0, 0, 0];
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    let cellsHTML = "";
    days.forEach((day, idx) => {
        cellsHTML += `
            <div class="timecard-day-card">
                <span class="timecard-day-lbl">${day.slice(0,3)}</span>
                <input type="number" step="0.25" class="timecard-day-val" id="myTimeDay-${idx}" value="${hours[idx] || 0}" oninput="AeroApp.calculateMyTimecardTotal()">
            </div>
        `;
    });

    return `
        <div class="card" style="max-width: 800px; margin: 0 auto;">
            <div class="section-title">Log Weekly Hours</div>
            <p style="color:var(--text-secondary); margin-bottom: 24px; font-size:14px;">
                Input your hours worked for the current pay period. Standard overtime rules apply (hours over 40.00/wk are calculated at 1.5x regular pay rate).
            </p>

            <div style="background-color: var(--bg-tertiary); border-radius: var(--radius-md); padding: 12px; margin-bottom:20px; font-weight:600; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:14px;">Your Regular Hourly Rate:</span>
                <span style="color:var(--primary); font-size:16px;" id="myTimeRateBadge">${formatCurrency(employee.rate)} / hour</span>
            </div>

            <div class="timecard-grid">
                ${cellsHTML}
            </div>

            <div style="background-color: var(--bg-tertiary); border-radius: var(--radius-md); padding: 20px; margin-bottom:24px; display:flex; flex-direction:column; gap:12px;">
                <div style="display:flex; justify-content:space-between; font-size:14px;">
                    <span>Total Accumulated Hours:</span>
                    <span style="font-weight:700;" id="myTimeTotalHrs">0.00 hrs</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:14px;">
                    <span>Regular / Overtime Breakdown:</span>
                    <span id="myTimeBreakdownHrs" style="font-weight:600; color:var(--text-secondary);">0.00h Reg / 0.00h OT</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:15px; border-top:1px solid var(--border-color); padding-top:12px; font-weight:700;">
                    <span>Estimated Period Gross Pay:</span>
                    <span style="color:var(--success);" id="myTimeEstGross">$0.00</span>
                </div>
            </div>

            <div style="display:flex; justify-content:flex-end; gap:12px;">
                <button class="btn btn-secondary" onclick="AeroApp.navigateTo('employee-dashboard')">Cancel</button>
                <button class="btn btn-primary" onclick="AeroApp.saveMyTimesheet()">Save Timecard</button>
            </div>
        </div>
    `;
}

// 14. Render Employee documents (W-2, W-4, I-9)
function renderEmployeeDocumentsView(state, employeeId) {
    const employee = state.employees.find(e => e.id === employeeId);
    if (!employee) return `<div class="card">Error: Employee profile not found.</div>`;

    const is1099 = employee.classification === '1099';
    const sigRecord = (state.w2Signatures && state.w2Signatures[employeeId]) || null;
    const isSigned = !!sigRecord;


    if (is1099) {
        return `
            <div class="card" style="max-width: 800px; margin: 0 auto;">
                <div class="section-title">Documents & Tax Compliance Files</div>
                <p style="color:var(--text-secondary); margin-bottom: 24px; font-size:14px;">
                    View your Form 1099-NEC nonemployee compensation statements, tax status forms, and active service contracts.
                </p>

                <div style="display:flex; flex-direction:column; gap:12px;">
                    <!-- Form 1099-NEC Row -->
                    <div style="border:1px solid var(--border-color); border-radius:var(--radius-md); padding:16px; display:flex; justify-content:space-between; align-items:center; background-color:var(--bg-secondary);">
                        <div>
                            <div style="font-weight:700; font-size:15px; color:var(--text-primary);">2026 Form 1099-NEC (Nonemployee Compensation)</div>
                            <div style="font-size:12px; color:var(--text-tertiary); margin-top:2px;">Pre-populated with YTD professional services billings. Ready for filing.</div>
                        </div>
                        <button class="btn btn-primary" onclick="AeroApp.generateEmployee1099()" style="padding:8px 16px; font-size:13px;">
                            View Form 1099-NEC
                        </button>
                    </div>

                    <!-- Form W-9 Row -->
                    <div style="border:1px solid var(--border-color); border-radius:var(--radius-md); padding:16px; display:flex; justify-content:space-between; align-items:center; background-color:var(--bg-secondary);">
                        <div>
                            <div style="font-weight:700; font-size:15px; color:var(--text-primary);">Form W-9 Request for Taxpayer ID</div>
                            <div style="font-size:12px; color:var(--text-tertiary); margin-top:2px;">TIN Verification: XXX-XX-8822. Signed and verified.</div>
                        </div>
                        <button class="btn btn-outline" onclick="AeroApp.showEmployeeOnboardingDoc('W-9', '${employee.id}')" style="padding:8px 16px; font-size:13px;">
                            Review W-9
                        </button>
                    </div>

                    <!-- Contractor Agreement Row -->
                    <div style="border:1px solid var(--border-color); border-radius:var(--radius-md); padding:16px; display:flex; justify-content:space-between; align-items:center; background-color:var(--bg-secondary);">
                        <div>
                            <div style="font-weight:700; font-size:15px; color:var(--text-primary);">Independent Contractor Agreement</div>
                            <div style="font-size:12px; color:var(--text-tertiary); margin-top:2px;">Services contract for Zenith Corp. Effective Jan 01, 2026.</div>
                        </div>
                        <span class="badge badge-success" style="padding:8px 12px; border-radius: var(--radius-sm);">Active Contract</span>
                    </div>
                </div>
            </div>
        `;
    }

    return `
        <div class="card" style="max-width: 800px; margin: 0 auto;">
            <div class="section-title">Documents & Tax Compliance Files</div>
            <p style="color:var(--text-secondary); margin-bottom: 24px; font-size:14px;">
                View your historical W-2 forms, onboarding information, and tax residency declarations compiled by corporate compliance.
            </p>

            <div style="display:flex; flex-direction:column; gap:12px;">
                <!-- Form W-2 Row -->
                <div style="border:1px solid ${isSigned ? 'var(--success)' : 'var(--border-color)'}; border-radius:var(--radius-md); padding:16px; display:flex; justify-content:space-between; align-items:center; background-color:var(--bg-secondary); ${isSigned ? 'background: linear-gradient(135deg, var(--bg-secondary) 0%, var(--success-light) 100%);' : ''}">
                    <div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div style="font-weight:700; font-size:15px; color:var(--text-primary);">2026 Form W-2 (Wage and Tax Statement)</div>
                            ${isSigned
                                ? `<span class="badge badge-success" style="padding:3px 10px; font-size:11px; display:flex; align-items:center; gap:4px;">
                                    <svg style="width:11px;height:11px;" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                    Digitally Signed
                                  </span>`
                                : `<span class="badge badge-warning" style="padding:3px 10px; font-size:11px;">⚠ Signature Required</span>`
                            }
                        </div>
                        <div style="font-size:12px; color:var(--text-tertiary); margin-top:2px;">
                            ${isSigned
                                ? `Signed by ${sigRecord.employeeName} on ${sigRecord.timestamp} · Verification ID: ARP-${employeeId.toUpperCase()}-2026`
                                : 'Please review and digitally sign your W-2 to complete tax documentation.'
                            }
                        </div>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center; flex-shrink:0;">
                        <button class="btn btn-outline" onclick="AeroApp.generateEmployeeW2()" style="padding:8px 16px; font-size:13px;">
                            View W-2
                        </button>
                        ${!isSigned ? `<button class="btn btn-primary" onclick="AeroApp.openW2SignaturePad('${employeeId}')" style="padding:8px 16px; font-size:13px; display:flex; align-items:center; gap:6px;">
                            <svg style="width:14px;height:14px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                            Sign Now
                        </button>` : ''}
                    </div>
                </div>

                <!-- Form W-4 Row -->
                <div style="border:1px solid var(--border-color); border-radius:var(--radius-md); padding:16px; display:flex; justify-content:space-between; align-items:center; background-color:var(--bg-secondary);">
                    <div>
                        <div style="font-weight:700; font-size:15px; color:var(--text-primary);">Form W-4 Withholding Allowance</div>
                        <div style="font-size:12px; color:var(--text-tertiary); margin-top:2px;">Filing Status: ${employee.filingStatus === 'married' ? 'Married Filing Jointly' : 'Single'}</div>
                    </div>
                    <button class="btn btn-outline" onclick="AeroApp.showEmployeeOnboardingDoc('W-4', '${employee.id}')" style="padding:8px 16px; font-size:13px;">
                        Review Details
                    </button>
                </div>

                <!-- Form I-9 Row -->
                <div style="border:1px solid var(--border-color); border-radius:var(--radius-md); padding:16px; display:flex; justify-content:space-between; align-items:center; background-color:var(--bg-secondary);">
                    <div>
                        <div style="font-weight:700; font-size:15px; color:var(--text-primary);">Form I-9 Eligibility Verification</div>
                        <div style="font-size:12px; color:var(--text-tertiary); margin-top:2px;">US Citizenship & Identification verified on onboarding date.</div>
                    </div>
                    <span class="badge badge-success" style="padding:8px 12px; border-radius: var(--radius-sm);">Verified</span>
                </div>
            </div>
        </div>
    `;
}

// 15. Render Contractor Self-Service Dashboard
function renderContractorDashboardView(state, employeeId) {
    const employee = state.employees.find(e => e.id === employeeId);
    if (!employee) return `<div class="card">Error: Contractor profile not found.</div>`;

    let ytdGross = 0;
    let ytdNet = 0;
    let latestNet = 0;
    let latestPayDate = "No processed payments";
    let latestReimbursement = 0;
    
    const processedRuns = [];
    state.payrollHistory.forEach(run => {
        if (run.details && run.details[employeeId]) {
            const detail = run.details[employeeId];
            processedRuns.push({
                runId: run.id,
                date: run.date,
                detail: detail
            });
            ytdGross += detail.grossPay;
            ytdNet += detail.netPay;
        }
    });

    if (processedRuns.length > 0) {
        // Sort descending by date
        processedRuns.reverse();
        latestNet = processedRuns[0].detail.netPay;
        latestPayDate = processedRuns[0].date;
        latestReimbursement = processedRuns[0].detail.reimbursement || 0;
    } else {
        // Fallback demo numbers
        const estimatedAnnual = employee.type === 'salaried' ? employee.rate : employee.rate * 40 * 52;
        ytdGross = estimatedAnnual * 0.45;
        const reimb = (employee.benefits && employee.benefits.reimbursement) ? employee.benefits.reimbursement : 0;
        ytdNet = ytdGross + (reimb * 10 || 0);
        latestNet = ytdNet / 12;
        latestPayDate = "June 10, 2026";
    }

    const loggedHours = state.timesheets[employeeId] || [0, 0, 0, 0, 0, 0, 0];
    const totalHours = loggedHours.reduce((sum, h) => sum + h, 0);

    let paymentRows = "";
    if (processedRuns.length > 0) {
        processedRuns.forEach(runItem => {
            paymentRows += `
                <tr>
                    <td style="font-weight:600;">${runItem.date}</td>
                    <td>${formatCurrency(runItem.detail.grossPay)}</td>
                    <td>${formatCurrency(runItem.detail.reimbursement || 0)}</td>
                    <td style="font-weight:700; color:var(--success);">${formatCurrency(runItem.detail.netPay)}</td>
                    <td><span class="badge badge-success">Deposited</span></td>
                    <td style="text-align:right;">
                        <button class="btn btn-outline" onclick="AeroApp.previewContractorReceiptFromId('${employeeId}', '${runItem.runId}')" style="padding: 6px 12px; font-size:12px;">
                            View Receipt
                        </button>
                    </td>
                </tr>
            `;
        });
    } else {
        // Fallback rows
        const reimb = (employee.benefits && employee.benefits.reimbursement) ? employee.benefits.reimbursement : 0;
        paymentRows += `
            <tr>
                <td style="font-weight:600;">June 10, 2026</td>
                <td>${formatCurrency(ytdGross / 3)}</td>
                <td>${formatCurrency(reimb)}</td>
                <td style="font-weight:700; color:var(--success);">${formatCurrency(latestNet)}</td>
                <td><span class="badge badge-success">Deposited</span></td>
                <td style="text-align:right;">
                    <button class="btn btn-outline" onclick="AeroApp.showToast('Archived receipt loaded!', 'info')" style="padding: 6px 12px; font-size:12px;">
                        Request Copy
                    </button>
                </td>
            </tr>
            <tr>
                <td style="font-weight:600;">May 30, 2026</td>
                <td>${formatCurrency(ytdGross / 3)}</td>
                <td>${formatCurrency(reimb)}</td>
                <td style="font-weight:700; color:var(--success);">${formatCurrency(latestNet)}</td>
                <td><span class="badge badge-success">Deposited</span></td>
                <td style="text-align:right;">
                    <button class="btn btn-outline" onclick="AeroApp.showToast('Archived receipt loaded!', 'info')" style="padding: 6px 12px; font-size:12px;">
                        Request Copy
                    </button>
                </td>
            </tr>
        `;
    }

    return `
        <div class="employee-header-card" style="border-left: 6px solid var(--warning);">
            <div class="employee-profile-summary">
                <div class="employee-avatar-large" style="background: var(--warning-light); color: var(--warning);">${employee.name.split(' ').map(n=>n[0]).join('')}</div>
                <div class="employee-meta-info">
                    <h2 class="employee-name-title">Welcome back, ${escapeHTML(employee.name)}!</h2>
                    <div style="display:flex; gap:8px; align-items:center; margin-top:4px;">
                        <span class="employee-role-badge" style="background: var(--warning-light); color: var(--warning);">${escapeHTML(employee.role)}</span>
                        <span style="font-size:13px; opacity:0.8;">Tax Status: 1099 Contractor | Department: ${escapeHTML(employee.department)}</span>
                    </div>
                </div>
            </div>
            <div class="employee-salary-card">
                <span style="font-size:12px; opacity:0.8; text-transform:uppercase; font-weight:700; letter-spacing:0.5px;">Contract Rate</span>
                <span style="font-family:var(--font-heading); font-size:24px; font-weight:700;">${formatCurrency(employee.rate)}/hr</span>
            </div>
        </div>

        <div class="grid-stats">
            <div class="card stat-card">
                <div class="stat-header">
                    <span class="stat-label">Last Invoice Paid</span>
                    <div class="stat-icon warning">
                        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    </div>
                </div>
                <span class="stat-value">${formatCurrency(latestNet)}</span>
                <span class="stat-trend" style="color:var(--text-secondary)">
                    Paid on ${latestPayDate}
                </span>
            </div>

            <div class="card stat-card">
                <div class="stat-header">
                    <span class="stat-label">YTD Earnings</span>
                    <div class="stat-icon primary">
                        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                </div>
                <span class="stat-value">${formatCurrency(ytdNet)}</span>
                <span class="stat-trend" style="color:var(--success)">
                    Gross Billings YTD
                </span>
            </div>

            <div class="card stat-card">
                <div class="stat-header">
                    <span class="stat-label">Logged Hours (Current Period)</span>
                    <div class="stat-icon info">
                        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                </div>
                <span class="stat-value">${totalHours.toFixed(2)} hrs</span>
                <span class="stat-trend" style="color:var(--primary); cursor:pointer; font-weight:700;" onclick="AeroApp.navigateTo('employee-timecard')">
                    Log Hours &rarr;
                </span>
            </div>
        </div>

        <div class="dashboard-grid">
            <!-- Left Column: Professional Services Billing -->
            <div class="card">
                <div class="section-title">
                    <span>Professional Services Billing & Receipts</span>
                    <span style="font-size:12px;font-weight:500;color:var(--text-tertiary)">1099 Disbursement Receipts</span>
                </div>
                <div class="table-wrapper">
                    <table class="table-responsive">
                        <thead>
                            <tr>
                                <th>Billing Date</th>
                                <th>Services Gross</th>
                                <th>Reimbursements</th>
                                <th>Net Amount Paid</th>
                                <th>Direct Deposit Status</th>
                                <th style="text-align:right;">Statement</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${paymentRows}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Right Column: Direct Deposit Allocation -->
            <div style="display:flex; flex-direction:column; gap:24px;">
                <div class="card" style="padding:24px;">
                    <div class="section-title" style="margin-bottom:12px; display:flex; flex-direction:column; align-items:flex-start; gap:4px;">
                        <span style="font-size:16px;">Direct Deposit Splits</span>
                        <p style="font-size:12px; color:var(--text-secondary); margin:0;">Allocate a percentage of your net paycheck to a secondary savings account.</p>
                    </div>
                    <form id="directDepositSplitForm" onsubmit="AeroApp.saveDirectDepositSplit(event)" style="display:flex; flex-direction:column; gap:16px;">
                        <div style="display:flex; align-items:center; justify-content:space-between; background:var(--bg-secondary); padding:12px 16px; border-radius:var(--radius-sm); border:1px solid var(--border-color);">
                            <label for="splitEnabled" style="font-weight:600; cursor:pointer; margin:0; font-size:14px;">Enable Split Allocation</label>
                            <input type="checkbox" id="splitEnabled" ${employee.splitDeposits && employee.splitDeposits.enabled ? 'checked' : ''} style="width:20px; height:20px; cursor:pointer;" onchange="const fields = document.getElementById('splitFields'); fields.style.display = this.checked ? 'flex' : 'none';">
                        </div>

                        <div id="splitFields" style="display:${employee.splitDeposits && employee.splitDeposits.enabled ? 'flex' : 'none'}; flex-direction:column; gap:12px;">
                            <div class="form-group">
                                <label for="splitSavingsPercent" style="font-size:12px; font-weight:600; color:var(--text-secondary);">Percent to Savings (%)</label>
                                <input type="number" min="0" max="100" class="form-control" id="splitSavingsPercent" value="${employee.splitDeposits ? employee.splitDeposits.savingsPercent : 0}" placeholder="e.g. 20" style="padding:8px 12px; background:var(--bg-secondary);">
                            </div>
                            <div class="form-group">
                                <label for="splitSavingsRouting" style="font-size:12px; font-weight:600; color:var(--text-secondary);">Savings Routing Number</label>
                                <input type="text" class="form-control" id="splitSavingsRouting" value="${escapeAttr(employee.splitDeposits ? (employee.splitDeposits.savingsRouting || '') : '')}" maxlength="9" inputmode="numeric" placeholder="9-digit Routing Number" style="padding:8px 12px; background:var(--bg-secondary);">
                            </div>
                            <div class="form-group">
                                <label for="splitSavingsAccount" style="font-size:12px; font-weight:600; color:var(--text-secondary);">Savings Account Number</label>
                                <input type="text" class="form-control" id="splitSavingsAccount" value="${escapeAttr(employee.splitDeposits ? (employee.splitDeposits.savingsAccount || '') : '')}" maxlength="17" inputmode="numeric" placeholder="Account Number" style="padding:8px 12px; background:var(--bg-secondary);">
                            </div>
                        </div>

                        <button type="submit" class="btn btn-primary" style="width:100%; justify-content:center; padding:10px 0;">Save Allocation Preferences</button>
                    </form>
                </div>
            </div>
        </div>
    `;
}

// 16. Generate custom receipt layout for contractors (gross payments, no tax deductions)
function getContractorReceiptHTML(employee, calcDetails, dateRange) {
    const totalEarnings = calcDetails.grossPay;
    const reimbursement = calcDetails.reimbursement || 0;
    const netPay = calcDetails.netPay;
    
    return `
        <div class="paystub-container">
            <div class="paystub-header" style="border-bottom: 2px solid var(--warning);">
                <div>
                    <div style="font-size:22px; font-weight:700; color:var(--warning); font-family:'Outfit'">${employee.name.toUpperCase()}</div>
                    <div style="font-size:12px; color:#64748b; font-weight:600;">State Residence: ${employee.state} (1099 Contractor)</div>
                </div>
                <div style="text-align:right;">
                    <div class="paystub-title" style="color:var(--warning)">Payment Receipt</div>
                    <div style="font-size:12px; color:#64748b; font-weight:600;">Form 1099-NEC Compensation</div>
                </div>
            </div>
            
            <div class="paystub-meta-grid">
                <div class="paystub-meta-item">
                    <span class="paystub-meta-label">Contractor ID</span>
                    <span class="paystub-meta-val">CON-${employee.id.substring(0,6)}</span>
                </div>
                <div class="paystub-meta-item">
                    <span class="paystub-meta-label">Billing Period</span>
                    <span class="paystub-meta-val">${dateRange}</span>
                </div>
                <div class="paystub-meta-item">
                    <span class="paystub-meta-label">Payment Date</span>
                    <span class="paystub-meta-val">June 16, 2026</span>
                </div>
                <div class="paystub-meta-item">
                    <span class="paystub-meta-label">Classification</span>
                    <span class="paystub-meta-val">1099 Independent Contractor</span>
                </div>
                <div class="paystub-meta-item">
                    <span class="paystub-meta-label">Payment Method</span>
                    <span class="paystub-meta-val">Direct Deposit (ACH)</span>
                </div>
                <div class="paystub-meta-item">
                    <span class="paystub-meta-label">Tax Withholding</span>
                    <span class="paystub-meta-val" style="color:var(--danger)">Exempt / Self-Reported</span>
                </div>
            </div>
            
            <table class="paystub-table">
                <thead>
                    <tr>
                        <th>Services Description</th>
                        <th>Hourly Rate / Basis</th>
                        <th>Hours Worked</th>
                        <th style="text-align: right;">Total Amount</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="font-weight:600;">Independent Professional Services</td>
                        <td>${formatCurrency(employee.rate)}/hr</td>
                        <td>${calcDetails.regularHours ? calcDetails.regularHours.toFixed(2) : (calcDetails.grossPay / employee.rate).toFixed(2)}</td>
                        <td style="text-align: right; font-weight:600;">${formatCurrency(calcDetails.regularEarnings || calcDetails.grossPay)}</td>
                    </tr>
                    ${reimbursement > 0 ? `
                        <tr>
                            <td style="font-weight:600; color:var(--success)">Expense Reimbursement (Tax-Free)</td>
                            <td>Expense Sync</td>
                            <td>--</td>
                            <td style="text-align: right; font-weight:600; color:var(--success)">${formatCurrency(reimbursement)}</td>
                        </tr>
                    ` : ''}
                    <tr class="total-row">
                        <td colspan="3">Total Compensation Due</td>
                        <td style="text-align: right;">${formatCurrency(netPay)}</td>
                    </tr>
                </tbody>
            </table>
            
            <div style="background-color: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 16px; margin-top:20px; display:flex; flex-direction:column; gap:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                    <div>
                        <div style="font-weight:700; font-size:14px;">Total Gross Payment (Direct Deposit)</div>
                        <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">No taxes or pre-tax benefits deductions have been withheld from this payment.</div>
                    </div>
                    <div style="font-size:22px; font-weight:800; color:var(--warning);">${formatCurrency(netPay)}</div>
                </div>
                ${calcDetails.hasSplit ? `
                <div style="display:flex; justify-content:space-between; width:100%; font-size:12px; color:var(--text-secondary); padding-top: 12px; border-top: 1px solid var(--border-color); font-family:'Outfit';">
                    <div>
                        <span style="font-weight:600;">Checking Direct Deposit:</span> 
                        <span>${formatCurrency(calcDetails.netPayChecking)}</span>
                    </div>
                    <div>
                        <span style="font-weight:600;">Savings Direct Deposit (${employee.splitDeposits.savingsPercent}%):</span> 
                        <span>${formatCurrency(calcDetails.netPaySavings)}</span>
                    </div>
                </div>
                ` : ''}
            </div>
            
            <div style="border-top:1px dashed #cbd5e1; margin-top:30px; padding-top:15px; font-size:10px; color:#64748b; text-align:center;">
                GlidePay Payroll Systems Inc. - 1099 Professional Services Direct Deposit Statement - Keep for tax records.
            </div>
        </div>
    `;
}

// 17. Generate pre-populated Form 1099-NEC
function get1099NECHTML(employee, state) {
    let nonemployeeCompensation = 0;
    
    // Find all processed runs matching this employee
    const filteredRuns = [];
    state.payrollHistory.forEach(historyRun => {
        if (historyRun.details && historyRun.details[employee.id]) {
            filteredRuns.push(historyRun.details[employee.id]);
        }
    });
    
    if (filteredRuns.length > 0) {
        filteredRuns.forEach(r => {
            nonemployeeCompensation += r.grossPay;
        });
    } else {
        // Fallback: estimate based on rate
        const estimatedAnnual = employee.type === 'salaried' ? employee.rate : employee.rate * 40 * 52;
        nonemployeeCompensation = estimatedAnnual * 0.45; // Assume 45% of year has passed for demo
    }
    
    return `
        <div style="background-color:#fff5f0; color:#1c1917; border:2px solid #ea580c; padding:24px; font-family:'Plus Jakarta Sans',sans-serif; font-size:11px; max-width:800px; margin:0 auto; box-shadow:var(--shadow-md);">
            <div style="display:flex; justify-content:space-between; border-bottom:2px solid #ea580c; padding-bottom:8px; margin-bottom:12px;">
                <div>
                    <span style="font-size:18px; font-weight:800; color:#ea580c;">Form 1099-NEC</span>
                    <span style="font-size:11px; font-weight:600; margin-left:8px;">Nonemployee Compensation</span>
                </div>
                <div style="text-align:right; font-weight:800; font-size:14px; color:#ea580c;">2026</div>
            </div>
            
            <div style="display:grid; grid-template-columns: 1.2fr 1fr; gap:12px; border:1px solid #ea580c;">
                <div style="border-right:1px solid #ea580c;">
                    <div style="border-bottom:1px solid #ea580c; padding:6px;">
                        <span style="font-weight:700; color:#c2410c; font-size:9px; display:block;">PAYER'S name, street address, city or town, state or province, country, ZIP</span>
                        <span style="font-weight:600;">${state.settings.companyName || 'Zenith Corp'}<br/>GlidePay Suite 200</span>
                    </div>
                    <div style="border-bottom:1px solid #ea580c; padding:6px;">
                        <span style="font-weight:700; color:#c2410c; font-size:9px; display:block;">PAYER'S TIN</span>
                        <span style="font-weight:600;">${state.settings.ein || 'XX-XXXXXXX'}</span>
                    </div>
                    <div style="border-bottom:1px solid #ea580c; padding:6px;">
                        <span style="font-weight:700; color:#c2410c; font-size:9px; display:block;">RECIPIENT'S TIN</span>
                        <span style="font-weight:600;">XXX-XX-8822</span>
                    </div>
                    <div style="padding:6px;">
                        <span style="font-weight:700; color:#c2410c; font-size:9px; display:block;">RECIPIENT'S name, address, and ZIP code</span>
                        <span style="font-weight:600;">${escapeHTML(employee.name)}<br/>${escapeHTML(employee.email)}</span>
                    </div>
                </div>
                
                <div>
                    <div style="border-bottom:1px solid #ea580c; padding:10px; height:80px; display:flex; flex-direction:column; justify-content:center;">
                        <span style="font-weight:700; color:#c2410c; font-size:10px; display:block;">1. Nonemployee compensation</span>
                        <span style="font-weight:800; font-size:16px; color:#1c1917; margin-top:4px;">${formatCurrency(nonemployeeCompensation)}</span>
                    </div>
                    <div style="border-bottom:1px solid #ea580c; padding:6px;">
                        <span style="font-weight:700; color:#c2410c; font-size:9px; display:block;">4. Federal income tax withheld</span>
                        <span style="font-weight:600;">$0.00</span>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; padding:6px;">
                        <div style="border-right:1px solid #ea580c; padding-right:6px;">
                            <span style="font-weight:700; color:#c2410c; font-size:9px; display:block;">5. State tax withheld</span>
                            <span style="font-weight:600;">$0.00</span>
                        </div>
                        <div style="padding-left:6px;">
                            <span style="font-weight:700; color:#c2410c; font-size:9px; display:block;">6. State / Payer's state no.</span>
                            <span style="font-weight:600;">${employee.state} / --</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <div style="margin-top:12px; text-align:center; font-size:9px; color:#4b5563;">
                Copy B - For Recipient. Pre-populated automatically by GlidePay compliance module.
            </div>
        </div>
    `;
}


// ============================================================
// NEW FEATURE RENDER FUNCTIONS (Wave 2 & 3)
// ============================================================

// A. Employee Onboarding View
function renderOnboardingView(state) {
    const queue = state.onboardingQueue || [];
    const statusColors = { 'in-progress': 'primary', 'pending-docs': 'warning', 'complete': 'success', 'cancelled': 'danger' };
    const statusLabels = { 'in-progress': 'In Progress', 'pending-docs': 'Pending Docs', 'complete': 'Complete', 'cancelled': 'Cancelled' };

    let queueRows = '';
    queue.forEach(h => {
        const total = h.totalSteps || 5;
        const step = h.step || 1;
        const pct = Math.round((step / total) * 100);
        const color = statusColors[h.status] || 'primary';
        const initials = (h.name || '?').split(' ').map(n => n[0]).join('').slice(0, 2);
        queueRows += `
            <tr>
                <td>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div class="employee-avatar" style="width:36px;height:36px;font-size:13px;">${initials}</div>
                        <div><div style="font-weight:600;">${h.name}</div><div style="font-size:12px;color:var(--text-tertiary);">${h.email}</div></div>
                    </div>
                </td>
                <td><span style="font-weight:600;">${h.role || ''}</span><br/><span style="font-size:12px;color:var(--text-tertiary);">${h.department || ''}</span></td>
                <td><span style="font-weight:600;">${h.startDate || 'TBD'}</span></td>
                <td>
                    <div style="width:120px;">
                        <div style="height:6px;background:var(--bg-tertiary);border-radius:var(--radius-full);overflow:hidden;">
                            <div style="height:100%;width:${pct}%;background:var(--${color});border-radius:var(--radius-full);transition:width 0.4s;"></div>
                        </div>
                        <div style="font-size:11px;color:var(--text-secondary);margin-top:3px;">Step ${step} of ${total} (${pct}%)</div>
                    </div>
                </td>
                <td><span class="badge badge-${color}">${statusLabels[h.status] || h.status}</span></td>
                <td style="text-align:right;">
                    <button class="btn btn-outline" style="padding:5px 12px;font-size:12px;" onclick="AeroApp.openOnboardingWizard('${h.id}')">Continue</button>
                </td>
            </tr>`;
    });

    return `
        <div class="card" style="margin-bottom:24px; padding:20px; display:flex; justify-content:space-between; align-items:center; background:linear-gradient(135deg, var(--primary) 0%, #6366f1 100%); color:#fff;">
            <div>
                <div style="font-size:20px; font-weight:800; font-family:var(--font-heading);">New Hire Onboarding</div>
                <div style="font-size:13px; opacity:0.85; margin-top:4px;">${queue.length} active new hires in pipeline</div>
            </div>
            <button class="btn" style="background:rgba(255,255,255,0.2); color:#fff; border:1px solid rgba(255,255,255,0.4); backdrop-filter:blur(8px);" onclick="AeroApp.openNewHireForm()">
                <svg style="width:16px;height:16px;margin-right:6px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path></svg>
                Add New Hire
            </button>
        </div>

        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">Active Onboarding</span>
                <span class="stat-value">${queue.filter(h=>h.status==='in-progress').length}</span>
                <span class="stat-trend up">In progress</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Pending Documents</span>
                <span class="stat-value">${queue.filter(h=>h.status==='pending-docs').length}</span>
                <span class="stat-trend" style="color:var(--warning)">Awaiting signatures</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Completed (YTD)</span>
                <span class="stat-value">${queue.filter(h=>h.status==='complete').length}</span>
                <span class="stat-trend up">Successfully hired</span>
            </div>
        </div>

        <div class="card table-card">
            <div class="section-title" style="padding:20px 24px 0 24px;">Onboarding Queue</div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr>
                        <th>New Hire</th><th>Role</th><th>Start Date</th><th>Progress</th><th>Status</th><th></th>
                    </tr></thead>
                    <tbody>${queueRows || '<tr><td colspan="6" style="text-align:center;color:var(--text-tertiary);padding:40px;">No active onboarding records</td></tr>'}</tbody>
                </table>
            </div>
        </div>

        <div class="card" style="margin-top:24px; padding:24px;">
            <div class="section-title">Onboarding Steps</div>
            <div style="display:grid; grid-template-columns:repeat(5,1fr); gap:12px; margin-top:16px;">
                ${['Personal Info', 'Role & Pay', 'Benefits Setup', 'Document Signing', 'Finish & Provision'].map((step, i) => `
                    <div style="text-align:center; padding:16px; background:var(--bg-tertiary); border-radius:var(--radius-md);">
                        <div style="width:32px;height:32px;border-radius:50%;background:var(--primary-light);color:var(--primary);font-weight:800;font-size:14px;display:flex;align-items:center;justify-content:center;margin:0 auto 8px;">${i+1}</div>
                        <div style="font-size:12px;font-weight:600;">${step}</div>
                    </div>`).join('')}
            </div>
        </div>
    `;
}

// B. Employee Directory View
function renderDirectoryView(state) {
    const deptColors = { 'Engineering': 'primary', 'Sales & Marketing': 'success', 'Customer Support': 'warning', 'Product Design': 'accent-purple', 'Operations & HR': 'danger' };
    const cards = state.employees.map(emp => {
        const initials = emp.name.split(' ').map(n=>n[0]).join('');
        const color = deptColors[emp.department] || 'primary';
        const isSigned = emp.classification === 'w2' && state.w2Signatures && state.w2Signatures[emp.id];
        return `
            <div class="dir-card card">
                <div class="dir-avatar" style="background:var(--${color}-light);color:var(--${color === 'accent-purple' ? 'accent-purple' : color});">${initials}</div>
                <div style="font-size:17px;font-weight:800;margin-top:10px;">${escapeHTML(emp.name)}</div>
                <div style="font-size:13px;color:var(--text-secondary);margin-top:2px;">${escapeHTML(emp.role)}</div>
                <div class="badge badge-${color}" style="margin-top:8px;font-size:11px;">${escapeHTML(emp.department)}</div>
                <div style="width:100%;margin-top:12px;border-top:1px solid var(--border-color);padding-top:12px;display:flex;flex-direction:column;gap:4px;">
                    <div style="font-size:12px;color:var(--text-tertiary);display:flex;gap:6px;align-items:center;">
                        <svg style="width:12px;height:12px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                        ${escapeHTML(emp.email)}
                    </div>
                    <div style="font-size:12px;color:var(--text-tertiary);display:flex;gap:6px;align-items:center;">
                        <svg style="width:12px;height:12px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                        ${emp.state} · ${emp.type === 'salaried' ? 'Salaried' : 'Hourly'}
                    </div>
                    <div style="font-size:12px;margin-top:4px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                        <span class="badge badge-${emp.classification === '1099' ? 'warning' : 'success'}" style="padding:2px 8px;font-size:10px;">${emp.classification === '1099' ? '1099 Contractor' : 'W-2 Employee'}</span>
                        ${isSigned ? '<span class="badge badge-success" style="padding:2px 8px;font-size:10px;">W-2 Signed</span>' : ''}
                        <span class="badge ${emp.userId ? 'badge-success' : 'badge-warning'}" style="padding:2px 8px;font-size:10px;">${emp.userId ? 'Portal linked' : 'Not invited'}</span>
                    </div>
                    <button class="btn ${emp.userId ? 'btn-outline' : 'btn-primary'}" style="margin-top:10px;width:100%;padding:8px 10px;font-size:12px;"
                        onclick="AeroApp.inviteEmployeeToPortal('${emp.id}')">
                        ${emp.userId ? 'Resend Portal Link' : 'Invite to Portal'}
                    </button>
                </div>
            </div>`;
    });

    return `
        <div style="display:flex; gap:12px; margin-bottom:20px; align-items:center;">
            <div style="position:relative;flex:1;">
                <svg style="position:absolute;left:12px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:var(--text-tertiary);" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                <input type="text" class="form-control" placeholder="Search by name, role, or department..." id="dirSearch" oninput="AeroApp.filterDirectory()" style="padding-left:38px;">
            </div>
            <select class="form-control" id="dirDeptFilter" onchange="AeroApp.filterDirectory()" style="width:200px;">
                <option value="">All Departments</option>
                ${[...new Set(state.employees.map(e=>e.department))].map(d=>`<option value="${d}">${d}</option>`).join('')}
            </select>
        </div>
        <div class="dir-grid" id="directoryGrid">
            ${cards.join('')}
        </div>
    `;
}

// C. PTO & Leave Admin View
function renderPTOView(state) {
    const typeColors = { vacation: 'primary', sick: 'success', personal: 'warning' };
    const statusColors = { pending: 'warning', approved: 'success', denied: 'danger' };

    let reqRows = '';
    state.ptoRequests.forEach(req => {
        const emp = state.employees.find(e => e.id === req.empId);
        const empName = emp ? emp.name : 'Unknown';
        const typeColor = typeColors[req.type] || 'primary';
        const statusColor = statusColors[req.status] || 'primary';
        reqRows += `
            <tr id="pto-row-${req.id}">
                <td>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <div class="employee-avatar" style="width:32px;height:32px;font-size:12px;">${empName.split(' ').map(n=>n[0]).join('')}</div>
                        <span style="font-weight:600;">${empName}</span>
                    </div>
                </td>
                <td><span class="badge badge-${typeColor}" style="text-transform:capitalize;">${req.type}</span></td>
                <td style="font-weight:600;">${req.startDate} → ${req.endDate}</td>
                <td>${req.hours} hrs</td>
                <td style="max-width:180px;font-size:13px;color:var(--text-secondary);">${escapeHTML(req.reason)}</td>
                <td><span class="badge badge-${statusColor}" style="text-transform:capitalize;">${req.status}</span></td>
                <td style="text-align:right;">
                    ${req.status === 'pending' ? `
                        <div style="display:flex;gap:6px;justify-content:flex-end;">
                            <button class="btn btn-outline" style="padding:4px 10px;font-size:12px;color:var(--success);border-color:var(--success);" onclick="AeroApp.approvePTO('${req.id}')">Approve</button>
                            <button class="btn btn-outline" style="padding:4px 10px;font-size:12px;color:var(--danger);border-color:var(--danger);" onclick="AeroApp.denyPTO('${req.id}')">Deny</button>
                        </div>` : '—'}
                </td>
            </tr>`;
    });

    let balanceRows = '';
    state.employees.filter(e => e.classification !== '1099').forEach(emp => {
        const bal = state.ptoBalances[emp.id] || { vacation: 0, sick: 0, personal: 0 };
        balanceRows += `
            <tr>
                <td><div style="display:flex;align-items:center;gap:8px;"><div class="employee-avatar" style="width:32px;height:32px;font-size:12px;">${emp.name.split(' ').map(n=>n[0]).join('')}</div><span style="font-weight:600;">${emp.name}</span></div></td>
                <td><span style="font-weight:700;color:var(--primary);">${bal.vacation} hrs</span></td>
                <td><span style="font-weight:700;color:var(--success);">${bal.sick} hrs</span></td>
                <td><span style="font-weight:700;color:var(--warning);">${bal.personal} hrs</span></td>
                <td><span style="font-weight:700;">${bal.vacation + bal.sick + bal.personal} hrs</span></td>
                <td style="text-align:right;"><button class="btn btn-outline" style="padding:4px 10px;font-size:12px;" onclick="AeroApp.adjustPTOBalance('${emp.id}')">Adjust</button></td>
            </tr>`;
    });

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">Pending Requests</span>
                <span class="stat-value">${state.ptoRequests.filter(r=>r.status==='pending').length}</span>
                <span class="stat-trend" style="color:var(--warning)">Require approval</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Approved (YTD)</span>
                <span class="stat-value">${state.ptoRequests.filter(r=>r.status==='approved').length}</span>
                <span class="stat-trend up">Days off taken</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Team on Leave Today</span>
                <span class="stat-value">0</span>
                <span class="stat-trend">Full team available</span>
            </div>
        </div>

        <div class="dashboard-grid">
            <div class="card table-card">
                <div class="section-title" style="padding:20px 24px 0 24px;">Leave Requests</div>
                <div class="table-wrapper">
                    <table class="table-responsive">
                        <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Hours</th><th>Reason</th><th>Status</th><th></th></tr></thead>
                        <tbody>${reqRows || '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-tertiary);">No leave requests</td></tr>'}</tbody>
                    </table>
                </div>
            </div>
            <div class="card table-card">
                <div class="section-title" style="padding:20px 24px 0 24px;">PTO Balances</div>
                <div class="table-wrapper">
                    <table class="table-responsive">
                        <thead><tr><th>Employee</th><th>Vacation</th><th>Sick</th><th>Personal</th><th>Total</th><th></th></tr></thead>
                        <tbody>${balanceRows}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
}

// D. Benefits Admin View
function renderBenefitsAdminView(state) {
    const planColors = { gold: 'warning', silver: 'primary', bronze: 'success', none: 'danger' };
    const planPremiums = { gold: 520, silver: 280, bronze: 120, none: 0 };

    let rows = '';
    state.employees.filter(e => e.classification !== '1099').forEach(emp => {
        const b = state.benefits[emp.id] || { healthPlan: 'none', dental: false, vision: false, lifeInsurance: false, fsa: 0 };
        const planColor = planColors[b.healthPlan] || 'primary';
        const totalPremium = planPremiums[b.healthPlan] + (b.dental ? 35 : 0) + (b.vision ? 15 : 0) + (b.lifeInsurance ? 20 : 0);
        rows += `
            <tr>
                <td><div style="display:flex;align-items:center;gap:8px;"><div class="employee-avatar" style="width:32px;height:32px;font-size:12px;">${emp.name.split(' ').map(n=>n[0]).join('')}</div><div><div style="font-weight:600;">${emp.name}</div><div style="font-size:12px;color:var(--text-tertiary);">${emp.department}</div></div></div></td>
                <td><span class="badge badge-${planColor}" style="text-transform:capitalize;">${b.healthPlan} Health</span></td>
                <td><span class="badge badge-${b.dental?'success':'danger'}">${b.dental?'✓ Enrolled':'✗ Waived'}</span></td>
                <td><span class="badge badge-${b.vision?'success':'danger'}">${b.vision?'✓ Enrolled':'✗ Waived'}</span></td>
                <td><span class="badge badge-${b.lifeInsurance?'success':'danger'}">${b.lifeInsurance?'✓ Active':'✗ None'}</span></td>
                <td style="font-weight:700;color:var(--primary);">${formatCurrency(totalPremium)}/mo</td>
                <td style="text-align:right;"><button class="btn btn-outline" style="padding:4px 10px;font-size:12px;" onclick="AeroApp.editEmployeeBenefits('${emp.id}')">Edit</button></td>
            </tr>`;
    });

    const totalMonthlyPremium = state.employees.filter(e => e.classification !== '1099').reduce((sum, emp) => {
        const b = state.benefits[emp.id] || { healthPlan: 'none', dental: false, vision: false, lifeInsurance: false };
        return sum + planPremiums[b.healthPlan || 'none'] + (b.dental?35:0) + (b.vision?15:0) + (b.lifeInsurance?20:0);
    }, 0);

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">Total Monthly Premium</span>
                <span class="stat-value">${formatCurrency(totalMonthlyPremium)}</span>
                <span class="stat-trend up">Employer contribution</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Employees Enrolled</span>
                <span class="stat-value">${state.employees.filter(e=>e.classification!=='1099').length}</span>
                <span class="stat-trend up">Active coverage</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Open Enrollment</span>
                <span class="stat-value" style="font-size:18px;">July 1 – 31</span>
                <span class="stat-trend" style="color:var(--warning)">Upcoming</span>
            </div>
        </div>
        <div class="card table-card">
            <div class="section-title" style="padding:20px 24px 0 24px; margin-bottom:0;">Benefits Enrollments</div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>Employee</th><th>Health Plan</th><th>Dental</th><th>Vision</th><th>Life Ins.</th><th>Monthly Cost</th><th></th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>`;
}

// E. Payroll Approvals View
function renderApprovalsView(state) {
    const statusColors = { pending: 'warning', approved: 'success', rejected: 'danger' };
    const approvals = state.payrollApprovals || [];
    const advances  = state.payAdvances || [];

    let rows = '';
    [...approvals].reverse().forEach(appr => {
        const run = (state.payrollHistory || []).find(r => r.id === appr.runId);
        const statusColor = statusColors[appr.status] || 'primary';
        const shortId = String(appr.runId || appr.id).slice(0, 8).toUpperCase();
        rows += `
            <tr>
                <td style="font-weight:600;">${shortId}</td>
                <td>${run ? run.date : '—'}</td>
                <td>${appr.employeeCount} employees</td>
                <td style="font-weight:700;">${formatCurrency(appr.totalAmount)}</td>
                <td>${escapeHTML(appr.submittedBy)}</td>
                <td>${escapeHTML(appr.submittedTs)}</td>
                <td><span class="badge badge-${statusColor}" style="text-transform:capitalize;">${escapeHTML(appr.status)}</span></td>
                <td style="text-align:right;">
                    ${appr.status === 'pending' ? `
                        <div style="display:flex;gap:6px;justify-content:flex-end;">
                            <button class="btn btn-outline" style="padding:4px 10px;font-size:12px;color:var(--success);border-color:var(--success);" onclick="AeroApp.approvePayroll('${appr.id}')">Approve</button>
                            <button class="btn btn-outline" style="padding:4px 10px;font-size:12px;color:var(--danger);border-color:var(--danger);" onclick="AeroApp.rejectPayroll('${appr.id}')">Reject</button>
                        </div>` : `<span style="font-size:12px;color:var(--text-tertiary);">${appr.approvedBy || '—'}</span>`}
                </td>
            </tr>`;
    });

    const pendingCount = approvals.filter(a=>a.status==='pending').length;
    const approvedTotal = approvals.filter(a=>a.status==='approved').reduce((s,a)=>s+a.totalAmount,0);

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">Pending Payroll Approvals</span>
                <span class="stat-value">${pendingCount}</span>
                <span class="stat-trend" style="color:var(--warning);">${pendingCount > 0 ? 'Action required' : 'All clear'}</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Approved Payrolls (YTD)</span>
                <span class="stat-value">${approvals.filter(a=>a.status==='approved').length}</span>
                <span class="stat-trend up">Processed runs</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Total Approved Amount</span>
                <span class="stat-value">${formatCurrency(approvedTotal)}</span>
                <span class="stat-trend up">YTD payroll</span>
            </div>
        </div>

        <!-- 1. Primary: Payroll Runs Pending Approval & History -->
        <div class="card table-card" style="margin-bottom:24px;">
            <div class="section-title" style="padding:20px 24px 0 24px; display:flex; justify-content:space-between; align-items:center;">
                <span>Payroll Approval Runs</span>
                <span class="badge ${pendingCount > 0 ? 'badge-warning' : 'badge-success'}" style="font-size:11px;">${pendingCount} Pending</span>
            </div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>Run ID</th><th>Pay Date</th><th>Employees</th><th>Total Payroll</th><th>Submitted By</th><th>Submitted At</th><th>Status</th><th style="text-align:right;">Actions</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-tertiary);">No approval records found. Run payroll first to submit a cycle.</td></tr>'}</tbody>
                </table>
            </div>
        </div>

        <!-- 2. Secondary: Pay Advance Requests -->
        ${(() => {
            const pendingAdvances = advances.filter(a => a.status === 'pending');
            let advanceRows = '';
            pendingAdvances.forEach(adv => {
                const emp = (state.employees || []).find(e => e.id === adv.empId);
                advanceRows += `
                    <tr>
                        <td style="padding: 12px 24px;">
                            <div class="employee-row-info">
                                <div class="avatar">${escapeHTML(emp ? emp.name.split(' ').map(n=>n[0]).join('') : 'U')}</div>
                                <div>
                                    <div style="font-weight:600;">${escapeHTML(emp ? emp.name : 'Unknown')}</div>
                                    <div style="font-size:12px; color:var(--text-tertiary);">${escapeHTML(emp ? emp.email : '')}</div>
                                </div>
                            </div>
                        </td>
                        <td>W-2 Employee</td>
                        <td>${escapeHTML(adv.requestDate)}</td>
                        <td style="font-weight:700; color:var(--primary);">${formatCurrency(adv.amount)}</td>
                        <td><span class="badge badge-warning">Pending Review</span></td>
                        <td style="text-align:right; padding-right:24px;">
                            <div style="display:flex; gap:6px; justify-content:flex-end;">
                                <button class="btn btn-outline" style="padding:4px 10px; font-size:12px; color:var(--success); border-color:var(--success);" onclick="AeroApp.approvePayAdvance('${adv.id}')">Approve</button>
                                <button class="btn btn-outline" style="padding:4px 10px; font-size:12px; color:var(--danger); border-color:var(--danger);" onclick="AeroApp.denyPayAdvance('${adv.id}')">Deny</button>
                            </div>
                        </td>
                    </tr>
                `;
            });

            return `
            <div class="card table-card">
                <div class="section-title" style="padding:20px 24px 0 24px; display:flex; justify-content:space-between; align-items:center;">
                    <span>On-Demand Pay Advance Requests</span>
                    <span class="badge badge-warning" style="font-size:11px;">${pendingAdvances.length} Pending</span>
                </div>
                <div class="table-wrapper">
                    <table class="table-responsive">
                        <thead>
                            <tr>
                                <th style="padding-left:24px;">Employee</th>
                                <th>Classification</th>
                                <th>Request Date</th>
                                <th>Advance Amount</th>
                                <th>Status</th>
                                <th style="text-align:right; padding-right:24px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${advanceRows || '<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text-tertiary);">No pending pay advance requests.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
            `;
        })()}`;
}

// F. Reports & Analytics View
function renderReportsView(state) {
    return `
        <div class="card" style="margin-bottom:24px; padding:24px;">
            <div class="section-title">Report Builder</div>
            <p style="font-size:13px;color:var(--text-secondary);margin-bottom:20px;">Select a report type, apply filters, and generate or export results.</p>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px;">
                <div class="form-group">
                    <label>Report Type</label>
                    <select class="form-control" id="reportType" onchange="AeroApp.generateReport()">
                        <option value="payroll-summary">Payroll Summary</option>
                        <option value="employee-list">Employee List</option>
                        <option value="tax-summary">Tax Summary</option>
                        <option value="pto-report">PTO Report</option>
                        <option value="department-spend">Department Spend</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Department Filter</label>
                    <select class="form-control" id="reportDeptFilter" onchange="AeroApp.generateReport()">
                        <option value="">All Departments</option>
                        ${[...new Set(state.employees.map(e=>e.department))].map(d=>`<option value="${escapeAttr(d)}">${escapeHTML(d)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Classification</label>
                    <select class="form-control" id="reportClassFilter" onchange="AeroApp.generateReport()">
                        <option value="">All</option>
                        <option value="w2">W-2 Employees</option>
                        <option value="1099">1099 Contractors</option>
                    </select>
                </div>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:10px;">
                <button class="btn btn-outline" onclick="AeroApp.exportReportCSV()">
                    <svg style="width:16px;height:16px;margin-right:6px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                    Export CSV
                </button>
                <button class="btn btn-primary" onclick="AeroApp.generateReport()">Generate Report</button>
            </div>
        </div>

        <div class="card table-card" id="reportResultsCard">
            <div class="section-title" style="padding:20px 24px 0 24px;" id="reportTitle">Report Results</div>
            <div class="table-wrapper" id="reportTableContainer">
                <div style="text-align:center;padding:40px;color:var(--text-tertiary);">Select a report type and click Generate</div>
            </div>
        </div>`;
}

// G. Announcements View
function renderAnnouncementsView(state) {
    const priorityColors = { info: 'primary', warning: 'warning', success: 'success', danger: 'danger' };
    const priorityIcons = {
        info: '<path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>',
        warning: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>',
        success: '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>',
        danger: '<path stroke-linecap="round" stroke-linejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path>'
    };

    const announcementCards = [...state.announcements].reverse().map(ann => {
        const color = priorityColors[ann.priority] || 'primary';
        const icon = priorityIcons[ann.priority] || priorityIcons.info;
        return `
            <div class="card announcement-card" style="border-left:4px solid var(--${color});">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                    <div style="display:flex;gap:12px;align-items:flex-start;flex:1;">
                        <div style="width:36px;height:36px;border-radius:50%;background:var(--${color}-light);color:var(--${color});display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                            <svg style="width:18px;height:18px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">${icon}</svg>
                        </div>
                        <div>
                            <div style="font-weight:700;font-size:15px;">${escapeHTML(ann.title)}</div>
                            <div style="font-size:13px;color:var(--text-secondary);margin-top:4px;line-height:1.6;">${escapeHTML(ann.body)}</div>
                            <div style="font-size:11px;color:var(--text-tertiary);margin-top:8px;">Posted by ${escapeHTML(ann.author)} · ${escapeHTML(ann.date)}</div>
                        </div>
                    </div>
                    <button onclick="AeroApp.deleteAnnouncement('${ann.id}')" style="background:none;border:none;color:var(--text-tertiary);cursor:pointer;padding:4px;border-radius:4px;flex-shrink:0;" title="Delete">
                        <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
            </div>`;
    }).join('');

    return `
        <div class="card" style="margin-bottom:24px; padding:24px;">
            <div class="section-title">Post New Announcement</div>
            <form onsubmit="AeroApp.postAnnouncement(event)" style="margin-top:16px;">
                <div style="display:grid;grid-template-columns:1fr auto;gap:12px;margin-bottom:12px;">
                    <input type="text" class="form-control" id="annTitle" placeholder="Announcement title..." required>
                    <select class="form-control" id="annPriority" style="width:150px;">
                        <option value="info">ℹ Info</option>
                        <option value="warning">⚠ Warning</option>
                        <option value="success">✓ Good News</option>
                        <option value="danger">🚨 Urgent</option>
                    </select>
                </div>
                <textarea class="form-control" id="annBody" placeholder="Announcement body..." rows="3" style="resize:vertical;margin-bottom:12px;" required></textarea>
                <div style="display:flex;justify-content:flex-end;">
                    <button type="submit" class="btn btn-primary">Post Announcement</button>
                </div>
            </form>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;" id="announcementsFeed">
            ${announcementCards || '<div class="card" style="text-align:center;padding:40px;color:var(--text-tertiary);">No announcements posted yet</div>'}
        </div>`;
}

// H. Audit Log View
function renderAuditLogView(state) {
    const catColors = { payroll: 'primary', employee: 'success', compliance: 'warning', integration: 'accent-purple', settings: 'danger', system: 'danger' };
    const catIcons = {
        payroll: '<path stroke-linecap="round" stroke-linejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>',
        employee: '<path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>',
        integration: '<path stroke-linecap="round" stroke-linejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path>',
        settings: '<path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>'
    };

    const entries = [...state.auditLog].reverse().map(entry => {
        const color = catColors[entry.category] || 'primary';
        const iconPath = catIcons[entry.category] || catIcons.payroll;
        return `
            <div class="audit-entry">
                <div class="audit-icon" style="background:var(--${color}-light);color:var(--${color});">
                    <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">${iconPath}</svg>
                </div>
                <div class="audit-connector"></div>
                <div class="audit-body card">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                        <div>
                            <div style="font-weight:700;font-size:14px;">${escapeHTML(entry.action)}</div>
                            <div style="font-size:13px;color:var(--text-secondary);margin-top:2px;">${escapeHTML(entry.details)}</div>
                        </div>
                        <div style="text-align:right;flex-shrink:0;margin-left:16px;">
                            <span class="badge badge-${color}" style="font-size:10px;text-transform:capitalize;">${entry.category}</span>
                            <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">${escapeHTML(entry.ts)}</div>
                            <div style="font-size:11px;color:var(--text-tertiary);">${escapeHTML(entry.actor)}</div>
                        </div>
                    </div>
                </div>
            </div>`;
    }).join('');

    return `
        <div style="display:flex;gap:10px;margin-bottom:20px;">
            <div style="position:relative;flex:1;">
                <svg style="position:absolute;left:12px;top:50%;transform:translateY(-50%);width:15px;height:15px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                <input type="text" class="form-control" placeholder="Search audit log..." id="auditSearch" oninput="AeroApp.filterAuditLog()" style="padding-left:38px;">
            </div>
            <select class="form-control" id="auditCatFilter" onchange="AeroApp.filterAuditLog()" style="width:180px;">
                <option value="">All Categories</option>
                <option value="payroll">Payroll</option>
                <option value="employee">Employee</option>
                <option value="integration">Integration</option>
                <option value="settings">Settings</option>
                <option value="compliance">Compliance</option>
            </select>
        </div>
        <div class="audit-timeline" id="auditTimeline">
            ${entries || '<div class="card" style="text-align:center;padding:40px;color:var(--text-tertiary);">No audit entries</div>'}
        </div>`;
}

// I. Employee PTO View
function renderEmployeePTOView(state, employeeId) {
    const employee = state.employees.find(e => e.id === employeeId);
    if (!employee) return '<div class="card">Employee not found.</div>';

    const bal = state.ptoBalances[employeeId] || { vacation: 0, sick: 0, personal: 0 };
    const myRequests = state.ptoRequests.filter(r => r.empId === employeeId);

    const statusColors = { pending: 'warning', approved: 'success', denied: 'danger' };
    let reqRows = myRequests.map(req => `
        <tr>
            <td><span class="badge badge-primary" style="text-transform:capitalize;">${req.type}</span></td>
            <td>${req.startDate} → ${req.endDate}</td>
            <td>${req.hours} hrs</td>
            <td>${escapeHTML(req.reason)}</td>
            <td><span class="badge badge-${statusColors[req.status]||'primary'}" style="text-transform:capitalize;">${req.status}</span></td>
        </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-tertiary);">No requests submitted yet</td></tr>';

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <div class="stat-header"><span class="stat-label">Vacation</span><div class="stat-icon primary"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg></div></div>
                <span class="stat-value">${bal.vacation} hrs</span>
                <span class="stat-trend">${Math.floor(bal.vacation/8)} days available</span>
            </div>
            <div class="card stat-card">
                <div class="stat-header"><span class="stat-label">Sick Leave</span><div class="stat-icon success"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path></svg></div></div>
                <span class="stat-value">${bal.sick} hrs</span>
                <span class="stat-trend">${Math.floor(bal.sick/8)} days available</span>
            </div>
            <div class="card stat-card">
                <div class="stat-header"><span class="stat-label">Personal Days</span><div class="stat-icon warning"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg></div></div>
                <span class="stat-value">${bal.personal} hrs</span>
                <span class="stat-trend">${Math.floor(bal.personal/8)} days available</span>
            </div>
        </div>

        <div class="dashboard-grid">
            <div class="card" style="padding:24px;">
                <div class="section-title">Request Time Off</div>
                <form onsubmit="AeroApp.submitPTORequest(event)" style="margin-top:16px;display:flex;flex-direction:column;gap:14px;">
                    <div class="form-group">
                        <label>Leave Type</label>
                        <select class="form-control" id="ptoType">
                            <option value="vacation">Vacation</option>
                            <option value="sick">Sick Leave</option>
                            <option value="personal">Personal Day</option>
                        </select>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div class="form-group">
                            <label>Start Date</label>
                            <input type="date" class="form-control" id="ptoStart" required>
                        </div>
                        <div class="form-group">
                            <label>End Date</label>
                            <input type="date" class="form-control" id="ptoEnd" required>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Hours Requested</label>
                        <input type="number" class="form-control" id="ptoHours" min="1" max="160" value="8" required>
                    </div>
                    <div class="form-group">
                        <label>Reason (Optional)</label>
                        <textarea class="form-control" id="ptoReason" rows="2" style="resize:vertical;"></textarea>
                    </div>
                    <button type="submit" class="btn btn-primary">Submit Request</button>
                </form>
            </div>
            <div class="card table-card">
                <div class="section-title" style="padding:20px 24px 0 24px;">My Requests</div>
                <div class="table-wrapper">
                    <table class="table-responsive">
                        <thead><tr><th>Type</th><th>Dates</th><th>Hours</th><th>Reason</th><th>Status</th></tr></thead>
                        <tbody>${reqRows}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
}

// J. Employee Benefits View
function renderEmployeeBenefitsView(state, employeeId) {
    const employee = state.employees.find(e => e.id === employeeId);
    if (!employee) return '<div class="card">Employee not found.</div>';

    const b = state.benefits[employeeId] || { healthPlan: 'none', dental: false, vision: false, lifeInsurance: false, fsa: 0 };
    const planDetails = {
        gold:   { name: 'Gold Plan', deductible: '$250', outOfPocket: '$2,000', premium: 520, color: 'warning', coverage: '90%' },
        silver: { name: 'Silver Plan', deductible: '$750', outOfPocket: '$4,500', premium: 280, color: 'primary', coverage: '80%' },
        bronze: { name: 'Bronze Plan', deductible: '$1,500', outOfPocket: '$7,000', premium: 120, color: 'success', coverage: '70%' },
        none:   { name: 'No Health Coverage', deductible: '—', outOfPocket: '—', premium: 0, color: 'danger', coverage: '0%' }
    };
    const plan = planDetails[b.healthPlan] || planDetails.none;
    const totalPremium = plan.premium + (b.dental?35:0) + (b.vision?15:0) + (b.lifeInsurance?20:0);

    return `
        <div class="dashboard-grid">
            <div class="card" style="padding:24px;">
                <div class="section-title">Current Enrollments</div>
                <div style="margin-top:20px;display:flex;flex-direction:column;gap:14px;">
                    <div style="padding:16px;border:2px solid var(--${plan.color});border-radius:var(--radius-md);background:var(--${plan.color === 'warning' ? 'warning' : plan.color}-light);">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <div>
                                <div style="font-weight:800;font-size:16px;">${plan.name}</div>
                                <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">
                                    Deductible: ${plan.deductible} · Out-of-Pocket Max: ${plan.outOfPocket} · Coverage: ${plan.coverage}
                                </div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:20px;font-weight:800;color:var(--primary);">${formatCurrency(plan.premium)}</div>
                                <div style="font-size:11px;color:var(--text-tertiary);">employer/mo</div>
                            </div>
                        </div>
                    </div>
                    ${[
                        { key: 'dental', label: 'Dental Coverage', cost: 35, icon: '🦷' },
                        { key: 'vision', label: 'Vision Coverage', cost: 15, icon: '👁' },
                        { key: 'lifeInsurance', label: 'Life Insurance (2x Salary)', cost: 20, icon: '🛡' }
                    ].map(item => `
                        <div style="padding:12px 16px;border:1px solid var(--border-color);border-radius:var(--radius-md);display:flex;justify-content:space-between;align-items:center;background:var(--bg-secondary);">
                            <div style="display:flex;align-items:center;gap:10px;">
                                <span style="font-size:20px;">${item.icon}</span>
                                <span style="font-weight:600;">${item.label}</span>
                            </div>
                            <span class="badge badge-${b[item.key]?'success':'danger'}">${b[item.key]?'Enrolled — '+formatCurrency(item.cost)+'/mo':'Waived'}</span>
                        </div>`).join('')}
                    <div style="padding:14px 16px;background:var(--bg-tertiary);border-radius:var(--radius-md);display:flex;justify-content:space-between;font-weight:700;">
                        <span>Total Monthly Benefits Premium</span>
                        <span style="color:var(--primary);">${formatCurrency(totalPremium)}/mo</span>
                    </div>
                    <button class="btn btn-primary" onclick="AeroApp.openBenefitsEnrollment('${employeeId}')">Change Elections</button>
                </div>
            </div>
            <div class="card" style="padding:24px;">
                <div class="section-title">FSA / HSA Account</div>
                <div style="margin-top:20px;">
                    <div style="text-align:center;padding:24px;background:var(--primary-light);border-radius:var(--radius-md);margin-bottom:20px;">
                        <div style="font-size:36px;font-weight:800;color:var(--primary);">${formatCurrency(b.fsa * 10)}</div>
                        <div style="font-size:13px;color:var(--text-secondary);margin-top:4px;">Available FSA Balance</div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:10px;font-size:13px;">
                        <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-color);padding-bottom:8px;">
                            <span style="color:var(--text-secondary);">Annual Contribution</span>
                            <span style="font-weight:700;">${formatCurrency(b.fsa * 12)}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-color);padding-bottom:8px;">
                            <span style="color:var(--text-secondary);">Per-Paycheck Deduction</span>
                            <span style="font-weight:700;">${formatCurrency(b.fsa)}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;">
                            <span style="color:var(--text-secondary);">Plan Year Runs Through</span>
                            <span style="font-weight:700;">Dec 31, 2026</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
}

// K. Employee 401k & Roth IRA View with Live Tax & Take-Home Visualizer
function renderEmployee401kView(state, employeeId) {
    const employee = state.employees.find(e => e.id === employeeId);
    if (!employee) return '<div class="card">Employee not found.</div>';

    const rate401k = (employee.benefits && employee.benefits.rate401k) || 0;
    const rateRoth = (employee.benefits && employee.benefits.rateRoth) || 0;
    const annualSalary = employee.type === 'salaried' ? employee.rate : employee.rate * 40 * 52;
    const annualContrib = annualSalary * ((rate401k + rateRoth) / 100);
    const employerMatch = Math.min(annualSalary * (rate401k / 100), annualSalary * 0.04);
    const ytdContrib = annualContrib * 0.45;
    const ytdMatch = employerMatch * 0.45;
    const totalBalance = ytdContrib + ytdMatch + (annualSalary * 0.15);
    const vestingPct = 80;

    const estTaxSavings = (annualSalary * (rate401k / 100) * 0.24).toFixed(0);
    const perCheckDeduction = (annualContrib / 26).toFixed(2);

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <div class="stat-header"><span class="stat-label">Current Balance</span><div class="stat-icon primary"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></div></div>
                <span class="stat-value">${formatCurrency(totalBalance)}</span>
                <span class="stat-trend up">+8.4% YTD return</span>
            </div>
            <div class="card stat-card">
                <div class="stat-header"><span class="stat-label">YTD Contributions</span><div class="stat-icon success"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg></div></div>
                <span class="stat-value">${formatCurrency(ytdContrib)}</span>
                <span class="stat-trend up">+ ${formatCurrency(ytdMatch)} employer match</span>
            </div>
            <div class="card stat-card">
                <div class="stat-header"><span class="stat-label">Est. Annual Tax Savings</span><div class="stat-icon success"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></div></div>
                <span class="stat-value" style="color:var(--success);">$${parseInt(estTaxSavings).toLocaleString()}/yr</span>
                <span class="stat-trend up">Pre-tax sheltering</span>
            </div>
        </div>

        <div class="dashboard-grid" style="grid-template-columns: 1fr 1fr; gap:24px;">
            <div class="card" style="padding:24px;">
                <div class="section-title" style="margin-bottom:16px;">📈 Interactive 401(k) Contribution Slider</div>
                <p style="font-size:13px; color:var(--text-secondary); margin-bottom:20px;">Adjust your contribution percentages in real time to see instant projected tax savings and take-home pay impact.</p>

                <div class="form-group" style="margin-bottom:20px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                        <label style="font-weight:600;">Pre-Tax Traditional 401(k)</label>
                        <span id="rate401kDisplay" style="font-weight:700; color:var(--primary); font-size:16px;">${rate401k}%</span>
                    </div>
                    <input type="range" id="slider401k" min="0" max="25" step="1" value="${rate401k}" oninput="AeroApp.updateRetirementPreview('${employeeId}', ${annualSalary})" style="width:100%;" />
                    <div style="font-size:11px; color:var(--text-tertiary); margin-top:4px;">Lowers current taxable income immediately.</div>
                </div>

                <div class="form-group" style="margin-bottom:24px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                        <label style="font-weight:600;">Post-Tax Roth 401(k)</label>
                        <span id="rateRothDisplay" style="font-weight:700; color:var(--success); font-size:16px;">${rateRoth}%</span>
                    </div>
                    <input type="range" id="sliderRoth" min="0" max="25" step="1" value="${rateRoth}" oninput="AeroApp.updateRetirementPreview('${employeeId}', ${annualSalary})" style="width:100%;" />
                    <div style="font-size:11px; color:var(--text-tertiary); margin-top:4px;">Grows 100% tax-free at retirement withdrawal.</div>
                </div>

                <button class="btn btn-primary" style="width:100%; font-size:13px;" onclick="AeroApp.saveRetirementContribution('${employeeId}')">Save Contribution Rates 🚀</button>
            </div>

            <div class="card" style="padding:24px; background:var(--bg-secondary);">
                <div class="section-title" style="margin-bottom:16px;">💵 Real-Time Take-Home Pay Impact</div>
                
                <div style="display:flex; flex-direction:column; gap:12px; font-size:13px;">
                    <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding-bottom:8px;">
                        <span style="color:var(--text-secondary);">Gross Salary</span>
                        <span style="font-weight:600;">${formatCurrency(annualSalary)}/yr</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding-bottom:8px;">
                        <span style="color:var(--text-secondary);">Per-Paycheck Deduction</span>
                        <span id="previewDeduction" style="font-weight:700; color:var(--primary);">$${perCheckDeduction}/check</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding-bottom:8px;">
                        <span style="color:var(--text-secondary);">Employer 4% Match (Free Money)</span>
                        <span style="font-weight:700; color:var(--success);">${formatCurrency(employerMatch)}/yr</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding-bottom:8px;">
                        <span style="color:var(--text-secondary);">Estimated Tax Savings</span>
                        <span id="previewTaxSavings" style="font-weight:700; color:var(--success);">$${parseInt(estTaxSavings).toLocaleString()}/yr</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; padding-top:4px;">
                        <span style="color:var(--text-secondary);">2026 IRS Maximum Limit</span>
                        <span style="font-weight:600;">$23,500</span>
                    </div>
                </div>
            </div>
        </div>`;
}

function renderHelpDocsView(state) {
    const company = state?.settings?.companyName || 'your company';
    const sections = [
        {
            id: 'getting-started',
            title: 'Getting started',
            body: `
                <ol style="margin:0;padding-left:18px;line-height:1.7;font-size:14px;color:var(--text-secondary);">
                    <li>Complete company setup (legal name, EIN, funding bank).</li>
                    <li>Subscribe on the billing banner if prompted.</li>
                    <li>Open <a href="#" onclick="event.preventDefault();AeroApp.navigateTo('settings');" style="color:var(--primary);font-weight:600;">Settings</a> and start Stripe Connect onboarding for ACH.</li>
                    <li>Add employees under <a href="#" onclick="event.preventDefault();AeroApp.navigateTo('employees');" style="color:var(--primary);font-weight:600;">Employees</a> or <a href="#" onclick="event.preventDefault();AeroApp.navigateTo('onboarding');" style="color:var(--primary);font-weight:600;">Onboarding</a>.</li>
                    <li>Run payroll when ready — submit for approval before ACH fires.</li>
                </ol>`
        },
        {
            id: 'payroll',
            title: 'Running payroll',
            body: `
                <p style="font-size:14px;color:var(--text-secondary);margin:0 0 12px;line-height:1.6;">Use <strong>Run Payroll</strong> for a three-step cycle: enter hours → review taxes → submit.</p>
                <ul style="margin:0;padding-left:18px;line-height:1.7;font-size:14px;color:var(--text-secondary);">
                    <li>Hourly staff pull hours from Time Tracking; salaried staff use period rates.</li>
                    <li>Submit sends the run to <a href="#" onclick="event.preventDefault();AeroApp.navigateTo('approvals');" style="color:var(--primary);font-weight:600;">Approvals</a> as pending.</li>
                    <li>Approve a run to mark it completed and initiate ACH for linked bank accounts.</li>
                    <li>History and pay stubs live on the Dashboard and employee portal.</li>
                </ul>`
        },
        {
            id: 'ach-connect',
            title: 'ACH & Stripe Connect',
            body: `
                <p style="font-size:14px;color:var(--text-secondary);margin:0 0 12px;line-height:1.6;">GlidePay uses Stripe Connect + Treasury to pay employees via ACH.</p>
                <ul style="margin:0;padding-left:18px;line-height:1.7;font-size:14px;color:var(--text-secondary);">
                    <li>Settings → <strong>Start / Continue Stripe Onboarding</strong> (KYB for ${company}).</li>
                    <li>Status flow: Onboarding Required → Under Review → Active.</li>
                    <li>If status looks stuck, use <strong>Refresh Status</strong> after returning from Stripe.</li>
                    <li>Employees link their own bank accounts from the employee portal.</li>
                    <li>New employee bank accounts may have a short security hold before the first transfer.</li>
                </ul>`
        },
        {
            id: 'employees',
            title: 'Employees & onboarding',
            body: `
                <ul style="margin:0;padding-left:18px;line-height:1.7;font-size:14px;color:var(--text-secondary);">
                    <li>W-2 vs 1099 classification drives tax withholding and forms.</li>
                    <li>Set pay type (hourly/salaried), frequency, state, and benefits on each profile.</li>
                    <li>Onboarding tracks new-hire steps and document collection.</li>
                    <li>Use <strong>Invite to Portal</strong> on an employee to email a sign-in link and enable My Dashboard / time / pay stubs.</li>
                    <li>Garnishments and pay advances are managed from employee records / Approvals.</li>
                </ul>`
        },
        {
            id: 'tax',
            title: 'Tax & compliance',
            body: `
                <ul style="margin:0;padding-left:18px;line-height:1.7;font-size:14px;color:var(--text-secondary);">
                    <li><a href="#" onclick="event.preventDefault();AeroApp.navigateTo('tax-compliance');" style="color:var(--primary);font-weight:600;">Tax Compliance</a> covers Form 941, W-2, and 1099 previews.</li>
                    <li>You can mark filings as filed manually, or transmit when an e-file provider is connected.</li>
                    <li>Employees can view/sign W-2s from their Documents area.</li>
                </ul>`
        },
        {
            id: 'billing',
            title: 'Billing & plans',
            body: `
                <ul style="margin:0;padding-left:18px;line-height:1.7;font-size:14px;color:var(--text-secondary);">
                    <li>GlidePay bills a base subscription plus per-seat pricing.</li>
                    <li>Use the billing banner to start Checkout or open the customer portal.</li>
                    <li>ACH Connect onboarding is separate from subscription billing.</li>
                </ul>`
        },
        {
            id: 'support',
            title: 'Support',
            body: `
                <p style="font-size:14px;color:var(--text-secondary);margin:0 0 8px;line-height:1.6;">Need help with ${company}'s account?</p>
                <ul style="margin:0;padding-left:18px;line-height:1.7;font-size:14px;color:var(--text-secondary);">
                    <li>Email <a href="mailto:support@glidepay.org" style="color:var(--primary);font-weight:600;">support@glidepay.org</a></li>
                    <li>Review the <a href="#" onclick="event.preventDefault();AeroApp.navigateTo('audit-log');" style="color:var(--primary);font-weight:600;">Audit Log</a> for recent system actions.</li>
                    <li>Legal: <a href="#" onclick="event.preventDefault();AeroApp.navigateTo('privacy-policy');" style="color:var(--primary);font-weight:600;">Privacy Policy</a> · <a href="#" onclick="event.preventDefault();AeroApp.navigateTo('terms-of-service');" style="color:var(--primary);font-weight:600;">Terms of Service</a></li>
                </ul>`
        },
    ];

    const toc = sections.map(s => `
        <a href="#help-${s.id}" style="display:block;padding:8px 0;font-size:13px;font-weight:600;color:var(--primary);text-decoration:none;border-bottom:1px solid var(--border-color);">
            ${s.title}
        </a>`).join('');

    const articles = sections.map(s => `
        <div class="card" id="help-${s.id}" style="padding:24px;margin-bottom:16px;scroll-margin-top:24px;">
            <div class="section-title" style="margin-bottom:12px;">${s.title}</div>
            ${s.body}
        </div>`).join('');

    return `
        <div class="help-docs-layout" style="display:grid;grid-template-columns:minmax(200px,240px) 1fr;gap:24px;align-items:start;">
            <div class="card help-docs-toc" style="padding:20px 24px;position:sticky;top:16px;">
                <div class="section-title" style="margin-bottom:8px;">Topics</div>
                <p style="font-size:12px;color:var(--text-tertiary);margin:0 0 8px;">Jump to a guide</p>
                ${toc}
            </div>
            <div>
                <div class="card" style="padding:24px;margin-bottom:16px;background:linear-gradient(135deg, rgba(79,70,229,0.06), rgba(14,165,233,0.06));border:1px solid var(--border-color);">
                    <div class="section-title" style="margin-bottom:8px;">GlidePay Help Center</div>
                    <p style="font-size:14px;color:var(--text-secondary);margin:0;line-height:1.6;">
                        Short guides for the screens you use every pay cycle. Prefer email? Reach us at
                        <a href="mailto:support@glidepay.org" style="color:var(--primary);font-weight:600;">support@glidepay.org</a>.
                    </p>
                </div>
                ${articles}
            </div>
        </div>`;
}

// G. Accountant & Multi-Company Firm Switchboard
function renderAccountantPortalView(state) {
    const companies = state.managedCompanies || [];
    let rows = '';
    companies.forEach(c => {
        const isCurrent = c.id === state.settings?.companyId;
        rows += `
            <tr>
                <td style="font-weight:600;">${escapeHTML(c.name)}</td>
                <td>${escapeHTML(c.ein || 'Pending')}</td>
                <td><span class="badge ${c.stripeStatus === 'active' ? 'badge-success' : 'badge-warning'}">${c.stripeStatus === 'active' ? 'ACH Active' : 'Setup Required'}</span></td>
                <td><span class="badge badge-info" style="text-transform:capitalize;">${escapeHTML(c.role)}</span></td>
                <td style="text-align:right;">
                    ${isCurrent ? '<span class="badge badge-success">Current Firm</span>' : `
                        <button class="btn btn-outline" style="padding:4px 12px; font-size:12px;" onclick="AeroApp.switchCompany('${c.id}')">Switch Organization</button>
                    `}
                </td>
            </tr>
        `;
    });

    return `
        <div class="card" style="padding:32px; margin-bottom:24px; background:linear-gradient(135deg, rgba(79,70,229,0.06), rgba(14,165,233,0.06)); border:1px solid var(--border-color);">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
                <div>
                    <div class="section-title" style="margin-bottom:4px;">Accountant & CPA Firm Portal</div>
                    <p style="font-size:14px; color:var(--text-secondary); margin:0;">Switch between all client organizations and manage multi-company payroll seamlessly.</p>
                </div>
                <button class="btn btn-primary" onclick="AeroApp.promptRegisterNewClientCompany()">+ Add Client Company</button>
            </div>
        </div>

        <div class="card table-card">
            <div class="section-title" style="padding:20px 24px 0 24px;">Managed Client Companies (${companies.length})</div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>Company Name</th><th>EIN</th><th>Payout Status</th><th>Your Role</th><th style="text-align:right;">Action</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-tertiary);">No additional client companies linked yet.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    `;
}

// H. Digital Onboarding: Form W-9 & Form I-9
function renderOnboardingFormsView(state) {
    const contractors = (state.employees || []).filter(e => e.classification === '1099');
    const w2Employees = (state.employees || []).filter(e => e.classification !== '1099');
    const w9Map = state.w9Records || {};
    const i9Map = state.i9Records || {};

    let w9Rows = '';
    contractors.forEach(c => {
        const hasW9 = !!w9Map[c.id];
        w9Rows += `
            <tr>
                <td style="font-weight:600;">${escapeHTML(c.name)}</td>
                <td>1099 Contractor</td>
                <td>${escapeHTML(c.email)}</td>
                <td><span class="badge ${hasW9 ? 'badge-success' : 'badge-warning'}">${hasW9 ? 'W-9 Signed ✓' : 'W-9 Pending'}</span></td>
                <td style="text-align:right;">
                    <button class="btn btn-outline" style="padding:4px 10px; font-size:12px;" onclick="AeroApp.openW9Modal('${c.id}')">${hasW9 ? 'View W-9' : 'Fill / Sign W-9'}</button>
                </td>
            </tr>
        `;
    });

    let i9Rows = '';
    w2Employees.forEach(e => {
        const hasI9 = !!i9Map[e.id];
        i9Rows += `
            <tr>
                <td style="font-weight:600;">${escapeHTML(e.name)}</td>
                <td>W-2 Employee</td>
                <td>${escapeHTML(e.department || 'General')}</td>
                <td><span class="badge ${hasI9 ? 'badge-success' : 'badge-warning'}">${hasI9 ? 'I-9 Verified ✓' : 'I-9 Incomplete'}</span></td>
                <td style="text-align:right;">
                    <button class="btn btn-outline" style="padding:4px 10px; font-size:12px;" onclick="AeroApp.openI9Modal('${e.id}')">${hasI9 ? 'View I-9' : 'Verify I-9'}</button>
                </td>
            </tr>
        `;
    });

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">Contractor W-9 Forms</span>
                <span class="stat-value">${Object.keys(w9Map).length} / ${contractors.length}</span>
                <span class="stat-trend ${Object.keys(w9Map).length === contractors.length ? 'up' : ''}">Verified TINs</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Employee I-9 Verifications</span>
                <span class="stat-value">${Object.keys(i9Map).length} / ${w2Employees.length}</span>
                <span class="stat-trend ${Object.keys(i9Map).length === w2Employees.length ? 'up' : ''}">Compliant records</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Federal Compliance Status</span>
                <span class="stat-value" style="color:var(--success);">100% Active</span>
                <span class="stat-trend up">Audit ready</span>
            </div>
        </div>

        <div class="card table-card" style="margin-bottom:24px;">
            <div class="section-title" style="padding:20px 24px 0 24px;">Contractor Form W-9 Collection (1099-NEC)</div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>Contractor</th><th>Type</th><th>Email</th><th>W-9 Status</th><th style="text-align:right;">Action</th></tr></thead>
                    <tbody>${w9Rows || '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-tertiary);">No 1099 contractors in this organization.</td></tr>'}</tbody>
                </table>
            </div>
        </div>

        <div class="card table-card">
            <div class="section-title" style="padding:20px 24px 0 24px;">Employee Form I-9 Eligibility Verification (W-2)</div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>Employee</th><th>Type</th><th>Department</th><th>I-9 Status</th><th style="text-align:right;">Action</th></tr></thead>
                    <tbody>${i9Rows || '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-tertiary);">No W-2 employees found.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    `;
}

// I. GPS Mobile Time Clock & Tablet Kiosk
function renderTimeClockView(state) {
    const punches = state.timePunches || [];
    let punchRows = '';
    punches.slice(0, 15).forEach(p => {
        const emp = (state.employees || []).find(e => e.id === p.employeeId);
        const typeLabels = {
            clock_in: { label: 'Clock In', color: 'success' },
            meal_start: { label: 'Meal Break Start', color: 'warning' },
            meal_end: { label: 'Meal Break End', color: 'info' },
            clock_out: { label: 'Clock Out', color: 'danger' }
        };
        const t = typeLabels[p.type] || { label: p.type, color: 'primary' };
        punchRows += `
            <tr>
                <td style="font-weight:600;">${escapeHTML(emp ? emp.name : 'Worker')}</td>
                <td><span class="badge badge-${t.color}">${t.label}</span></td>
                <td>${new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} (${new Date(p.timestamp).toLocaleDateString()})</td>
                <td>📍 ${escapeHTML(p.address || (p.latitude ? `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}` : 'On-Site'))}</td>
                <td><span class="badge badge-info" style="text-transform:capitalize;">${escapeHTML(p.device || 'mobile')}</span></td>
            </tr>
        `;
    });

    return `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:24px; margin-bottom:24px;">
            <div class="card" style="padding:28px; display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                    <div class="section-title" style="margin-bottom:8px;">📍 GPS Mobile Punch Clock</div>
                    <p style="font-size:13px; color:var(--text-secondary); margin-bottom:20px;">Workers clock in and out with live geolocation coordinates and photo verification.</p>
                </div>
                <div style="display:flex; gap:12px; flex-wrap:wrap;">
                    <button class="btn btn-success" style="flex:1;" onclick="AeroApp.handleMobilePunch('clock_in')">🟢 Clock In (GPS)</button>
                    <button class="btn btn-warning" style="flex:1;" onclick="AeroApp.handleMobilePunch('meal_start')">☕ Meal Break</button>
                    <button class="btn btn-danger" style="flex:1;" onclick="AeroApp.handleMobilePunch('clock_out')">🔴 Clock Out</button>
                </div>
            </div>

            <div class="card" style="padding:28px; background:linear-gradient(135deg, rgba(16,185,129,0.06), rgba(79,70,229,0.06)); border:1px solid var(--border-color); display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                    <div class="section-title" style="margin-bottom:8px;">📟 Tablet Breakroom Kiosk</div>
                    <p style="font-size:13px; color:var(--text-secondary); margin-bottom:16px;">Launch a dedicated full-screen PIN-entry time clock for communal breakrooms and job trailers.</p>
                </div>
                <button class="btn btn-primary" onclick="AeroApp.launchTabletKiosk()">🚀 Launch Breakroom Kiosk Mode</button>
            </div>
        </div>

        <div class="card table-card">
            <div class="section-title" style="padding:20px 24px 0 24px;">Live Time Punches (GPS Verified)</div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>Employee</th><th>Punch Event</th><th>Timestamp</th><th>Location</th><th>Device</th></tr></thead>
                    <tbody>${punchRows || '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-tertiary);">No punches logged today.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    `;
}

// Tablet Kiosk Fullscreen Interface
function renderTabletKioskView(state) {
    return `
        <div style="max-width:480px; margin:40px auto; padding:36px; background:var(--bg-card); border:1px solid var(--border-color); border-radius:var(--radius-lg); box-shadow:var(--shadow-lg); text-align:center;">
            <h2 style="font-family:var(--font-heading); margin-bottom:8px;">🏢 Breakroom Time Clock</h2>
            <p style="font-size:13px; color:var(--text-secondary); margin-bottom:24px;">Enter your 4-digit Employee PIN to punch in or out.</p>
            
            <input type="password" id="kioskPinInput" maxlength="4" style="font-size:32px; letter-spacing:12px; text-align:center; width:200px; padding:12px; border:2px solid var(--primary); border-radius:var(--radius-md); margin-bottom:24px;" placeholder="••••" />

            <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:12px; max-width:280px; margin:0 auto 24px auto;">
                ${[1,2,3,4,5,6,7,8,9,'C',0,'⌫'].map(btn => `
                    <button class="btn btn-secondary" style="font-size:20px; font-weight:700; padding:14px 0;" onclick="AeroApp.kioskKeypadPress('${btn}')">${btn}</button>
                `).join('')}
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
                <button class="btn btn-success" style="padding:14px; font-size:15px;" onclick="AeroApp.submitKioskPunch('clock_in')">Clock In</button>
                <button class="btn btn-danger" style="padding:14px; font-size:15px;" onclick="AeroApp.submitKioskPunch('clock_out')">Clock Out</button>
            </div>
            <div style="margin-top:20px;">
                <button class="btn btn-outline" style="font-size:12px;" onclick="AeroApp.navigateTo('time-tracking')">Exit Kiosk Mode</button>
            </div>
        </div>
    `;
}

// J. Pay-As-You-Go Workers' Compensation
function renderWorkersCompView(state) {
    const rates = state.workersCompRates || DEFAULT_WORKERS_COMP_RATES;
    const employees = state.employees || [];

    let rows = '';
    let totalEstPremium = 0;
    employees.forEach(emp => {
        const grossEst = emp.type === 'salaried' ? (emp.rate / 26) : (emp.rate * 80);
        const comp = calculateWorkersComp(emp, grossEst, rates);
        totalEstPremium += comp.premium;
        rows += `
            <tr>
                <td style="font-weight:600;">${escapeHTML(emp.name)}</td>
                <td><code>${escapeHTML(comp.classCode)}</code></td>
                <td>${escapeHTML(comp.title)}</td>
                <td>$${comp.ratePerHundred.toFixed(2)} / $100</td>
                <td>${formatCurrency(grossEst)}</td>
                <td style="font-weight:700; color:var(--primary);">${formatCurrency(comp.premium)}</td>
            </tr>
        `;
    });

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">Estimated Premium (Per Run)</span>
                <span class="stat-value">${formatCurrency(totalEstPremium)}</span>
                <span class="stat-trend up">Pay-as-you-go</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Active Risk Class Codes</span>
                <span class="stat-value">${Object.keys(rates).length}</span>
                <span class="stat-trend">State mapped</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Carrier Audit Status</span>
                <span class="stat-value" style="color:var(--success);">Verified</span>
                <span class="stat-trend up">No annual lump-sum</span>
            </div>
        </div>

        <div class="card table-card" style="margin-bottom:24px;">
            <div class="section-title" style="padding:20px 24px 0 24px; display:flex; justify-content:space-between; align-items:center;">
                <span>Pay-As-You-Go Employee Class Code Breakdown</span>
                <button class="btn btn-outline" style="font-size:12px;" onclick="AeroApp.exportWorkersCompLedger()">Export Carrier Audit CSV</button>
            </div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>Employee</th><th>Code</th><th>Classification Title</th><th>Rate per $100</th><th>Est. Cycle Wages</th><th>Est. Premium</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text-tertiary);">No employee records found.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    `;
}

// K. Smart Expense & Mileage Tracker
function renderExpensesView(state) {
    const expenses = state.expenses || [];
    let rows = '';
    expenses.forEach(exp => {
        const statusColors = { pending: 'warning', approved: 'success', denied: 'danger' };
        rows += `
            <tr>
                <td style="font-weight:600;">${escapeHTML(exp.employeeName)}</td>
                <td><span class="badge badge-info">${escapeHTML(exp.category)}</span></td>
                <td>${escapeHTML(exp.description)}</td>
                <td>${exp.miles > 0 ? `${exp.miles} mi ($0.67/mi)` : '—'}</td>
                <td style="font-weight:700; color:var(--success);">${formatCurrency(exp.amount)}</td>
                <td><span class="badge badge-${statusColors[exp.status] || 'primary'}" style="text-transform:capitalize;">${escapeHTML(exp.status)}</span></td>
                <td style="text-align:right;">
                    ${exp.status === 'pending' ? `
                        <div style="display:flex; gap:6px; justify-content:flex-end;">
                            <button class="btn btn-outline" style="padding:3px 8px; font-size:11px; color:var(--success); border-color:var(--success);" onclick="AeroApp.approveExpenseItem('${exp.id}')">Approve</button>
                            <button class="btn btn-outline" style="padding:3px 8px; font-size:11px; color:var(--danger); border-color:var(--danger);" onclick="AeroApp.denyExpenseItem('${exp.id}')">Deny</button>
                        </div>
                    ` : '<span style="font-size:12px; color:var(--text-tertiary);">Processed</span>'}
                </td>
            </tr>
        `;
    });

    const pendingTotal = expenses.filter(e => e.status === 'pending').reduce((s, e) => s + e.amount, 0);
    const approvedTotal = expenses.filter(e => e.status === 'approved').reduce((s, e) => s + e.amount, 0);

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">Pending Reimbursements</span>
                <span class="stat-value">${formatCurrency(pendingTotal)}</span>
                <span class="stat-trend" style="color:var(--warning);">${expenses.filter(e => e.status === 'pending').length} pending approval</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Approved for Next Payroll</span>
                <span class="stat-value">${formatCurrency(approvedTotal)}</span>
                <span class="stat-trend up">Tax-free additions</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">2026 IRS Mileage Rate</span>
                <span class="stat-value">$0.67 / mi</span>
                <span class="stat-trend up">Standard IRS rate</span>
            </div>
        </div>

        <div class="card table-card">
            <div class="section-title" style="padding:20px 24px 0 24px; display:flex; justify-content:space-between; align-items:center;">
                <span>Expense & Mileage Reimbursement Queue</span>
                <button class="btn btn-primary" style="font-size:12px;" onclick="AeroApp.openSubmitExpenseModal()">+ Submit New Expense</button>
            </div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>Employee</th><th>Category</th><th>Description</th><th>Mileage</th><th>Amount</th><th>Status</th><th style="text-align:right;">Actions</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text-tertiary);">No expenses submitted.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    `;
}

// L. Visual Interactive Org Chart
function renderOrgChartView(state) {
    const employees = state.employees || [];
    const depts = {};
    employees.forEach(emp => {
        const d = emp.department || 'General & Administration';
        depts[d] = depts[d] || [];
        depts[d].push(emp);
    });

    let deptBlocks = '';
    Object.entries(depts).forEach(([deptName, members]) => {
        let memberCards = '';
        members.forEach(m => {
            const initials = m.name.split(' ').map(n=>n[0]).join('');
            memberCards += `
                <div class="card" style="padding:16px; min-width:220px; border-left:4px solid var(--primary); background:var(--bg-card); box-shadow:var(--shadow-sm); transition:transform 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'">
                    <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
                        <div class="avatar" style="width:36px; height:36px; font-size:13px; font-weight:700;">${escapeHTML(initials)}</div>
                        <div>
                            <div style="font-weight:700; font-size:14px;">${escapeHTML(m.name)}</div>
                            <div style="font-size:12px; color:var(--text-tertiary);">${escapeHTML(m.role || 'Team Member')}</div>
                        </div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--text-secondary); padding-top:8px; border-top:1px solid var(--border-color);">
                        <span class="badge badge-info" style="font-size:10px;">${escapeHTML(m.classification.toUpperCase())}</span>
                        <span>📍 ${escapeHTML(m.state || 'CA')}</span>
                    </div>
                </div>
            `;
        });

        deptBlocks += `
            <div style="margin-bottom:32px;">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px;">
                    <div style="width:10px; height:10px; border-radius:50%; background:var(--primary);"></div>
                    <h3 style="margin:0; font-size:16px; font-weight:700;">${escapeHTML(deptName)} (${members.length})</h3>
                </div>
                <div style="display:flex; gap:16px; flex-wrap:wrap;">
                    ${memberCards}
                </div>
            </div>
        `;
    });

    return `
        <div class="card" style="padding:24px; margin-bottom:24px; background:linear-gradient(135deg, rgba(79,70,229,0.06), rgba(14,165,233,0.06)); border:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
                <div class="section-title" style="margin-bottom:4px;">Organizational Hierarchy & Team Map</div>
                <p style="font-size:13px; color:var(--text-secondary); margin:0;">Visual department reporting structure, spans of control, and headcount distribution.</p>
            </div>
            <div style="display:flex; gap:12px;">
                <button class="btn btn-outline" onclick="AeroApp.navigateTo('directory')">List View</button>
                <button class="btn btn-primary" onclick="AeroApp.openAddEmployeeModal()">+ Add Team Member</button>
            </div>
        </div>

        <div style="padding:12px 0;">
            ${deptBlocks || '<div class="card" style="padding:40px; text-align:center; color:var(--text-tertiary);">No employees in organization.</div>'}
        </div>
    `;
}

// M. Global Contractors & Form W-8BEN (50+ Countries)
function renderGlobalContractorsView(state) {
    const contractors = (state.employees || []).filter(e => e.classification === '1099');
    const currencies = {
        'EUR': { symbol: '€', rate: 0.92, name: 'Euro' },
        'GBP': { symbol: '£', rate: 0.78, name: 'British Pound' },
        'CAD': { symbol: 'CA$', rate: 1.36, name: 'Canadian Dollar' },
        'MXN': { symbol: 'MX$', rate: 18.10, name: 'Mexican Peso' },
        'AUD': { symbol: 'A$', rate: 1.52, name: 'Australian Dollar' },
        'INR': { symbol: '₹', rate: 83.50, name: 'Indian Rupee' },
    };
    const w8benMap = state.w8benRecords || {};

    let rows = '';
    contractors.forEach(c => {
        const hasW8 = !!w8benMap[c.id];
        const curr = currencies[c.currency || 'EUR'] || currencies['EUR'];
        const converted = ((c.rate || 45) * 80 * curr.rate).toFixed(2);
        rows += `
            <tr>
                <td style="font-weight:600;">${escapeHTML(c.name)}</td>
                <td>${escapeHTML(c.country || 'United Kingdom')}</td>
                <td><span class="badge badge-info">${curr.symbol} ${curr.name}</span></td>
                <td>$${c.rate || 45}/hr USD (≈ ${curr.symbol}${converted} / bi-wk)</td>
                <td><span class="badge ${hasW8 ? 'badge-success' : 'badge-warning'}">${hasW8 ? 'W-8BEN Certified ✓' : 'W-8BEN Pending'}</span></td>
                <td style="text-align:right;">
                    <button class="btn btn-outline" style="padding:4px 10px; font-size:12px;" onclick="AeroApp.openW8BENModal('${c.id}')">${hasW8 ? 'View W-8BEN' : 'Certify W-8BEN'}</button>
                </td>
            </tr>
        `;
    });

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">Cross-Border Rails</span>
                <span class="stat-value">50+ Countries</span>
                <span class="stat-trend up">Stripe Global Payouts</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Supported Currencies</span>
                <span class="stat-value">EUR, GBP, CAD, MXN, AUD, INR</span>
                <span class="stat-trend up">Real-time FX lock</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">IRS Form W-8BEN Status</span>
                <span class="stat-value">${Object.keys(w8benMap).length} / ${contractors.length}</span>
                <span class="stat-trend ${Object.keys(w8benMap).length === contractors.length ? 'up' : ''}">Tax Treaty Compliant</span>
            </div>
        </div>

        <div class="card table-card">
            <div class="section-title" style="padding:20px 24px 0 24px;">International Contractor Roster (Cross-Border Payouts)</div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>Contractor</th><th>Country</th><th>Payout Currency</th><th>Comp Rate (Local FX)</th><th>Tax Treaty Status</th><th style="text-align:right;">Action</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text-tertiary);">No international contractors configured.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    `;
}

// N. Custom Company Documents & E-Sign Workflows
function renderCompanyDocumentsView(state) {
    const docs = state.companyDocs || [];
    let rows = '';
    docs.forEach(d => {
        const isComplete = d.signedCount >= d.totalCount;
        rows += `
            <tr>
                <td style="font-weight:600;">📄 ${escapeHTML(d.title)}</td>
                <td><span class="badge badge-info">${escapeHTML(d.category)}</span></td>
                <td>${escapeHTML(d.requiredFor)}</td>
                <td>${escapeHTML(d.publishedAt)}</td>
                <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-weight:700;">${d.signedCount} / ${d.totalCount}</span>
                        <div style="flex:1; height:6px; background:var(--border-color); border-radius:3px; overflow:hidden; min-width:60px;">
                            <div style="height:100%; width:${(d.signedCount / d.totalCount) * 100}%; background:var(--${isComplete ? 'success' : 'primary'});"></div>
                        </div>
                    </div>
                </td>
                <td style="text-align:right;">
                    <button class="btn btn-outline" style="padding:4px 10px; font-size:12px;" onclick="AeroApp.openSignDocumentModal('${d.id}')">Review &amp; E-Sign</button>
                </td>
            </tr>
        `;
    });

    return `
        <div class="card" style="padding:24px; margin-bottom:24px; background:linear-gradient(135deg, rgba(79,70,229,0.06), rgba(16,185,129,0.06)); border:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
                <div class="section-title" style="margin-bottom:4px;">Company Policies &amp; E-Signature Center</div>
                <p style="font-size:13px; color:var(--text-secondary); margin:0;">Distribute employee handbooks, NDAs, and remote work agreements with legally-binding electronic signatures.</p>
            </div>
            <button class="btn btn-primary" onclick="AeroApp.promptUploadCompanyDocument()">+ Add Policy Document</button>
        </div>

        <div class="card table-card">
            <div class="section-title" style="padding:20px 24px 0 24px;">Required Company Documents (${docs.length})</div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>Document Title</th><th>Category</th><th>Assigned To</th><th>Published</th><th>Completion Status</th><th style="text-align:right;">Action</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text-tertiary);">No policy documents uploaded.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    `;
}

// O. Performance Reviews, 1-on-1s & OKR Goal Tracking
function renderPerformanceReviewsView(state) {
    const goals = state.goals || [];
    const reviews = state.reviews || [];

    let goalRows = '';
    goals.forEach(g => {
        goalRows += `
            <tr>
                <td style="font-weight:600;">${escapeHTML(g.empName)}</td>
                <td>${escapeHTML(g.title)}</td>
                <td><span class="badge badge-info">${escapeHTML(g.quarter)}</span></td>
                <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-weight:700; width:35px;">${g.progress}%</span>
                        <div style="flex:1; height:6px; background:var(--border-color); border-radius:3px; overflow:hidden; min-width:80px;">
                            <div style="height:100%; width:${g.progress}%; background:var(--${g.progress >= 100 ? 'success' : 'primary'});"></div>
                        </div>
                    </div>
                </td>
                <td><span class="badge badge-${g.progress >= 100 ? 'success' : 'warning'}">${g.progress >= 100 ? 'Achieved ✓' : 'In Progress'}</span></td>
            </tr>
        `;
    });

    let reviewRows = '';
    reviews.forEach(r => {
        reviewRows += `
            <tr>
                <td style="font-weight:600;">${escapeHTML(r.empName)}</td>
                <td>${escapeHTML(r.cycle)}</td>
                <td>${escapeHTML(r.reviewer)}</td>
                <td style="font-weight:700; color:var(--warning);">⭐ ${r.rating} / 5.0</td>
                <td>${r.meritRaiseProposed ? `+$${r.meritRaiseProposed.toLocaleString()}/yr` : '—'}</td>
                <td style="text-align:right;">
                    ${r.meritRaiseProposed ? `
                        <button class="btn btn-outline" style="padding:3px 8px; font-size:11px; color:var(--success); border-color:var(--success);" onclick="AeroApp.applyMeritRaise('${r.empId}', ${r.meritRaiseProposed})">Apply Merit Wage Sync</button>
                    ` : '<span style="font-size:12px; color:var(--text-tertiary);">Recorded</span>'}
                </td>
            </tr>
        `;
    });

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">Active Team OKRs</span>
                <span class="stat-value">${goals.length} Goals</span>
                <span class="stat-trend up">Q3 Objectives</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Completed Reviews</span>
                <span class="stat-value">${reviews.length} Evaluated</span>
                <span class="stat-trend up">360° Review Cycle</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Merit Salary Link</span>
                <span class="stat-value" style="color:var(--success);">Automated</span>
                <span class="stat-trend up">Direct payroll sync</span>
            </div>
        </div>

        <div class="card table-card" style="margin-bottom:24px;">
            <div class="section-title" style="padding:20px 24px 0 24px; display:flex; justify-content:space-between; align-items:center;">
                <span>Quarterly Goal &amp; OKR Progress Tracker</span>
                <button class="btn btn-primary" style="font-size:12px;" onclick="AeroApp.openAddGoalModal()">+ Create Employee OKR</button>
            </div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>Employee</th><th>Objective</th><th>Quarter</th><th>Progress</th><th>Status</th></tr></thead>
                    <tbody>${goalRows || '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-tertiary);">No goals tracked yet.</td></tr>'}</tbody>
                </table>
            </div>
        </div>

        <div class="card table-card">
            <div class="section-title" style="padding:20px 24px 0 24px; display:flex; justify-content:space-between; align-items:center;">
                <span>Performance Review Cycles &amp; Merit Raises</span>
                <button class="btn btn-outline" style="font-size:12px;" onclick="AeroApp.openSubmitReviewModal()">+ Record Review</button>
            </div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>Employee</th><th>Review Cycle</th><th>Lead Reviewer</th><th>Overall Rating</th><th>Merit Raise</th><th style="text-align:right;">Actions</th></tr></thead>
                    <tbody>${reviewRows || '<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text-tertiary);">No review cycles recorded.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    `;
}

// P. Corporate Virtual & Physical Spend Cards
function renderSpendCardsView(state) {
    const cards = state.spendCards || [];
    let cardGrid = '';
    cards.forEach(c => {
        const isFrozen = c.status === 'frozen';
        const percent = Math.min(100, Math.round((c.spentThisMonth / c.monthlyLimit) * 100));
        cardGrid += `
            <div class="card" style="padding:24px; position:relative; overflow:hidden; border-top:4px solid var(--${isFrozen ? 'warning' : 'primary'});">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px;">
                    <div>
                        <span class="badge badge-${isFrozen ? 'warning' : 'success'}" style="margin-bottom:6px;">${isFrozen ? 'Frozen ❄️' : 'Active 🟢'}</span>
                        <div style="font-size:12px; color:var(--text-tertiary);">${escapeHTML(c.category)}</div>
                    </div>
                    <div style="font-weight:800; font-size:16px; color:var(--primary);">💳 VISA</div>
                </div>

                <div style="font-size:20px; font-weight:700; letter-spacing:4px; margin-bottom:16px; font-family:monospace;">
                    •••• •••• •••• ${escapeHTML(c.last4)}
                </div>

                <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:16px;">
                    <div>
                        <div style="font-size:10px; color:var(--text-tertiary); text-transform:uppercase;">Cardholder</div>
                        <div style="font-weight:600; font-size:13px;">${escapeHTML(c.empName)}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:10px; color:var(--text-tertiary); text-transform:uppercase;">Expires</div>
                        <div style="font-weight:600; font-size:13px;">${escapeHTML(c.expMonth)}/${escapeHTML(c.expYear)}</div>
                    </div>
                </div>

                <div style="padding-top:12px; border-top:1px solid var(--border-color);">
                    <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:6px;">
                        <span>Spent: <strong>$${c.spentThisMonth.toFixed(2)}</strong></span>
                        <span>Limit: <strong>$${c.monthlyLimit.toLocaleString()}</strong></span>
                    </div>
                    <div style="height:6px; background:var(--border-color); border-radius:3px; overflow:hidden; margin-bottom:12px;">
                        <div style="height:100%; width:${percent}%; background:var(--${percent > 85 ? 'danger' : 'primary'});"></div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="btn btn-outline" style="flex:1; padding:4px 0; font-size:11px;" onclick="AeroApp.toggleSpendCardFreeze('${c.id}')">${isFrozen ? 'Unfreeze' : 'Freeze Card'}</button>
                    </div>
                </div>
            </div>
        `;
    });

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">Active Virtual Cards</span>
                <span class="stat-value">${cards.length} Cards</span>
                <span class="stat-trend up">Zero liability</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Total Monthly Limit</span>
                <span class="stat-value">${formatCurrency(cards.reduce((s, c) => s + c.monthlyLimit, 0))}</span>
                <span class="stat-trend">Spend controls</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Month-to-Date Spend</span>
                <span class="stat-value" style="color:var(--primary);">${formatCurrency(cards.reduce((s, c) => s + c.spentThisMonth, 0))}</span>
                <span class="stat-trend up">Automated receipts</span>
            </div>
        </div>

        <div class="card" style="padding:24px; margin-bottom:24px; background:linear-gradient(135deg, rgba(79,70,229,0.06), rgba(16,185,129,0.06)); border:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
                <div class="section-title" style="margin-bottom:4px;">Corporate Spend Cards &amp; Expense Controls</div>
                <p style="font-size:13px; color:var(--text-secondary); margin:0;">Issue instant corporate cards with automated spend limits, category locks, and AI receipt matching.</p>
            </div>
            <div style="display:flex; gap:12px;">
                <button class="btn btn-outline" onclick="AeroApp.openReceiptScannerModal()">📷 Scan Receipt (OCR)</button>
                <button class="btn btn-primary" onclick="AeroApp.openIssueSpendCardModal()">+ Issue Virtual Card</button>
            </div>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:20px;">
            ${cardGrid}
        </div>
    `;
}

// Q. Equity & Cap Table Management (Carta Style)
function renderCapTableView(state) {
    const grants = state.stockGrants || [];
    let rows = '';
    let totalGrantedShares = 0;
    grants.forEach(g => {
        totalGrantedShares += g.shares;
        const vestedPct = Math.min(100, Math.round((g.vestedMonths / g.totalMonths) * 100));
        const vestedShares = Math.round((g.shares * vestedPct) / 100);
        const estValue = (vestedShares * (g.currentValuation - g.strikePrice)).toFixed(2);
        rows += `
            <tr>
                <td style="font-weight:600;">${escapeHTML(g.empName)}</td>
                <td><span class="badge badge-info">${escapeHTML(g.type)}</span></td>
                <td>${g.shares.toLocaleString()} shares</td>
                <td>$${g.strikePrice.toFixed(2)}</td>
                <td>$${g.currentValuation.toFixed(2)} / sh</td>
                <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-weight:700; width:35px;">${vestedPct}%</span>
                        <div style="flex:1; height:6px; background:var(--border-color); border-radius:3px; overflow:hidden; min-width:60px;">
                            <div style="height:100%; width:${vestedPct}%; background:var(--success);"></div>
                        </div>
                    </div>
                </td>
                <td style="font-weight:700; color:var(--success);">$${parseFloat(estValue).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
        `;
    });

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">Total Option Pool</span>
                <span class="stat-value">1,000,000</span>
                <span class="stat-trend up">100% Authorized</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Issued Shares</span>
                <span class="stat-value">${totalGrantedShares.toLocaleString()}</span>
                <span class="stat-trend up">Team Grants</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Latest 409A Valuation</span>
                <span class="stat-value" style="color:var(--primary);">$8.50 / share</span>
                <span class="stat-trend up">Fair Market Value</span>
            </div>
        </div>

        <div class="card table-card">
            <div class="section-title" style="padding:20px 24px 0 24px; display:flex; justify-content:space-between; align-items:center;">
                <span>Company Cap Table &amp; Stock Option Grants</span>
                <button class="btn btn-primary" style="font-size:12px;" onclick="AeroApp.openIssueStockGrantModal()">+ Grant Stock Options</button>
            </div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>Stakeholder</th><th>Option Type</th><th>Total Shares</th><th>Strike Price</th><th>409A FMV</th><th>Vesting Progress</th><th>Estimated Value</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text-tertiary);">No equity grants issued.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    `;
}

// R. IT Hardware & Asset Tracking
function renderITAssetsView(state) {
    const assets = state.itAssets || [];
    let rows = '';
    assets.forEach(a => {
        rows += `
            <tr>
                <td style="font-weight:600;">💻 ${escapeHTML(a.model)}</td>
                <td><code>${escapeHTML(a.tag)}</code></td>
                <td><span style="font-family:monospace; font-size:12px;">${escapeHTML(a.serial)}</span></td>
                <td>${escapeHTML(a.empName || 'In Inventory')}</td>
                <td><span class="badge ${a.status === 'assigned' ? 'badge-success' : 'badge-warning'}">${a.status === 'assigned' ? 'Deployed' : 'In Inventory'}</span></td>
                <td style="text-align:right;">
                    ${a.status === 'assigned' ? `
                        <button class="btn btn-outline" style="padding:3px 8px; font-size:11px;" onclick="AeroApp.returnHardwareAsset('${a.id}')">Return to Inventory</button>
                    ` : '<span style="font-size:12px; color:var(--text-tertiary);">Available</span>'}
                </td>
            </tr>
        `;
    });

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">Total Hardware Assets</span>
                <span class="stat-value">${assets.length} Devices</span>
                <span class="stat-trend up">IT Catalog</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Deployed to Workers</span>
                <span class="stat-value">${assets.filter(a => a.status === 'assigned').length}</span>
                <span class="stat-trend up">Active in field</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Available in Inventory</span>
                <span class="stat-value">${assets.filter(a => a.status === 'inventory').length}</span>
                <span class="stat-trend">Ready to ship</span>
            </div>
        </div>

        <div class="card table-card">
            <div class="section-title" style="padding:20px 24px 0 24px; display:flex; justify-content:space-between; align-items:center;">
                <span>IT Hardware &amp; Device Inventory</span>
                <button class="btn btn-primary" style="font-size:12px;" onclick="AeroApp.openAssignAssetModal()">+ Provision New Asset</button>
            </div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>Hardware Model</th><th>Asset Tag</th><th>Serial Number</th><th>Assigned To</th><th>Status</th><th style="text-align:right;">Actions</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text-tertiary);">No IT assets cataloged.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    `;
}

// S. State-Mandated Retirement Auto-Compliance (CalSavers & NY Secure Choice)
function renderStateRetirementView(state) {
    const enrollments = state.retirementEnrollments || {};
    const employees = state.employees || [];

    let rows = '';
    employees.forEach(e => {
        const enr = enrollments[e.id] || { mandate: e.state === 'CA' ? 'CalSavers' : (e.state === 'NY' ? 'NY Secure Choice' : 'None (State Exempt)'), status: e.state === 'CA' || e.state === 'NY' ? 'enrolled' : 'exempt', ratePercent: e.state === 'CA' || e.state === 'NY' ? 5.0 : 0 };
        rows += `
            <tr>
                <td style="font-weight:600;">${escapeHTML(e.name)}</td>
                <td><span class="badge badge-info">State: ${escapeHTML(e.state || 'CA')}</span></td>
                <td><strong>${escapeHTML(enr.mandate)}</strong></td>
                <td>${enr.ratePercent}% of gross pay</td>
                <td><span class="badge ${enr.status === 'enrolled' ? 'badge-success' : 'badge-secondary'}">${enr.status === 'enrolled' ? 'Compliant &amp; Deducted ✓' : 'Exempt / Opted Out'}</span></td>
                <td style="text-align:right;">
                    <button class="btn btn-outline" style="padding:3px 8px; font-size:11px;" onclick="AeroApp.toggleRetirementStatus('${e.id}')">Toggle Opt-Out</button>
                </td>
            </tr>
        `;
    });

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">State Mandate Compliance</span>
                <span class="stat-value" style="color:var(--success);">100% Shielded</span>
                <span class="stat-trend up">Zero State Fines</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Enrolled Workers</span>
                <span class="stat-value">${employees.filter(e => e.state === 'CA' || e.state === 'NY').length}</span>
                <span class="stat-trend up">Auto-Deducted</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Default Contribution</span>
                <span class="stat-value">5.0%</span>
                <span class="stat-trend up">Auto-Escalating</span>
            </div>
        </div>

        <div class="card table-card">
            <div class="section-title" style="padding:20px 24px 0 24px;">State-Mandated Retirement Compliance Ledger (CalSavers / NY Secure Choice)</div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>Employee</th><th>Jurisdiction</th><th>State Mandate Program</th><th>Deduction Rate</th><th>Status</th><th style="text-align:right;">Actions</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text-tertiary);">No employees registered.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    `;
}

// T. Payroll Cash Flow & Runway Simulator
function renderRunwaySimulatorView(state) {
    const cashInBank = 450000;
    const monthlyRevenue = 35000;
    const currentMonthlyPayroll = 24500;
    const netBurn = currentMonthlyPayroll - monthlyRevenue;
    const runwayMonths = netBurn > 0 ? (cashInBank / netBurn).toFixed(1) : 'Profitable (Infinite)';

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">Cash in Bank</span>
                <span class="stat-value">${formatCurrency(cashInBank)}</span>
                <span class="stat-trend up">Audited balance</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Monthly Gross Payroll</span>
                <span class="stat-value">${formatCurrency(currentMonthlyPayroll)}</span>
                <span class="stat-trend">Current team burn</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Projected Runway</span>
                <span class="stat-value" style="color:var(--success);">${runwayMonths} Months</span>
                <span class="stat-trend up">Safe runway</span>
            </div>
        </div>

        <div class="card" style="padding:32px; margin-bottom:24px;">
            <div class="section-title" style="margin-bottom:16px;">🔮 Interactive Headcount &amp; Burn Rate Simulator</div>
            <p style="font-size:14px; color:var(--text-secondary); margin-bottom:24px;">Simulate future engineering and sales hires to see their immediate impact on monthly cash burn and runway timeline.</p>
            
            <div class="form-grid">
                <div class="form-group">
                    <label>Current Monthly Revenue ($)</label>
                    <input type="number" id="simRevInput" class="form-control" value="${monthlyRevenue}" oninput="AeroApp.updateRunwayCalc()" />
                </div>
                <div class="form-group">
                    <label>Add Planned Engineers ($125k/yr)</label>
                    <input type="number" id="simEngCount" class="form-control" value="2" min="0" max="20" oninput="AeroApp.updateRunwayCalc()" />
                </div>
                <div class="form-group">
                    <label>Add Planned Sales Execs ($90k/yr)</label>
                    <input type="number" id="simSalesCount" class="form-control" value="1" min="0" max="20" oninput="AeroApp.updateRunwayCalc()" />
                </div>
            </div>

            <div id="simResultsBox" style="margin-top:24px; padding:20px; background:var(--bg-secondary); border-radius:var(--radius-md); border-left:4px solid var(--primary);">
                <div style="font-weight:700; font-size:16px; margin-bottom:6px;">Projected Post-Hiring Burn Rate</div>
                <div style="font-size:14px; color:var(--text-secondary);" id="simOutputText">
                    Adding 2 Engineers and 1 Sales Exec will increase monthly payroll to <strong>$49,500/mo</strong>, resulting in a net burn of <strong>$14,500/mo</strong> and <strong>31.0 months</strong> of runway.
                </div>
            </div>
        </div>
    `;
}

// U. Multi-Pay Groups & Split Schedules
function renderPayGroupsView(state) {
    const groups = state.payGroups || [];
    let rows = '';
    groups.forEach(g => {
        rows += `
            <tr>
                <td style="font-weight:600;">🏢 ${escapeHTML(g.name)}</td>
                <td><span class="badge badge-info">${escapeHTML(g.frequency)}</span></td>
                <td>${escapeHTML(g.nextPayDate)}</td>
                <td>${g.memberCount} workers assigned</td>
                <td style="text-align:right;">
                    <button class="btn btn-outline" style="padding:4px 10px; font-size:12px;" onclick="AeroApp.navigateTo('payroll')">Run Group Payroll</button>
                </td>
            </tr>
        `;
    });

    return `
        <div class="card" style="padding:24px; margin-bottom:24px; background:linear-gradient(135deg, rgba(79,70,229,0.06), rgba(14,165,233,0.06)); border:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
                <div class="section-title" style="margin-bottom:4px;">Multi-Pay Schedules &amp; Employee Groups</div>
                <p style="font-size:13px; color:var(--text-secondary); margin:0;">Run separate payroll cycles for Monthly executives, Bi-weekly staff, and Weekly hourly crews.</p>
            </div>
            <button class="btn btn-primary" onclick="AeroApp.promptCreatePayGroup()">+ Add Pay Schedule</button>
        </div>

        <div class="card table-card">
            <div class="section-title" style="padding:20px 24px 0 24px;">Active Pay Groups (${groups.length})</div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>Pay Group Name</th><th>Frequency</th><th>Next Pay Date</th><th>Assigned Members</th><th style="text-align:right;">Action</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-tertiary);">No pay groups defined.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    `;
}

// V. Compliance Training & LMS
function renderComplianceTrainingView(state) {
    const courses = state.trainingCourses || [];
    let courseCards = '';
    courses.forEach(c => {
        const isComplete = c.completedCount >= c.totalCount;
        courseCards += `
            <div class="card" style="padding:24px; display:flex; flex-direction:column; justify-content:space-between; border-top:4px solid var(--${isComplete ? 'success' : 'primary'});">
                <div>
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                        <span class="badge badge-info">${escapeHTML(c.category)}</span>
                        <span style="font-size:12px; color:var(--text-tertiary);">⏱️ ${escapeHTML(c.duration)}</span>
                    </div>
                    <h3 style="margin:0 0 8px 0; font-size:16px; font-weight:700;">${escapeHTML(c.title)}</h3>
                    <p style="font-size:13px; color:var(--text-secondary); margin:0 0 16px 0;">Mandatory compliance training for ${escapeHTML(c.requiredFor)}.</p>
                </div>

                <div>
                    <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:6px;">
                        <span>Progress: <strong>${c.completedCount} / ${c.totalCount} completed</strong></span>
                        <span>${Math.round((c.completedCount / c.totalCount) * 100)}%</span>
                    </div>
                    <div style="height:6px; background:var(--border-color); border-radius:3px; overflow:hidden; margin-bottom:16px;">
                        <div style="height:100%; width:${(c.completedCount / c.totalCount) * 100}%; background:var(--${isComplete ? 'success' : 'primary'});"></div>
                    </div>
                    <button class="btn btn-outline" style="width:100%; font-size:12px;" onclick="AeroApp.openCourseQuizModal('${c.id}')">Start Course &amp; Quiz 🎓</button>
                </div>
            </div>
        `;
    });

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">Active Training Modules</span>
                <span class="stat-value">${courses.length} Courses</span>
                <span class="stat-trend up">State certified</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Compliance Pass Rate</span>
                <span class="stat-value" style="color:var(--success);">94.2%</span>
                <span class="stat-trend up">CA &amp; NY SB 1343</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Audit Readiness</span>
                <span class="stat-value">100% Active</span>
                <span class="stat-trend up">Certificates logged</span>
            </div>
        </div>

        <div class="card" style="padding:24px; margin-bottom:24px; background:linear-gradient(135deg, rgba(79,70,229,0.06), rgba(16,185,129,0.06)); border:1px solid var(--border-color);">
            <div class="section-title" style="margin-bottom:4px;">Mandatory Compliance Training &amp; LMS</div>
            <p style="font-size:13px; color:var(--text-secondary); margin:0;">Automate state-mandated harassment prevention, HIPAA, and OSHA training with verifiable certificates.</p>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:20px;">
            ${courseCards}
        </div>
    `;
}

// W. Anonymous Pulse Surveys & eNPS Analytics
function renderPulseSurveysView(state) {
    const surveys = state.surveys || [];
    const promoters = surveys.filter(s => s.score >= 9).length;
    const detractors = surveys.filter(s => s.score <= 6).length;
    const total = surveys.length || 1;
    const enps = Math.round(((promoters - detractors) / total) * 100);

    let feedbackCards = '';
    surveys.forEach(s => {
        feedbackCards += `
            <div class="card" style="padding:16px; margin-bottom:12px; border-left:4px solid var(--${s.score >= 9 ? 'success' : (s.score >= 7 ? 'warning' : 'danger')});">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span class="badge badge-${s.score >= 9 ? 'success' : (s.score >= 7 ? 'warning' : 'danger')}">Rating: ${s.score}/10 (${s.category})</span>
                    <span style="font-size:12px; color:var(--text-tertiary);">${escapeHTML(s.date)}</span>
                </div>
                <div style="font-size:13px; line-height:1.5; color:var(--text-primary);">"${escapeHTML(s.feedback)}"</div>
            </div>
        `;
    });

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">Employee Net Promoter (eNPS)</span>
                <span class="stat-value" style="color:var(--success);">+${enps}</span>
                <span class="stat-trend up">World Class Morale</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Promoters (9-10)</span>
                <span class="stat-value">${promoters}</span>
                <span class="stat-trend up">${Math.round((promoters / total) * 100)}% of team</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Responses Logged</span>
                <span class="stat-value">${surveys.length}</span>
                <span class="stat-trend">100% Anonymous</span>
            </div>
        </div>

        <div class="card" style="padding:24px; margin-bottom:24px; background:linear-gradient(135deg, rgba(79,70,229,0.06), rgba(14,165,233,0.06)); border:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
                <div class="section-title" style="margin-bottom:4px;">Team Sentiment &amp; Anonymous Pulse Feed</div>
                <p style="font-size:13px; color:var(--text-secondary); margin:0;">Real-time employee satisfaction metrics, culture feedback, and sentiment scorecards.</p>
            </div>
            <button class="btn btn-primary" onclick="AeroApp.openSubmitPulseModal()">+ Submit Anonymous Pulse</button>
        </div>

        <div class="card table-card">
            <div class="section-title" style="padding:20px 24px 0 24px;">Recent Team Feedback Feed</div>
            <div style="padding:20px 24px;">
                ${feedbackCards || '<div style="text-align:center; padding:40px; color:var(--text-tertiary);">No pulse feedback submitted.</div>'}
            </div>
        </div>
    `;
}

// X. Company Holiday Calendar & PTO Blackouts
function renderHolidayCalendarView(state) {
    const holidays = state.holidays || [];
    const blackouts = state.blackoutDates || [];

    let holRows = '';
    holidays.forEach(h => {
        holRows += `
            <tr>
                <td style="font-weight:600;">🎉 ${escapeHTML(h.name)}</td>
                <td>${escapeHTML(h.date)}</td>
                <td><span class="badge ${h.type.includes('Federal') ? 'badge-primary' : 'badge-info'}">${escapeHTML(h.type)}</span></td>
                <td><span class="badge badge-success">Paid Holiday ✓</span></td>
            </tr>
        `;
    });

    let blkRows = '';
    blackouts.forEach(b => {
        blkRows += `
            <tr>
                <td style="font-weight:600; color:var(--warning);">🔒 ${escapeHTML(b.title)}</td>
                <td>${escapeHTML(b.startDate)} → ${escapeHTML(b.endDate)}</td>
                <td>${escapeHTML(b.department)}</td>
                <td><span class="badge badge-warning">Approval Required</span></td>
            </tr>
        `;
    });

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">Official Paid Holidays</span>
                <span class="stat-value">${holidays.length} Days</span>
                <span class="stat-trend up">Annual calendar</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">PTO Blackout Periods</span>
                <span class="stat-value">${blackouts.length} Windows</span>
                <span class="stat-trend" style="color:var(--warning);">Peak business freeze</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Auto-Timesheet Sync</span>
                <span class="stat-value" style="color:var(--success);">Active</span>
                <span class="stat-trend up">Holiday pay credited</span>
            </div>
        </div>

        <div class="card table-card" style="margin-bottom:24px;">
            <div class="section-title" style="padding:20px 24px 0 24px; display:flex; justify-content:space-between; align-items:center;">
                <span>Official Paid Company Holidays</span>
                <button class="btn btn-outline" style="font-size:12px;" onclick="AeroApp.promptAddHoliday()">+ Add Custom Holiday</button>
            </div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>Holiday Name</th><th>Date</th><th>Classification</th><th>Compensation</th></tr></thead>
                    <tbody>${holRows}</tbody>
                </table>
            </div>
        </div>

        <div class="card table-card">
            <div class="section-title" style="padding:20px 24px 0 24px; display:flex; justify-content:space-between; align-items:center;">
                <span>PTO Blackout Dates (Freeze Windows)</span>
                <button class="btn btn-outline" style="font-size:12px;" onclick="AeroApp.promptAddBlackout()">+ Add Blackout Window</button>
            </div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>Event / Freeze Title</th><th>Date Range</th><th>Impacted Group</th><th>Policy Rule</th></tr></thead>
                    <tbody>${blkRows}</tbody>
                </table>
            </div>
        </div>
    `;
}

// Y. Automated Offboarding & COBRA Engine
function renderOffboardingView(state) {
    const records = state.offboardingRecords || [];
    let rows = '';
    records.forEach(r => {
        rows += `
            <tr>
                <td style="font-weight:600;">${escapeHTML(r.empName)}</td>
                <td>${escapeHTML(r.separationDate)}</td>
                <td>${escapeHTML(r.reason)}</td>
                <td>${r.ptoPayoutHours} hrs (${formatCurrency(r.ptoPayoutAmount)})</td>
                <td><span class="badge badge-success">COBRA Form Dispatched ✓</span></td>
                <td><span class="badge badge-info">Cards &amp; Assets Revoked</span></td>
            </tr>
        `;
    });

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">Processed Offboardings</span>
                <span class="stat-value">${records.length} Completed</span>
                <span class="stat-trend up">Full legal audit</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Accrued PTO Payouts</span>
                <span class="stat-value">${formatCurrency(records.reduce((s, r) => s + r.ptoPayoutAmount, 0))}</span>
                <span class="stat-trend">Final checks</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">COBRA Compliance</span>
                <span class="stat-value" style="color:var(--success);">100%</span>
                <span class="stat-trend up">DOL notice compliant</span>
            </div>
        </div>

        <div class="card" style="padding:24px; margin-bottom:24px; background:linear-gradient(135deg, rgba(239,68,68,0.06), rgba(79,70,229,0.06)); border:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
                <div class="section-title" style="margin-bottom:4px;">Automated Offboarding &amp; COBRA Continuation</div>
                <p style="font-size:13px; color:var(--text-secondary); margin:0;">Calculate accrued PTO payouts, revoke IT/spend card credentials, and generate COBRA notices with 1 click.</p>
            </div>
            <button class="btn btn-primary" onclick="AeroApp.openOffboardingWizardModal()">+ Initiate Separation</button>
        </div>

        <div class="card table-card">
            <div class="section-title" style="padding:20px 24px 0 24px;">Separation &amp; COBRA Audit Log</div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>Employee</th><th>Separation Date</th><th>Reason</th><th>Accrued PTO Payout</th><th>COBRA Notice</th><th>Asset Status</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text-tertiary);">No employee separations recorded.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    `;
}

// Z. 1099-MISC & 1099-NEC Contractor Year-End Tax Vault
function render1099TaxVaultView(state) {
    const records = state.taxVault1099 || [];
    const totalComp = records.reduce((s, r) => s + r.box1NonemployeeComp, 0);
    const efiledCount = records.filter(r => r.status === 'efiled').length;

    let rows = '';
    records.forEach(r => {
        const isEfiled = r.status === 'efiled';
        rows += `
            <tr>
                <td style="font-weight:600;">${escapeHTML(r.contractorName)}</td>
                <td><span class="badge badge-info">${escapeHTML(r.type)}</span></td>
                <td><span style="font-family:monospace; font-size:12px;">${escapeHTML(r.tin)}</span></td>
                <td style="font-weight:700; color:var(--primary);">${formatCurrency(r.box1NonemployeeComp)}</td>
                <td><span class="badge badge-info">State: ${escapeHTML(r.state || 'FL')}</span></td>
                <td><span class="badge ${isEfiled ? 'badge-success' : 'badge-warning'}">${isEfiled ? 'E-Filed with IRS ✓' : 'Ready to File'}</span></td>
                <td style="text-align:right;">
                    <div style="display:flex; gap:6px; justify-content:flex-end;">
                        <button class="btn btn-outline" style="padding:3px 8px; font-size:11px;" onclick="AeroApp.open1099PreviewModal('${r.contractorId}')">View IRS Copy B</button>
                    </div>
                </td>
            </tr>
        `;
    });

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">Total 1099 Disbursements</span>
                <span class="stat-value">${formatCurrency(totalComp)}</span>
                <span class="stat-trend up">Nonemployee comp</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Eligible Contractors (&ge; $600)</span>
                <span class="stat-value">${records.length} Payees</span>
                <span class="stat-trend up">IRS 1099-NEC required</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">IRS E-Filing Transmission</span>
                <span class="stat-value" style="color:var(--${efiledCount === records.length ? 'success' : 'primary'});">${efiledCount} / ${records.length} Transmitted</span>
                <span class="stat-trend up">TaxBandits API connected</span>
            </div>
        </div>

        <div class="card" style="padding:24px; margin-bottom:24px; background:linear-gradient(135deg, rgba(79,70,229,0.06), rgba(245,158,11,0.06)); border:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
                <div class="section-title" style="margin-bottom:4px;">1099 Contractor Year-End Tax Vault (Tax Year 2026)</div>
                <p style="font-size:13px; color:var(--text-secondary); margin:0;">Generate official IRS 1099-NEC / 1099-MISC Copy B statements and batch e-file directly with the IRS.</p>
            </div>
            <button class="btn btn-primary" onclick="AeroApp.batchEfile1099Forms()">⚡ 1-Click Batch E-File with IRS</button>
        </div>

        <div class="card table-card">
            <div class="section-title" style="padding:20px 24px 0 24px;">Contractor Year-End Tax Packages</div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>Contractor Name</th><th>Form Type</th><th>Recipient TIN</th><th>Box 1 Nonemployee Comp</th><th>Jurisdiction</th><th>IRS E-File Status</th><th style="text-align:right;">Action</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text-tertiary);">No 1099 contractor records found.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    `;
}

// Full IRS 1099-NEC Form Layout
function getForm1099NECFullHTML(record, state) {
    const comp = state.settings?.companyName || 'GlidePay Inc.';
    const ein = state.settings?.ein || '88-9182310';
    return `
        <div style="font-family: Arial, sans-serif; max-width:700px; margin:0 auto; padding:24px; border:2px solid #000; background:#fff; color:#000;">
            <div style="display:flex; justify-content:space-between; border-bottom:2px solid #000; padding-bottom:8px; margin-bottom:12px;">
                <div>
                    <div style="font-size:12px; font-weight:bold;">CORRECTED (if checked) [ ]</div>
                    <div style="font-size:22px; font-weight:900; margin-top:4px;">Form 1099-NEC</div>
                </div>
                <div style="text-align:center;">
                    <div style="font-size:20px; font-weight:900;">2026</div>
                    <div style="font-size:10px;">Nonemployee<br>Compensation</div>
                </div>
                <div style="text-align:right; font-size:11px;">
                    <div>OMB No. 1545-0116</div>
                    <div style="font-weight:bold; margin-top:4px;">Copy B<br>For Recipient</div>
                </div>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; border:1px solid #000; margin-bottom:12px;">
                <div style="padding:8px; border-right:1px solid #000; border-bottom:1px solid #000;">
                    <div style="font-size:9px; text-transform:uppercase;">PAYER'S name, address, and telephone number</div>
                    <div style="font-weight:bold; font-size:13px; margin-top:4px;">${escapeHTML(comp)}</div>
                    <div style="font-size:11px;">100 Montgomery St, Suite 1500<br>San Francisco, CA 94104</div>
                </div>
                <div style="padding:8px; border-bottom:1px solid #000; background:#f9fafb;">
                    <div style="font-size:9px; text-transform:uppercase;">1. Nonemployee compensation</div>
                    <div style="font-weight:bold; font-size:18px; color:#111827; margin-top:6px;">$${record.box1NonemployeeComp.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                </div>
                <div style="padding:8px; border-right:1px solid #000;">
                    <div style="font-size:9px; text-transform:uppercase;">PAYER'S TIN: <strong>${escapeHTML(ein)}</strong></div>
                    <div style="font-size:9px; text-transform:uppercase; margin-top:6px;">RECIPIENT'S TIN: <strong>${escapeHTML(record.tin)}</strong></div>
                </div>
                <div style="padding:8px;">
                    <div style="font-size:9px; text-transform:uppercase;">4. Federal income tax withheld</div>
                    <div style="font-weight:bold; font-size:13px; margin-top:4px;">$0.00</div>
                </div>
            </div>

            <div style="border:1px solid #000; padding:8px; margin-bottom:16px;">
                <div style="font-size:9px; text-transform:uppercase;">RECIPIENT'S name, street address, and ZIP code</div>
                <div style="font-weight:bold; font-size:14px; margin-top:4px;">${escapeHTML(record.contractorName)}</div>
                <div style="font-size:11px; color:#4b5563;">742 Evergreen Terrace, Orlando, ${escapeHTML(record.state)} 32801</div>
            </div>

            <div style="font-size:10px; color:#6b7280; text-align:center;">
                This is important tax information and is being furnished to the Internal Revenue Service. If you are required to file a return, a negligence penalty or other sanction may be imposed on you if this income is taxable and the IRS determines that it has not been reported.
            </div>
        </div>
    `;
}

// AA. Official Employment & Income Verification Letter Generator
function renderEmploymentLetterHTML(emp, state, options = {}) {
    const comp = state.settings?.companyName || 'GlidePay Inc.';
    const ein = state.settings?.ein || '88-9182310';
    const showComp = options.includeComp !== false;
    const annualComp = emp.type === 'salaried' ? emp.rate : emp.rate * 40 * 52;
    const issueDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    return `
        <div style="font-family: 'Times New Roman', Times, serif; max-width:680px; margin:0 auto; padding:40px; background:#fff; color:#111; line-height:1.6; border:1px solid #ddd; box-shadow:0 4px 12px rgba(0,0,0,0.05);">
            <div style="border-bottom:2px solid #111; padding-bottom:16px; margin-bottom:24px; display:flex; justify-content:space-between; align-items:flex-end;">
                <div>
                    <div style="font-size:24px; font-weight:bold; letter-spacing:1px;">${escapeHTML(comp)}</div>
                    <div style="font-size:12px; color:#555; font-family:Arial, sans-serif; margin-top:4px;">
                        100 Montgomery Street, Suite 1500 · San Francisco, CA 94104<br>
                        EIN: ${escapeHTML(ein)} · Human Resources Dept
                    </div>
                </div>
                <div style="font-size:12px; font-family:Arial, sans-serif; color:#666;">
                    Date: <strong>${issueDate}</strong>
                </div>
            </div>

            <div style="font-size:14px; margin-bottom:20px;">
                <strong>TO WHOM IT MAY CONCERN:</strong>
            </div>

            <p style="font-size:14px; margin-bottom:16px; text-align:justify;">
                This official letter serves as formal verification of employment for <strong>${escapeHTML(emp.name)}</strong> with <strong>${escapeHTML(comp)}</strong>.
            </p>

            <table style="width:100%; font-size:13px; font-family:Arial, sans-serif; border-collapse:collapse; margin:20px 0; background:#f9fafb;">
                <tbody>
                    <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:8px 12px; font-weight:bold; width:40%;">Employee Name:</td><td style="padding:8px 12px;">${escapeHTML(emp.name)}</td></tr>
                    <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:8px 12px; font-weight:bold;">Job Title:</td><td style="padding:8px 12px;">${escapeHTML(emp.role)}</td></tr>
                    <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:8px 12px; font-weight:bold;">Department:</td><td style="padding:8px 12px;">${escapeHTML(emp.department)}</td></tr>
                    <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:8px 12px; font-weight:bold;">Employment Status:</td><td style="padding:8px 12px;">Active · Full-Time (${escapeHTML(emp.classification).toUpperCase()})</td></tr>
                    <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:8px 12px; font-weight:bold;">Start Date:</td><td style="padding:8px 12px;">January 15, 2024</td></tr>
                    ${showComp ? `
                    <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:8px 12px; font-weight:bold;">Current Base Rate:</td><td style="padding:8px 12px;"><strong>$${annualComp.toLocaleString(undefined, { minimumFractionDigits: 2 })} / year</strong></td></tr>
                    <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:8px 12px; font-weight:bold;">Pay Frequency:</td><td style="padding:8px 12px; text-transform:capitalize;">${escapeHTML(emp.payFrequency || 'bi-weekly')}</td></tr>
                    ` : ''}
                </tbody>
            </table>

            <p style="font-size:14px; margin-bottom:24px; text-align:justify;">
                ${escapeHTML(emp.name)} is currently an employee in good standing. If you require any additional verification, please contact our Human Resources and Payroll department at <code>hr@glidepay.org</code>.
            </p>

            <div style="margin-top:32px;">
                <div style="font-family:'Brush Script MT', cursive; font-size:24px; color:#1e40af; margin-bottom:4px;">Eleanor Vance</div>
                <div style="font-size:13px; font-weight:bold;">Eleanor Vance</div>
                <div style="font-size:12px; color:#555;">Director of People &amp; Payroll Operations</div>
                <div style="font-size:12px; color:#555;">${escapeHTML(comp)}</div>
            </div>
        </div>
    `;
}

// BB. Multi-State Tax Registration & Nexus Guide
function renderMultiStateNexusView(state) {
    const nexus = state.stateNexus || [];
    let rows = '';
    nexus.forEach(n => {
        const isReg = n.status === 'registered';
        rows += `
            <tr>
                <td style="font-weight:700;"><span class="badge badge-primary" style="margin-right:6px;">${escapeHTML(n.state)}</span> ${escapeHTML(n.name)}</td>
                <td><span style="font-size:12px;">${escapeHTML(n.sitAgency)}</span></td>
                <td><span style="font-size:12px;">${escapeHTML(n.sutaAgency)} (Rate: ${n.sutaRate}%)</span></td>
                <td><span class="badge ${isReg ? 'badge-success' : 'badge-warning'}">${isReg ? 'Registered &amp; Active ✓' : 'Registration Pending'}</span></td>
                <td style="text-align:right;">
                    <div style="display:flex; gap:6px; justify-content:flex-end;">
                        <a href="${n.link}" target="_blank" class="btn btn-outline" style="padding:3px 8px; font-size:11px;">State Portal ↗</a>
                        <button class="btn btn-outline" style="padding:3px 8px; font-size:11px;" onclick="AeroApp.toggleStateNexus('${n.state}')">${isReg ? 'Mark Pending' : 'Mark Registered'}</button>
                    </div>
                </td>
            </tr>
        `;
    });

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">Active State Jurisdictions</span>
                <span class="stat-value">${nexus.filter(n => n.status === 'registered').length} States</span>
                <span class="stat-trend up">SIT &amp; SUTA active</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Pending State Registrations</span>
                <span class="stat-value">${nexus.filter(n => n.status === 'pending').length} States</span>
                <span class="stat-trend" style="color:var(--warning);">Remote employee nexus</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Tax Compliance Shield</span>
                <span class="stat-value" style="color:var(--success);">100% Protected</span>
                <span class="stat-trend up">Zero penalty exposure</span>
            </div>
        </div>

        <div class="card" style="padding:24px; margin-bottom:24px; background:linear-gradient(135deg, rgba(79,70,229,0.06), rgba(14,165,233,0.06)); border:1px solid var(--border-color);">
            <div class="section-title" style="margin-bottom:4px;">Multi-State Tax Nexus &amp; Employer Registration Guide</div>
            <p style="font-size:13px; color:var(--text-secondary); margin:0;">Registering with state departments of labor and revenue ensures legal compliance when hiring remote workers.</p>
        </div>

        <div class="card table-card">
            <div class="section-title" style="padding:20px 24px 0 24px;">State Tax Agency &amp; SUTA Roster</div>
            <div class="table-wrapper">
                <table class="table-responsive">
                    <thead><tr><th>State Jurisdiction</th><th>State Income Tax Agency (SIT)</th><th>Unemployment Agency (SUTA)</th><th>Status</th><th style="text-align:right;">Actions</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
    `;
}

// CC. Executive Board & Investor Reporting Deck
function renderExecutiveBoardDeckView(state) {
    const employees = state.employees || [];
    const history = state.payrollHistory || [];
    const totalGrossYTD = history.reduce((s, h) => s + (h.grossPayroll || h.totalAmount || 0), 0);
    const employerTaxesYTD = history.reduce((s, h) => s + (h.employerTaxes || (h.grossPayroll * 0.08) || 0), 0);
    const loadedLaborBurden = totalGrossYTD + employerTaxesYTD;
    const avgComp = employees.length ? Math.round(employees.reduce((s, e) => s + (e.type === 'salaried' ? e.rate : e.rate * 2080), 0) / employees.length) : 0;

    return `
        <div class="grid-stats" style="margin-bottom:24px;">
            <div class="card stat-card">
                <span class="stat-label">Total Active Headcount</span>
                <span class="stat-value">${employees.length} Team Members</span>
                <span class="stat-trend up">+100% YoY Growth</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Fully Loaded Labor Burden (YTD)</span>
                <span class="stat-value" style="color:var(--primary);">${formatCurrency(loadedLaborBurden)}</span>
                <span class="stat-trend">Wages + FICA + SUTA + Benefits</span>
            </div>
            <div class="card stat-card">
                <span class="stat-label">Average Annualized Comp</span>
                <span class="stat-value">${formatCurrency(avgComp)}</span>
                <span class="stat-trend up">Market benchmarked</span>
            </div>
        </div>

        <div class="dashboard-grid" style="grid-template-columns: 1fr 1fr; gap:24px; margin-bottom:24px;">
            <div class="card" style="padding:24px;">
                <div class="section-title" style="margin-bottom:16px;">🏢 Departmental Headcount &amp; Cost Allocation</div>
                <div style="display:flex; flex-direction:column; gap:12px; font-size:13px;">
                    <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding-bottom:8px;">
                        <span>Engineering &amp; Product (2 Members)</span>
                        <span style="font-weight:700; color:var(--primary);">64.2% of payroll</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding-bottom:8px;">
                        <span>Sales &amp; Marketing (1 Member)</span>
                        <span style="font-weight:700;">22.1% of payroll</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding-bottom:8px;">
                        <span>Customer Support &amp; Ops (1 Member)</span>
                        <span style="font-weight:700;">13.7% of payroll</span>
                    </div>
                </div>
            </div>

            <div class="card" style="padding:24px;">
                <div class="section-title" style="margin-bottom:16px;">📊 Workforce Retention &amp; Equity Health</div>
                <div style="display:flex; flex-direction:column; gap:12px; font-size:13px;">
                    <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding-bottom:8px;">
                        <span>Annual Turnover Rate</span>
                        <span style="font-weight:700; color:var(--success);">0.0% (Zero voluntary departures)</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding-bottom:8px;">
                        <span>Option Pool Utilization</span>
                        <span style="font-weight:700;">3.5% allocated of 1M pool</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding-bottom:8px;">
                        <span>Employee eNPS Morale</span>
                        <span style="font-weight:700; color:var(--success);">+75 (World Class)</span>
                    </div>
                </div>
            </div>
        </div>

        <div style="text-align:right;">
            <button class="btn btn-primary" onclick="window.print()">🖨️ Export Investor Board Summary (PDF)</button>
        </div>
    `;
}

// Export UI Renderers
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        renderSpendChart,
        renderHeadcountChart,
        renderDeptSpendChart,
        renderDashboardView,
        renderEmployeesView,
        renderRunPayrollView,
        renderTimeTrackingView,
        renderTaxComplianceView,
        renderIntegrationsView,
        renderSettingsView,
        getPaystubHTML,
        getForm941HTML,
        getW2HTML,
        formatCurrency,
        renderLandingPageView,
        renderEmployeeDashboardView,
        renderEmployeeTimecardView,
        renderEmployeeDocumentsView,
        renderContractorDashboardView,
        getContractorReceiptHTML,
        get1099NECHTML,
        getW2SignaturePadHTML,
        renderOnboardingView,
        renderDirectoryView,
        renderPTOView,
        renderBenefitsAdminView,
        renderApprovalsView,
        renderReportsView,
        renderAnnouncementsView,
        renderAuditLogView,
        renderEmployeePTOView,
        renderEmployeeBenefitsView,
        renderEmployee401kView,
        renderHelpDocsView,
        renderAccountantPortalView,
        renderOnboardingFormsView,
        renderTimeClockView,
        renderTabletKioskView,
        renderWorkersCompView,
        renderExpensesView,
        renderOrgChartView,
        renderGlobalContractorsView,
        renderCompanyDocumentsView,
        renderPerformanceReviewsView,
        renderSpendCardsView,
        renderCapTableView,
        renderITAssetsView,
        renderStateRetirementView,
        renderRunwaySimulatorView,
        renderPayGroupsView,
        renderComplianceTrainingView,
        renderPulseSurveysView,
        renderHolidayCalendarView,
        renderOffboardingView,
        render1099TaxVaultView,
        getForm1099NECFullHTML,
        renderEmploymentLetterHTML,
        renderMultiStateNexusView,
        renderExecutiveBoardDeckView
    };
}






