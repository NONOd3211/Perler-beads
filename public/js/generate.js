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
    pixelBeadsPresetId,
    maxColorsOverride,
    presampleFactor,
    mergeThreshold,
    tempCanvas,
    tempCtx,
    currentPalette,
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
    cellShape,
    gridLineWidth,
    exportBackground,
} from './state.js';
// 移植自 pixel-beads.com 的算法(完整 1:1 移植,文档见 algorithms/pixel-beads/README.md)
import { extractCellFeatures, PRESETS } from './algorithms/pixel-beads/cell-extract.js';
import { detectBackgroundMask } from './algorithms/pixel-beads/background-mask.js';
import { assignBeads, resolveAssignmentsToBeads } from './algorithms/pixel-beads/pipeline.js';

// 在指定 canvas 上绘制网格图(每格一色 + 网格线 + 色号文字)
// 1:1 移植自 pixel-beads.com 的 bead-grid-canvas.js 渲染逻辑:
//   - cellShape='square' → 填色方块,pindou 默认(铺满整个网格,真实拼豆图纸的样子)
//   - cellShape='round'  → arc + fill(圆珠,圆与圆天然留缝 → 柔光感主因)
//   - cellShape='hollow' → 描边圆(lineWidth = max(2, r*0.25))
//   - 文字 shadowBlur=1 + offsetY=1 + rgba(0,0,0,0.35) 阴影(柔光感细节)
//   - 网格线 gridLineWidth: 'none' | 'small'(1) | 'big'(3)
// 纯函数:不修改 window.*,仅消费入参; cellShape/gridLineWidth 由 caller 传入
export function drawGrid(ctx, grid, cols, rows, cellSize, options = {}) {
    const cellShape = options.cellShape || 'square';
    const gridLineWidth = options.gridLineWidth || 'small';
    // pixel-beads: 0=none, 1=small, 3=big
    const lineWidthPx = gridLineWidth === 'none' ? 0 : gridLineWidth === 'big' ? 3 : 1;
    const re = cellShape === 'round' || cellShape === 'hollow';
    const we = cellShape === 'hollow';
    const d = cellSize / 2;

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const x = Math.round(col * cellSize);
            const y = Math.round(row * cellSize);
            const sz = Math.floor(cellSize);

            const color = grid[row][col];

            // 透明格跳过填色和文字
            if (color.transparent) continue;

            if (we /* hollow */) {
                // 空心圆(线宽 = max(2, r*0.25),与 pixel-beads 1:1)
                ctx.strokeStyle = color.hex;
                ctx.lineWidth = Math.max(2, cellSize * 0.25);
                ctx.beginPath();
                ctx.arc(x + d, y + d, (cellSize - ctx.lineWidth) / 2, 0, Math.PI * 2);
                ctx.stroke();
            } else if (re /* round */) {
                // 实心圆(默认 — 圆与圆之间留缝 = 柔光主因)
                ctx.fillStyle = color.hex;
                ctx.beginPath();
                ctx.arc(x + d, y + d, d, 0, Math.PI * 2);
                ctx.fill();
            } else {
                // 实心方块(pindou 旧行为)
                ctx.fillStyle = color.hex;
                ctx.fillRect(x, y, sz, sz);
            }

            // 色号文字(在 cellSize >= 8 时显示,与原版一致)
            if (sz >= 8) {
                // 计算文本颜色(根据背景色亮度选择黑白)
                const brightness = (color.r * 299 + color.g * 587 + color.b * 114) / 1000;
                const textColor = brightness > 128 ? '#000000' : '#FFFFFF';

                // 字体大小:与 pixel-beads 1:1(r<12 用 0.5 倍,否则 0.45 倍,最小 6/8)
                const fontSize = sz < 12
                    ? Math.max(6, Math.floor(sz * 0.5))
                    : Math.max(8, Math.floor(sz * 0.45));
                ctx.font = `800 ${fontSize}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                // 文字加 1px 阴影(柔光感的最后细节,1:1 移植自 pixel-beads)
                ctx.shadowColor = 'rgba(0,0,0,0.35)';
                ctx.shadowBlur = 1;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 1;
                ctx.fillStyle = textColor;
                ctx.fillText(BeadColor.getDisplayCode(color), x + d, y + d);

                // 重置 shadow(避免影响后续 cell)
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
            }
        }
    }

    // 网格线(0=无, 1=细, 3=粗; pixel-beads 同款)
    if (lineWidthPx > 0) {
        ctx.strokeStyle = '#888888';
        ctx.lineWidth = lineWidthPx;
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

export async function generatePerlerGrid() {
    stateDom.loadingOverlay.style.display = 'flex';
    stateDom.loadingProgress.textContent = '正在提取像素代表色...';

    try {
        const ctx = stateDom.perlerCanvas.getContext('2d');
        // 网格尺寸:优先从滑块读(1-120),无滑块时回退 radio
        const gridSizeSlider = document.getElementById('gridSizeSlider');
        const selectedGridSize = gridSizeSlider
            ? parseInt(gridSizeSlider.value)
            : parseInt(document.querySelector('input[name="density"]:checked')?.value || '52');

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
        let fullImageData = tempCtx.getImageData(0, 0, imgW, imgH);
        let procW = imgW;
        let procH = imgH;

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

        if (pixelationMode === 'pixel-beads') {
            // pixel-beads 模式:1:1 移植 www.pixel-beads.com 算法
            // 流程:背景 BFS → 提取 cell 特征 → K-means 聚类 → 色板匹配
            stateDom.loadingProgress.textContent = '正在分析图片...';

            const preset = PRESETS[pixelBeadsPresetId] || PRESETS.detailed;

            // ===== 预采样(仅 pixel-beads 模式)= 避免 cell 内平均把抗锯齿中间色混进结果 =====
            // factor=1 不采样(原图),默认 4(4x 目标网格),更高 = 更强离散化。
            // 只在 pixel-beads 分支执行,不影响 dominant / alpha-weighted 模式
            // (它们的 cell 取色按 imgW/imgH 比例映射,需要全分辨率 fullImageData)。
            if (presampleFactor > 1) {
                const { presampleNearest, presampleSize } = await import(
                    './algorithms/pixel-beads/presample.js'
                );
                // 下限保护:不要小于目标网格,否则 cell-extract 会"反向"放大
                const targetW = Math.max(cols, 4);
                const targetH = Math.max(rows, 4);
                const factorSize = presampleSize(imgW, imgH, presampleFactor);
                const dstW = Math.max(targetW, factorSize.width);
                const dstH = Math.max(targetH, factorSize.height);
                const downsampled = presampleNearest(
                    fullImageData.data,
                    imgW,
                    imgH,
                    dstW,
                    dstH
                );
                // 转成新的 ImageData(allocate 新 buffer)
                fullImageData = new ImageData(downsampled, dstW, dstH);
                procW = dstW;
                procH = dstH;
                stateDom.loadingProgress.textContent = `预采样 ${procW}×${procH} (${presampleFactor}x)...`;
            }

            // 1. 背景 mask(imageData 维度 BFS,见 detectBackgroundMask 注释)
            const { mask: bgMask } = detectBackgroundMask({
                imageData: fullImageData.data,
                width: procW,
                height: procH,
                mode: 'auto',
                preset,
            });

            // 2. 每 cell 特征(含 isOutline 判定)
            const cellFeatures = extractCellFeatures({
                imageData: fullImageData.data,
                imageWidth: procW,
                imageHeight: procH,
                targetWidth: cols,
                targetHeight: rows,
                backgroundMask: bgMask,
                preset,
            });

            // 3. K-means 聚类 + 色板匹配 + outline 强制最暗
            // maxColorsOverride 优先,否则用 preset 默认(legacy/zippland = null = 全 palette)
            const effectiveK = maxColorsOverride ?? preset.maxColors ?? currentPalette.length;
            const assignments = assignBeads({
                cells: cellFeatures,
                palette: currentPalette,
                k: effectiveK,
                outlineWeight: preset.outlineWeight,
            });

            // 4. 转回 gridColors 格式
            const beads = resolveAssignmentsToBeads(assignments, currentPalette);
            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    const idx = row * cols + col;
                    const feature = cellFeatures[idx];
                    const bead = beads[idx];
                    if (!feature || !bead) {
                        // 背景格(coverage 不足 / 调色板为空)
                        gridColors[row][col] = { transparent: true };
                    } else {
                        gridColors[row][col] = bead;
                    }
                }
            }
        } else {
            // legacy 模式:'dominant' / 'alpha-weighted'(保持原逻辑)
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
        // exportCanvas = 干净 grid(无 overlay),PNG 导出用;可选手动填米色背景
        // perlerCanvas = 干净 grid + 半透明灰覆盖(背景格)+ manual 模式点击圆圈
        const drawOptions = {
            cellShape,
            gridLineWidth,
        };
        if (stateDom.exportCanvas) {
            stateDom.exportCanvas.width = canvasWidth;
            stateDom.exportCanvas.height = canvasHeight;
            const exportCtx = stateDom.exportCanvas.getContext('2d');
            exportCtx.clearRect(0, 0, canvasWidth, canvasHeight);
            // 米色背景(柔光感第三要素 — 1:1 移植自 pixel-beads 的 #F7F1E1)
            if (exportBackground === 'cream') {
                exportCtx.fillStyle = '#F7F1E1';
                exportCtx.fillRect(0, 0, canvasWidth, canvasHeight);
            }
            drawGrid(exportCtx, mergedGrid, cols, rows, cellSize, drawOptions);
        }
        drawGrid(ctx, mergedGrid, cols, rows, cellSize, drawOptions);
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
