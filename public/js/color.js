// js/color.js — 颜色算法:Oklab 距离 + D/A 双模式 + DFS 显式栈合并 + 透明格短路 + getDisplayCode
// ESM 化:IIFE wrapper 去掉;所有 `window.Oklab.xxx` 改为 import 的 `rgbToOklab`;
// 所有 `window.currentPalette` 改为 import 的 `currentPalette`(state.js 顶层 let binding,只读);
// 所有 `window.tempCtx.getImageData(...)` 改为 import 的 `tempCtx.getImageData(...)`

import { BeadPalettes } from './palettes.js';
import { rgbToOklab } from './oklab.js';
import { currentPalette, tempCtx } from './state.js';

// Oklab 欧氏距离 ×100(感知色彩空间)
export function calculateColorDistance(r1, g1, b1, r2, g2, b2) {
    const o1 = rgbToOklab(r1, g1, b1);
    const o2 = rgbToOklab(r2, g2, b2);
    const dL = o1.L - o2.L,
        da = o1.a - o2.a,
        db = o1.b - o2.b;
    return Math.sqrt(dL * dL + da * da + db * db) * 100;
}

// 在 palette 中找 Oklab 距离最近的色(精确匹配早退)
export function getClosestBeadColor(r, g, b) {
    const palette = currentPalette;
    // 防御性:空 palette 返回 null(避免 palette[0] 抛错)
    if (!palette || palette.length === 0) return null;
    let minDist = Infinity;
    let best = palette[0];
    for (let i = 0; i < palette.length; i++) {
        const c = palette[i];
        const d = calculateColorDistance(r, g, b, c.r, c.g, c.b);
        if (d === 0) return c; // 精确匹配提前退出
        if (d < minDist) {
            minDist = d;
            best = c;
        }
    }
    return best;
}

// 从图像区域提取主导色(RGB 众数),按 α 加权:key="r,g,b",value=Σ α。
// 不透明图(α=255 全部)退化为原"出现次数最多"。
// 返回 { r, g, b } 或 null(全透明)
function getDominantColorFromData(data) {
    const colorCounts = new Map();
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a === 0) continue; // 完全透明跳过;其余按 α 计入
        const key = `${r},${g},${b}`;
        colorCounts.set(key, (colorCounts.get(key) || 0) + a);
    }
    if (colorCounts.size === 0) return null;
    let maxWeight = 0;
    let dominantColor = null;
    for (const [key, weight] of colorCounts.entries()) {
        if (weight > maxWeight) {
            maxWeight = weight;
            const [r, g, b] = key.split(',').map(Number);
            dominantColor = { r, g, b };
        }
    }
    return dominantColor;
}

export function getDominantColor(x0, y0, w, h) {
    const data = tempCtx.getImageData(x0, y0, w, h).data;
    return getDominantColorFromData(data);
}

// D6: α_max < 30 视为透明 cell。30 ≈ 12% 不透明度。
// 比旧 `a < 128` 阈值保留反走样边 (α ∈ [30, 128] 的中间过渡像素)
export function isTransparentCell(data) {
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] >= 30) return false; // 找到任意 α ≥ 30 → 不透明
    }
    return true; // 全部 α < 30
}

// 4 角采样多数投票 — 输入 grid + cols + rows,返回代表背景色集合
// 行为:读 grid 4 角 cell representative color → 透明角过滤 →
//       两两 Oklab 距离 < 8 归组 → 取 count>=2 的组作代表;
//       全部 count=1 时 fallback 为所有有效角单色
// 透明 cell (transparent=true) 不贡献;全透明 grid 返回 []
export function computeBackgroundSamplesFromGridAuto(grid, cols, rows) {
    const corners = [grid[0][0], grid[0][cols - 1], grid[rows - 1][0], grid[rows - 1][cols - 1]];

    const validColors = corners
        .filter((c) => !c.transparent)
        .map((c) => ({ r: c.r, g: c.g, b: c.b }));
    if (validColors.length === 0) return [];

    const groups = [];
    for (const color of validColors) {
        let merged = false;
        for (const group of groups) {
            const dist = calculateColorDistance(
                color.r,
                color.g,
                color.b,
                group[0].r,
                group[0].g,
                group[0].b
            );
            if (dist < 8) {
                group.push(color);
                merged = true;
                break;
            }
        }
        if (!merged) groups.push([color]);
    }

    const majorityGroups = groups.filter((g) => g.length >= 2);
    return majorityGroups.length > 0 ? majorityGroups.map((g) => g[0]) : validColors;
}

// 点击标记背景 — BFS 4 邻接扩展采同色 cell
// 每点 BFS 上限 5,000 cells;样本与现有样本 Oklab 距离 < 8 视为重复
// 透明种子跳过;全部样本 dedup 后空返回 []
export function computeBackgroundSamplesFromGridPoints(
    grid,
    clickPoints,
    sampleMatchThr,
    cols,
    rows
) {
    const MAX_CELLS = 5000;
    const samples = [];
    const visited = new Uint8Array(cols * rows);

    for (const { col, row } of clickPoints) {
        if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
        const seed = grid[row][col];
        if (seed.transparent) continue;

        const stack = [[col, row]];
        const collected = [];
        let count = 0;

        while (stack.length > 0 && count < MAX_CELLS) {
            const [c, r] = stack.pop();
            if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
            const idx = r * cols + c;
            if (visited[idx]) continue;
            visited[idx] = 1;

            const cell = grid[r][c];
            if (cell.transparent) continue;

            const dist = calculateColorDistance(cell.r, cell.g, cell.b, seed.r, seed.g, seed.b);
            if (dist >= sampleMatchThr) continue;

            collected.push(cell);
            count++;

            stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
        }

        // BFS 触 5000 上限且仍有未探索邻接 cell,提示用户采样区过大
        if (count >= MAX_CELLS && stack.length > 0) {
            alert('采样区过大');
        }

        if (collected.length === 0) continue;

        // 简单平均 (cells 都已经 α 不透明, 来自调色板)
        let sumR = 0,
            sumG = 0,
            sumB = 0;
        for (const c of collected) {
            sumR += c.r;
            sumG += c.g;
            sumB += c.b;
        }
        const newSample = {
            r: Math.round(sumR / collected.length),
            g: Math.round(sumG / collected.length),
            b: Math.round(sumB / collected.length),
        };

        const isDuplicate = samples.some(
            (s) => calculateColorDistance(s.r, s.g, s.b, newSample.r, newSample.g, newSample.b) < 8
        );
        if (!isDuplicate) samples.push(newSample);
    }

    return samples;
}

// 计算全局 α-weighted mean:Σ(pixel.rgb × α) / Σ(α)
// 全 α=0 时返回 {r:0,g:0,b:0}
export function computeAlphaWeightedMean(data) {
    let sumR = 0,
        sumG = 0,
        sumB = 0,
        sumA = 0;
    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a === 0) continue;
        sumR += data[i] * a;
        sumG += data[i + 1] * a;
        sumB += data[i + 2] * a;
        sumA += a;
    }
    if (sumA === 0) return { r: 0, g: 0, b: 0 };
    return { r: sumR / sumA, g: sumG / sumA, b: sumB / sumA };
}

// α-weighted k-means,接受原始 Uint8ClampedArray(data)而非 pixel object 数组。
// init: center₁ = α_max 像素;center₂ = 与 center₁ Oklab 距离最大的像素(D2)
// assign: RGB Euclidean(D1,平方距离,不开方)
// update: center = Σ(pixel.rgb × α) / Σ(α)(D5)
// 收敛:max center movement(平方距离)< eps² 提前停止(D3)
export function kMeansAlphaWeighted(data, w, h, k, maxIters, eps) {
    if (k === undefined) k = 2;
    if (maxIters === undefined) maxIters = 10;
    if (eps === undefined) eps = 1e-3;
    const pixelCount = w * h;
    if (pixelCount === 0) return [];

    // 单次扫描:找 α_max 像素索引 + 同时收集 α 总和
    let c1Idx = 0,
        maxA = -1;
    let sumA = 0;
    for (let i = 0; i < pixelCount; i++) {
        const a = data[i * 4 + 3];
        sumA += a;
        if (a > maxA) {
            maxA = a;
            c1Idx = i;
        }
    }
    if (sumA === 0) return []; // 全透明

    const c1R = data[c1Idx * 4],
        c1G = data[c1Idx * 4 + 1],
        c1B = data[c1Idx * 4 + 2];
    const c1Oklab = rgbToOklab(c1R, c1G, c1B);

    // 单次扫描:找与 center₁ Oklab 平方距离最大的像素
    let c2Idx = -1,
        maxDist = -1;
    for (let i = 0; i < pixelCount; i++) {
        if (i === c1Idx) continue;
        if (data[i * 4 + 3] === 0) continue; // 完全透明跳过(无 Oklab 信号)
        const o = rgbToOklab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
        const dL = o.L - c1Oklab.L,
            da = o.a - c1Oklab.a,
            db = o.b - c1Oklab.b;
        const dist = dL * dL + da * da + db * db;
        if (dist > maxDist) {
            maxDist = dist;
            c2Idx = i;
        }
    }

    // 退化:全同色 → 单簇
    if (c2Idx < 0) {
        return [{ center: { r: c1R, g: c1G, b: c1B }, alphaWeight: sumA, pixelCount }];
    }

    const c2R = data[c2Idx * 4],
        c2G = data[c2Idx * 4 + 1],
        c2B = data[c2Idx * 4 + 2];

    // 退化兜底:若 c1 和 c2 完全相同(理论上不会,因 dist > maxDist 时更新)
    if (c1R === c2R && c1G === c2G && c1B === c2B) {
        return [{ center: { r: c1R, g: c1G, b: c1B }, alphaWeight: sumA, pixelCount }];
    }

    // centers[0..k-1]: {r, g, b}
    const centers = [
        { r: c1R, g: c1G, b: c1B },
        { r: c2R, g: c2G, b: c2B },
    ];
    let prevCenters = [
        { r: centers[0].r, g: centers[0].g, b: centers[0].b },
        { r: centers[1].r, g: centers[1].g, b: centers[1].b },
    ];

    const assignments = new Uint8Array(pixelCount);
    const eps2 = eps * eps;

    for (let iter = 0; iter < maxIters; iter++) {
        // Assign
        for (let i = 0; i < pixelCount; i++) {
            const r = data[i * 4],
                g = data[i * 4 + 1],
                b = data[i * 4 + 2];
            const dr0 = r - centers[0].r,
                dg0 = g - centers[0].g,
                db0 = b - centers[0].b;
            const d0 = dr0 * dr0 + dg0 * dg0 + db0 * db0;
            const dr1 = r - centers[1].r,
                dg1 = g - centers[1].g,
                db1 = b - centers[1].b;
            const d1 = dr1 * dr1 + dg1 * dg1 + db1 * db1;
            assignments[i] = d0 <= d1 ? 0 : 1;
        }

        // Update (α-weighted mean)
        const sumR = new Float64Array(k);
        const sumG = new Float64Array(k);
        const sumB = new Float64Array(k);
        const sumAkk = new Float64Array(k);
        for (let i = 0; i < pixelCount; i++) {
            const kk = assignments[i];
            const a = data[i * 4 + 3];
            sumR[kk] += data[i * 4] * a;
            sumG[kk] += data[i * 4 + 1] * a;
            sumB[kk] += data[i * 4 + 2] * a;
            sumAkk[kk] += a;
        }
        for (let kk = 0; kk < k; kk++) {
            if (sumAkk[kk] > 0) {
                centers[kk] = {
                    r: sumR[kk] / sumAkk[kk],
                    g: sumG[kk] / sumAkk[kk],
                    b: sumB[kk] / sumAkk[kk],
                };
            }
        }

        // 收敛检测:max movement(平方距离)
        let maxMove = 0;
        for (let kk = 0; kk < k; kk++) {
            const dr = centers[kk].r - prevCenters[kk].r;
            const dg = centers[kk].g - prevCenters[kk].g;
            const db = centers[kk].b - prevCenters[kk].b;
            const move = dr * dr + dg * dg + db * db;
            if (move > maxMove) maxMove = move;
        }
        if (maxMove < eps2) break;
        prevCenters[0] = { r: centers[0].r, g: centers[0].g, b: centers[0].b };
        prevCenters[1] = { r: centers[1].r, g: centers[1].g, b: centers[1].b };
    }

    // Build cluster stats
    const clusterSumA = new Float64Array(k);
    const clusterCount = new Uint32Array(k);
    for (let i = 0; i < pixelCount; i++) {
        clusterSumA[assignments[i]] += data[i * 4 + 3];
        clusterCount[assignments[i]]++;
    }
    return [
        {
            center: { r: centers[0].r, g: centers[0].g, b: centers[0].b },
            alphaWeight: clusterSumA[0],
            pixelCount: clusterCount[0],
        },
        {
            center: { r: centers[1].r, g: centers[1].g, b: centers[1].b },
            alphaWeight: clusterSumA[1],
            pixelCount: clusterCount[1],
        },
    ];
}

// D4: 选离群簇 = 距 globalMean Oklab 距离最大者;若其 α-weight < 1% × total 则回退到 max α-weight
// 阈值保护:噪点 cluster α-weight 占比 < 1% → 被回退到 max α-weight
// thin feature (≥1%) → 保留作为 outlier
// 单簇直接返回该 cluster;空数组返回 null
export function pickOutlierCluster(clusters, globalMean) {
    if (clusters.length === 0) return null;
    if (clusters.length === 1) return clusters[0];

    const totalAlphaWeight = clusters.reduce((s, c) => s + c.alphaWeight, 0);
    const threshold = 0.01 * totalAlphaWeight;

    const gO = rgbToOklab(globalMean.r, globalMean.g, globalMean.b);
    let bestOutlier = null,
        maxDist = -1;
    for (const c of clusters) {
        const o = rgbToOklab(c.center.r, c.center.g, c.center.b);
        const dL = o.L - gO.L,
            da = o.a - gO.a,
            db = o.b - gO.b;
        const dist = dL * dL + da * da + db * db;
        if (dist > maxDist) {
            maxDist = dist;
            bestOutlier = c;
        }
    }

    if (bestOutlier.alphaWeight >= threshold) return bestOutlier;
    // 回退:max α-weight
    let bestByWeight = clusters[0];
    for (const c of clusters) {
        if (c.alphaWeight > bestByWeight.alphaWeight) bestByWeight = c;
    }
    return bestByWeight;
}

// 提取区域代表色并匹配到色板最近色
// mode = 'dominant' (主色) | 'alpha-weighted' (α-加权 k-means),默认 dominant
// 全透明格返回 { transparent: true };未知 mode 走 console.error + 回退 dominant
//
// sourceImageData(可选):预读的整图 ImageData。
//   - 提供时,内部按行 subarray 切片拼成 cell buffer(纯内存,零跨进程)
//   - 不提供时,回退到 tempCtx.getImageData(逐 cell 跨进程读取,慢但向后兼容)
//
// 必须逐行切片:ImageData 按行扫描,跨行时下一行字节紧接本行末尾。如果直接
// subarray(start, start + w*h*4) 会把行尾的"行间字节"(其实属于下一行 x=0..)
// 错算进本 cell,导致 cell 跨越 imgW 或包含多行时颜色完全错乱。
// generate.js 在 52/104 网格 + 像素尺寸不能整除网格时会出现 srcX+srcW > imgW,
// 整张图的所有列都会被错位染色(表现为"颜色混乱、细节全无")。
//
// 生产代码应传 sourceImageData(generate.js 主循环外预读一次,10816 cell 从 N 次 getImageData 降到 1 次);
// 5 参数形式保留作 test stub 便利。
export function getBlockColorForGrid(x0, y0, w, h, mode, sourceImageData) {
    if (mode === undefined) mode = 'dominant';
    let data;
    if (sourceImageData) {
        const W = sourceImageData.width;
        const total = w * h * 4;
        // 越界部分(行尾裁剪 + x0+w>W)保持 0 — 等价 canvas getImageData 越界默认透明(α=0)
        data = new Uint8ClampedArray(total);
        let dst = 0;
        for (let dy = 0; dy < h; dy++) {
            const sx = x0;
            const sy = y0 + dy;
            if (sy >= 0 && sy < sourceImageData.height && sx < W) {
                const rowW = Math.min(w, W - sx);
                const srcStart = (sy * W + sx) * 4;
                data.set(sourceImageData.data.subarray(srcStart, srcStart + rowW * 4), dst);
                dst += rowW * 4;
            } else {
                dst += w * 4; // 越界行整段保持 0(α=0 → 透明)
            }
        }
    } else {
        data = tempCtx.getImageData(x0, y0, w, h).data;
    }

    // D6: soft transparent 短路
    if (isTransparentCell(data)) return { transparent: true };

    let representative;
    if (mode === 'alpha-weighted') {
        // D2-D5: k-means + outlier picker
        const clusters = kMeansAlphaWeighted(data, w, h);
        const globalMean = computeAlphaWeightedMean(data);
        const picked = pickOutlierCluster(clusters, globalMean);
        if (picked === null) return { transparent: true };
        representative = picked.center;
    } else {
        // 'dominant' (含未知 mode 回退)
        if (mode !== 'dominant') {
            console.error('BeadColor.getBlockColorForGrid: 未知的 mode', mode, '— 回退到 dominant');
            mode = 'dominant';
        }
        representative = getDominantColorFromData(data);
    }

    if (representative === null) return { transparent: true };
    const closest = getClosestBeadColor(representative.r, representative.g, representative.b);
    // 防御性:空 palette 时 getClosestBeadColor 返回 null,视为透明格
    if (closest === null) return { transparent: true };
    return closest;
}

// 全局按颜色频率合并(参考 Zippland/perler-beads 的实现思路):
// 1. 统计网格里所有不同 code 的出现次数
// 2. 按频率从高到低排序
// 3. 每个高频色吸收所有"距离 < 阈值"的低频色(全局替换,不关心位置)
// 4. 平局由频率决定(高频赢),确定性强、单调,不会出现 seed-based DFS 的"噪声劫持"问题。
export function mergeSimilarColors(gridColors, cols, rows, distanceThreshold) {
    if (distanceThreshold === undefined) distanceThreshold = 8;
    if (!Number.isFinite(distanceThreshold)) distanceThreshold = 8;

    // 1. 统计频率 + 记录每个 code 对应的 cell(用于替换时复用 r/g/b/hex)
    const codeCount = new Map();
    const codeToCell = new Map();
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = gridColors[r][c];
            if (cell.transparent) continue;
            if (!codeCount.has(cell.code)) codeToCell.set(cell.code, cell);
            codeCount.set(cell.code, (codeCount.get(cell.code) || 0) + 1);
        }
    }

    // 2. 频率降序排序(sort 稳定,平局时按首次出现顺序)
    const sortedCodes = [...codeCount.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);

    // 3. 构建 oldCode -> newCode 映射(每个低频色被最近的高频邻居吸收)
    const codeMap = new Map();
    for (const code of sortedCodes) codeMap.set(code, code);

    for (let i = 0; i < sortedCodes.length; i++) {
        const highCode = sortedCodes[i];
        const highCell = codeToCell.get(highCode);
        for (let j = i + 1; j < sortedCodes.length; j++) {
            const lowCode = sortedCodes[j];
            // 已经被更前面的高频色吸收过,跳过
            if (codeMap.get(lowCode) !== lowCode) continue;
            const lowCell = codeToCell.get(lowCode);
            const dist = calculateColorDistance(
                highCell.r,
                highCell.g,
                highCell.b,
                lowCell.r,
                lowCell.g,
                lowCell.b
            );
            if (dist < distanceThreshold) {
                codeMap.set(lowCode, highCode);
            }
        }
    }

    // 4. 应用映射。透明格保留;其他格替换成目标 code 对应的 cell 对象
    //    (复用原 cell 对象,这样 drawGrid 取 r/g/b/hex 都不需要额外字段)
    const mergedGrid = Array.from({ length: rows }, () => new Array(cols));
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = gridColors[r][c];
            if (cell.transparent) {
                mergedGrid[r][c] = cell;
            } else {
                mergedGrid[r][c] = codeToCell.get(codeMap.get(cell.code));
            }
        }
    }
    return mergedGrid;
}

// 按当前品牌取显示色号
export function getDisplayCode(color, brand) {
    const m = BeadPalettes.COLOR_MAPPING[color.hex];
    return m && m[brand] ? m[brand] : color.code;
}

// 移除孤立的"翻盘像素":JPEG/降采样伪影会导致 104 网格的某格
// 主导色被噪点翻盘成相邻区域颜色(如白脑袋冒蓝点、黑身体冒白点)。
// 这种孤立格子的 4 邻居通常 ≥3 个颜色一致且都跟它不同——
// 检测到这种情况且它与邻居主色 Oklab 距离 > noiseThreshold 时,
// 用邻居主色替换。真正的"小细节"格子周围邻居颜色不会 3+ 一致,
// 所以不会被误删。
export function despeckleIsolatedCells(gridColors, cols, rows, noiseThreshold) {
    if (noiseThreshold === undefined) noiseThreshold = 20;
    if (!Number.isFinite(noiseThreshold)) noiseThreshold = 20;

    const result = gridColors.map((row) => row.slice());
    const dirs = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
    ];

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = gridColors[r][c];
            if (cell.transparent) continue;

            // 收集 4 个有效(非透明、范围内)邻居
            const neighbors = [];
            for (let d = 0; d < 4; d++) {
                const nr = r + dirs[d][0];
                const nc = c + dirs[d][1];
                if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
                const n = gridColors[nr][nc];
                if (n.transparent) continue;
                neighbors.push(n);
            }
            // 边缘格子(邻居不足 4 个)跳过,避免误判
            if (neighbors.length < 4) continue;

            // 统计邻居中每个 code 出现次数
            const counts = new Map();
            for (const n of neighbors) {
                counts.set(n.code, (counts.get(n.code) || 0) + 1);
            }
            let bestCode = null,
                bestCount = 0;
            for (const [code, count] of counts) {
                if (count > bestCount) {
                    bestCount = count;
                    bestCode = code;
                }
            }

            // 多数派 ≥3 且与本格颜色不同,且 Oklab 距离 > 阈值 → 替换
            if (bestCount >= 3 && bestCode !== cell.code) {
                const majority = neighbors.find((n) => n.code === bestCode);
                const dist = calculateColorDistance(
                    cell.r,
                    cell.g,
                    cell.b,
                    majority.r,
                    majority.g,
                    majority.b
                );
                if (dist > noiseThreshold) {
                    result[r][c] = majority;
                }
            }
        }
    }
    return result;
}

export const BeadColor = {
    calculateColorDistance,
    getClosestBeadColor,
    getDominantColor, // 保留(向后兼容)
    computeAlphaWeightedMean, // Task 2 (D1-D3, D5): α-加权均值
    kMeansAlphaWeighted, // Task 2 (D1-D3, D5): α-加权 k-means 聚类
    pickOutlierCluster, // Task 3 (D4): 离群簇选择 + 1% α-weight 阈值回退
    isTransparentCell, // Task 4 (D6): soft transparent 判定(α_max < 30)
    computeBackgroundSamplesFromGridAuto, // 自动背景检测:grid 4 角 cell 多数投票
    computeBackgroundSamplesFromGridPoints, // 点击标记背景:cell BFS 同色扩展
    getBlockColorForGrid,
    mergeSimilarColors,
    despeckleIsolatedCells,
    getDisplayCode,
};
