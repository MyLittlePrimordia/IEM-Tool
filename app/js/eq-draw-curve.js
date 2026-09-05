 const EQ_DrawCurveMethods = {
     // F-7 frame-budget draw scheduler. The old wall-clock throttle
     // (16/24/50ms buckets) still rasterized twice inside a single animation
     // frame whenever two state changes landed in the same bucket window —
     // and each raster strokes ~6 full-curve passes over a 1000-point grid.
     // The rAF coalescer guarantees AT MOST ONE raster per animation frame:
     // every drawCurve() call inside a frame collapses into the next frame's
     // single paint, which always reads the LATEST state (no intermediate
     // snapshots, so slider drags can never end on a stale frame). The
     // drawPending flag doubles as an in-flight guard so re-entrant calls
     // from rAF callbacks themselves (e.g. resize storms) can't queue a
     // second raster for the same frame.
     drawCurve: function() {
         if (this.drawPending) return;
         const cv = document.getElementById("eq-squiglinkViz");
         if (!cv || cv.clientWidth === 0 || cv.clientHeight === 0) return;
         this.drawPending = true;
         requestAnimationFrame(() => {
             this.drawPending = false;
             // Re-check size inside the frame: a hidden canvas (tab switch,
             // fullscreen exit) must not schedule endless empty rAFs.
             const c = document.getElementById("eq-squiglinkViz");
             if (!c || c.clientWidth === 0 || c.clientHeight === 0) return;
             this.lastDrawTime = Date.now();
             this.drawSquiglinkGraphInternal();
         });
     }
 };
