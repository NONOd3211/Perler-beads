// algorithms/pixel-beads/distance.js — 色彩空间距离函数
// 移植自 pixel-beads.com (www.pixel-beads.com) processing.worker.js
// 原始 reference: docs/reference/processing-worker-pixel-beads-com.js
//
// 字段命名约定(与 pindou rgbToOklab 一致,大写 L):
//   - Oklab 坐标: { L, a, b }(大写 L,小写 a/b,匹配 pindou 现有 API)
//   - pixel-beads.com reference 用小写 l,但纯命名差异,不影响算法
//
// 设计目标:
//   - 色彩空间无关:所有距离函数接收 {L, a, b} 或 {l, a, b} 对象
//     (用 L 做主键,a/b 任意,因为只有 L 字段名差异)
//   - K-means 内部用平方距离(避免 sqrt),匹配用 sqrt 距离
//   - 默认 Oklab(沿用 pindou 偏好,见 docs/learning-pixel-beads-generator-comparison-2026-07-23.md)
//   - CIE Lab 作为备选导出(供后续切换或对比)
//
// 与原 pindou calculateColorDistance 行为兼容:输入 RGB + 调色板 → Oklab 距离 × 100
//
// 距离单位约定:
//   - 函数名后缀 _squared:平方距离(无 sqrt,K-means 内部用)
//   - 无后缀:实际距离(× 100,与 pindou 现有 API 一致)

import { rgbToOklab } from '../../oklab.js';

// ============================================================================
// 平方距离(K-means 内部用,避免 sqrt)
// ============================================================================

/**
 * Oklab 平方距离(无 sqrt),用于 K-means assign 步骤的高频内层循环
 * @param {{L:number, a:number, b:number}} a  pindou rgbToOklab 返回大写 L
 * @param {{L:number, a:number, b:number}} b
 * @returns {number} 平方距离
 */
export function oklabDistanceSquared(a, b) {
    const dL = a.L - b.L;
    const da = a.a - b.a;
    const db = a.b - b.b;
    return dL * dL + da * da + db * db;
}

/**
 * CIE Lab 平方距离(无 sqrt)
 * @param {{L:number, a:number, b:number}} a
 * @param {{L:number, a:number, b:number}} b
 * @returns {number} 平方距离
 */
export function labDistanceSquared(a, b) {
    const dL = a.L - b.L;
    const da = a.a - b.a;
    const db = a.b - b.b;
    return dL * dL + da * da + db * db;
}

// ============================================================================
// 实际距离(× 100,匹配 pindou calculateColorDistance 的单位)
// ============================================================================

/**
 * Oklab 欧氏距离 × 100(感知色彩空间)
 * 与 pindou color.js calculateColorDistance 单位一致
 * @param {{L:number, a:number, b:number}} a
 * @param {{L:number, a:number, b:number}} b
 * @returns {number} 距离 × 100,值域 [0, 100+]
 */
export function oklabDistance(a, b) {
    return Math.sqrt(oklabDistanceSquared(a, b)) * 100;
}

/**
 * CIE Lab 欧氏距离 × 100(CIE76 Delta E)
 * pixel-beads.com 主力色彩空间(我们保留作为备选/对比)
 * @param {{L:number, a:number, b:number}} a
 * @param {{L:number, a:number, b:number}} b
 * @returns {number} CIE76 Delta E
 */
export function labDistance(a, b) {
    return Math.sqrt(labDistanceSquared(a, b)) * 100;
}

// ============================================================================
// 高层封装:从 RGB 直接算 + 在 palette 中找最近
// ============================================================================

/**
 * 从 RGB 算 Oklab 距离 × 100(与 pindou calculateColorDistance 行为等价)
 * @param {number} r1
 * @param {number} g1
 * @param {number} b1
 * @param {number} r2
 * @param {number} g2
 * @param {number} b2
 * @returns {number}
 */
export function rgbOklabDistance(r1, g1, b1, r2, g2, b2) {
    return oklabDistance(rgbToOklab(r1, g1, b1), rgbToOklab(r2, g2, b2));
}

/**
 * 在 palette 中找 Oklab 距离最近的 bead(精确匹配早退)
 * 与 pindou color.js getClosestBeadColor 行为等价
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {Array<{r:number, g:number, b:number, [key:string]:any}>} palette
 * @returns {object|null} 最近 bead,空 palette 返回 null
 */
export function findClosestBeadByOklab(r, g, b, palette) {
    if (!palette || palette.length === 0) return null;
    const target = rgbToOklab(r, g, b);
    let minDist = Infinity;
    let best = palette[0];
    for (let i = 0; i < palette.length; i++) {
        const c = palette[i];
        const d = oklabDistance(target, rgbToOklab(c.r, c.g, c.b));
        if (d === 0) return c; // 精确匹配提前退出
        if (d < minDist) {
            minDist = d;
            best = c;
        }
    }
    return best;
}
