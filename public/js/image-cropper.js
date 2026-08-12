// js/image-cropper.js — inline 选区:在原图预览里直接选范围
// 不弹 modal,在传入的容器里加浮动操作面板 + 选区 canvas
//
// 用法:
//   const { enableSelection } = await import('./image-cropper.js');
//   const sel = enableSelection(image, container, {
//       onConfirm: (crop) => { ... },  // crop = {x, y, width, height} in 原图坐标
//       onSkip: () => { ... },         // 取消选区(关闭 UI,不做任何事)
//   });
//   // 之后 sel.destroy() 可主动销毁
//
// UI 形态:
//   顶部居中浮动条:[取消] [重选(完成选区后可点)] [确认裁剪(完成选区后可点)]
//   拖动框选完成后才激活 [重选] / [确认裁剪]

/**
 * 在容器里激活选区 UI
 * @param {HTMLImageElement} image 原图(naturalWidth/Height 已知)
 * @param {HTMLElement} container 容器(必须 position: relative)
 * @param {{onConfirm?: (crop: {x:number, y:number, width:number, height:number}) => void, onSkip?: () => void}} callbacks
 * @returns {{destroy: () => void}}
 */
export function enableSelection(image, container, callbacks = {}) {
    const onConfirm = callbacks.onConfirm || null;
    const onSkip = callbacks.onSkip || null;

    // ===== 1. 创建/复用 canvas overlay =====
    let canvas = container.querySelector('.selection-canvas');
    let canvasNewlyCreated = false;
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.className = 'selection-canvas';
        canvasNewlyCreated = true;
    }
    // 关键:先设 position: absolute,再 append,避免 canvas 初始 300x150 抢占 flex 空间
    // 影响 image 尺寸、触发 ResizeObserver 反馈循环
    canvas.style.position = 'absolute';
    canvas.style.pointerEvents = 'auto'; // 此模式下 canvas 需要接收事件
    if (canvasNewlyCreated) container.appendChild(canvas);

    // ===== 2. 创建/复用操作面板 =====
    let toolbar = container.querySelector('.selection-toolbar');
    let toolbarNewlyCreated = false;
    if (!toolbar) {
        toolbar = document.createElement('div');
        toolbar.className = 'selection-toolbar';
        toolbar.innerHTML = `
            <span class="selection-info">拖动鼠标框选范围</span>
            <button type="button" class="btn-cream selection-cancel">取消</button>
            <button type="button" class="btn-cream selection-reset" disabled>重选</button>
            <button type="button" class="btn-primary selection-confirm" disabled>确认裁剪</button>
        `;
        toolbarNewlyCreated = true;
    }
    if (toolbarNewlyCreated) container.appendChild(toolbar);

    const ctx = canvas.getContext('2d');
    const cancelBtn = toolbar.querySelector('.selection-cancel');
    const resetBtn = toolbar.querySelector('.selection-reset');
    const confirmBtn = toolbar.querySelector('.selection-confirm');
    const infoEl = toolbar.querySelector('.selection-info');

    let dragState = null;
    let crop = null; // 原图坐标 {x, y, width, height}

    // ===== 3. canvas 跟随 img 实际显示尺寸 =====
    function syncCanvasSize() {
        if (!image.isConnected) return;
        const rect = image.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return; // 没布局好,跳过
        canvas.style.left = image.offsetLeft + 'px';
        canvas.style.top = image.offsetTop + 'px';
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        canvas.width = Math.round(rect.width);
        canvas.height = Math.round(rect.height);
        redraw();
    }

    // ===== 4. 坐标转换 =====
    function canvasToOriginal(cx, cy) {
        const cw = canvas.width;
        const ch = canvas.height;
        const iw = image.naturalWidth;
        const ih = image.naturalHeight;
        if (cw === 0 || ch === 0) return { x: 0, y: 0 };
        return {
            x: Math.round((cx / cw) * iw),
            y: Math.round((cy / ch) * ih),
        };
    }
    function originalToCanvas(ox, oy) {
        const cw = canvas.width;
        const ch = canvas.height;
        const iw = image.naturalWidth;
        const ih = image.naturalHeight;
        if (iw === 0 || ih === 0) return { x: 0, y: 0 };
        return {
            x: (ox / iw) * cw,
            y: (oy / ih) * ch,
        };
    }
    function toCanvasRect(c) {
        const a = originalToCanvas(c.x, c.y);
        const b = originalToCanvas(c.x + c.width, c.y + c.height);
        return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }

    // ===== 5. 绘制 =====
    function redraw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const sel = dragState || (crop ? toCanvasRect(crop) : null);
        if (!sel) return;

        const x = Math.min(sel.x1, sel.x2);
        const y = Math.min(sel.y1, sel.y2);
        const w = Math.abs(sel.x2 - sel.x1);
        const h = Math.abs(sel.y2 - sel.y1);

        // 选区外半透明遮罩
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath();
        ctx.rect(0, 0, canvas.width, canvas.height);
        ctx.rect(x, y, w, h);
        ctx.fill('evenodd');
        ctx.restore();

        // 选区边框
        ctx.strokeStyle = '#168b7d';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        // 角点
        const corners = [
            [x, y],
            [x + w, y],
            [x, y + h],
            [x + w, y + h],
        ];
        ctx.fillStyle = '#168b7d';
        for (const [cx, cy] of corners) {
            ctx.beginPath();
            ctx.arc(cx, cy, 4, 0, Math.PI * 2);
            ctx.fill();
        }

        // 尺寸标签
        ctx.fillStyle = '#168b7d';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(`${Math.round(w)} × ${Math.round(h)}`, x + 6, y - 6 < 12 ? y + 18 : y - 6);
    }

    // ===== 6. 拖拽事件 =====
    function getEventPoint(e) {
        const rect = canvas.getBoundingClientRect();
        let cx, cy;
        if (e.touches && e.touches[0]) {
            cx = e.touches[0].clientX;
            cy = e.touches[0].clientY;
        } else if (e.changedTouches && e.changedTouches[0]) {
            cx = e.changedTouches[0].clientX;
            cy = e.changedTouches[0].clientY;
        } else {
            cx = e.clientX;
            cy = e.clientY;
        }
        return {
            x: ((cx - rect.left) * canvas.width) / rect.width,
            y: ((cy - rect.top) * canvas.height) / rect.height,
        };
    }
    function onPointerDown(e) {
        if (!image.complete || !image.naturalWidth) return;
        e.preventDefault();
        const p = getEventPoint(e);
        dragState = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
        if (canvas.setPointerCapture && e.pointerId !== undefined) {
            try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        }
        redraw();
    }
    function onPointerMove(e) {
        if (!dragState) return;
        e.preventDefault();
        const p = getEventPoint(e);
        dragState.x2 = p.x;
        dragState.y2 = p.y;
        redraw();
    }
    function onPointerUp() {
        if (!dragState) return;
        const x1 = Math.min(dragState.x1, dragState.x2);
        const y1 = Math.min(dragState.y1, dragState.y2);
        const x2 = Math.max(dragState.x1, dragState.x2);
        const y2 = Math.max(dragState.y1, dragState.y2);
        const w = x2 - x1;
        const h = y2 - y1;
        if (w > 4 && h > 4) {
            const tl = canvasToOriginal(x1, y1);
            const br = canvasToOriginal(x2, y2);
            crop = {
                x: tl.x,
                y: tl.y,
                width: br.x - tl.x,
                height: br.y - tl.y,
            };
            infoEl.textContent = `${crop.width}×${crop.height} (点确认裁剪)`;
            confirmBtn.disabled = false;
            resetBtn.disabled = false;
        } else {
            crop = null;
            infoEl.textContent = '选区太小,拖大一点';
            confirmBtn.disabled = true;
            resetBtn.disabled = true;
        }
        dragState = null;
        redraw();
    }

    // ===== 7. 按钮事件 =====
    function onCancel() {
        destroy();
        if (onSkip) onSkip();
    }
    function onReset() {
        crop = null;
        dragState = null;
        infoEl.textContent = '拖动鼠标框选范围';
        confirmBtn.disabled = true;
        resetBtn.disabled = true;
        redraw();
    }
    function onConfirmClick() {
        if (crop) {
            const c = crop;
            destroy();
            if (onConfirm) onConfirm(c);
        }
    }

    cancelBtn.addEventListener('click', onCancel);
    resetBtn.addEventListener('click', onReset);
    confirmBtn.addEventListener('click', onConfirmClick);

    // ===== 8. 拖拽 DOM 事件 =====
    canvas.addEventListener('mousedown', onPointerDown);
    canvas.addEventListener('mousemove', onPointerMove);
    canvas.addEventListener('mouseup', onPointerUp);
    canvas.addEventListener('mouseleave', onPointerUp);
    canvas.addEventListener(
        'touchstart',
        (e) => {
            e.preventDefault();
            onPointerDown(e);
        },
        { passive: false }
    );
    canvas.addEventListener(
        'touchmove',
        (e) => {
            e.preventDefault();
            onPointerMove(e);
        },
        { passive: false }
    );
    canvas.addEventListener('touchend', onPointerUp);

    // ===== 9. 监听 img 尺寸变化(响应式缩放) =====
    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => syncCanvasSize());
        resizeObserver.observe(image);
    } else {
        window.addEventListener('resize', syncCanvasSize);
    }

    // ===== 10. 初次同步 =====
    function init() {
        syncCanvasSize();
    }
    if (image.complete && image.naturalWidth) {
        init();
    } else {
        image.addEventListener('load', init, { once: true });
    }

    // ===== 11. 清理 =====
    function destroy() {
        try { canvas.removeEventListener('mousedown', onPointerDown); } catch (_) {}
        try { canvas.removeEventListener('mousemove', onPointerMove); } catch (_) {}
        try { canvas.removeEventListener('mouseup', onPointerUp); } catch (_) {}
        try { canvas.removeEventListener('mouseleave', onPointerUp); } catch (_) {}
        try { cancelBtn.removeEventListener('click', onCancel); } catch (_) {}
        try { resetBtn.removeEventListener('click', onReset); } catch (_) {}
        try { confirmBtn.removeEventListener('click', onConfirmClick); } catch (_) {}
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        } else {
            window.removeEventListener('resize', syncCanvasSize);
        }
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        if (toolbar.parentNode) toolbar.parentNode.removeChild(toolbar);
    }

    return { destroy };
}
