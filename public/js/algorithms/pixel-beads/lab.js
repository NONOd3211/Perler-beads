// algorithms/pixel-beads/lab.js — CIE Lab 色彩空间转换
// 移植自 pixel-beads.com processing.worker.js
// 原始 reference: docs/reference/processing-worker-pixel-beads-com.js
//   - W() 函数(line 395-398) = sRGB → linear
//   - O() 函数(line 399-414) = linear → Oklab
//   - 但我们这里要 Lab 不是 Oklab,改用标准 CIE Lab
//   - 与 reference R() 函数等价 (line 1-49 CIE Lab D65)
//
// 为什么用 Lab:
//   - reference 背景检测的 ΔE 阈值(8/13/14)是 Lab 单位
//   - 1:1 移植 reference an() 必须用 Lab
//   - pindou 整体偏好 Oklab(主算法),但背景 BFS 沿用 Lab(reference 兼容)
//
// 色彩空间混用说明:
//   - 背景检测(an): CIE Lab(reference 1:1)
//   - 主体提取(gn): luminance only,无色彩空间依赖
//   - K-means 聚类: Oklab(pindou 偏好,1.2 阶段已实现)
//   - 距离匹配: Oklab(pindou 偏好,1.1 阶段已实现)
//
// sRGB → CIE Lab D65 标准流程:
//   sRGB → linear RGB (gamma 反校正)
//   → XYZ (D65)
//   → Lab (D65 reference white)

const REF_X = 95.047; // D65
const REF_Y = 100.0;
const REF_Z = 108.883;

/**
 * sRGB → linear (反 gamma 校正)
 * 移植自 reference W() 函数
 */
function srgbToLinear(c) {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/**
 * RGB → CIE Lab D65
 * 移植自 reference R() 函数 (CIE Lab D65 版本)
 *
 * @param {number} r 0-255
 * @param {number} g 0-255
 * @param {number} b 0-255
 * @returns {{L:number, a:number, b:number}} Lab 坐标(L 0-100, a/b 无界)
 */
export function rgbToLab(r, g, b) {
    const lr = srgbToLinear(r);
    const lg = srgbToLinear(g);
    const lb = srgbToLinear(b);

    // linear RGB → XYZ (D65, sRGB matrix)
    const X = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) * 100;
    const Y = (lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175) * 100;
    const Z = (lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) * 100;

    // XYZ → Lab
    const xR = X / REF_X;
    const yR = Y / REF_Y;
    const zR = Z / REF_Z;

    const fx = xR > 0.008856 ? Math.cbrt(xR) : (7.787 * xR + 16 / 116);
    const fy = yR > 0.008856 ? Math.cbrt(yR) : (7.787 * yR + 16 / 116);
    const fz = zR > 0.008856 ? Math.cbrt(zR) : (7.787 * zR + 16 / 116);

    return {
        L: 116 * fy - 16,
        a: 500 * (fx - fy),
        b: 200 * (fy - fz),
    };
}
