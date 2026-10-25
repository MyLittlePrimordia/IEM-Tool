// Find extras: side-by-side spec comparison, the price/performance value map,
// and the one-click "match this set to that set" solve.
//
// These three tools all answer the same follow-up question after a scan:
// "I have a shortlist — how do I choose, and how do I make one sound like the
// other?" They reuse the already-computed match list and the existing AutoEQ
// solver, so nothing here re-scans the catalogue.
const Find_ExtrasMethods = {
    _checkedFindItems: function () {
        const checked = Array.from(document.querySelectorAll('.find-compare-cb:checked'));
        return checked.map(cb => ({
            id: cb.getAttribute('data-id'),
            name: cb.getAttribute('data-name')
        })).filter(x => x.id);
    },

    _findItemRecord: function (id) {
        const item = (PEQDB_Module.STATE.dataset || []).find(d => d.id === id);
        const match = (this._lastMatches || []).find(m => m.id === id || (m.dbEntry && m.dbEntry.id === id));
        const db = (match && match.dbEntry) || (this.iemDatabase || []).find(d => d.id === id) || item;
        return { item, match, db };
    },

    _specRows: function (id) {
        const { item, match, db } = this._findItemRecord(id);
        const src = db || item || {};
        const tags = Array.isArray(src.tags) ? src.tags : [];
        const files = Array.isArray(src.files) ? src.files : [];
        const sourceCount = (match && match.sourceCount) || src.sourceCount || files.length || 1;
        const spread = Number((match && match.consensusSpread) || src.consensusSpread || 0);
        return {
            id,
            name: (match && match.name) || src.name || id,
            brand: src.brand || '',
            model: src.model || '',
            variant: src.variant || '',
            year: src.year || '',
            price: Number(src.price_usd || src.price || 0) || null,
            driver: src.driver_config || src.driver_type || '',
            driverType: src.driver_type || '',
            form: src.form_factor || '',
            connector: src.connector || '',
            impedance: Number(src.impedance) || null,
            sensitivity: Number(src.sensitivity) || null,
            tags,
            files: sourceCount,
            spread,
            score: (match && Number.isFinite(Number(match.score))) ? Number(match.score) : null,
            hasConsensus: !!(match && match.hasConsensus)
        };
    },

    openSpecCompare: function () {
        const selected = this._checkedFindItems();
        if (selected.length < 2 || selected.length > 4) {
            showToast('Check 2–4 IEMs first, then open Compare specs.', '⚠️');
            return;
        }
        const rows = selected.map(s => this._specRows(s.id));
        const defs = [
            ['Match score', r => r.score === null ? '—' : r.score.toFixed(1) + '%'],
            ['Price', r => r.price ? '$' + r.price : '—'],
            ['Year', r => r.year || '—'],
            ['Driver', r => r.driver || '—'],
            ['Form factor', r => r.form || '—'],
            ['Connector', r => r.connector || '—'],
            ['Impedance', r => r.impedance ? r.impedance + ' Ω' : '—'],
            ['Sensitivity', r => r.sensitivity ? r.sensitivity + ' dB' : '—'],
            ['Measurements', r => r.files + (r.files === 1 ? ' source' : ' sources')],
            ['Source spread', r => r.spread > 0 ? '±' + r.spread.toFixed(2) + ' dB' : (r.hasConsensus ? 'consensus' : 'single source')],
            ['Tags', r => r.tags.length ? r.tags.join(' · ') : '—']
        ];
        const escCell = (v) => esc(String(v));
        const actions = [];
        if (rows.length >= 2) {
            actions.push({
                label: '🪄 Match ' + this._shortName(rows[0]) + ' → ' + this._shortName(rows[1]),
                title: 'Load the first as Base, the second as Target, and solve AutoEQ',
                onClick: () => {
                    UIKit.closeReader();
                    this.matchSound(rows[0].id, rows[1].id);
                }
            });
            actions.push({
                label: '🪄 Match ' + this._shortName(rows[1]) + ' → ' + this._shortName(rows[0]),
                title: 'Load the second as Base, the first as Target, and solve AutoEQ',
                onClick: () => {
                    UIKit.closeReader();
                    this.matchSound(rows[1].id, rows[0].id);
                }
            });
        }
        UIKit.read({
            title: '📊 Compare specs',
            subtitle: rows.map(r => this._shortName(r)).join('  vs  '),
            actions,
            render: (body) => {
                const table = document.createElement('table');
                table.style.cssText = 'width:100%;border-collapse:collapse;font-size:var(--t-xs);';
                const head = document.createElement('thead');
                head.innerHTML = '<tr><th style="text-align:left;padding:6px 8px;color:var(--text-lo);font-size:var(--t-micro);text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid var(--line);">Spec</th>' +
                    rows.map(r => `<th style="text-align:left;padding:6px 8px;color:var(--text-hi);border-bottom:1px solid var(--line);">${esc(this._shortName(r))}</th>`).join('') + '</tr>';
                table.appendChild(head);
                const tbody = document.createElement('tbody');
                defs.forEach(([label, get]) => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `<td style="padding:6px 8px;color:var(--text-lo);border-bottom:1px solid var(--line);white-space:nowrap;">${esc(label)}</td>` +
                        rows.map(r => `<td style="padding:6px 8px;color:var(--text-mid);border-bottom:1px solid var(--line);">${escCell(get(r))}</td>`).join('');
                    tbody.appendChild(tr);
                });
                table.appendChild(tbody);
                body.appendChild(table);
                if (rows.some(r => r.files > 1)) {
                    const note = document.createElement('div');
                    note.className = 'type-micro';
                    note.style.cssText = 'margin-top:8px;color:var(--text-lo);line-height:1.5;';
                    note.textContent = 'Source spread is how far the individual measurements disagree after levelling. A small spread means the score is stable; a large one means the published measurements themselves disagree.';
                    body.appendChild(note);
                }
            }
        });
    },

    _shortName: function (r) {
        const n = r && (r.name || r.id) || '';
        return n.length > 28 ? n.slice(0, 26) + '…' : n;
    },

    // Load from as Base, to as Target, then solve. This is the same solver the
    // EQ workspace uses; the difference is that the two products come from the
    // Find shortlist with one click instead of two manual role assignments.
    matchSound: async function (fromId, toId) {
        const from = (PEQDB_Module.STATE.dataset || []).find(d => d.id === fromId);
        const to = (PEQDB_Module.STATE.dataset || []).find(d => d.id === toId);
        if (!from || !to) { showToast('Could not resolve those products.', '⚠️'); return; }
        const ensure = async (item) => {
            if (!item.data || item.data.length < 2) {
                if (typeof CurveIndexer !== 'undefined') await CurveIndexer.loadCurve(item, 0);
            }
            return item.data && item.data.length > 1;
        };
        const okFrom = await ensure(from);
        const okTo = await ensure(to);
        if (!okFrom || !okTo) { showToast('One of those products has no usable measurement.', '⚠️'); return; }

        // Clear through setTarget so the stepper label and hidden selector are
        // reset from the same place as every other target change; then label
        // the custom Target card explicitly (targetMode stays empty because
        // this target is a measured curve, not a catalogue target id).
        PEQDB_Module.setTarget('');
        PEQDB_Module.STATE.activeCurves = PEQDB_Module.STATE.activeCurves.filter(c => c.role !== 'base' && c.role !== 'target');
        const targetBtn = document.getElementById('target-cycle-btn');
        if (targetBtn) {
            targetBtn.textContent = '🎯 ' + to.name;
            targetBtn.title = 'Custom target: ' + to.name;
        }
        const colorBase = PEQDB_Module.colorPalette[0];
        const colorTarget = '#2563eb';
        PEQDB_Module.STATE.activeCurves.push({
            uid: from.id + '-match-base-' + Date.now(), id: from.id, name: from.name,
            data: from.data, color: colorBase, role: 'base', visible: true, offset: 0
        });
        PEQDB_Module.STATE.activeCurves.push({
            uid: to.id + '-match-target-' + Date.now(), id: to.id, name: to.name,
            data: to.data, color: colorTarget, role: 'target', visible: true, offset: 0
        });
        PEQDB_Module.updateAll();
        App.switchTab('eq');
        showToast(`Matching ${from.name} → ${to.name}…`, '🪄', { duration: 2200 });
        try {
            await PEQDB_Module.generateLeastSquaresAutoEQ();
        } catch (e) {
            console.error('[Match sound] solve failed', e);
            showToast('The match solve failed: ' + (e && e.message ? e.message : e), '⚠️');
        }
    },

    openValueMap: function () {
        const matches = Array.isArray(this._lastMatches) ? this._lastMatches : [];
        if (!matches.length) {
            showToast('Run FIND MATCHES first — the value map uses that shortlist.', 'ℹ️');
            return;
        }
        const points = [];
        matches.forEach(m => {
            const { db } = this._findItemRecord(m.id);
            const price = Number((db && (db.price_usd || db.price)) || m.price || 0);
            const score = Number(m.score);
            if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(score)) return;
            points.push({
                id: m.id,
                name: m.name || (db && db.name) || m.id,
                price, score,
                sources: m.sourceCount || (db && db.files && db.files.length) || 1,
                form: (db && db.form_factor) || m.formFactor || ''
            });
        });
        if (points.length < 4) {
            showToast('The current shortlist has too few priced matches for a value map.', 'ℹ️');
            return;
        }

        // Pareto frontier: the highest score available at or below each price.
        // A product on it is not beaten by anything cheaper; a product below it
        // costs more for less score, which is the useful part of the picture.
        const sorted = points.slice().sort((a, b) => a.price - b.price);
        let best = -Infinity;
        const frontier = [];
        sorted.forEach(p => {
            if (p.score > best) { best = p.score; frontier.push(p); }
        });
        const frontierIds = new Set(frontier.map(p => p.id));
        const bestValue = frontier.slice().sort((a, b) => (b.score / Math.log10(b.price + 10)) - (a.score / Math.log10(a.price + 10))).slice(0, 8);

        UIKit.read({
            title: '💎 Value map',
            subtitle: `${points.length} priced matches · drag the pointer over a dot for details`,
            actions: [{
                label: 'Close',
                onClick: () => UIKit.closeReader()
            }],
            render: (body) => {
                body.style.position = 'relative';
                const canvas = document.createElement('canvas');
                canvas.width = 920;
                canvas.height = 440;
                canvas.style.cssText = 'width:100%;height:auto;display:block;background:#050507;border:1px solid var(--line);border-radius:var(--r-xs);';
                body.appendChild(canvas);
                const tip = document.createElement('div');
                tip.style.cssText = 'position:absolute;pointer-events:none;display:none;background:#000;color:#fff;border:1px solid var(--line);padding:4px 6px;font-size:11px;line-height:1.35;z-index:5;white-space:nowrap;';
                body.appendChild(tip);

                const draw = () => {
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return;
                    const W = canvas.width, H = canvas.height;
                    const padL = 58, padR = 24, padT = 26, padB = 44;
                    ctx.clearRect(0, 0, W, H);
                    ctx.fillStyle = '#050507';
                    ctx.fillRect(0, 0, W, H);
                    const minP = Math.max(5, Math.floor(Math.min(...points.map(p => p.price)) / 10) * 10);
                    const maxP = Math.ceil(Math.max(...points.map(p => p.price)) / 10) * 10;
                    const minS = 0, maxS = 100;
                    const x = (price) => padL + (Math.log10(price) - Math.log10(minP)) / (Math.log10(maxP) - Math.log10(minP)) * (W - padL - padR);
                    const y = (score) => padT + (maxS - score) / (maxS - minS) * (H - padT - padB);
                    // grid
                    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
                    ctx.fillStyle = 'rgba(255,255,255,0.45)';
                    ctx.font = '11px ui-monospace, monospace';
                    ctx.lineWidth = 1;
                    [0, 25, 50, 75, 100].forEach(s => {
                        ctx.beginPath(); ctx.moveTo(padL, y(s)); ctx.lineTo(W - padR, y(s)); ctx.stroke();
                        ctx.fillText(s + '%', 12, y(s) + 4);
                    });
                    const ticks = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000].filter(v => v >= minP && v <= maxP);
                    ticks.forEach(v => {
                        ctx.beginPath(); ctx.moveTo(x(v), padT); ctx.lineTo(x(v), H - padB); ctx.stroke();
                        ctx.fillText('$' + v, x(v) - 10, H - 18);
                    });
                    ctx.fillStyle = 'rgba(255,255,255,0.6)';
                    ctx.fillText('PRICE (log)', W / 2 - 32, H - 4);
                    ctx.save();
                    ctx.translate(14, H / 2 + 30);
                    ctx.rotate(-Math.PI / 2);
                    ctx.fillText('MATCH SCORE', 0, 0);
                    ctx.restore();

                    // frontier line
                    if (frontier.length > 1) {
                        ctx.strokeStyle = 'rgba(52,211,153,0.75)';
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        frontier.forEach((p, i) => { if (i === 0) ctx.moveTo(x(p.price), y(p.score)); else ctx.lineTo(x(p.price), y(p.score)); });
                        ctx.stroke();
                    }
                    const drawPoint = (p) => {
                        const on = frontierIds.has(p.id);
                        const r = Math.max(4, Math.min(9, 3 + Math.log2(p.sources || 1)));
                        ctx.beginPath();
                        ctx.arc(x(p.price), y(p.score), r, 0, Math.PI * 2);
                        ctx.fillStyle = on ? 'rgba(52,211,153,0.85)' : 'rgba(96,165,250,0.55)';
                        ctx.fill();
                        ctx.strokeStyle = on ? '#34d399' : 'rgba(255,255,255,0.25)';
                        ctx.lineWidth = 1.2;
                        ctx.stroke();
                    };
                    points.forEach(drawPoint);

                    // label the extreme value picks only; labelling every dot
                    // turns the map into unreadable confetti.
                    ctx.font = '10px ui-monospace, monospace';
                    bestValue.slice(0, 4).forEach(p => {
                        ctx.fillStyle = '#34d399';
                        const tx = Math.min(W - 150, Math.max(padL, x(p.price) + 8));
                        ctx.fillText(p.name.length > 22 ? p.name.slice(0, 20) + '…' : p.name, tx, Math.max(padT + 10, y(p.score) - 8));
                    });

                    canvas._map = { x, y, minP, maxP, points };
                };
                draw();

                canvas.addEventListener('mousemove', (e) => {
                    const rect = canvas.getBoundingClientRect();
                    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
                    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
                    const map = canvas._map;
                    if (!map) return;
                    let nearest = null, nd = 16;
                    map.points.forEach(p => {
                        const dx = map.x(p.price) - mx, dy = map.y(p.score) - my;
                        const d = Math.sqrt(dx * dx + dy * dy);
                        if (d < nd) { nd = d; nearest = p; }
                    });
                    if (!nearest) { tip.style.display = 'none'; return; }
                    tip.innerHTML = `<strong>${esc(nearest.name)}</strong><br>$${nearest.price} · ${nearest.score.toFixed(1)}% · ${nearest.sources} src${frontierIds.has(nearest.id) ? ' · ◆ value' : ''}`;
                    tip.style.display = 'block';
                    tip.style.left = Math.min(rect.width - 220, e.clientX - rect.left + 12) + 'px';
                    tip.style.top = Math.max(4, e.clientY - rect.top - 44) + 'px';
                });
                canvas.addEventListener('mouseleave', () => { tip.style.display = 'none'; });

                const table = document.createElement('div');
                table.style.cssText = 'margin-top:10px;display:grid;grid-template-columns:1fr auto auto;gap:3px 10px;font-size:var(--t-xs);';
                table.innerHTML = '<div style="color:var(--text-lo);font-size:var(--t-micro);text-transform:uppercase;letter-spacing:.06em;">Best value</div><div style="color:var(--text-lo);font-size:var(--t-micro);text-transform:uppercase;letter-spacing:.06em;text-align:right;">Price</div><div style="color:var(--text-lo);font-size:var(--t-micro);text-transform:uppercase;letter-spacing:.06em;text-align:right;">Score</div>' +
                    bestValue.map(p => `<div style="color:var(--text-hi);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.name)}</div><div style="color:var(--text-mid);text-align:right;">$${p.price}</div><div style="color:var(--accent);text-align:right;">${p.score.toFixed(1)}%</div>`).join('');
                body.appendChild(table);
                const note = document.createElement('div');
                note.className = 'type-micro';
                note.style.cssText = 'margin-top:8px;color:var(--text-lo);line-height:1.5;';
                note.textContent = 'Green dots and the line are the Pareto frontier: nothing cheaper scores higher. Dot size is the number of measurements behind the score.';
                body.appendChild(note);
            }
        });
    }
};

Object.assign(FindEngine, Find_ExtrasMethods);
