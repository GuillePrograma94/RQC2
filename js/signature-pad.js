/**
 * Pad de firma reutilizable (Elo tactil, Wacom lapiz, XPPEN tableta, etc.)
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
        const fillContainer = opts.fillContainer === true;
        const tabletMode = opts.tabletMode === true;
        const minHeight = opts.minHeight || (tabletMode ? 200 : 300);
        const heightRatio = opts.heightRatio || 0.32;
        const maxHeight = opts.maxHeight || 420;

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
            if (fillContainer) {
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

        const getPos = (event) => {
            if (event.touches && event.touches.length > 0) {
                const touch = event.touches[0];
                return getPosFromClient(touch.clientX, touch.clientY);
            }
            if (event.changedTouches && event.changedTouches.length > 0) {
                const touch = event.changedTouches[0];
                return getPosFromClient(touch.clientX, touch.clientY);
            }
            return getPosFromClient(event.clientX, event.clientY);
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
            if (activePointerId !== null && event.pointerId !== undefined && event.pointerId !== activePointerId) {
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

        if (supportsPointer) {
            addListener(canvas, 'pointerdown', startDraw, { passive: false });
            addListener(canvas, 'pointermove', moveDraw, { passive: false });
            addListener(canvas, 'pointerup', endDraw, { passive: false });
            addListener(canvas, 'pointercancel', endDraw, { passive: false });
            addListener(canvas, 'pointerleave', endDraw, { passive: false });
            if ('onpointerrawupdate' in canvas) {
                addListener(canvas, 'pointerrawupdate', moveDraw, { passive: false });
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

        resizeCanvas();
        if (fillContainer || tabletMode) {
            requestAnimationFrame(() => {
                resizeCanvas();
            });
        } else {
            requestAnimationFrame(resizeCanvas);
            if (typeof ResizeObserver !== 'undefined') {
                resizeObserver = new ResizeObserver(() => resizeCanvas());
                resizeObserver.observe(wrapper);
            }
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

        if (tabletMode) {
            requestAnimationFrame(() => {
                padState.focus();
            });
        }

        return padState;
    }

    global.SignaturePad = {
        setup: setupSignaturePadCanvas
    };
})(window);
