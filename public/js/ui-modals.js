// js/ui-modals.js — zoom modal 显隐 + drawImage 同步 + editorModal 关闭后 zoom 刷新
import {
    dom as stateDom,
    currentMode,
    lastMergedGrid,
    lastCellSize,
    lastGridCols,
    lastGridRows,
} from './state.js';

const ZOOM_FIT_MARGIN = 0.95;
const MIN_SCALE_RATIO = 0.25;
const MAX_SCALE = 16;
const zoomState = { scale: 1, tx: 0, ty: 0 };

function applyZoomTransform() {
    const zc = stateDom.zoomCanvas;
    zc.style.width = zc.width * zoomState.scale + 'px';
    zc.style.height = zc.height * zoomState.scale + 'px';
    zc.style.transform = `translate(${zoomState.tx}px, ${zoomState.ty}px)`;
}

function fitToScreen() {
    if (!stateDom.canvasFrame || !stateDom.zoomCanvas.width) return;
    const innerW = stateDom.canvasFrame.clientWidth;
    const innerH = stateDom.canvasFrame.clientHeight;
    const fit =
        Math.min(innerW / stateDom.zoomCanvas.width, innerH / stateDom.zoomCanvas.height) *
        ZOOM_FIT_MARGIN;
    zoomState.scale = fit;
    zoomState.tx = (innerW - stateDom.zoomCanvas.width * zoomState.scale) / 2;
    zoomState.ty = (innerH - stateDom.zoomCanvas.height * zoomState.scale) / 2;
    applyZoomTransform();
}

export function fitZoomToScreen() {
    fitToScreen();
}

export function getZoomScaleBounds() {
    const fit =
        Math.min(
            stateDom.canvasFrame.clientWidth / stateDom.zoomCanvas.width,
            stateDom.canvasFrame.clientHeight / stateDom.zoomCanvas.height
        ) * ZOOM_FIT_MARGIN;
    return { min: fit * MIN_SCALE_RATIO, max: MAX_SCALE };
}

export function syncZoomCanvas() {
    const zc = stateDom.zoomCanvas;
    const perlerCanvas = stateDom.perlerCanvas;
    zc.width = perlerCanvas.width;
    zc.height = perlerCanvas.height;
    const ctx = zc.getContext('2d');
    ctx.clearRect(0, 0, zc.width, zc.height);
    ctx.drawImage(perlerCanvas, 0, 0);
    stateDom.zoomModeLabel.textContent = currentMode === 'fused' ? '成品预览' : '网格图';
}

export async function openZoomModal() {
    if (!lastMergedGrid) return;
    const { syncModeToggleButton } = await import('./ui-mode.js');
    const { syncFuseEffectButtons, syncFuseEffectDisabledState } = await import('./ui-fuse.js');
    if (typeof syncModeToggleButton === 'function') syncModeToggleButton();
    if (typeof syncFuseEffectDisabledState === 'function') syncFuseEffectDisabledState();
    if (typeof syncFuseEffectButtons === 'function') syncFuseEffectButtons();
    syncZoomCanvas();
    stateDom.zoomModal.style.display = 'flex';
    fitToScreen();
}

export function closeZoomModal() {
    stateDom.zoomModal.style.display = 'none';
}

export function attachModalsListeners() {
    if (stateDom.fusedPreviewZoomButton) {
        stateDom.fusedPreviewZoomButton.addEventListener('click', openZoomModal);
    }
    if (stateDom.closeZoom) {
        stateDom.closeZoom.addEventListener('click', closeZoomModal);
    }
    if (stateDom.zoomModal) {
        stateDom.zoomModal.addEventListener('click', function (e) {
            if (e.target === stateDom.zoomModal) closeZoomModal();
        });
    }
    if (stateDom.zoomCanvas) {
        stateDom.zoomCanvas.addEventListener('click', async function (e) {
            if (!lastMergedGrid) return;
            const rect = stateDom.zoomCanvas.getBoundingClientRect();
            const xInCanvas = (e.clientX - rect.left) * (stateDom.zoomCanvas.width / rect.width);
            const yInCanvas = (e.clientY - rect.top) * (stateDom.zoomCanvas.height / rect.height);
            const cs = lastCellSize;
            const col = Math.floor(xInCanvas / cs);
            const row = Math.floor(yInCanvas / cs);
            if (row < 0 || row >= lastGridRows || col < 0 || col >= lastGridCols) return;
            const { openPicker } = await import('./editor.js');
            openPicker(row, col);
        });
    }
    // editorDisplayObserver: editorModal 关闭后刷新 zoom canvas
    if (stateDom.editorModal && typeof MutationObserver !== 'undefined') {
        let prevEditorDisplay = stateDom.editorModal.style.display;
        const editorDisplayObserver = new MutationObserver(function () {
            const cur = stateDom.editorModal.style.display;
            if (
                prevEditorDisplay !== 'none' &&
                cur === 'none' &&
                stateDom.zoomModal.style.display === 'flex'
            ) {
                syncZoomCanvas();
            }
            prevEditorDisplay = cur;
        });
        editorDisplayObserver.observe(stateDom.editorModal, {
            attributes: true,
            attributeFilter: ['style'],
        });
    }

    // ============ Wheel zoom(以光标为中心) ============
    stateDom.canvasFrame.addEventListener(
        'wheel',
        function (e) {
            if (stateDom.zoomModal.style.display !== 'flex') return;
            e.preventDefault();
            // deltaY > 0 = 向下滚 = 缩小;exp 让缩放感更平滑
            const factor = Math.exp(-e.deltaY * 0.0015);
            const { min, max } = getZoomScaleBounds();
            const newScale = Math.max(min, Math.min(max, zoomState.scale * factor));
            if (newScale === zoomState.scale) return;
            // 缩放后保持光标下的画布点不动
            const rect = stateDom.canvasFrame.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            const ratio = newScale / zoomState.scale;
            zoomState.tx = cx - (cx - zoomState.tx) * ratio;
            zoomState.ty = cy - (cy - zoomState.ty) * ratio;
            zoomState.scale = newScale;
            applyZoomTransform();
        },
        { passive: false }
    );

    // ============ Mouse pan(桌面端拖动) ============
    let mouseDrag = null;
    stateDom.canvasFrame.addEventListener('mousedown', function (e) {
        if (stateDom.zoomModal.style.display !== 'flex') return;
        if (e.button !== 0) return;
        mouseDrag = {
            startX: e.clientX,
            startY: e.clientY,
            startTx: zoomState.tx,
            startTy: zoomState.ty,
        };
        stateDom.canvasFrame.style.cursor = 'grabbing';
        e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
        if (!mouseDrag) return;
        if (stateDom.zoomModal.style.display !== 'flex') {
            mouseDrag = null;
            stateDom.canvasFrame.style.cursor = '';
            return;
        }
        zoomState.tx = mouseDrag.startTx + (e.clientX - mouseDrag.startX);
        zoomState.ty = mouseDrag.startTy + (e.clientY - mouseDrag.startY);
        applyZoomTransform();
    });
    window.addEventListener('mouseup', function () {
        if (mouseDrag) {
            mouseDrag = null;
            stateDom.canvasFrame.style.cursor = '';
        }
    });

    // ============ Touch pan + pinch(移动端 / pad) ============
    // touchState.mode: 'pan' 1 指 | 'pinch' 2 指
    // 每次 touchstart 锁定初始状态;touchmove 始终基于初始 start* 计算,中途不更新 start*
    let touchState = null;
    function touchMidPoint(touches) {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2,
        };
    }
    function touchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.hypot(dx, dy);
    }
    stateDom.canvasFrame.addEventListener(
        'touchstart',
        function (e) {
            if (stateDom.zoomModal.style.display !== 'flex') return;
            e.preventDefault();
            const touches = e.touches;
            if (touches.length === 1) {
                touchState = {
                    mode: 'pan',
                    startX: touches[0].clientX,
                    startY: touches[0].clientY,
                    startTx: zoomState.tx,
                    startTy: zoomState.ty,
                };
            } else if (touches.length === 2) {
                const mid = touchMidPoint(touches);
                touchState = {
                    mode: 'pinch',
                    startDist: touchDistance(touches),
                    startMidX: mid.x,
                    startMidY: mid.y,
                    startScale: zoomState.scale,
                    startTx: zoomState.tx,
                    startTy: zoomState.ty,
                };
            }
        },
        { passive: false }
    );
    stateDom.canvasFrame.addEventListener(
        'touchmove',
        function (e) {
            if (stateDom.zoomModal.style.display !== 'flex') return;
            if (!touchState) return;
            e.preventDefault();
            const touches = e.touches;
            if (touchState.mode === 'pan' && touches.length >= 1) {
                zoomState.tx = touchState.startTx + (touches[0].clientX - touchState.startX);
                zoomState.ty = touchState.startTy + (touches[0].clientY - touchState.startY);
                applyZoomTransform();
            } else if (touchState.mode === 'pinch' && touches.length >= 2) {
                const mid = touchMidPoint(touches);
                const dist = touchDistance(touches);
                const { min, max } = getZoomScaleBounds();
                const newScale = Math.max(
                    min,
                    Math.min(max, touchState.startScale * (dist / touchState.startDist))
                );
                // 锚定 startMid 下的画布点 → 跟到新的 mid + 应用 scale 变化
                const rect = stateDom.canvasFrame.getBoundingClientRect();
                const r = newScale / touchState.startScale;
                zoomState.tx =
                    mid.x - rect.left - r * (touchState.startMidX - rect.left - touchState.startTx);
                zoomState.ty =
                    mid.y - rect.top - r * (touchState.startMidY - rect.top - touchState.startTy);
                zoomState.scale = newScale;
                applyZoomTransform();
            }
        },
        { passive: false }
    );
    stateDom.canvasFrame.addEventListener('touchend', function (e) {
        // 2 指 → 1 指时切换为 pan,以当前缩放状态继续
        if (touchState && touchState.mode === 'pinch' && e.touches.length === 1) {
            const t = e.touches[0];
            touchState = {
                mode: 'pan',
                startX: t.clientX,
                startY: t.clientY,
                startTx: zoomState.tx,
                startTy: zoomState.ty,
            };
        } else if (e.touches.length === 0) {
            touchState = null;
        }
    });
    stateDom.canvasFrame.addEventListener('touchcancel', function () {
        touchState = null;
    });

    // ============ ResizeObserver:旋转屏 / 键盘弹起 / 窗口变化时重 fit ============
    // 观察 documentElement(视口)而非 canvasFrame:
    // canvasFrame 没有显式 width,会随内部 canvas 大小自动撑开。
    // 若观察它,用户滚轮/双指缩放会让 canvas 变大 → frame 变大 → ResizeObserver 触发
    // → fitToScreen 把 zoomState.scale 重置回当前 frame 对应的 fit 值,放大效果被反向覆盖。
    // 改为观察视口,只在真正外部尺寸变化(旋转、键盘、窗口)时重 fit,用户缩放不被打断。
    if (typeof ResizeObserver !== 'undefined') {
        const zoomResizeObserver = new ResizeObserver(function () {
            // rAF 包一层,确保 layout 完成后再读尺寸
            requestAnimationFrame(function () {
                if (stateDom.zoomModal.style.display === 'flex') {
                    fitToScreen();
                }
            });
        });
        zoomResizeObserver.observe(document.documentElement);
    }
}
