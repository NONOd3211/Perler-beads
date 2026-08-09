// algorithms/pixel-beads/kmeans.js — K-means++ 初始化 + K-means 迭代
// 移植自 pixel-beads.com processing.worker.js
// 原始 reference: docs/reference/processing-worker-pixel-beads-com.js
//   - sn() 函数 = K-means++ 初始化(line 162-176)
//   - un() 函数 = K-means 主迭代(line 177-196)
//
// 差异 vs reference:
//   - reference 用 Lab 距离(平方),我们用 Oklab 平方距离(沿用 pindou 偏好)
//   - 接口:接收 {L, a, b, weight, isOutline} 样本数组,返回 k 个中心
//   - 默认 12 次迭代 + 1e-4 收敛阈值(reference 同)
//
// 关键设计点:
//   - 中心初始化:outline 优先 + L 最暗(reference 行为)
//   - 距离函数:用平方(避免 sqrt,K-means 内层循环热路径)
//   - 权重:每个样本 weight 影响 K-means 中心计算(α-weighted mean)
//   - 收敛:max center movement < threshold
//
// 样本格式约定:
//   { L:number, a:number, b:number, weight:number, isOutline?:boolean }
//   - L, a, b:Oklab 坐标(已转好)
//   - weight:样本权重(α 加权时用 α,简单模式 = 1)
//   - isOutline:暗部标记(影响初始化,首中心取 outline 中 L 最小的)

import { oklabDistanceSquared } from './distance.js';

const DEFAULT_MAX_ITER = 12;
const DEFAULT_CONVERGE_THRESHOLD = 1e-4; // 平方距离单位(reference 同)

// ============================================================================
// K-means++ 初始化
// ============================================================================

/**
 * K-means++ 初始化:选 k 个初始中心
 * 移植自 reference sn() 函数
 *
 * 步骤:
 *   1. 首中心:如果有 outline 样本,取 L 最小的 outline;否则所有样本中 L 最小的
 *   2. 后续每个中心:按"距离已选中心最远"×weight 选(权重加权采样)
 *   3. 提前停止:剩余最大距离 ≤ EPSILON(所有样本都已覆盖)
 *
 * @param {Array<{lab:{L:number, a:number, b:number}, weight:number, isOutline?:boolean}>} samples
 * @param {number} k 目标中心数
 * @returns {Array<{L:number, a:number, b:number}>} k 个中心(实际可能少于 k)
 */
export function kmeansPlusPlusInit(samples, k) {
    if (samples.length === 0 || k <= 0) return [];
    const centers = [];

    // 1. 首中心:outline 优先取 L 最小的
    const outlines = samples.filter((s) => s.isOutline);
    const seedPool = outlines.length > 0 ? outlines : samples;
    let first = seedPool[0];
    for (const s of seedPool) {
        if (s.lab.L < first.lab.L) first = s;
    }
    centers.push({ L: first.lab.L, a: first.lab.a, b: first.lab.b });

    // 2. 后续 k-1 个中心:按权重加权的最远距离采样
    for (let i = 1; i < k; i++) {
        let bestSample = null;
        let bestScore = -Infinity;
        for (const s of samples) {
            // 找该样本到所有已选中心的最近距离
            let minDist = Infinity;
            for (const c of centers) {
                const d = oklabDistanceSquared(s.lab, c);
                if (d < minDist) minDist = d;
            }
            // 加权(参考 reference sn():c = s * weight,取最大 c 的样本)
            const score = minDist * s.weight;
            if (score > bestScore) {
                bestScore = score;
                bestSample = s;
            }
        }
        if (!bestSample || bestScore <= Number.EPSILON) break;
        centers.push({ L: bestSample.lab.L, a: bestSample.lab.a, b: bestSample.lab.b });
    }
    return centers;
}

// ============================================================================
// K-means 主迭代
// ============================================================================

/**
 * K-means 主迭代:初始化 + 收敛,返回 k 个中心
 * 移植自 reference un() 函数
 *
 * 步骤:
 *   1. K-means++ 初始化 k 个中心
 *   2. 迭代(默认 12 次):
 *      a. assign:每个样本分配到最近中心(平方距离)
 *      b. update:每个中心 = 该簇所有样本的 weight-weighted mean(Oklab 空间)
 *      c. 收敛检测:max center movement(平方)< threshold → 提前停止
 *
 * @param {Array<{lab:{L:number, a:number, b:number}, weight:number, isOutline?:boolean}>} samples
 * @param {number} k 目标中心数
 * @param {number} [maxIter=12] 最大迭代次数
 * @param {number} [threshold=1e-4] 收敛阈值(平方距离单位)
 * @returns {Array<{L:number, a:number, b:number}>} k 个中心
 */
export function kmeans(samples, k, maxIter = DEFAULT_MAX_ITER, threshold = DEFAULT_CONVERGE_THRESHOLD) {
    if (samples.length === 0 || k <= 0) return [];

    // 1. 初始化
    let centers = kmeansPlusPlusInit(samples, k);

    // 退化:样本数 < k 或初始化失败
    if (centers.length === 0) return [];

    // 2. 迭代
    const thresholdSq = threshold; // 已是平方距离单位
    for (let iter = 0; iter < maxIter; iter++) {
        // a. assign:每个样本到最近中心
        const assignments = new Int32Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
            const s = samples[i];
            let minDist = Infinity;
            let bestK = 0;
            for (let kk = 0; kk < centers.length; kk++) {
                const d = oklabDistanceSquared(s.lab, centers[kk]);
                if (d < minDist) {
                    minDist = d;
                    bestK = kk;
                }
            }
            assignments[i] = bestK;
        }

        // b. update:每簇 weight-weighted mean
        const sumL = new Float64Array(centers.length);
        const sumA = new Float64Array(centers.length);
        const sumB = new Float64Array(centers.length);
        const sumW = new Float64Array(centers.length);
        for (let i = 0; i < samples.length; i++) {
            const s = samples[i];
            const kk = assignments[i];
            const w = s.weight || 1;
            sumL[kk] += s.lab.L * w;
            sumA[kk] += s.lab.a * w;
            sumB[kk] += s.lab.b * w;
            sumW[kk] += w;
        }

        const newCenters = [];
        for (let kk = 0; kk < centers.length; kk++) {
            if (sumW[kk] > 0) {
                newCenters.push({
                    L: sumL[kk] / sumW[kk],
                    a: sumA[kk] / sumW[kk],
                    b: sumB[kk] / sumW[kk],
                });
            } else {
                // 空簇:保留原中心(reference 行为,避免 NaN)
                newCenters.push(centers[kk]);
            }
        }

        // c. 收敛检测:max movement(平方)
        let maxMove = 0;
        for (let kk = 0; kk < centers.length; kk++) {
            const d = oklabDistanceSquared(centers[kk], newCenters[kk]);
            if (d > maxMove) maxMove = d;
        }
        centers = newCenters;
        if (maxMove < thresholdSq) break;
    }
    return centers;
}
