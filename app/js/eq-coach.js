// Guided "fix my sound" coach. A short symptom interview that turns plain
// language into a small, reversible set of EQ moves. It is deliberately not a
// black box: every recommendation names the band, the gain and what it should
// change, and Apply is one Undo away (toast action restores a full snapshot).
//
// The panel is rendered inside the My Sound hub (personal-targets.js), which is
// why it takes a container instead of owning a modal.
const EQ_CoachMethods = {
    COACH_SYMPTOMS: [
        {
            id: 'bass-light', emoji: '🥁', label: 'Bass feels light',
            why: 'A low shelf at 100 Hz adds weight without thickening the mids.',
            moves: [{ type: 'lowshelf', hz: 100, q: 0.7, gain: 4.0 }]
        },
        {
            id: 'bass-bloated', emoji: '🌊', label: 'Bass is bloated / boomy',
            why: 'Trim the sub-bass shelf; keep the punch around 150–250 Hz intact.',
            moves: [{ type: 'lowshelf', hz: 90, q: 0.7, gain: -3.5 }]
        },
        {
            id: 'muddy', emoji: '🌫️', label: 'Mids sound muddy',
            why: 'A gentle cut at 250 Hz clears congestion without hollowing vocals.',
            moves: [{ type: 'peaking', hz: 260, q: 0.9, gain: -2.5 }]
        },
        {
            id: 'shouty', emoji: '📣', label: 'Vocals are shouty',
            why: 'The 2–3 kHz pinna region is too forward for your ears.',
            moves: [{ type: 'peaking', hz: 2600, q: 1.3, gain: -3.0 }]
        },
        {
            id: 'sibilant', emoji: '🐍', label: '“S” sounds pierce',
            why: 'A narrow cut at 6.5 kHz tames sibilance without dulling the whole treble.',
            moves: [{ type: 'peaking', hz: 6500, q: 2.4, gain: -3.5 }]
        },
        {
            id: 'harsh', emoji: '⚡', label: 'Treble is harsh',
            why: 'A high shelf softens the whole top octave instead of notching one band.',
            moves: [{ type: 'highshelf', hz: 6000, q: 0.7, gain: -3.0 }]
        },
        {
            id: 'dull', emoji: '🌑', label: 'Treble sounds dull',
            why: 'A high shelf at 7 kHz restores air and detail.',
            moves: [{ type: 'highshelf', hz: 7000, q: 0.7, gain: 3.0 }]
        },
        {
            id: 'thin', emoji: '🪶', label: 'Sound is thin / hollow',
            why: 'Lift the lower mids a touch and reduce any 1 kHz scoop.',
            moves: [
                { type: 'peaking', hz: 180, q: 0.8, gain: 2.0 },
                { type: 'peaking', hz: 800, q: 1.0, gain: 1.5 }
            ]
        },
        {
            id: 'metallic', emoji: '🔔', label: 'Upper mids ring',
            why: 'A focused cut around 4 kHz removes the metallic edge.',
            moves: [{ type: 'peaking', hz: 4000, q: 1.8, gain: -3.0 }]
        },
        {
            id: 'imbalance', emoji: '↔️', label: 'One side is louder',
            why: 'That is a channel/fit problem, not an EQ problem. Measure it in Test Lab → Balance first.',
            moves: [], route: 'balance'
        }
    ],

    _coachSelected: null,

    renderCoachPanel: function (container) {
        if (!this._coachSelected) this._coachSelected = new Set();
        const selected = this._coachSelected;
        container.innerHTML = `
            <div class="grid gap-4" style="grid-template-columns: minmax(0,1.1fr) minmax(0,0.9fr);">
                <div>
                    <div class="type-sm font-semibold" style="color:var(--text-hi);">What is wrong with the sound?</div>
                    <p class="type-xs mt-1 leading-relaxed" style="color:var(--text-mid);">Pick every symptom you recognise. The coach only uses small, reversible moves and never touches bands it did not list.</p>
                    <div id="coach-chips" class="flex flex-wrap gap-1.5 mt-2.5"></div>
                    <div class="flex gap-2 mt-3">
                        <button id="coach-apply" type="button" class="cta-primary no-tactile cursor-pointer" style="height:32px;padding:0 14px;border-radius:var(--r-sm);" disabled>Apply to EQ</button>
                        <button id="coach-clear" type="button" class="btn-clear cursor-pointer" style="height:32px;padding:0 12px;border-radius:var(--r-sm);">Clear</button>
                    </div>
                </div>
                <div>
                    <div class="type-micro font-black uppercase tracking-wider mb-1.5" style="color:var(--text-lo);">Recommendation</div>
                    <div id="coach-result" class="type-xs leading-relaxed" style="color:var(--text-mid);">Select a symptom to see the fix.</div>
                </div>
            </div>`;

        const chips = container.querySelector('#coach-chips');
        this.COACH_SYMPTOMS.forEach(sym => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'pt-chip cursor-pointer' + (selected.has(sym.id) ? ' is-on' : '');
            b.dataset.sym = sym.id;
            b.textContent = sym.emoji + ' ' + sym.label;
            b.addEventListener('click', () => {
                if (selected.has(sym.id)) selected.delete(sym.id); else selected.add(sym.id);
                b.classList.toggle('is-on', selected.has(sym.id));
                this._renderCoachResult(container);
            });
            chips.appendChild(b);
        });
        container.querySelector('#coach-clear').addEventListener('click', () => {
            selected.clear();
            chips.querySelectorAll('.pt-chip').forEach(c => c.classList.remove('is-on'));
            this._renderCoachResult(container);
        });
        container.querySelector('#coach-apply').addEventListener('click', () => this._applyCoach(container));
        this._renderCoachResult(container);
    },

    _coachMoves: function () {
        const chosen = this.COACH_SYMPTOMS.filter(s => this._coachSelected.has(s.id));
        const merged = [];
        chosen.forEach(sym => {
            sym.moves.forEach(m => {
                // Coalesce identical/near-identical bands so two symptoms that
                // both cut 250 Hz produce one move, not two competing ones.
                const hit = merged.find(x => x.type === m.type && Math.abs(Math.log(x.hz / m.hz)) < 0.08);
                if (hit) hit.gain = this._clampCoachGain(hit.gain + m.gain);
                else merged.push({ type: m.type, hz: m.hz, q: m.q, gain: m.gain, why: sym.why });
            });
        });
        return { chosen, moves: merged };
    },

    _clampCoachGain: function (g) {
        return Math.max(-8, Math.min(8, Math.round(g * 10) / 10));
    },

    _renderCoachResult: function (container) {
        const result = container.querySelector('#coach-result');
        const apply = container.querySelector('#coach-apply');
        if (!result) return;
        const { chosen, moves } = this._coachMoves();
        if (!chosen.length) {
            result.innerHTML = 'Select a symptom to see the fix.';
            if (apply) apply.disabled = true;
            return;
        }
        if (!moves.length) {
            result.innerHTML = chosen.map(s => `<div class="mb-2"><strong style="color:var(--text-hi)">${s.emoji} ${esc(s.label)}</strong><br>${esc(s.why)}</div>`).join('') +
                '<button id="coach-open-balance" type="button" class="btn-clear cursor-pointer type-micro mt-1" style="height:28px;padding:0 9px;border-radius:var(--r-xs);">Open Test Lab → Balance</button>';
            if (apply) apply.disabled = true;
            const go = result.querySelector('#coach-open-balance');
            if (go) go.addEventListener('click', () => {
                PersonalTargets.close();
                if (typeof TestLab !== 'undefined' && TestLab.switchLeftTab) TestLab.switchLeftTab('balance');
                if (typeof App !== 'undefined') App.switchTab('testlab');
            });
            return;
        }
        const typeLabel = { lowshelf: 'Low shelf', highshelf: 'High shelf', peaking: 'Peak' };
        result.innerHTML = chosen.map(s => `<div class="mb-2"><strong style="color:var(--text-hi)">${s.emoji} ${esc(s.label)}</strong><br>${esc(s.why)}</div>`).join('') +
            '<div class="type-micro font-black uppercase tracking-wider mt-2 mb-1" style="color:var(--text-lo);">Moves</div>' +
            moves.map(m => `<div class="flex justify-between gap-2 py-0.5" style="border-bottom:1px solid var(--line);"><span>${typeLabel[m.type] || 'Peak'} · ${Math.round(m.hz).toLocaleString()} Hz</span><strong style="color:${m.gain > 0 ? 'var(--accent-blue)' : 'var(--accent-amber)'}">${m.gain > 0 ? '+' : ''}${m.gain.toFixed(1)} dB</strong></div>`).join('') +
            '<div class="type-micro mt-2" style="color:var(--text-lo);">Applied to bands 1–' + moves.length + '. Undo is offered in the toast.</div>';
        if (apply) apply.disabled = false;
    },

    _applyCoach: function (container) {
        if (typeof EQ_Module === 'undefined' || !Array.isArray(EQ_Module.bands)) return;
        const { moves } = this._coachMoves();
        if (!moves.length) return;
        const snap = EQ_Module.snapshotEQState ? EQ_Module.snapshotEQState() : null;
        const count = Math.min(moves.length, EQ_Module.bands.length);
        for (let i = 0; i < EQ_Module.bands.length; i++) {
            if (i < count) {
                const m = moves[i];
                EQ_Module.handleTypeChange(i, m.type);
                EQ_Module.handleFreqNumInput(i, m.hz);
                EQ_Module.handleQNumInput(i, m.q);
                EQ_Module.handleGainNumInput(i, m.gain);
            } else {
                // Leave unrelated bands alone except for the bands the coach
                // previously wrote into. We do not know which those were, so
                // only zero the unused tail if it is completely flat already.
                const b = EQ_Module.bands[i];
                if (b && Math.abs(Number(b.gain) || 0) < 0.001) {
                    EQ_Module.handleGainNumInput(i, 0);
                }
            }
        }
        if (typeof EQ_Module.drawCurve === 'function') EQ_Module.drawCurve();
        showToast('Coach applied ' + count + ' EQ move' + (count === 1 ? '' : 's') + '.', '🩺', {
            action: snap ? {
                label: 'Undo',
                onClick: () => {
                    try {
                        EQ_Module.restoreEQState(snap);
                        showToast('EQ restored.', '↩️');
                    } catch (e) {
                        console.error('[Coach] undo failed', e);
                    }
                }
            } : null
        });
    }
};

Object.assign(EQ_Module, EQ_CoachMethods);
