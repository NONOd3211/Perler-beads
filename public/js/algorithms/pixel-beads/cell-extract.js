// algorithms/pixel-beads/cell-extract.js — Cell 特征提取 + isOutline 判定
// 移植自 pixel-beads.com processing.worker.js
// 原始 reference: docs/reference/processing-worker-pixel-beads-com.js
//   - gn() 函数(line 295-359) = 主体提取 + outline 判定
//   - q() 函数(line 292-294) = BT.709 luminance
//   - N 常量(line 50) = 16 (alpha 阈值,等价于 pindou 的 D6 软阈值 30)
//
// 输出每 cell 一个特征对象(或 null 表示背景格):
//   {
//     rgb: { r, g, b },          // 代表色 (outline 时仅用暗像素均值)
//     coverage: number,          // 前景像素占比 (0-1)
//     darkRatio: number,         // 暗像素占比 (0-1)
//     luminanceRange: number,    // luminance max - min
//     isOutline: boolean,        // 是否判定为暗部/轮廓
//   }
//
// 关键设计:
//   - 每 cell 内扫描 (srcX, srcY, srcW, srcH) 区域的每个像素
//   - 完全透明像素(α < ALPHA_THRESHOLD)跳过,等价于 pindou D6 软阈值
//   - luminance 用 BT.709 公式(reference 同):(0.2126 R + 0.7152 G + 0.0722 B) / 255
//   - isOutline 判定:暗像素占比够 + (luminance range 大 OR 平均 luminance 暗)
//   - 代表色:outline 仅用暗像素均值,主体用全部前景均值

// Alpha 阈值:像素 α < 此值视为透明/背景
// reference line 50: N = 16
// pindou D6 软阈值:30(略宽松,保留反走样边)
// 这里用 16(更接近 reference,跟 imageData 维度的 BFS 背景检测配合)
const ALPHA_THRESHOLD = 16;

/**
 * BT.709 luminance(0-1 范围)
 * 移植自 reference q() 函数
 */
function luminance(r, g, b) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * 提取每 cell 的代表色 + 暗部判定
 * 移植自 reference gn() 函数
 *
 * @param {object} params
 * @param {Uint8ClampedArray} params.imageData 整图 RGBA 数据
 * @param {number} params.imageWidth 整图宽度
 * @param {number} params.imageHeight 整图高度
 * @param {number} params.targetWidth 网格列数
 * @param {number} params.targetHeight 网格行数
 * @param {Uint8Array} [params.backgroundMask] 可选:per-pixel 背景 mask(1=背景像素)
 * @param {object} params.preset
 * @param {number} params.preset.minimumForegroundCoverage 最低前景占比(0-1)
 * @param {number} params.preset.outlineDarkLuminance 暗像素 luminance 阈值(0-1)
 * @param {number} params.preset.outlineDarkRatio 暗像素占比阈值(0-1)
 * @param {number} params.preset.outlineContrast luminance range 阈值(0-1)
 * @returns {Array<{rgb:{r:number,g:number,b:number}, coverage:number, darkRatio:number, luminanceRange:number, isOutline:boolean} | null>}
 *          length = targetWidth * targetHeight,null = 背景格
 */
export function extractCellFeatures({
    imageData,
    imageWidth,
    imageHeight,
    targetWidth,
    targetHeight,
    backgroundMask = null,
    preset,
}) {
    if (targetWidth <= 0 || targetHeight <= 0) return [];

    const result = [];

    for (let row = 0; row < targetHeight; row++) {
        // 行范围:row * H/rows 到 (row+1) * H/rows
        const yStart = Math.floor((row * imageHeight) / targetHeight);
        const yEnd = Math.max(yStart + 1, Math.floor(((row + 1) * imageHeight) / targetHeight));

        for (let col = 0; col < targetWidth; col++) {
            // 列范围
            const xStart = Math.floor((col * imageWidth) / targetWidth);
            const xEnd = Math.max(xStart + 1, Math.floor(((col + 1) * imageWidth) / targetWidth));

            // 单 cell 内累加
            let foregroundCount = 0;
            let sumR = 0,
                sumG = 0,
                sumB = 0;
            let darkCount = 0;
            let darkSumR = 0,
                darkSumG = 0,
                darkSumB = 0;
            let minLum = 1.0;
            let maxLum = 0.0;
            const totalPixels = (xEnd - xStart) * (yEnd - yStart);

            for (let y = yStart; y < yEnd; y++) {
                for (let x = xStart; x < xEnd; x++) {
                    const idx = (y * imageWidth + x) * 4;
                    const r = imageData[idx];
                    const g = imageData[idx + 1];
                    const b = imageData[idx + 2];
                    const a = imageData[idx + 3];
                    const pixelIdx = y * imageWidth + x;

                    // 跳过完全透明像素(α < 阈值)
                    if (a < ALPHA_THRESHOLD) continue;
                    // 跳过背景 mask 标记的像素(1.4 阶段会用上)
                    if (backgroundMask && backgroundMask[pixelIdx] === 1) continue;

                    // 前景像素
                    foregroundCount++;
                    sumR += r;
                    sumG += g;
                    sumB += b;

                    // luminance 范围
                    const lum = luminance(r, g, b);
                    if (lum < minLum) minLum = lum;
                    if (lum > maxLum) maxLum = lum;

                    // 暗像素(luminance ≤ 阈值)
                    if (lum <= preset.outlineDarkLuminance) {
                        darkCount++;
                        darkSumR += r;
                        darkSumG += g;
                        darkSumB += b;
                    }
                }
            }

            // 背景格判定:无前景 或 覆盖率太低
            const coverage = foregroundCount / totalPixels;
            if (foregroundCount === 0 || coverage < preset.minimumForegroundCoverage) {
                result.push(null);
                continue;
            }

            // 暗部判定
            const darkRatio = darkCount / foregroundCount;
            const luminanceRange = maxLum - minLum;
            const meanLum = luminance(sumR / foregroundCount, sumG / foregroundCount, sumB / foregroundCount);
            const isOutline =
                darkCount > 0 &&
                darkRatio >= preset.outlineDarkRatio &&
                (luminanceRange >= preset.outlineContrast || meanLum <= preset.outlineDarkLuminance);

            // 代表色:outline 仅用暗像素均值,主体用全部前景均值
            const divisor = isOutline ? darkCount : foregroundCount;
            const useSumR = isOutline ? darkSumR : sumR;
            const useSumG = isOutline ? darkSumG : sumG;
            const useSumB = isOutline ? darkSumB : sumB;

            result.push({
                rgb: {
                    r: Math.round(useSumR / divisor),
                    g: Math.round(useSumG / divisor),
                    b: Math.round(useSumB / divisor),
                },
                coverage,
                darkRatio,
                luminanceRange,
                isOutline,
            });
        }
    }
    return result;
}

// ============================================================================
// 预设参数定义(从 reference fn 对象移植)
// ============================================================================

/**
 * 5 档预设参数
 * 移植自 reference processing.worker.js fn 对象(line 220-291)
 *
 * 每档定义:
 *   - maxColors: K-means 聚类中心数(<= palette 颜色数,<= cell 数)
 *   - analysisPixelsPerCell: 每 cell 采样率(1=每像素都看,4=每 cell 内 4 像素采样)
 *   - minimumForegroundCoverage: 最低前景占比(背景格判定)
 *   - outlineDarkLuminance: 暗像素 luminance 阈值
 *   - outlineDarkRatio: 暗像素占比阈值
 *   - outlineContrast: luminance range 阈值
 *   - outlineWeight: K-means 中 outline 样本权重倍数
 *   - backgroundSeedDeltaE: 背景种子 BFS 阈值
 *   - backgroundFillDeltaE: 背景 BFS 扩展阈值
 *   - backgroundMinimumConfidence: 背景识别最低置信度
 *   - cleanupMinimumNeighbors: 8 邻去斑最小邻居一致数
 */
export const PRESETS = {
    legacy: {
        id: 'legacy',
        maxColors: null,
        minimumForegroundCoverage: 0,
        outlineDarkLuminance: 0,
        outlineDarkRatio: 1,
        outlineContrast: 1,
        outlineWeight: 1,
        backgroundSeedDeltaE: 0,
        backgroundFillDeltaE: 0,
        backgroundMinimumConfidence: 1,
        cleanupMinimumNeighbors: null,
    },
    zippland: {
        id: 'zippland',
        maxColors: null,
        minimumForegroundCoverage: 0,
        outlineDarkLuminance: 0,
        outlineDarkRatio: 1,
        outlineContrast: 1,
        outlineWeight: 1,
        backgroundSeedDeltaE: 0,
        backgroundFillDeltaE: 0,
        backgroundMinimumConfidence: 1,
        cleanupMinimumNeighbors: null,
    },
    simplified: {
        id: 'simplified',
        maxColors: 8,
        minimumForegroundCoverage: 0.28,
        outlineDarkLuminance: 0.34,
        outlineDarkRatio: 0.22,
        outlineContrast: 0.18,
        outlineWeight: 3,
        backgroundSeedDeltaE: 8,
        backgroundFillDeltaE: 13,
        backgroundMinimumConfidence: 0.85,
        cleanupMinimumNeighbors: 4,
    },
    standard: {
        id: 'standard',
        maxColors: 10,
        minimumForegroundCoverage: 0.2,
        outlineDarkLuminance: 0.32,
        outlineDarkRatio: 0.2,
        outlineContrast: 0.16,
        outlineWeight: 2.5,
        backgroundSeedDeltaE: 8,
        backgroundFillDeltaE: 14,
        backgroundMinimumConfidence: 0.85,
        cleanupMinimumNeighbors: 5,
    },
    detailed: {
        id: 'detailed',
        maxColors: 16,
        minimumForegroundCoverage: 0.12,
        outlineDarkLuminance: 0.28,
        outlineDarkRatio: 0.3,
        outlineContrast: 0.22,
        outlineWeight: 1.5,
        backgroundSeedDeltaE: 8,
        backgroundFillDeltaE: 13,
        backgroundMinimumConfidence: 0.88,
        cleanupMinimumNeighbors: 7,
    },
};
