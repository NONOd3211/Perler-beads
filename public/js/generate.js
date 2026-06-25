// js/generate.js — 拼豆网格生成 + 区域代表色提取
// ESM 化:IIFE wrapper 去掉;window.perlerCanvas/tempCanvas/tempCtx 等替换为 state.js dom refs;
import {
    getBlockColorForGrid,
    mergeSimilarColors,
    despeckleIsolatedCells,
    BeadColor,
    calculateColorDistance,
    computeBackgroundSamplesFromGridAuto,
    computeBackgroundSamplesFromGridPoints,
} from './color.js';
import {
    dom as stateDom,
    pixelationMode,
    mergeThreshold,
    currentBrand,
    tempCanvas,
    tempCtx,
    lastFileSize,
    setLastCellSize,
    setLastMergedGrid,
    setLastPreMergeGrid,
    setLastGridDims,
    bgRemovalEnabled,
    bgRemovalMode,
    bgThreshold,
    bgManualPoints,
    sampleMatchThr,
} from './state.js';

// 在指定 canvas 上绘制网格图(每格一色 + 网格线 + 色号文字)
// 纯函数:不修改 window.*,仅消费入参
export function drawGrid(ctx, grid, cols, rows, cellSize, brand) {
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const x = Math.round(col * cellSize);
            const y = Math.round(row * cellSize);
            const sz = Math.floor(cellSize);

            const color = grid[row][col];

            // 透明格跳过填色和文字
            if (color.transparent) continue;

            ctx.fillStyle = color.hex;
            ctx.fillRect(x, y, sz, sz);

            // 计算文本颜色(根据背景色亮度选择黑白)
            const brightness = (color.r * 299 + color.g * 587 + color.b * 114) / 1000;
            const textColor = brightness > 128 ? '#000000' : '#FFFFFF';
            const strokeColor = brightness > 128 ? '#FFFFFF' : '#000000';

            // 设置文本样式,调小字体大小以确保完全显示
            const fontSize = Math.max(7, Math.min(10, Math.floor(sz * 0.4)));
            ctx.font = fontSize + 'px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // 绘制文本描边,提高清晰度
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 0.5;
            ctx.strokeText(color.code, x + sz / 2, y + sz / 2);

            // 绘制文本
            ctx.fillStyle = textColor;
            ctx.fillText(BeadColor.getDisplayCode(color, brand), x + sz / 2, y + sz / 2);
        }
    }

    // 灰色网格线
    ctx.strokeStyle = '#888888';
    ctx.lineWidth = 1.5;
    for (let x = 0; x <= cols * cellSize; x += cellSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, rows * cellSize);
        ctx.stroke();
    }
    for (let y = 0; y <= rows * cellSize; y += cellSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(cols * cellSize, y);
        ctx.stroke();
    }
}

// 在 perlerCanvas 上画半透明灰覆盖(背景格) + manual 模式点击圆圈
// 显示用:不修改 grid,仅在 ctx 上绘制标记;exportCanvas 走另一路(只画 grid)
function drawBgOverlay(ctx, grid, cols, rows, cellSize, manualPoints, showMarkers) {
    ctx.fillStyle = 'rgba(128, 128, 128, 0.4)';
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (grid[r][c].transparent) {
                ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
            }
        }
    }
    if (showMarkers) {
        const radius = cellSize * 1.5;
        ctx.strokeStyle = '#FF6B35';
        ctx.lineWidth = 2;
        for (const { col, row } of manualPoints) {
            ctx.beginPath();
            ctx.arc(
                col * cellSize + cellSize / 2,
                row * cellSize + cellSize / 2,
                radius,
                0,
                Math.PI * 2
            );
            ctx.stroke();
        }
    }
}

export function generatePerlerGrid() {
    stateDom.loadingOverlay.style.display = 'flex';
    stateDom.loadingProgress.textContent = '正在提取像素代表色...';

    try {
        const ctx = stateDom.perlerCanvas.getContext('2d');
        const selectedGridSize = parseInt(
            document.querySelector('input[name="density"]:checked').value
        );

        // 用 naturalWidth/naturalHeight 而不是 width/height:
        // .width/.height 是 CSS 渲染后的尺寸(被 max-width:300px 限制),
        // 大图会被浏览器降采样,产生混色伪影,JPEG 压缩还会引入噪点。
        // 在 104 网格下,每格只采 3x3=9 像素,降采样伪影会"翻盘"主导色
        // (白脑袋冒蓝点、黑身体冒白点);用原始像素采样则每格几百像素,
        // 主导色算法能稳定识别。
        const imgW = stateDom.originalImage.naturalWidth || stateDom.originalImage.width;
        const imgH = stateDom.originalImage.naturalHeight || stateDom.originalImage.height;

        // 固定单个网格的像素大小
        const fixedCellSize = 20;

        // 计算网格数量
        const cols = Math.ceil(imgW / (Math.max(imgW, imgH) / selectedGridSize));
        const rows = Math.ceil(imgH / (Math.max(imgW, imgH) / selectedGridSize));

        // 根据网格数量和固定网格大小计算画布尺寸
        const canvasWidth = cols * fixedCellSize;
        const canvasHeight = rows * fixedCellSize;

        stateDom.perlerCanvas.width = canvasWidth;
        stateDom.perlerCanvas.height = canvasHeight;

        setLastCellSize(fixedCellSize);

        tempCanvas.width = imgW;
        tempCanvas.height = imgH;
        tempCtx.drawImage(stateDom.originalImage, 0, 0, imgW, imgH);

        // 一次性读整图到 ImageData,主循环里 subarray 切片(纯内存),
        // 避免每个 cell 一次 getImageData 跨进程读取(10816 cell 时 N 次降到 1 次)。
        const fullImageData = tempCtx.getImageData(0, 0, imgW, imgH);

        const cellSize = fixedCellSize;

        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        // 大图(>5MB)前置提示,让用户感知到正在处理
        if (lastFileSize && lastFileSize > 5 * 1024 * 1024) {
            stateDom.loadingProgress.textContent = '正在处理大图,请稍候...';
        }

        // 第一步:为每个网格单元提取代表色(模式由 pixelationMode 决定)并映射到拼豆色
        const gridColors = Array(rows)
            .fill()
            .map(() => Array(cols).fill(null));

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                // 计算对应原始图像的区域
                const srcX = Math.round(col * (imgW / cols));
                const srcY = Math.round(row * (imgH / rows));
                const srcW = Math.ceil(imgW / cols);
                const srcH = Math.ceil(imgH / rows);

                // 提取代表色(Dominant/Average 由 pixelationMode 决定)并映射到拼豆色
                const color = getBlockColorForGrid(
                    srcX,
                    srcY,
                    srcW,
                    srcH,
                    pixelationMode,
                    fullImageData
                );
                gridColors[row][col] = color;
            }
        }

        // gridColors 已是 bead color,第二步快速跳过
        stateDom.loadingProgress.textContent = '正在合并区域...';

        // 第二步:去斑(把被 JPEG/降采样伪影"翻盘"的孤立格子替换为邻居主色),
        // 再做区域颜色合并(DFS + Oklab 阈值由 mergeThreshold 决定)。
        // 顺序:去斑在合并之前——孤立噪声跟周围颜色差距大(白蓝 Oklab≈63),
        // 任何合并阈值都救不了它,所以先单独清掉,再让合并处理"接近色"的小区域。
        // 用 typeof 防御:如果浏览器缓存了旧 color.js 没 despeckle,跳过这步,
        // 算法仍能跑(只是去斑失效,可能还有噪声)。
        const preGrid =
            typeof despeckleIsolatedCells === 'function'
                ? despeckleIsolatedCells(gridColors, cols, rows)
                : gridColors;
        let mergedGrid = mergeSimilarColors(preGrid, cols, rows, mergeThreshold);

        // 第三步:bgRemoval pass(在 mergedGrid 之上,标 {transparent:true})
        // 两种模式共享同一阈值结构:cell 与样本 Oklab 距离 < bgThreshold 视为背景
        if (bgRemovalEnabled) {
            const { samples, overflow } =
                bgRemovalMode === 'auto'
                    ? {
                          samples: computeBackgroundSamplesFromGridAuto(mergedGrid, cols, rows),
                          overflow: false,
                      }
                    : computeBackgroundSamplesFromGridPoints(
                          mergedGrid,
                          bgManualPoints,
                          sampleMatchThr,
                          cols,
                          rows
                      );
            if (overflow) {
                // 协调层提示(manual 模式 BFS 触 5000 格上限);彻底解耦到 UI 层留待 #3 重构
                alert('采样区过大,已按 5000 格上限截断');
            }
            if (samples.length > 0) {
                const next = mergedGrid.map((row) => row.slice());
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        if (next[r][c].transparent) continue;
                        const cell = next[r][c];
                        for (const sample of samples) {
                            if (
                                calculateColorDistance(
                                    cell.r,
                                    cell.g,
                                    cell.b,
                                    sample.r,
                                    sample.g,
                                    sample.b
                                ) < bgThreshold
                            ) {
                                next[r][c] = { transparent: true };
                                break;
                            }
                        }
                    }
                }
                mergedGrid = next;
            }
        }
        stateDom.loadingProgress.textContent = '正在绘制网格...';

        // 第四步:双 canvas 绘制
        // exportCanvas = 干净 grid(无 overlay),保证 PNG 导出背景自然透明
        // perlerCanvas = 干净 grid + 半透明灰覆盖(背景格)+ manual 模式点击圆圈
        if (stateDom.exportCanvas) {
            stateDom.exportCanvas.width = canvasWidth;
            stateDom.exportCanvas.height = canvasHeight;
            const exportCtx = stateDom.exportCanvas.getContext('2d');
            exportCtx.clearRect(0, 0, canvasWidth, canvasHeight);
            drawGrid(exportCtx, mergedGrid, cols, rows, cellSize, currentBrand);
        }
        drawGrid(ctx, mergedGrid, cols, rows, cellSize, currentBrand);
        drawBgOverlay(
            ctx,
            mergedGrid,
            cols,
            rows,
            cellSize,
            bgManualPoints,
            bgRemovalEnabled && bgRemovalMode === 'manual'
        );

        stateDom.originalInfo.textContent = `尺寸: ${imgW}×${imgH} 像素`;
        stateDom.perlerInfo.textContent = `网格: ${cols}×${rows} | 单格: ${cellSize}px 正方形`;

        setLastMergedGrid(mergedGrid);
        setLastPreMergeGrid(preGrid);
        setLastGridDims(cols, rows);
        stateDom.colorListButton.disabled = false;
    } catch (err) {
        console.error('生成拼豆图纸失败:', err);
        alert('生成拼豆图纸失败,请重试或更换图片。');
    } finally {
        stateDom.loadingOverlay.style.display = 'none';
    }
}
