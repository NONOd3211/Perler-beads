// algorithms/pixel-beads/pipeline.js — 主算法 pipeline (K-means + 色板匹配)
// 移植自 pixel-beads.com processing.worker.js
// 原始 reference: docs/reference/processing-worker-pixel-beads-com.js
//   - dn() 函数(line 197-219) = 主算法
//   - J() 函数(line 153-161) = 找最近中心(K-means 内部)
//   - Y() 函数(line 162-176) = 在 palette 中找最近(reference 简版,K-means++ init)
//
// 工作流程:
//   1. 收集非空 cells,转 CIE Lab,加权(weight = max(0.01, coverage) * outlineWeight(if outline))
//   2. K = min(maxColors, palette.length, cells.length)
//   3. K-means 聚类(Lab 距离,12 次迭代)
//   4. 调色板转 Lab
//   5. K-means 中心 → 最近 palette 颜色(用作"实际使用调色板子集")
//   6. 分配每 cell:
//      - outline → 强制使用 palette 中 L 最小的 bead
//      - 非 outline → 在子集中找最近 bead
//
// 色彩空间:CIE Lab D65(1:1 移植 reference,reference 用 R()/T()/Y() 都是 Lab)
// 与 pindou 偏好 Oklab 的差异:先 1:1 移植,后续再优化时切回 Oklab

import { rgbToLab } from './lab.js';
import { labDistance, labDistanceSquared } from './distance.js';
import { kmeans } from './kmeans.js';

const MIN_WEIGHT = 0.01; // 避免 weight=0 导致空簇

// ============================================================================
// Palette 转换:缓存 Lab 坐标,避免重复转换
// ============================================================================

/**
 * 把 palette 数组转成 CIE Lab 形式(带 id)
 * 输入:palette = [{ r, g, b, code, ... }]
 * 输出:[{ id, L, a, b }](id 默认 = code,如有则用 id)
 */
function paletteToLab(palette) {
    return palette.map((c) => {
        const lab = rgbToLab(c.r, c.g, c.b);
        return {
            id: c.id || c.code,
            L: lab.L,
            a: lab.a,
            b: lab.b,
        };
    });
}

/**
 * 在 Lab 化的 palette 中找最近 bead 的 id
 * 精确匹配早退(ΔE = 0)
 */
function findClosestPaletteId(targetLab, paletteLab) {
    let minDist = Infinity;
    let bestId = paletteLab[0].id;
    for (const p of paletteLab) {
        const d = labDistanceSquared(targetLab, p);
        if (d === 0) return p.id; // 精确匹配
        if (d < minDist) {
            minDist = d;
            bestId = p.id;
        }
    }
    return bestId;
}

// ============================================================================
// 主算法
// ============================================================================

/**
 * 主算法 pipeline:cell 特征 → 调色板 id 分配
 * 移植自 reference dn() 函数
 *
 * @param {object} params
 * @param {Array<{rgb:{r,g,b}, coverage:number, isOutline:boolean} | null>} params.cells
 *        来自 extractCellFeatures 的输出,length = targetWidth * targetHeight
 * @param {Array<{r:number, g:number, b:number, code:string, id?:string}>} params.palette
 *        可用色板
 * @param {number} params.k 最大聚类中心数(来自 preset.maxColors)
 * @param {number} [params.outlineWeight=1] outline 样本权重倍数(来自 preset.outlineWeight)
 * @returns {string[]} length = cells.length,值为 palette id (cell 为 null 时为 "")
 * @throws {Error} EMPTY_PALETTE if palette is empty
 */
export function assignBeads({ cells, palette, k, outlineWeight = 1 }) {
    if (!palette || palette.length === 0) {
        throw new Error('EMPTY_PALETTE');
    }
    const N = cells.length;
    const result = new Array(N).fill('');

    // 1. 收集非空 cells,转 Lab,加权
    const samples = [];
    for (let i = 0; i < N; i++) {
        const c = cells[i];
        if (!c) continue;
        const lab = rgbToLab(c.rgb.r, c.rgb.g, c.rgb.b);
        const weight = Math.max(MIN_WEIGHT, c.coverage) * (c.isOutline ? outlineWeight : 1);
        samples.push({
            index: i,
            lab,
            weight,
            isOutline: c.isOutline,
        });
    }

    if (samples.length === 0) return result;

    // 2. K = min(maxColors, palette.length, samples.length)
    const effectiveK = Math.max(1, Math.min(k, palette.length, samples.length));

    // 3. K-means 聚类
    const centers = kmeans(samples, effectiveK, 12, 1e-4);

    // 4. 调色板转 Lab
    const paletteLab = paletteToLab(palette);

    // 5. K-means 中心 → 最近 palette 颜色 → 子集
    const usedIds = new Set(centers.map((center) => findClosestPaletteId(center, paletteLab)));
    const usedPalette = paletteLab.filter((p) => usedIds.has(p.id));

    // 退化兜底:如果 usedPalette 为空(理论上不会,K 个中心总能找到),用全 palette
    const finalPalette = usedPalette.length > 0 ? usedPalette : paletteLab;

    // 6. 最暗色(reference 行为:outline 强制用 L 最小的)
    let darkest = finalPalette[0];
    for (const p of finalPalette) {
        if (p.L < darkest.L) darkest = p;
    }

    // 7. 分配
    for (const s of samples) {
        if (s.isOutline) {
            // outline 强制用最暗色
            result[s.index] = darkest.id;
        } else {
            // 在子集中找最近
            result[s.index] = findClosestPaletteId(s.lab, finalPalette);
        }
    }

    return result;
}

/**
 * 把 bead id 分配结果转回 bead 对象
 * 便利函数:assignBeads 返回 id 数组,这函数把 id 映射回 bead 对象
 *
 * @param {string[]} assignments assignBeads 输出
 * @param {Array<object>} palette 调色板
 * @returns {Array<object | {transparent:true} | null>}
 *          长度 = assignments 长度
 *          - "" → null(背景格)
 *          - 其他 id → 对应 bead 对象
 */
export function resolveAssignmentsToBeads(assignments, palette) {
    const idToBead = new Map();
    for (const c of palette) {
        idToBead.set(c.id || c.code, c);
    }
    return assignments.map((id) => {
        if (id === '') return null;
        return idToBead.get(id) || null;
    });
}
