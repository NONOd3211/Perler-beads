// js/ui-events.js — 其他事件(fileInput / download / reset / colorList / editor / keyboard / density / palette / brand / pixelation / merge)
import {
    dom as stateDom,
    setLastFileSize,
    currentImage,
    setCurrentImage,
    pixelationMode,
    setPixelationMode,
    currentPalette,
    setPalette,
    currentBrand,
    setBrand,
    setFuseEffect,
    lastMergedGrid,
    setLastMergedGrid,
    lastPreMergeGrid,
    setMergeThreshold,
    editorHistory,
    recentCodes,
    pickerActive,
    clearManualRefine,
    BeadRefine,
    lastCellSize,
    lastGridCols,
    lastGridRows,
    bgRemovalEnabled,
    bgRemovalMode,
    bgManualPoints,
    setBgRemovalEnabled,
    setBgRemovalMode,
    setBgThreshold,
    setSampleMatchThr,
    pushBgManualPoint,
    popBgManualPoint,
    clearBgManualPoints,
} from './state.js';
import { getDisplayCode } from './color.js';
import { applyColorChange, openPicker, closePicker, undo, redo } from './editor.js';
import { generatePerlerGrid } from './generate.js';

// ---- 文件处理(点击上传与拖拽上传共用) ----
function isValidImageFile(file) {
    if (!file) return false;
    return typeof file.type === 'string' && file.type.indexOf('image/') === 0;
}

async function handleFile(file, refs) {
    if (!file) return;
    if (!isValidImageFile(file)) {
        alert('请选择 JPG 或 PNG 图片。');
        return;
    }
    setLastFileSize(file.size);
    stateDom.fileInfo.textContent = `已选择: ${file.name}`;
    const reader = new FileReader();
    reader.onload = function (e) {
        setCurrentImage(e.target.result);
        // 先注册 load 监听器(用 addEventListener,不被 race condition 错过),
        // 再设置 src。原来的 onload = ... 写法在 data URL/缓存场景下
        // 会因为 load 事件早于 onload 赋值触发而丢失回调。
        stateDom.originalImage.addEventListener(
            'load',
            async function onImgLoad() {
                stateDom.originalImage.removeEventListener('load', onImgLoad);
                stateDom.originalImage.style.display = '';
                const { generatePerlerGrid } = await import('./generate.js');
                generatePerlerGrid();
                clearBgManualPoints();
                setBgRemovalEnabled(false);
                if (refs.bgEnabledChk) refs.bgEnabledChk.checked = false;
                if (refs.bgModeGroup) refs.bgModeGroup.disabled = true;
                if (refs.bgThresholdSlider) refs.bgThresholdSlider.disabled = true;
                if (refs.sampleMatchThrSlider) refs.sampleMatchThrSlider.disabled = true;
                stateDom.downloadButton.disabled = false;
                stateDom.resetButton.disabled = false;
                stateDom.fusedPreviewZoomButton.disabled = false;
            },
            { once: true }
        );
        stateDom.originalImage.src = currentImage;
    };
    reader.readAsDataURL(file);
}

// ---- 拖拽上传(document 级,拖到页面任意位置即可接收) ----
// dragenter/leave 用计数器,避免光标经过嵌套子元素时反复触发
let dragCounter = 0;

async function getPaletteById(id) {
    const { BeadPalettes } = await import('./palettes.js');
    if (id === 221) return BeadPalettes.p221;
    if (id === 291) return BeadPalettes.p291;
    return BeadPalettes.p221;
}

async function syncFuseAfterReset() {
    const { syncFuseEffectButtons, syncFuseEffectDisabledState } = await import('./ui-fuse.js');
    if (typeof syncFuseEffectButtons === 'function') syncFuseEffectButtons();
    if (typeof syncFuseEffectDisabledState === 'function') syncFuseEffectDisabledState();
}

export function attachEventsListeners(win = window) {
    const doc = win.document;

    // ---- bg 相关控件(顶部统一收集,handleFile 通过 refs 引用) ----
    const bgEnabledChk = doc.getElementById('bgRemovalEnabled');
    const bgModeGroup = doc.getElementById('bgModeGroup');
    const bgThresholdSlider = doc.getElementById('bgThresholdSlider');
    const bgThresholdValue = doc.getElementById('bgThresholdValue');
    const sampleMatchThrRow = doc.getElementById('sampleMatchThrRow');
    const sampleMatchThrSlider = doc.getElementById('sampleMatchThrSlider');
    const sampleMatchThrValue = doc.getElementById('sampleMatchThrValue');
    const bgManualControls = doc.getElementById('bgManualControls');
    const bgUndoBtn = doc.getElementById('bgUndoBtn');
    const bgClearBtn = doc.getElementById('bgClearBtn');
    const bgRefs = { bgEnabledChk, bgModeGroup, bgThresholdSlider, sampleMatchThrSlider };

    // ---- 点击上传 ----
    stateDom.fileInput.addEventListener('change', function (e) {
        handleFile(e.target.files[0], bgRefs);
    });

    doc.addEventListener('dragenter', function (e) {
        e.preventDefault();
        dragCounter++;
        doc.body.classList.add('dragging-file');
    });
    doc.addEventListener('dragover', function (e) {
        e.preventDefault(); // 必须 preventDefault,否则 drop 不触发
        e.dataTransfer.dropEffect = 'copy';
    });
    doc.addEventListener('dragleave', function (e) {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            doc.body.classList.remove('dragging-file');
        }
    });
    doc.addEventListener('drop', function (e) {
        e.preventDefault();
        dragCounter = 0;
        doc.body.classList.remove('dragging-file');
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (!file) return;
        handleFile(file, bgRefs);
    });

    // ---- density change handler(切换网格尺寸) ----
    stateDom.densityOptions.forEach((option) => {
        option.addEventListener('change', async function () {
            if (currentImage && (editorHistory.length > 0 || recentCodes.length > 0)) {
                if (!confirm('切换网格尺寸会丢失所有手动精修,是否继续?')) {
                    // 取消 → 还原 radio 旧值
                    const prev = doc.querySelector('input[name="density"]:checked');
                    if (prev && prev !== this) prev.checked = true;
                    return;
                }
                clearManualRefine();
            }
            if (currentImage) {
                const { generatePerlerGrid } = await import('./generate.js');
                generatePerlerGrid();
            }
        });
    });

    // ---- palette change handler ----
    stateDom.paletteOptions.forEach((option) => {
        option.addEventListener('change', async function () {
            if (this.disabled) return;
            const paletteValue = parseInt(this.value);
            const palette = await getPaletteById(paletteValue);
            setPalette(palette, paletteValue);
            if (currentImage) BeadRefine.recomputePreservingRefine('palette');
        });
    });

    // ---- brand change handler ----
    stateDom.brandOptions.forEach((option) => {
        option.addEventListener('change', function () {
            if (this.disabled) return;
            setBrand(this.value);
            if (currentImage) BeadRefine.recomputePreservingRefine('brand');
        });
    });

    // ---- colorList modal 显隐 + 配色清单渲染 ----
    const closeColorListBtn = doc.getElementById('closeColorList');
    closeColorListBtn.addEventListener('click', function () {
        stateDom.colorListModal.style.display = 'none';
    });
    stateDom.colorListModal.addEventListener('click', function (e) {
        if (e.target === stateDom.colorListModal) stateDom.colorListModal.style.display = 'none';
    });
    stateDom.colorListButton.addEventListener('click', function () {
        if (!lastMergedGrid) return;
        const counts = new Map();
        let beadTotal = 0; // 实际拼豆数(排除全透明格,用于占比与"共 X 颗")
        for (let row = 0; row < lastGridRows; row++) {
            for (let col = 0; col < lastGridCols; col++) {
                const c = lastMergedGrid[row][col];
                if (c.transparent) continue; // 全透明格不分配色号,不计入清单
                beadTotal++;
                const key = getDisplayCode(c, currentBrand);
                if (!counts.has(key)) counts.set(key, { color: c, code: key, count: 0 });
                counts.get(key).count++;
            }
        }
        const sorted = [...counts.values()].sort((a, b) => b.count - a.count);
        const total = beadTotal;
        const content = stateDom.colorListContent;
        content.replaceChildren();

        const table = doc.createElement('table');
        table.className = 'color-list-table';
        const headerRow = doc.createElement('tr');
        headerRow.className = 'color-list-head';
        const headers = [
            { text: '色号' },
            { text: '颜色' },
            { text: '数量', cls: 'col-num' },
            { text: '占比', cls: 'col-num' },
        ];
        for (const h of headers) {
            const th = doc.createElement('th');
            th.textContent = h.text;
            if (h.cls) th.className = h.cls;
            headerRow.appendChild(th);
        }
        table.appendChild(headerRow);

        for (const item of sorted) {
            const pct = ((item.count / total) * 100).toFixed(1);
            const tr = doc.createElement('tr');
            tr.className = 'color-list-row';

            const codeTd = doc.createElement('td');
            codeTd.className = 'col-code';
            codeTd.textContent = item.code;
            tr.appendChild(codeTd);

            const swatchTd = doc.createElement('td');
            const swatch = doc.createElement('span');
            swatch.className = 'swatch';
            swatch.style.backgroundColor = item.color.hex;
            swatchTd.appendChild(swatch);
            swatchTd.appendChild(doc.createTextNode(item.color.hex));
            tr.appendChild(swatchTd);

            const countTd = doc.createElement('td');
            countTd.className = 'col-num';
            countTd.textContent = String(item.count);
            tr.appendChild(countTd);

            const pctTd = doc.createElement('td');
            pctTd.className = 'col-num';
            pctTd.textContent = pct + '%';
            tr.appendChild(pctTd);

            table.appendChild(tr);
        }
        content.appendChild(table);

        const summary = doc.createElement('div');
        summary.className = 'color-list-summary';
        summary.textContent = `共 ${sorted.length} 种颜色,${total} 颗拼豆`;
        content.appendChild(summary);

        stateDom.colorListModal.style.display = 'flex';
    });

    // ---- PNG 下载 — 始终输出网格图(无论当前显示什么模式)
    // 走 exportCanvas(只画 grid 不画 overlay),保证背景透明 PNG 不被半透明灰污染
    stateDom.downloadButton.addEventListener('click', async function () {
        if (!stateDom.perlerCanvas.width) return;
        // fallback:旧版 HTML 没有 exportCanvas 时退回 perlerCanvas
        const exportEl = stateDom.exportCanvas || stateDom.perlerCanvas;
        if (!exportEl.width) return;
        try {
            const link = doc.createElement('a');
            link.download = '拼豆图纸.png';
            link.href = exportEl.toDataURL('image/png');
            link.click();
        } catch (err) {
            console.error('下载图纸失败:', err);
            alert('下载图纸失败,请重试。');
        }
    });

    // ---- reset button ----
    stateDom.resetButton.addEventListener('click', async function () {
        stateDom.fileInput.value = '';
        stateDom.originalImage.src = '';
        stateDom.originalImage.style.display = 'none';
        stateDom.perlerCanvas.width = 0;
        stateDom.fileInfo.textContent = '';
        stateDom.originalInfo.textContent = '';
        stateDom.perlerInfo.textContent = '';
        stateDom.downloadButton.disabled = true;
        stateDom.colorListButton.disabled = true;
        stateDom.resetButton.disabled = true;
        stateDom.fusedPreviewZoomButton.disabled = true;
        setFuseEffect('plain');
        await syncFuseAfterReset();
        setCurrentImage(null);
        setLastMergedGrid(null);
        clearBgManualPoints();
        setBgRemovalEnabled(false);
    });

    // ---- 像素化模式 select ----
    const pixelationModeSelect = doc.getElementById('pixelationModeSelect');
    pixelationModeSelect.addEventListener('change', async function () {
        if (currentImage && (editorHistory.length > 0 || recentCodes.length > 0)) {
            if (!confirm('切换处理模式会丢失所有手动精修,是否继续?')) {
                // 取消 → 还原 select 旧值
                this.value = pixelationMode;
                return;
            }
            clearManualRefine();
        }
        setPixelationMode(this.value);
        if (currentImage) {
            const { generatePerlerGrid } = await import('./generate.js');
            generatePerlerGrid();
        }
    });

    // ---- merge slider(拖动时实时生效,边拖边重算) ----
    // 旧版用 'change' 事件只在松开时才触发,所以感觉"没有实时"——其实只是延迟了
    // 改用 'input' 事件,边拖边更新;同时改成统一由 input 触发
    const mergeSlider = doc.getElementById('mergeSlider');
    const mergeValueLabel = doc.getElementById('mergeValue');
    function onMergeSliderChange() {
        setMergeThreshold(+this.value);
        mergeValueLabel.textContent = this.value;
        if (currentImage && lastPreMergeGrid) {
            BeadRefine.recomputePreservingRefine('threshold');
        }
    }
    mergeSlider.addEventListener('input', onMergeSliderChange);
    mergeSlider.addEventListener('change', onMergeSliderChange);

    // ---- canvas 点击:manual bg 模式优先加采样点,否则打开选色浮窗 ----
    // v2:manual 模式点击在拼豆图纸上(不是原图),坐标用 col/row 而非 v1 的 nx/ny
    stateDom.perlerCanvas.addEventListener('click', function (e) {
        if (!lastMergedGrid) return;
        const rect = stateDom.perlerCanvas.getBoundingClientRect();
        const cs = lastCellSize;
        // canvas 实际尺寸 vs CSS 显示尺寸的缩放
        const scaleX = stateDom.perlerCanvas.width / rect.width;
        const scaleY = stateDom.perlerCanvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        const col = Math.floor(x / cs);
        const row = Math.floor(y / cs);
        if (row < 0 || row >= lastGridRows || col < 0 || col >= lastGridCols) return;

        // manual bg 模式:点击 cell 推入 bgManualPoints,触发重生成
        if (bgRemovalEnabled && bgRemovalMode === 'manual') {
            if (bgManualPoints.length >= 32) {
                alert('手动采样点已达上限 32 个');
                return;
            }
            pushBgManualPoint({ col, row });
            bgUndoBtn.disabled = false;
            bgClearBtn.disabled = false;
            if (stateDom.originalImage && stateDom.originalImage.src) {
                generatePerlerGrid();
            }
            return;
        }
        openPicker(row, col);
    });

    // ---- editor picker: 确认按钮(手动输入色号) ----
    doc.getElementById('editorCodeSubmit').addEventListener('click', async function () {
        if (!pickerActive.current) return;
        const input = doc.getElementById('editorCodeInput');
        const err = doc.getElementById('editorCodeError');
        const target = (input.value || '').trim().toUpperCase();
        if (!target) return;
        const match = currentPalette.find((p) => getDisplayCode(p, currentBrand) === target);
        if (!match) {
            if (err) err.style.display = 'block';
            return;
        }
        const { row, col } = pickerActive.current;
        await applyColorChange(row, col, match);
        closePicker();
    });

    // ---- editor picker: 取消按钮 ----
    doc.getElementById('editorCancel').addEventListener('click', function () {
        closePicker();
    });

    // ---- editor picker: 背景点击关闭 ----
    doc.getElementById('editorModal').addEventListener('click', function (e) {
        if (e.target === this) closePicker();
    });

    // ---- 键盘快捷键:撤销/重做/关闭浮窗 ----
    doc.addEventListener('keydown', async function (e) {
        // 输入框内不抢焦点
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

        const mod = e.ctrlKey || e.metaKey;
        if (mod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
            e.preventDefault();
            undo();
            return;
        }
        if (mod && (e.key === 'y' || e.key === 'Y')) {
            e.preventDefault();
            redo();
            return;
        }
        if (mod && (e.key === 'z' || e.key === 'Z') && e.shiftKey) {
            e.preventDefault();
            redo();
            return;
        }
        if (e.key === 'Escape' && pickerActive.current) {
            e.preventDefault();
            closePicker();
            return;
        }
        if (e.key === 'Escape' && doc.getElementById('zoomModal').style.display === 'flex') {
            e.preventDefault();
            const { closeZoomModal } = await import('./ui-modals.js');
            if (closeZoomModal) closeZoomModal();
            return;
        }
    });

    // ---- 去背景:开关 ----
    // bg 相关元素引用统一在 attachEventsListeners 顶部收集(bgRefs 闭包内可见)
    function bgRegenerate() {
        if (stateDom.originalImage && stateDom.originalImage.src) {
            generatePerlerGrid();
        }
    }

    function updateBgModeVisibility() {
        const isManual = bgRemovalMode === 'manual';
        sampleMatchThrRow.hidden = !isManual;
        bgManualControls.hidden = !isManual || !bgRemovalEnabled;
    }

    bgEnabledChk.addEventListener('change', () => {
        setBgRemovalEnabled(bgEnabledChk.checked);
        bgModeGroup.disabled = !bgEnabledChk.checked;
        bgThresholdSlider.disabled = !bgEnabledChk.checked;
        sampleMatchThrSlider.disabled = !bgEnabledChk.checked;
        updateBgModeVisibility();
        bgRegenerate();
    });

    bgModeGroup.addEventListener('change', () => {
        const checked = doc.querySelector('input[name="bgMode"]:checked');
        if (checked) {
            setBgRemovalMode(checked.value);
            updateBgModeVisibility();
            bgRegenerate();
        }
    });

    bgThresholdSlider.addEventListener('input', () => {
        setBgThreshold(+bgThresholdSlider.value);
        bgThresholdValue.textContent = bgThresholdSlider.value;
        bgRegenerate();
    });

    sampleMatchThrSlider.addEventListener('input', () => {
        setSampleMatchThr(+sampleMatchThrSlider.value);
        sampleMatchThrValue.textContent = sampleMatchThrSlider.value;
        bgRegenerate();
    });

    // ---- 去背景:perlerCanvas 点击(manual 模式)
    // v2 改在拼豆图纸上点 cell(v1 在原图上点像素),逻辑见上方 perlerCanvas click handler
    // 这里只接管 撤销 / 清空 按钮

    bgUndoBtn.addEventListener('click', () => {
        popBgManualPoint();
        bgUndoBtn.disabled = bgManualPoints.length === 0;
        bgClearBtn.disabled = bgManualPoints.length === 0;
        bgRegenerate();
    });

    bgClearBtn.addEventListener('click', () => {
        clearBgManualPoints();
        bgUndoBtn.disabled = true;
        bgClearBtn.disabled = true;
        bgRegenerate();
    });

    // 初始化时显式同步一次 bg 折叠区可见性,避免依赖 HTML hidden 属性维持初始态
    updateBgModeVisibility();
}
