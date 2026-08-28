const EQ_Sculptor = {
    sculptPoints: [
        { hz: 22, val: 81.0 },
        { hz: 100, val: 76.5 },
        { hz: 350, val: 74.0 },
        { hz: 1000, val: 75.0 },
        { hz: 3000, val: 83.0 },
        { hz: 5500, val: 79.0 },
        { hz: 10000, val: 76.0 },
        { hz: 18000, val: 70.0 }
    ],
    defaultSculptPoints: [
        { hz: 22, val: 81.0 },
        { hz: 100, val: 76.5 },
        { hz: 350, val: 74.0 },
        { hz: 1000, val: 75.0 },
        { hz: 3000, val: 83.0 },
        { hz: 5500, val: 79.0 },
        { hz: 10000, val: 76.0 },
        { hz: 18000, val: 70.0 }
    ],

    convertActiveToSculpt: function(PEQDB_Module, showToast) {
        let sourceCurve = PEQDB_Module.STATE.activeCurves.find(c => c.role === 'target' && c.id !== 'custom_sculptor');
        if (!sourceCurve) {
            sourceCurve = PEQDB_Module.STATE.activeCurves.find(c => c.role === 'base' || c.role === 'reference');
        }

        if (!sourceCurve) {
            showToast("Load a target or reference curve first.", "⚠️");
            return;
        }

        const normData = PEQDB_Module.getNormalizedData(sourceCurve.data, sourceCurve.name);
        const spline = PEQDB_Module.Spline.build(normData);
        if (!spline) {
            showToast("Failed to process curve geometry.", "⚠️");
            return;
        }

        this.sculptPoints = this.sculptPoints.map(p => {
            const newVal = PEQDB_Module.Spline.evaluate(spline, p.hz);
            return { hz: p.hz, val: newVal };
        });

        PEQDB_Module.setTarget('sculptor');
        showToast(`Converted "${sourceCurve.name}" to editable target!`, "✏️");
    },

    handleSculptChangeDirect: function(index, db, PEQDB_Module) {
        this.sculptPoints[index].val = db;
        this.updateSculptTargetData(PEQDB_Module);
        if (window.EQ) EQ.updateAll();
    },

    updateSculptTargetData: function(PEQDB_Module) {
        const activeTarget = PEQDB_Module.STATE.activeCurves.find(c => c.role === 'target');
        if (activeTarget) {
            if (PEQDB_Module.sculptPoints && PEQDB_Module.sculptPoints !== this.sculptPoints && Array.isArray(PEQDB_Module.sculptPoints) && PEQDB_Module.sculptPoints.length === this.sculptPoints.length) {
                const sameRef = PEQDB_Module.sculptPoints === this.sculptPoints;
                if (!sameRef) {
                    // Prefer EQ_Sculptor as source if it was mutated via direct UI, otherwise sync from PEQDB
                    // Detect divergence: if PEQDB has been dragged/drawn, its values differ
                    let diverged = false;
                    for (let i=0;i<this.sculptPoints.length;i++) {
                        if (Math.abs((this.sculptPoints[i].hz - PEQDB_Module.sculptPoints[i].hz))>0.01 || Math.abs(this.sculptPoints[i].val - PEQDB_Module.sculptPoints[i].val)>0.001) { diverged=true; break; }
                    }
                    if (diverged) {
                        this.sculptPoints = PEQDB_Module.sculptPoints.map(p=> ({hz:p.hz,val:p.val}));
                    }
                }
            }
            this.sculptPoints.sort((a, b) => a.hz - b.hz);
            PEQDB_Module.sculptPoints = this.sculptPoints.map(p=> ({hz:p.hz,val:p.val}));
            activeTarget.data = this.sculptPoints.map(p => [p.hz, p.val]);

            activeTarget.cachedNormalized = null;
            activeTarget.cachedSpline = null;
            activeTarget._cmpSplineVersion = (activeTarget._cmpSplineVersion || 0) + 1;
            activeTarget._splineVersion = (activeTarget._splineVersion || 0) + 1;
            activeTarget._splineSourceData = null;
        }
    },

    resetSculptTarget: function(PEQDB_Module) {
        this.sculptPoints = [
            { hz: 22, val: 81.0 },
            { hz: 100, val: 76.5 },
            { hz: 350, val: 74.0 },
            { hz: 1000, val: 75.0 },
            { hz: 3000, val: 83.0 },
            { hz: 5500, val: 79.0 },
            { hz: 10000, val: 76.0 },
            { hz: 18000, val: 70.0 }
        ];
        this.updateSculptTargetData(PEQDB_Module);
        if (window.EQ) EQ.updateAll();
    },

    getSculptPoints: function() {
        return this.sculptPoints;
    },

    setSculptPoints: function(points) {
        if (Array.isArray(points)) {
            this.sculptPoints = points;
        }
    }
};

// Export for both module and global usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EQ_Sculptor;
} else {
    window.EQ_Sculptor = EQ_Sculptor;
}