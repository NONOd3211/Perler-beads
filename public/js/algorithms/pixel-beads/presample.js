// algorithms/pixel-beads/presample.js — 预采样(nearest-neighbor 降采样)
//
// 设计目的:
//   cell-extract 会对每 cell 内的多个像素求平均,把抗锯齿边缘的中间色混进结果,
//   K-means 再聚类时这些灰扑扑的中间色分不开,导致颜色不准。
//
//   预采样先用 nearest-neighbor 把原图降到 4x 目标网格大小:
//   - 每个输出像素取最近的源像素,**保留原色不带平均**
//   - 同 cell 内的多个预像素都来自原图同一区域,颜色相同,平均等于不平均
//   - 抗锯齿边缘的"中间色"被 nearest 强制落到一边(亮或暗),后续算法处理更干净
//
// 为什么不用 bilinear/box:
//   bilinear 会在像素间插值,又把"原色"变回"中间色",等于没做
//   box 平均同理
//   only nearest 真正保留了原图的离散色
//
// 1:1 移植自传统 pixel-art 工作流:原图 → 4x downsample → 调色板映射

/**
 * Nearest-neighbor 降采样
 * @param {Uint8ClampedArray} imageData 源图 RGBA
 * @param {number} srcW 源宽
 * @param {number} srcH 源高
 * @param {number} dstW 目标宽
 * @param {number} dstH 目标高
 * @returns {Uint8ClampedArray} 目标图 RGBA(新数组,长度 = dstW*dstH*4)
 */
export function presampleNearest(imageData, srcW, srcH, dstW, dstH) {
    if (dstW === srcW && dstH === srcH) return imageData;
    if (dstW <= 0 || dstH <= 0) {
        throw new Error(`presampleNearest: invalid dst size ${dstW}x${dstH}`);
    }
    const result = new Uint8ClampedArray(dstW * dstH * 4);
    // 用 +0.5 中心对齐,避免 (0,0) 始终取 srcY=0 的偏置
    for (let y = 0; y < dstH; y++) {
        const srcY = Math.min(srcH - 1, Math.floor((y + 0.5) * srcH / dstH));
        const srcRowOffset = srcY * srcW * 4;
        const dstRowOffset = y * dstW * 4;
        for (let x = 0; x < dstW; x++) {
            const srcX = Math.min(srcW - 1, Math.floor((x + 0.5) * srcW / dstW));
            const srcIdx = srcRowOffset + srcX * 4;
            const dstIdx = dstRowOffset + x * 4;
            result[dstIdx] = imageData[srcIdx];
            result[dstIdx + 1] = imageData[srcIdx + 1];
            result[dstIdx + 2] = imageData[srcIdx + 2];
            result[dstIdx + 3] = imageData[srcIdx + 3];
        }
    }
    return result;
}

/**
 * 根据倍率算预采样后的尺寸
 * - factor=1 或 <=1:不降采样,返回原尺寸
 * - factor>1:dst = src / factor(向下取整,最小不小于 1)
 * @param {number} srcW
 * @param {number} srcH
 * @param {number} factor 预采样倍率(1=不采样,4=4x)
 * @returns {{width: number, height: number}}
 */
export function presampleSize(srcW, srcH, factor) {
    if (!factor || factor <= 1) return { width: srcW, height: srcH };
    return {
        width: Math.max(1, Math.floor(srcW / factor)),
        height: Math.max(1, Math.floor(srcH / factor)),
    };
}
