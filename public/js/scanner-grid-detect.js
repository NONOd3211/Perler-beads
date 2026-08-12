// Task 2.0:自动检测图纸网格(rows/cols/cellSize/origin)
// 主算法:检测「灰线投影峰」— 网格线贯穿全图,投影值远高于文字,是最稳定的周期特征
// 回退:暗像素位置间距聚类(对无网格线图有效)

function toGrayscale(imageData) {
    const { width: w, height: h, data } = imageData;
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        gray[i] = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
    }
    return gray;
}

// ── 间距聚类:用容差桶代替精确众数,抗抗锯齿/JPEG 噪声 ──

// 将间距数组按 tolerance 聚类,返回 { center, count, total } 最多的那个
function clusterDiffs(diffs, tolerance) {
    if (diffs.length === 0) return null;
    // 按值排序,滑动窗口找最密区间
    const sorted = diffs.slice().sort((a, b) => a - b);
    let bestCenter = 0, bestCount = 0;
    let j = 0;
    for (let i = 0; i < sorted.length; i++) {
        while (j < sorted.length && sorted[j] - sorted[i] <= tolerance) j++;
        const count = j - i;
        if (count > bestCount) {
            bestCount = count;
            let sum = 0;
            for (let k = i; k < j; k++) sum += sorted[k];
            bestCenter = sum / count;
        }
    }
    return { center: bestCenter, count: bestCount, total: sorted.length };
}

// ── 主算法:灰线投影峰检测 ──
// 网格线(#888,灰度≈136)贯穿全行/全列,投影值 = 图高/图宽(极大)
// 文字(7-10px)投影值 = 字符高度(远小于网格线)
// 策略:统计每列/行中「灰线像素」数量,找投影极大峰 = 网格线位置

function detectGridLines(gray, w, h, axis) {
    const size = axis === 'x' ? w : h;
    const crossSize = axis === 'x' ? h : w;

    // 灰线像素判定:灰度在 [110, 170] 范围内(中心 136,容差 ±30)
    // #888 = 136, JPEG 压缩/缩放后可能偏移,±30 足够覆盖
    const GRAY_LO = 110;
    const GRAY_HI = 170;

    // 统计每列/行的灰线像素数
    const counts = new Array(size).fill(0);
    if (axis === 'x') {
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
                const v = gray[y * w + x];
                if (v >= GRAY_LO && v <= GRAY_HI) counts[x]++;
            }
        }
    } else {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const v = gray[y * w + x];
                if (v >= GRAY_LO && v <= GRAY_HI) counts[y]++;
            }
        }
    }

    // 网格线峰特征:投影值 ≈ crossSize(贯穿全图)
    // 文字/色块峰:投影值 << crossSize
    // 阈值:至少占 crossSize 的 40%(留余量给 JPEG 噪声和线宽变化)
    const lineThreshold = crossSize * 0.4;

    // 找局部极大峰(> 左右邻居,且 > lineThreshold)
    const peakPositions = [];
    for (let i = 0; i < size; i++) {
        if (counts[i] < lineThreshold) continue;
        // 局部极大:允许平台(连续等高取中心)
        const isLeftEdge = i === 0 || counts[i] > counts[i - 1];
        // 平台检测:连续 >= lineThreshold 的区间,取中心
        if (isLeftEdge) {
            let end = i;
            while (end + 1 < size && counts[end + 1] >= lineThreshold) end++;
            const center = Math.round((i + end) / 2);
            peakPositions.push(center);
            i = end; // 跳过已处理的平台
        }
    }

    if (peakPositions.length < 2) return null;

    // 计算相邻峰间距
    const diffs = [];
    for (let i = 1; i < peakPositions.length; i++) {
        diffs.push(peakPositions[i] - peakPositions[i - 1]);
    }

    // 聚类找主导间距(容差 = 2,覆盖 1-2px 的抗锯齿偏移)
    const cluster = clusterDiffs(diffs, 2);
    if (!cluster || cluster.count < 2) return null;

    const period = Math.round(cluster.center);
    const strength = cluster.count / cluster.total;

    // origin:第一条网格线位置 + cellSize/2 = 第一个 cell 的中心
    // peakPositions[0] 是第一条检测到的网格线位置
    const firstLine = peakPositions[0];

    return { period, strength, firstLine, peakCount: peakPositions.length };
}

// ── 回退算法:暗像素位置间距聚类 ──
// 对无网格线的图(纯色块+文字),用暗像素坐标间距的主导周期

function otsuThreshold(gray) {
    if (gray.length === 0) return 128;
    const hist = new Array(256).fill(0);
    for (const v of gray) hist[v]++;
    const total = gray.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, maxVar = -1, threshold = 1;
    for (let t = 1; t < 256; t++) {
        wB += hist[t];
        if (wB === 0) continue;
        const wF = total - wB;
        if (wF === 0) break;
        sumB += t * hist[t];
        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;
        const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > maxVar) {
            maxVar = between;
            threshold = t;
        }
    }
    return threshold;
}

function detectByDarkPixels(gray, w, h, axis) {
    const t = otsuThreshold(gray);
    const positions = new Set();
    if (axis === 'x') {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (gray[y * w + x] < t) positions.add(x);
            }
        }
    } else {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (gray[y * w + x] < t) positions.add(y);
            }
        }
    }
    const sorted = Array.from(positions).sort((a, b) => a - b);
    if (sorted.length < 2) return null;

    // 相邻暗像素坐标的间距
    const diffs = [];
    for (let i = 1; i < sorted.length; i++) {
        const d = sorted[i] - sorted[i - 1];
        if (d >= 2) diffs.push(d);
    }
    if (diffs.length === 0) return null;

    // 聚类(容差 3,暗像素间距更分散)
    const cluster = clusterDiffs(diffs, 3);
    if (!cluster || cluster.count / cluster.total < 0.05) return null;

    return { period: Math.round(cluster.center), strength: cluster.count / cluster.total };
}

// ── 组装:从两个方向的检测结果计算最终 grid ──

function finalizeGrid(w, h, xResult, yResult, isPrimary) {
    // cellSize:优先各自独立取,若差异过大则取平均(图纸 cell 是正方形)
    const periodX = xResult.period;
    const periodY = yResult.period;
    const ratio = Math.max(periodX, periodY) / Math.min(periodX, periodY);
    // 正常图纸 cellSize X/Y 应接近,差异 > 1.5 说明某方向检测不可靠
    const cellSize = ratio <= 1.5
        ? Math.round((periodX + periodY) / 2)
        : Math.round(Math.max(periodX, periodY)); // 取较大值更安全(小值可能是文字间距)

    if (cellSize < 3 || cellSize > 80) {
        return { rows: 0, cols: 0, cellSize, origin: { x: 0, y: 0 }, confidence: 0.2 };
    }

    const cols = Math.max(1, Math.round(w / cellSize));
    const rows = Math.max(1, Math.round(h / cellSize));

    // origin:第一个 cell 的中心坐标
    // 主算法(灰线):firstLine 是第一条网格线位置,cell 中心 = firstLine + cellSize/2
    // 回退算法:假设网格从 0 开始,cell 中心 = cellSize/2
    const originX = xResult.firstLine != null
        ? xResult.firstLine + Math.floor(cellSize / 2)
        : Math.floor(cellSize / 2);
    const originY = yResult.firstLine != null
        ? yResult.firstLine + Math.floor(cellSize / 2)
        : Math.floor(cellSize / 2);

    // 置信度:基于 strength 和峰数
    const avgStrength = (xResult.strength + yResult.strength) / 2;
    // 主算法至少 3 条线才可靠,回退算法需要更高 strength
    const minPeaks = isPrimary ? 3 : 5;
    const hasEnoughPeaks = (xResult.peakCount || 0) >= minPeaks && (yResult.peakCount || 0) >= minPeaks;
    const confidence = hasEnoughPeaks ? avgStrength : avgStrength * 0.5;

    return { rows, cols, cellSize, origin: { x: originX, y: originY }, confidence };
}

export function detectGrid(imageData) {
    const { width: w, height: h } = imageData;
    if (w < 20 || h < 20) {
        return { rows: 0, cols: 0, cellSize: 0, origin: { x: 0, y: 0 }, confidence: 0 };
    }

    const gray = toGrayscale(imageData);

    // 主算法:灰线投影峰检测
    const xResult = detectGridLines(gray, w, h, 'x');
    const yResult = detectGridLines(gray, w, h, 'y');

    if (xResult && yResult) {
        return finalizeGrid(w, h, xResult, yResult, true);
    }

    // 回退:暗像素位置间距聚类
    const xResult2 = detectByDarkPixels(gray, w, h, 'x');
    const yResult2 = detectByDarkPixels(gray, w, h, 'y');

    if (xResult2 && yResult2) {
        // 回退算法没有 firstLine 信息
        return finalizeGrid(w, h, { ...xResult2, firstLine: null }, { ...yResult2, firstLine: null }, false);
    }

    return { rows: 0, cols: 0, cellSize: 0, origin: { x: 0, y: 0 }, confidence: 0.2 };
}
