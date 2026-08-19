const EQ_DrawCurveMethods = {
    drawCurve: function() {
        if (this.drawPending) return;
        const cv = document.getElementById("eq-squiglinkViz");
        if (!cv || cv.clientWidth === 0 || cv.clientHeight === 0) return;
        
        const now = Date.now();
        const isDragging = this.isDragging;
        
        // Throttle every draw, not just during playback: the overlay can keep
        // scheduling frames while paused, and a visible graph pays for every
        // redraw. Node dragging keeps the 60 FPS interaction budget.
        const limit = isDragging ? 16 : (this.showSpectrumOverlay ? 24 : 50);
        if (now - this.lastDrawTime < limit) {
            // Trailing edge: guarantee the final state is drawn once the
            // throttle window closes, so the last update is never dropped
            // (e.g. the final drag tick or a one-shot toggle).
            if (!this.drawTrailingPending) {
                this.drawTrailingPending = true;
                const wait = limit - (now - this.lastDrawTime) + 1;
                setTimeout(() => {
                    this.drawTrailingPending = false;
                    if (!this.drawPending) this.drawCurve();
                }, Math.max(0, wait));
            }
            return;
        }
        
        this.drawPending = true;
        requestAnimationFrame(() => {
            this.drawPending = false;
            this.lastDrawTime = Date.now();
            this.drawSquiglinkGraphInternal();
        });
    }
};
