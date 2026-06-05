/**
 * Pad de firma reutilizable (Elo tactil, Wacom lapiz, etc.)
 */
(function (global) {
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
        const minHeight = opts.minHeight || 300;
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
            logicalHeight = Math.max(
                minHeight,
                Math.floor(Math.min(global.innerHeight * heightRatio, maxHeight))
            );
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
        requestAnimationFrame(resizeCanvas);
        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(() => resizeCanvas());
            resizeObserver.observe(wrapper);
        }

        return {
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
    }

    global.SignaturePad = {
        setup: setupSignaturePadCanvas
    };
})(window);
