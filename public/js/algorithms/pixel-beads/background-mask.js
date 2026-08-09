// algorithms/pixel-beads/background-mask.js — imageData 维度背景 BFS 检测
// 移植自 pixel-beads.com processing.worker.js
// 原始 reference: docs/reference/processing-worker-pixel-beads-com.js
//   - an() 函数(line 76-118) = 背景检测主函数
//   - rn() 函数(line 51-60) = 边缘像素索引生成
//   - cn() 函数(line 61-63) = 4 角像素索引
//   - y() 函数(line 64-67) = 单像素 RGB → Lab
//   - F() 函数(line 68-72) = 数组中位数
//   - Q() 函数(line 73-75) = Lab 中位色(Lab 各通道分别求中位)
//
// 工作流程:
//   1. 标记完全透明像素为背景(α ≤ ALPHA_THRESHOLD)
//   2. 边缘非透明像素的 Lab 中位色 = 候选背景色
//   3. 4 角像素与候选背景色的 ΔE 一致性 ≥ 75% → 高置信度,确认背景
//   4. BFS flood fill from edges:遍历到的像素与确认背景色 ΔE ≤ backgroundFillDeltaE → 标记为背景
//
// 色彩空间:CIE Lab(reference 1:1 移植,与 Oklab 区分)
// 输出:{ mask, detected, confidence }
//   - mask: Uint8Array(per pixel, 1=背景)
//   - detected: 是否识别出背景
//   - confidence: 识别置信度(0-1)

import { rgbToLab } from './lab.js';
import { labDistance } from './distance.js';

// Alpha 阈值:像素 α ≤ 此值视为透明
// reference line 50: N = 16
const ALPHA_THRESHOLD = 16;

// ============================================================================
// 辅助函数(从 reference 移植)
// ============================================================================

/**
 * 生成所有边缘像素的索引(4 条边)
 * 移植自 reference rn() 函数
 */
function edgeIndices(width, height) {
    const indices = [];
    // 顶边(单行)
    for (let x = 0; x < width; x++) indices.push(x);
    // 底边(单行)
    if (height > 1) {
        const bottomStart = (height - 1) * width;
        for (let x = 0; x < width; x++) indices.push(bottomStart + x);
    }
    // 左边(去掉已加的角)
    for (let y = 1; y < height - 1; y++) indices.push(y * width);
    // 右边(去掉已加的角)
    for (let y = 1; y < height - 1; y++) indices.push(y * width + width - 1);
    return indices;
}

/**
 * 4 角像素索引
 * 移植自 reference cn() 函数
 */
function cornerIndices(width, height) {
    return [0, width - 1, (height - 1) * width, height * width - 1];
}

/**
 * 单像素 RGB → Lab(从 imageData 取)
 * 移植自 reference y() 函数
 */
function pixelToLab(imageData, pixelIndex) {
    const i = pixelIndex * 4;
    return rgbToLab(imageData[i], imageData[i + 1], imageData[i + 2]);
}

/**
 * 数组中位数(偶数取两数均值)
 * 移植自 reference F() 函数
 */
function median(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Lab 中位色(各通道分别求中位)
 * 移植自 reference Q() 函数
 */
function medianLab(labs) {
    return {
        L: median(labs.map((c) => c.L)),
        a: median(labs.map((c) => c.a)),
        b: median(labs.map((c) => c.b)),
    };
}

// ============================================================================
// 主函数
// ============================================================================

/**
 * 检测图片的背景区域,返回 per-pixel 背景 mask
 * 移植自 reference an() 函数
 *
 * @param {object} params
 * @param {Uint8ClampedArray} params.imageData RGBA 整图
 * @param {number} params.width
 * @param {number} params.height
 * @param {"auto" | "keep"} params.mode auto=检测,keep=只标透明像素
 * @param {object} params.preset
 * @param {number} params.preset.backgroundSeedDeltaE 4 角一致判定阈值
 * @param {number} params.preset.backgroundFillDeltaE BFS 扩展阈值
 * @param {number} params.preset.backgroundMinimumConfidence 最低置信度(低于此返回 detected=false)
 * @returns {{mask: Uint8Array, detected: boolean, confidence: number}}
 */
export function detectBackgroundMask({ imageData, width, height, mode, preset }) {
    const totalPixels = width * height;
    const mask = new Uint8Array(totalPixels);

    // 1. 标记透明像素为背景
    for (let i = 0; i < totalPixels; i++) {
        if (imageData[i * 4 + 3] <= ALPHA_THRESHOLD) {
            mask[i] = 1;
        }
    }

    if (mode === 'keep') {
        return { mask, detected: false, confidence: 0 };
    }

    // 2. 边缘非透明像素的 Lab
    const edgeIdxs = edgeIndices(width, height);
    const edgeVisibleLabs = edgeIdxs
        .filter((idx) => imageData[idx * 4 + 3] > ALPHA_THRESHOLD)
        .map((idx) => pixelToLab(imageData, idx));

    if (edgeVisibleLabs.length === 0) {
        // 整图全透明,无背景可识别
        return { mask, detected: false, confidence: 1 };
    }

    // 3. 边缘 Lab 中位色
    const edgeMedianLab = medianLab(edgeVisibleLabs);

    // 4. 4 角 Lab
    const cornerIdxs = cornerIndices(width, height);
    const cornerVisibleLabs = cornerIdxs
        .filter((idx) => imageData[idx * 4 + 3] > ALPHA_THRESHOLD)
        .map((idx) => pixelToLab(imageData, idx));
    const cornerMedianLab = cornerVisibleLabs.length > 0 ? medianLab(cornerVisibleLabs) : edgeMedianLab;

    // 5. 4 角置信度:与 4 角中位色距离 ≤ backgroundSeedDeltaE 的比例
    const cornerMatchCount = cornerVisibleLabs.reduce(
        (acc, lab) => acc + (labDistance(lab, cornerMedianLab) <= preset.backgroundSeedDeltaE ? 1 : 0),
        0
    );
    const cornerMatchRatio = cornerVisibleLabs.length > 0 ? cornerMatchCount / cornerVisibleLabs.length : 0;
    // 4 角 ≥ 3 个 + ≥ 75% 一致 → 高置信度
    const cornerConfirmed = cornerVisibleLabs.length >= 3 && cornerMatchRatio >= 0.75;

    // 6. 决定背景色:cornerConfirmed 用 4 角中位,否则用边缘中位
    const backgroundLab = cornerConfirmed ? cornerMedianLab : edgeMedianLab;

    // 7. 边缘置信度:边缘像素与背景色距离 ≤ backgroundSeedDeltaE 的比例
    const edgeMatchRatio =
        edgeVisibleLabs.reduce(
            (acc, lab) => acc + (labDistance(lab, backgroundLab) <= preset.backgroundSeedDeltaE ? 1 : 0),
            0
        ) / edgeVisibleLabs.length;
    const confidence = Math.max(edgeMatchRatio, cornerConfirmed ? cornerMatchRatio : 0);

    if (mode === 'auto' && confidence < preset.backgroundMinimumConfidence) {
        return { mask, detected: false, confidence };
    }

    // 8. BFS flood fill from edges
    // reference 行为:
    //   - 初始化(边缘入队):已标记 / 透明 / 距离够小 → 都入队
    //   - 主循环(邻接扩展):已标记跳过;透明 / 距离够小 → 标记 + 入队
    const queue = new Int32Array(totalPixels);
    let head = 0;
    let tail = 0;

    // 初始化:边缘像素,已标记也入队(让 BFS 边界对齐)
    const initEnqueue = (pixelIdx) => {
        queue[tail++] = pixelIdx;
        if (mask[pixelIdx] === 1) return; // 已标记,不再标
        if (imageData[pixelIdx * 4 + 3] <= ALPHA_THRESHOLD) {
            mask[pixelIdx] = 1;
            return;
        }
        if (labDistance(pixelToLab(imageData, pixelIdx), backgroundLab) <= preset.backgroundFillDeltaE) {
            mask[pixelIdx] = 1;
        }
    };

    for (const idx of edgeIdxs) initEnqueue(idx);

    // 主循环:邻接扩展,已标记跳过
    const expandNeighbor = (pixelIdx) => {
        if (mask[pixelIdx] === 1) return; // 已标记,跳过
        if (
            imageData[pixelIdx * 4 + 3] <= ALPHA_THRESHOLD ||
            labDistance(pixelToLab(imageData, pixelIdx), backgroundLab) <= preset.backgroundFillDeltaE
        ) {
            mask[pixelIdx] = 1;
            queue[tail++] = pixelIdx;
        }
    };

    while (head < tail) {
        const pixelIdx = queue[head++];
        const x = pixelIdx % width;
        const y = Math.floor(pixelIdx / width);

        if (x > 0) expandNeighbor(pixelIdx - 1);
        if (x < width - 1) expandNeighbor(pixelIdx + 1);
        if (y > 0) expandNeighbor(pixelIdx - width);
        if (y < height - 1) expandNeighbor(pixelIdx + width);
    }

    return { mask, detected: true, confidence };
}
