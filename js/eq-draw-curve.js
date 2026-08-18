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
