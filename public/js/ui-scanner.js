// 扫描 UI:模态框、上传、自动检测、错误格点击
import { scannerErrors, setScannerErrors, lastMergedGrid } from './state.js';

// Task 6.2:打开扫描模态框并显示 step1,清空 state
export function openScannerModal() {
    const modal = document.getElementById('scannerModal');
    if (!modal) return;
    scannerModalState.imageData = null;
    scannerModalState.result = null;
    goToStep(1);
    modal.style.display = 'flex';
}

function goToStep(n) {
    for (let i = 1; i <= 3; i++) {
        const el = document.getElementById(`scannerStep${i}`);
        if (el) el.hidden = i !== n;
    }
}

// 共享给 attachScannerListeners 的事件 handler 读写的状态
export const scannerModalState = {
    imageData: null,
    grid: null,
    templates: null,
    result: null,
};

// Task 6.6:改色后过滤 scannerErrors(该格 cell 不再 transparent → 已修正,移除)
// 无 candidates 时:cell.transparent=false 即视为用户已选色(成功修正)
// 有 candidates 时:用户在 picker 里选了候选也满足上面条件,行为一致
export function pruneScannerErrors() {
    if (!scannerErrors || scannerErrors.length === 0) return;
    if (!lastMergedGrid) return;
    const kept = scannerErrors.filter((e) => {
        const row = lastMergedGrid[e.row];
        const cell = row && row[e.col];
        if (!cell) return true; // 越界保留
        return cell.transparent === true; // 仍透明 = 未修正,保留;已填色 = 修正,移除
    });
    if (kept.length !== scannerErrors.length) setScannerErrors(kept);
}

// Task 5.3:在调用方 ctx 上画错误格红框(2px strokeRect,不 clear)
export function drawScannerErrors(ctx, cellSize) {
    if (!scannerErrors || scannerErrors.length === 0) return;
    ctx.strokeStyle = '#FF0000';
    ctx.lineWidth = 2;
    for (const err of scannerErrors) {
        const x = err.col * cellSize;
        const y = err.row * cellSize;
        ctx.strokeRect(x, y, cellSize, cellSize);
    }
}

// Task 6.7:v2 自动检测流程 — 上传后 detectGrid + 识别 → 结果
export function attachScannerListeners() {
    const fileInput = document.getElementById('scannerFileInput');
    const applyBtn = document.getElementById('scannerApplyBtn');
    const importButton = document.getElementById('scannerImportButton');

    const cancelBtns = [
        document.getElementById('scannerCancelBtn1'),
        document.getElementById('scannerCancelBtn3'),
    ];

    function closeScannerModal() {
        const m = document.getElementById('scannerModal');
        if (m) m.style.display = 'none';
    }

    if (importButton) {
        importButton.addEventListener('click', () => openScannerModal());
    }

    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            // 重置 file input 值,确保再次选择同一文件时仍触发 change 事件
            fileInput.value = '';
            if (!file.type.startsWith('image/')) {
                alert('请上传图片文件');
                return;
            }
            const img = new Image();
            img.onload = async () => {
                const c = document.getElementById('scannerPreviewCanvas');
                const ctx = c.getContext('2d');
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                ctx.drawImage(img, 0, 0);
                c.hidden = false;
                scannerModalState.imageData = ctx.getImageData(0, 0, c.width, c.height);
                // 重新上传时重置模板(不同图片可能需要重新检测)
                await runDetectAndRecognize();
            };
            img.src = URL.createObjectURL(file);
        });
    }

    // 核心:上传图后自动 detectGrid → 调 importDiagramFromImage → 显示结果
    async function runDetectAndRecognize() {
        if (!scannerModalState.imageData) return;
        try {
            // 1. 自动检测网格
            const { detectGrid } = await import('./scanner-grid-detect.js');
            const grid = detectGrid(scannerModalState.imageData);
            console.log('[scanner] detectGrid:', JSON.stringify(grid));

            if (grid.confidence < 0.3) {
                const summary = document.getElementById('scannerResultSummary');
                if (summary) {
                    summary.textContent = '未检测到网格,请检查图片是否清晰(建议:白底黑字、cellSize 8-30px、规整格子)';
                }
                goToStep(3);
                return;
            }

            // 2. 颜色匹配识别(让出主线程,显示进度)
            const { importDiagramFromImage } = await import('./scanner.js');
            const summaryEl = document.getElementById('scannerResultSummary');
            if (summaryEl) {
                summaryEl.textContent = `检测到 ${grid.rows}×${grid.cols},正在按颜色匹配 ${grid.rows * grid.cols} 格...`;
            }
            await new Promise((r) => requestAnimationFrame(r));
            const result = await importDiagramFromImage(scannerModalState.imageData, grid);
            scannerModalState.result = result;

            if (!result.ok) {
                const summary = document.getElementById('scannerResultSummary');
                if (summary) summary.textContent = '识别失败: ' + (result.fatal || '未知错误');
                goToStep(3);
                return;
            }

            // 4. 显示结果
            const total = grid.rows * grid.cols;
            const summary = document.getElementById('scannerResultSummary');
            if (summary) {
                const warnTxt = (result.warnings || []).join('; ');
                const confTxt = grid.confidence < 0.7 ? ' [检测置信度较低]' : '';
                summary.textContent =
                    `检测到 ${grid.rows}×${grid.cols} 网格,cellSize=${grid.cellSize}px${confTxt} | ` +
                    `识别:成功 ${total - result.errors.length} / 失败 ${result.errors.length}` +
                    (warnTxt ? ` | ${warnTxt}` : '');
            }
            goToStep(3);
        } catch (err) {
            console.error('[scanner] detect/recognize error:', err);
            const summary = document.getElementById('scannerResultSummary');
            if (summary) summary.textContent = '识别过程出错: ' + err.message;
            goToStep(3);
        }
    }

    if (applyBtn) {
        applyBtn.addEventListener('click', async () => {
            if (!scannerModalState.result || !scannerModalState.result.ok) return;
            const { applyScanResultToEditor } = await import('./scanner.js');
            applyScanResultToEditor(scannerModalState.result);
            closeScannerModal();
        });
    }

    for (const b of cancelBtns) {
        if (b) b.addEventListener('click', closeScannerModal);
    }
}
