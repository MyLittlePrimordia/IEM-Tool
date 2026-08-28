 const EQ_DrawCurveMethods = {
     drawCurve: function() {
         if (this.drawPending) return;
         const cv = document.getElementById("eq-squiglinkViz");
         if (!cv || cv.clientWidth === 0 || cv.clientHeight === 0) return;
         
         const now = Date.now();
         const isDragging = this.isDragging;
         
         const liveDrag = !!(this._liveDragUntil && performance.now() < this._liveDragUntil);
         
         const limit = (isDragging || liveDrag) ? 16 : (this.showSpectrumOverlay ? 24 : 50);
         if (now - this.lastDrawTime < limit) {
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
             this.lastDrawTime = Date.now();
             this.drawSquiglinkGraphInternal();
             this.drawPending = false;
         });
     }
 };
