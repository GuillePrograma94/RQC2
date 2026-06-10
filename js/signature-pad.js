/**
 * Pad de firma reutilizable (Elo tactil, XPPEN lapiz, Wacom, etc.)
 */
(function (global) {
    function cropCanvasToContent(sourceCanvas) {
        const ctx = sourceCanvas.getContext('2d');
        const w = sourceCanvas.width;
        const h = sourceCanvas.height;
        if (!w || !h) {
            return sourceCanvas.toDataURL('image/png');
        }
        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;
        let minX = w;
        let minY = h;
        let maxX = 0;
        let maxY = 0;
        let found = false;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const alpha = data[(y * w + x) * 4 + 3];
                if (alpha > 0) {
                    found = true;
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (!found) {
            return sourceCanvas.toDataURL('image/png');
        }
        const pad = Math.max(4, Math.floor(Math.min(w, h) * 0.02));
        minX = Math.max(0, minX - pad);
        minY = Math.max(0, minY - pad);
        maxX = Math.min(w - 1, maxX + pad);
        maxY = Math.min(h - 1, maxY + pad);
        const cropW = maxX - minX + 1;
        const cropH = maxY - minY + 1;
        const tmp = document.createElement('canvas');
        tmp.width = cropW;
        tmp.height = cropH;
        const tmpCtx = tmp.getContext('2d');
        tmpCtx.drawImage(sourceCanvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
        return tmp.toDataURL('image/png');
    }

    function setupSignaturePadCanvas(options) {
        const opts = options || {};
        const canvasId = opts.canvasId || 'albaranSignatureCanvas';
        const canvas = document.getElementById(canvasId);
        const wrapper = canvas ? canvas.parentElement : null;
        if (!canvas || !wrapper) {
            return null;
        }

        const ctx = canvas.getContext('2d');
        let logicalWidth = 0;
        let logicalHeight = 0;
        let dpr = 1;
        let activePointerId = null;
        let hasStroke = false;
        let lastX = 0;
        let lastY = 0;
        let resizeObserver = null;
        const listeners = [];
        const supportsPointer = typeof global.PointerEvent !== 'undefined';
        const fillWrapper = opts.fillWrapper === true || opts.fillContainer === true;
        const tabletMapToCanvas = opts.tabletMapToCanvas === true || opts.tabletMode === true;
        const minHeight = opts.minHeight || (tabletMapToCanvas ? 200 : 300);
        const heightRatio = opts.heightRatio || 0.32;
        const maxHeight = opts.maxHeight || 420;

        let penCaptureRoot = opts.penCaptureRoot || null;
        if (typeof penCaptureRoot === 'string') {
            penCaptureRoot = document.getElementById(penCaptureRoot);
        }
        let tabletMapRoot = opts.tabletMapRoot || null;
        if (typeof tabletMapRoot === 'string') {
            tabletMapRoot = document.getElementById(tabletMapRoot);
        }

        canvas.setAttribute('tabindex', '0');

        const applyBrush = (lineWidth) => {
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
        };

        const brushWidthForEvent = (event) => {
            if (event && event.pointerType === 'pen' && typeof event.pressure === 'number' && event.pressure > 0) {
                return 1.5 + event.pressure * 3.5;
            }
            if (event && event.pointerType === 'pen') {
                return 2.5;
            }
            return 3.5;
        };

        const resetCanvasTransform = () => {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(dpr, dpr);
            applyBrush(3.5);
        };

        const resizeCanvas = () => {
            const rect = wrapper.getBoundingClientRect();
            logicalWidth = Math.max(320, Math.floor(rect.width));
            if (fillWrapper && rect.height > 0) {
                logicalHeight = Math.max(minHeight, Math.floor(rect.height));
            } else {
                logicalHeight = Math.max(
                    minHeight,
                    Math.floor(Math.min(global.innerHeight * heightRatio, maxHeight))
                );
            }
            dpr = Math.min(global.devicePixelRatio || 1, 2);

            canvas.width = Math.floor(logicalWidth * dpr);
            canvas.height = Math.floor(logicalHeight * dpr);
            canvas.style.width = `${logicalWidth}px`;
            canvas.style.height = `${logicalHeight}px`;
            resetCanvasTransform();
        };

        const getPosFromClient = (clientX, clientY) => {
            const bounds = canvas.getBoundingClientRect();
            if (!bounds.width || !bounds.height) {
                return { x: 0, y: 0 };
            }
            const x = ((clientX - bounds.left) / bounds.width) * logicalWidth;
            const y = ((clientY - bounds.top) / bounds.height) * logicalHeight;
            return {
                x: Math.max(0, Math.min(logicalWidth, x)),
                y: Math.max(0, Math.min(logicalHeight, y))
            };
        };

        const getTabletMapRect = () => {
            const mapEl = tabletMapRoot || wrapper;
            if (mapEl && mapEl.getBoundingClientRect) {
                return mapEl.getBoundingClientRect();
            }
            return wrapper.getBoundingClientRect();
        };

        const getPosFromTabletMap = (clientX, clientY) => {
            const bounds = getTabletMapRect();
            if (!bounds.width || !bounds.height) {
                return { x: 0, y: 0 };
            }
            const nx = (clientX - bounds.left) / bounds.width;
            const ny = (clientY - bounds.top) / bounds.height;
            return {
                x: Math.max(0, Math.min(logicalWidth, nx * logicalWidth)),
                y: Math.max(0, Math.min(logicalHeight, ny * logicalHeight))
            };
        };

        const getPos = (event) => {
            if (event.touches && event.touches.length > 0) {
                const touch = event.touches[0];
                return getPosFromClient(touch.clientX, touch.clientY);
            }
            if (event.changedTouches && event.changedTouches.length > 0) {
                const touch = event.changedTouches[0];
                return getPosFromClient(touch.clientX, touch.clientY);
            }
            if (tabletMapToCanvas && event.pointerType === 'pen') {
                return getPosFromTabletMap(event.clientX, event.clientY);
            }
            return getPosFromClient(event.clientX, event.clientY);
        };

        const isPenEvent = (event) => {
            return !!(event && event.pointerType === 'pen');
        };

        const isPenLikeEvent = (event) => {
            if (!event) return false;
            if (event.pointerType === 'pen' || event.pointerType === 'touch') {
                return true;
            }
            return false;
        };

        const isUiControlTarget = (target) => {
            if (!target || !target.closest) {
                return false;
            }
            return !!target.closest('button, a, input, select, textarea, .signature-modal-actions');
        };

        const isActivePointer = (event) => {
            if (!event || activePointerId === null) {
                return false;
            }
            if (event.pointerId === undefined) {
                return true;
            }
            return event.pointerId === activePointerId;
        };

        const strokeTo = (event) => {
            const pos = getPos(event);
            applyBrush(brushWidthForEvent(event));
            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
            lastX = pos.x;
            lastY = pos.y;
            hasStroke = true;
        };

        const startDraw = (event) => {
            event.preventDefault();
            if (activePointerId !== null) {
                if (event.pointerId === undefined || event.pointerId === activePointerId) {
                    return;
                }
                return;
            }
            activePointerId = event.pointerId !== undefined ? event.pointerId : 'mouse-fallback';
            if (canvas.setPointerCapture && event.pointerId !== undefined) {
                try {
                    canvas.setPointerCapture(event.pointerId);
                } catch (captureErr) {
                    console.warn('No se pudo capturar el puntero:', captureErr);
                }
            }
            const pos = getPos(event);
            lastX = pos.x;
            lastY = pos.y;
            applyBrush(brushWidthForEvent(event));
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.lineTo(pos.x + 0.01, pos.y + 0.01);
            ctx.stroke();
            hasStroke = true;
        };

        const moveDraw = (event) => {
            if (!isActivePointer(event)) {
                return;
            }
            if (supportsPointer && typeof event.buttons === 'number' && event.buttons === 0) {
                return;
            }
            event.preventDefault();
            strokeTo(event);
        };

        const endDraw = (event) => {
            if (event) {
                if (!isActivePointer(event)) {
                    return;
                }
                event.preventDefault();
                if (canvas.releasePointerCapture && event.pointerId !== undefined) {
                    try {
                        if (canvas.hasPointerCapture && canvas.hasPointerCapture(event.pointerId)) {
                            canvas.releasePointerCapture(event.pointerId);
                        }
                    } catch (releaseErr) {
                        console.warn('No se pudo liberar el puntero:', releaseErr);
                    }
                }
            }
            activePointerId = null;
        };

        const addListener = (target, type, handler, listenerOptions) => {
            target.addEventListener(type, handler, listenerOptions);
            listeners.push({ target, type, handler, options: listenerOptions });
        };

        const onRootPointerDown = (event) => {
            if (!penCaptureRoot || !isPenLikeEvent(event)) {
                return;
            }
            if (isUiControlTarget(event.target)) {
                return;
            }
            if (event.target === canvas || canvas.contains(event.target)) {
                return;
            }
            startDraw(event);
        };

        const onRootPointerMove = (event) => {
            if (!penCaptureRoot || !isPenLikeEvent(event)) {
                return;
            }
            if (!isActivePointer(event)) {
                return;
            }
            moveDraw(event);
        };

        const onRootPointerEnd = (event) => {
            if (!penCaptureRoot || !isPenLikeEvent(event)) {
                return;
            }
            endDraw(event);
        };

        const onTabletMapPointerDown = (event) => {
            if (!tabletMapToCanvas || !isPenEvent(event)) {
                return;
            }
            if (isUiControlTarget(event.target)) {
                return;
            }
            event.preventDefault();
            startDraw(event);
        };

        const onTabletMapPointerMove = (event) => {
            if (!tabletMapToCanvas || !isPenEvent(event)) {
                return;
            }
            if (!isActivePointer(event)) {
                return;
            }
            moveDraw(event);
        };

        const onTabletMapPointerEnd = (event) => {
            if (!tabletMapToCanvas || !isPenEvent(event)) {
                return;
            }
            endDraw(event);
        };

        const skipCanvasPenEvent = (event) => {
            return tabletMapToCanvas && isPenEvent(event);
        };

        const onCanvasPointerDown = (event) => {
            if (skipCanvasPenEvent(event)) {
                return;
            }
            startDraw(event);
        };

        const onCanvasPointerMove = (event) => {
            if (skipCanvasPenEvent(event)) {
                return;
            }
            moveDraw(event);
        };

        const onCanvasPointerEnd = (event) => {
            if (skipCanvasPenEvent(event)) {
                return;
            }
            endDraw(event);
        };

        if (supportsPointer) {
            addListener(canvas, 'pointerdown', onCanvasPointerDown, { passive: false });
            addListener(canvas, 'pointermove', onCanvasPointerMove, { passive: false });
            addListener(canvas, 'pointerup', onCanvasPointerEnd, { passive: false });
            addListener(canvas, 'pointercancel', onCanvasPointerEnd, { passive: false });
            addListener(canvas, 'pointerleave', onCanvasPointerEnd, { passive: false });
            if ('onpointerrawupdate' in canvas) {
                addListener(canvas, 'pointerrawupdate', onCanvasPointerMove, { passive: false });
            }
            if (tabletMapToCanvas) {
                const tabletCaptureTarget = document;
                addListener(tabletCaptureTarget, 'pointerdown', onTabletMapPointerDown, { passive: false, capture: true });
                addListener(tabletCaptureTarget, 'pointermove', onTabletMapPointerMove, { passive: false, capture: true });
                addListener(tabletCaptureTarget, 'pointerup', onTabletMapPointerEnd, { passive: false, capture: true });
                addListener(tabletCaptureTarget, 'pointercancel', onTabletMapPointerEnd, { passive: false, capture: true });
                if ('onpointerrawupdate' in document) {
                    addListener(tabletCaptureTarget, 'pointerrawupdate', onTabletMapPointerMove, { passive: false, capture: true });
                }
            } else if (penCaptureRoot) {
                addListener(penCaptureRoot, 'pointerdown', onRootPointerDown, { passive: false });
                addListener(penCaptureRoot, 'pointermove', onRootPointerMove, { passive: false });
                addListener(penCaptureRoot, 'pointerup', onRootPointerEnd, { passive: false });
                addListener(penCaptureRoot, 'pointercancel', onRootPointerEnd, { passive: false });
            }
        } else {
            addListener(canvas, 'touchstart', startDraw, { passive: false });
            addListener(canvas, 'touchmove', moveDraw, { passive: false });
            addListener(canvas, 'touchend', endDraw, { passive: false });
            addListener(canvas, 'touchcancel', endDraw, { passive: false });
            addListener(canvas, 'mousedown', startDraw, { passive: false });
            addListener(canvas, 'mousemove', moveDraw, { passive: false });
            addListener(canvas, 'mouseup', endDraw, { passive: false });
            addListener(canvas, 'mouseleave', endDraw, { passive: false });
        }

        const padState = {
            clear() {
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                resetCanvasTransform();
                hasStroke = false;
            },
            isEmpty() {
                return !hasStroke;
            },
            toDataUrl() {
                if (opts.cropToContent !== false) {
                    return cropCanvasToContent(canvas);
                }
                return canvas.toDataURL('image/png');
            },
            focus() {
                try {
                    canvas.focus({ preventScroll: true });
                } catch (focusErr) {
                    canvas.focus();
                }
            },
            destroy() {
                if (resizeObserver) {
                    resizeObserver.disconnect();
                    resizeObserver = null;
                }
                listeners.forEach(({ target, type, handler, options: listenerOptions }) => {
                    target.removeEventListener(type, handler, listenerOptions);
                });
                listeners.length = 0;
            }
        };

        resizeCanvas();
        requestAnimationFrame(() => {
            resizeCanvas();
            if (tabletMapToCanvas) {
                padState.focus();
            }
        });
        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(() => resizeCanvas());
            resizeObserver.observe(wrapper);
            if (tabletMapRoot && tabletMapRoot !== wrapper) {
                resizeObserver.observe(tabletMapRoot);
            }
        }

        return padState;
    }

    global.SignaturePad = {
        setup: setupSignaturePadCanvas
    };
})(window);
