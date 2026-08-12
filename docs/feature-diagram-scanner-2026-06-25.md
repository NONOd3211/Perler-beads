# 图纸扫描 / 导入功能 — 设计文档

> ## ⚠️ 本文档已废弃(2026-06-28)
>
> **保留原因**:记录文字级模板识别路线的完整设计过程,作为「实验失败」的历史参考,避免未来重走老路。
>
> **新方向见**:
> - [openspec/changes/scanner-diagram-import/proposal.md](../openspec/changes/scanner-diagram-import/proposal.md)
> - [openspec/changes/scanner-diagram-import/design.md](../openspec/changes/scanner-diagram-import/design.md)
> - [openspec/changes/scanner-diagram-import/specs/diagram-import/spec.md](../openspec/changes/scanner-diagram-import/specs/diagram-import/spec.md)
>
> **废弃原因**:文字级识别路线(模板匹配 + 291 词表 + 易混字符纠错)实验期 H02/T01 区分成功率 < 20%,方案不可行。
>
> 新方向 = 仅支持**本项目 `generate.js` 导出图回导**,按 cell 颜色精确匹配 MARD 291 调色板,无文字识别、无 OCR、无模板。`scanner-templates.js` / `scanner-recognize.js` 等模块已从分支移除。
>
> ---
>
> # 以下为旧版设计文档,内容已被替代,仅供参考

- **日期**:2026-06-25
- **状态**:**已废弃**(第 2 版按「中档通用性」方向修订的文字识别路线未达预期,见顶部说明)
- **前置依赖**:MARD 单品牌重构已完成(`refactor/mard-only` 分支)
- **作者**:AI 协作起草

> **第 2 版修订摘要**(相对第 1 版):
> - 明确**通用性目标档位 = 中档**:支持任意软件生成的电子图纸截图,不假设来源是本项目导出。
> - 识别引擎**不用 Tesseract.js**(闭集短文本场景下它不如专用方案),采用**自建模板匹配 + 291 词表约束**。
> - 撤回第 1 版"整词模板反查"的设想——那是"已知本项目渲染参数"的特例优化;通用场景下**逐字切分 + 词表校验更鲁棒**。
> - 字体从 `SimHei/SimSun/Arial` 改为**代表性无衬线**(去掉衬线体 SimSun),因为色号是纯 ASCII、图纸不会用衬线体。
> - 把**归一化**和**易混字符专项纠错**提升为成败关键(各设专节)。
> - 验收指标按通用场景重定(85–92%),本项目导出图作为高精度特例另列。
> - 新增 **PNG metadata 快速通道**(Phase 2)——本项目导出图的专属零误差路径,与通用扫描器解耦共存。

---

## 一、目标与范围

### 1.1 业务目标

让用户上传一张**正方格、规整、格内印有 MARD 色号文字**的拼豆图纸截图,系统自动识别格内文字、还原成电子版颜色矩阵,直接进入现有编辑器流程,允许手动修正错误格。

**通用性定位**:这是一个通用导入功能,要能吃下**任意来源**的电子图纸截图——本项目导出的、别的拼豆软件导出的、网上找的——只要图是规整电子图(格内印色号、无拍照畸变),都应能处理。不针对单一软件的渲染参数做硬编码假设。

### 1.2 输入输出

| | 描述 |
|---|---|
| **输入** | 用户上传 JPEG / PNG 图(横屏或竖屏,边长 500–4000 像素);来源不限 |
| **输出** | 写入现有 `lastMergedGrid[row][col]`,每个 cell 是 `{ code, hex, r, g, b, name }`(MARD 色板对象)或 `{ transparent: true }` |
| **限制** | 仅 MARD 品牌(其他品牌已下线);仅处理规整电子图(不矫正透视/旋转) |

### 1.3 通用性档位与不在范围

本功能定位于**中档通用性**:

| 档位 | 说明 | 本功能 |
|---|---|---|
| 窄 | 仅本项目 / 已知软件导出 | ✅ 包含(且本项目导出图可走 Phase 2 metadata 快通道) |
| **中** | **任意电子生成的图纸截图(未知字体/布局,但规整无畸变)** | ✅ **目标档位** |
| 宽 | 手机拍照的纸质图纸(光照/透视/阴影) | ❌ 不在范围 |
| 最宽 | 手写体、歪斜、模糊 | ❌ 不在范围 |

**明确不做**(后续 phase 或永不):
- 透视矫正、旋转矫正(拍照场景)
- 手写体识别
- 多品牌混排
- 半透明 / 阴影图
- 批量识别

> 中档以上(拍照)每升一档工程量翻倍且准确率回报急剧变差,不在本期目标内。若将来要升档,预处理层可复用,只需加强识别引擎。

---

## 二、核心算法思路

采用**"读字 + 查表"**策略——不识别颜色,只识别格内已印好的色号文字,然后查 MARD 色板拿到 hex。

之所以"读字"而非"读色":电子截图里格子背景色未必对应色号真实颜色(有些图纸格子是统一底),唯一可信的信息载体是色号文字本身。

```
┌────────────────────────────────────────────────────────────┐
│ Step 1: 几何定位(知道格子边界)                              │
│  用户输入 rows×cols → 2 点校准(对角格子中心)                 │
│  → 拿到 N×M 个 cell 的精确像素矩形                            │
└────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│ Step 2: 归一化(吸收字体/字号/字重差异——成败关键)             │
│  切格 → 去网格线 → 二值化 → 找文字 bbox → letterbox 标准尺寸  │
└────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│ Step 3: 字符识别(逐字切分 + 多字体模板匹配)                  │
│  投影切字符 → 每字与无衬线模板库比对 → 每字 top-k 候选         │
└────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│ Step 4: 词表校验 + 易混字符纠错(291 闭集红利)                │
│  组合查词表 → 不命中则按易混对(0/O、2/Z…)生成变体重试         │
│  → 拿到每格色号                                               │
└────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│ Step 5: 查表 + 写 grid                                      │
│  色号 → 反查 BEAD_PALETTE_291 → 拿到 cell 对象               │
│  写进 lastMergedGrid → repaint                              │
└────────────────────────────────────────────────────────────┘
```

### 2.1 为什么不用 Tesseract.js

Tesseract 是为**自然语言长文本**设计的,在本场景下"强项用不上、弱项全踩中":

| Tesseract 特性 | 本场景 | 影响 |
|---|---|---|
| 靠上下文语言模型纠错 | 色号仅 2-4 字符,无上下文 | 准确率显著下降 |
| 适合中等以上字号 | 色号常 8-12px 小字 | 需额外放大预处理 |
| 字母数字天然混淆(0/O、1/I、2/Z) | 色号全是字母+数字 | 正好踩雷 |
| 不知道结果是闭集 | 有 291 词表红利却吃不到 | — |

结论:闭集短文本场景下,自建模板 + 词表约束比 Tesseract 更合适,且不引入几 MB WASM 体积(契合项目零运行时依赖理念)。

### 2.2 通用方案成败的 4 个关键

字体选择只占其一,另外三件才是决定性因素:

1. **字符集白名单**:只认 `0-9 + A-Z`,其它字符一律拒,大幅降噪。
2. **归一化**:吸收字体/字号/字重/描边差异。**这步做好 2 种字体就够;做不好 10 种也救不回来。**
3. **易混字符专项纠错**:`0/O`、`1/I`、`2/Z`、`5/S`、`6/G`、`8/B` 在像素层面天然接近,靠词表 + 易混对表纠错,是"中等准确率"拉到"可用"的关键红利。
4. **置信度分级 + 错误格手填**:永远是兜底真理,再高的识别率也要它兜。

---

## 三、模块设计

### 3.1 文件结构

```
public/js/
├── scanner.js              # 新增:扫描主流程(Step 1/5 + 编排)
├── scanner-templates.js    # 新增:模板生成 + 缓存
├── scanner-preprocess.js   # 新增:图像预处理(切格、去线、二值化、归一化)
├── scanner-recognize.js    # 新增:字符识别 + 词表校验 + 易混纠错
└── ui-scanner.js           # 新增:扫描 UI(模态框、上传、校准)
```

**职责切分**:
- `scanner.js`:对外主入口 `importDiagramFromImage(file, rows, cols, anchorPoints)`
- `scanner-templates.js`:模板构建 `buildCharTemplates(fonts)`,返回 `{ '0': [{font, data}...], 'A': [...], ... }`
- `scanner-preprocess.js`:`splitGrid`、`stripGridLines`、`preprocessCell`(二值化 + bbox + letterbox)、`splitByProjection`
- `scanner-recognize.js`:`recognizeCell`、`combineWithVocabulary`、`fixByConfusables`
- `ui-scanner.js`:`openScannerModal()`、`attachScannerListeners()`、DOM 引用收集

**与现有模块的边界**(单向依赖,不引入循环):
- 只读 `BEAD_PALETTE_291`(MARD 全量,[palettes.js:4](../js/palettes.js#L4))
- 只读 `setLastMergedGrid`、`setLastGridDims`(state.js 现有 mutator,[state.js:70](../js/state.js#L70))
- 写完后调用 `render-bus.js#repaintCurrentMode`([render-bus.js:30](../js/render-bus.js#L30))触发重绘
- 错误格暂存进 `scannerErrors`(新 state 字段),不污染 lastMergedGrid

> 依赖方向 scanner-* → state/render-bus/palettes,单向,不会重新引入 [code-audit 第 3 点](./code-audit-2026-06-24.md) 已还掉的循环依赖债。

### 3.2 关键函数签名

```javascript
// scanner.js
export async function importDiagramFromImage(imageData, rows, cols, anchors);
// imageData: HTMLImageElement 或 ImageData
// rows/cols: 用户输入的网格数
// anchors: [{ col, row, x, y }] × 2,对角格子中心(像素坐标)
// 返回: { ok: true, errors: [{ row, col, reason, candidates: [...] }] }
//       或 { ok: false, fatal: '...' }

// scanner-templates.js
export function buildCharTemplates(chars, fonts);
// chars: ['0'-'9', 'A'-'Z'] 默认 36 个
// fonts: [{ family: 'Arial' }, { family: 'Helvetica' }, ...] 默认 2-3 套代表性无衬线
// 返回: { 'A': [{ font: 'Arial', data: Uint8Array }, ...], ... }

// scanner-preprocess.js
export function splitGrid(imageData, rows, cols, anchors);
// 返回: ImageData[][]  二维数组,每个 ImageData 是一个 cell 的像素

export function stripGridLines(cellImageData);
// 去掉 cell 边缘的网格线像素(内缩 + 按灰度剔除 #888 附近的线)
// 返回: ImageData(略小于原 cell)

export function preprocessCell(cellImageData, targetW = 24, targetH = 32);
// 1. 灰度 + 二值化(Otsu,失败回退固定阈值)
// 2. 找文字 bbox(投影法或连通域)
// 3. letterbox 归一化到 targetW × targetH
// 返回: { bin: Uint8Array(0/1,长度 targetW*targetH), empty: boolean }

export function splitByProjection(binImage, w, h);
// 投影法切分字符(找竖直黑像素密度低谷 = 字间空隙)
// 返回: [{ x0, y0, x1, y1 }, ...]  字符 bbox 列表

// scanner-recognize.js
export function recognizeCell(cellImageData, templates);
// 返回: { code, confidence, reason, candidates: [{char, score}...] }

export function combineWithVocabulary(perSegmentTopK, confusables);
// 逐字 top-k 组合 → 查 291 词表 → 不命中则用易混对生成变体重试
// 返回: { code, confidence, combo } 或 { code: null, reason }

export const CONFUSABLE_PAIRS = [['0','O'], ['1','I'], ['2','Z'], ['5','S'], ['6','G'], ['8','B']];
```

### 3.3 状态扩展(state.js 新增)

```javascript
export let scannerErrors = [];  // Array<{ row, col, reason, candidates }>
export function setScannerErrors(errs) {
    scannerErrors = errs;
}
```

> 遵循 state.js 现有 `export let` + mutator 模式(参见 [state.js:26](../js/state.js#L26) `lastMergedGrid` 的处理)。

---

## 四、关键算法细节

### 4.1 2 点校准替代"均分整图"

**问题**:用户上传的图常带白边 / 扫描边框,"均分整图"会把白边也算进 cell,导致格位偏掉。

**方案**:让用户点 2 个对角格子中心(图上拖两个点),程序用这两个点反推出每格的精确边界。

```javascript
// 2 点 → 网格边界(注意归一化 anchor 顺序,用户可能点右下+左上)
function inferGridFromAnchors(a, b, rows, cols) {
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
    // 点是格子"中心",距离 = (cols-1) 个 cell 宽
    const cellW = (maxX - minX) / (cols - 1);
    const cellH = (maxY - minY) / (rows - 1);
    return { cellW, cellH, originX: minX, originY: minY };
}

function cellRect(r, c, grid) {
    const cx = grid.originX + c * grid.cellW;
    const cy = grid.originY + r * grid.cellH;
    return {
        x: Math.round(cx - grid.cellW / 2),
        y: Math.round(cy - grid.cellH / 2),
        w: Math.round(grid.cellW),
        h: Math.round(grid.cellH),
    };
}
```

**Sanity check**:本项目导出图 cellSize 固定 20px([generate.js:135](../js/generate.js#L135)),若反推 cellSize 明显偏离常见范围(如 < 10 或 > 60),提示用户检查校准点。

**回退**:用户跳过校准时,fallback 到"全图均分"(仅适合无白边的满幅图)。

> ⚠️ 2 点校准只能解平移+缩放,解不了透视。中档定位下要求输入是规整电子图(无透视),故 2 点足够;拍照场景需升 4 角点透视矫正,不在本期范围。

### 4.2 归一化(成败关键 ★)

归一化的目标是**让同色号在不同字体/字号/字重下,二值化后趋近同一张标准图**。这步质量直接决定整个方案的准确率上限。

```
原始 cell 像素
   │
   ├─① stripGridLines:内缩 + 剔除边缘 #888 网格线像素
   │     (网格线在格子边缘,文字在中央,互不干扰;但不去线会污染投影切分)
   │
   ├─② 灰度 + 二值化:Otsu 自适应(对比度不明时),失败回退固定阈值 128
   │     输出 0/1 单通道
   │
   ├─③ 找文字 bbox:行列投影取黑像素的 min/max 外接框
   │     全空 → empty:true(透明格候选)
   │
   └─④ letterbox:把 bbox 内容等比缩放到 targetW × targetH(如 24×32),
          短边居中补 0。统一尺寸后,字号差异被吸收。
```

**为什么 letterbox 到固定尺寸能吸收字号差异**:不同软件 cellSize 不同 → 字号不同,但归一化后所有字符都被缩放到同一画布,模板也用同一画布渲染,匹配时尺寸对齐,只剩"字形"差异——而无衬线 ASCII 的字形差异本就很小。

**易错点**:
- 二值化阈值:深底白字 / 浅底黑字都可能出现(本项目是按背景亮度自适应,[generate.js:48](../js/generate.js#L48)),二值化后统一成"文字=1、背景=0",因此模板匹配前要把所有 cell 的文字极性归一到同一方向(检测黑像素占比,反相使其一致)。
- 网格线若较粗,内缩量要够;本项目网格线 1.5px([generate.js:70](../js/generate.js#L70)),内缩 2px 即可避开。

### 4.3 模板构建(字符级,无衬线)

**2-3 套代表性无衬线 × 36 字符**,启动时构建一次缓存到内存。

```javascript
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
// 代表性无衬线:覆盖不同字宽/字重的变体,而非近亲重复
const FONTS = [
    { family: 'Arial' },                  // 西文事实标准,窄
    { family: 'Verdana' },                // 偏宽、偏圆,差异大
    { family: '"PingFang SC","Microsoft YaHei",sans-serif' }, // CJK 软件回退
];

function buildCharTemplates() {
    const TPL_W = 24, TPL_H = 32;
    const cache = {};
    for (const char of CHARS) {
        cache[char] = [];
        for (const font of FONTS) {
            const canvas = new OffscreenCanvas(TPL_W, TPL_H);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, TPL_W, TPL_H);
            ctx.fillStyle = 'black';
            ctx.font = `bold 26px ${font.family}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(char, TPL_W / 2, TPL_H / 2);
            const data = ctx.getImageData(0, 0, TPL_W, TPL_H).data;
            cache[char].push({ font: font.family, data: binarize(data, 128) });
        }
    }
    return cache;
}
```

**字体选择原则**:
- 选**差异尽可能大**的无衬线代表(Arial 窄 / Verdana 宽圆 / CJK 回退),而非近亲(Arial 和 Helvetica 太像,二选一即可)。
- **不选衬线体**(SimSun / Times)——图纸不会用衬线体印色号。第 1 版的 SimSun 已移除。
- 选中文字体的**西文回退**,因为有些拼豆软件是中文界面,色号渲染走中文字体的 ASCII 字形。

**性能**:3 字体 × 36 字符 × 24×32 = **83 KB** 二值数据,启动开销 < 50ms。

**浏览器字体可用性兜底**:若用户系统没装某字体,canvas 会回退到默认字体,模板仍可用(只是该字体代表性变弱)。极端情况下可让用户在 UI 里"提供一个样本格"反推字体——作为 Phase 2 增强。

### 4.4 字符识别(逐字切分)

> 撤回第 1 版"整词模板反查"设想——整词模板要求与原图高度对齐,字体/字号一有差异就拉低相似度,通用场景下偏脆。逐字切分能让每个字独立吸收字体差异,再用词表兜底,更鲁棒。

```javascript
function recognizeCell(cellImage, templates) {
    // 1. 归一化(§4.2)
    const { bin, empty } = preprocessCell(cellImage);
    if (empty) return { code: null, reason: 'empty', confidence: 0 };

    // 2. 文字极性归一(深底白字 → 统一成文字=1)
    const normalizedBin = unifyPolarity(bin);

    // 3. 投影切分字符
    const segments = splitByProjection(normalizedBin, TPL_W, TPL_H);
    if (segments.length === 0 || segments.length > 4) {
        // 0 段=空;>4 段=噪声/粘连,走低置信
        return { code: null, reason: 'seg_fail', confidence: 0, segments };
    }

    // 4. 每段与全部模板比对,取 top-k(k=3)
    const perSegTopK = segments.map(seg => {
        const scores = [];
        for (const char of CHARS) {
            for (const tpl of templates[char]) {
                scores.push({ char, score: similarity(seg, tpl.data), font: tpl.font });
            }
        }
        scores.sort((a, b) => b.score - a.score);
        return scores.slice(0, 3);
    });

    // 5. 词表校验 + 易混纠错(§4.5)
    return combineWithVocabulary(perSegTopK, CONFUSABLE_PAIRS);
}
```

**相似度度量**:1 − 汉明距离 / 像素数。简单快速,对规整二值字符足够。

### 4.5 词表校验 + 易混字符专项纠错(成败关键 ★)

291 词表是闭集,这是本场景最大的红利。两层校验:

```javascript
function combineWithVocabulary(perSegTopK, confusables) {
    // 第一层:top-1 组合直接查词表
    const top1 = perSegTopK.map(s => s[0].char).join('');
    if (MARD_CODE_SET.has(top1)) {
        return { code: top1, confidence: avgScore(top1, perSegTopK), combo: top1 };
    }

    // 第二层:top-k 笛卡尔积,优先选合法 + 均分最高
    let best = null;
    for (const combo of cartesianProduct(perSegTopK.map(s => s.map(x => x.char)))) {
        const code = combo.join('');
        if (MARD_CODE_SET.has(code)) {
            const avg = avgScore(code, perSegTopK);
            if (!best || avg > best.confidence) best = { code, confidence: avg, combo: code };
        }
    }
    if (best) return best;

    // 第三层:易混字符纠错——top-1 不在词表,按易混对生成变体重试
    const fixed = fixByConfusables(top1, confusables);
    return fixed
        ? { code: fixed, confidence: 0.6, combo: fixed, fuzzy: true }
        : { code: null, reason: 'no_vocab_match', confidence: 0 };
}

// HZ → 把 Z 按 [2,Z] 易混对换成 2 → H2 在词表 → 命中
function fixByConfusables(code, confusables) {
    const variants = [code];
    for (const [a, b] of confusables) {
        const next = [];
        for (const v of variants) {
            next.push(v);                 // 原样
            next.push(v.replaceAll(a, b)); // a→b
            next.push(v.replaceAll(b, a)); // b→a
        }
        variants.push(...next);
    }
    return variants.find(v => MARD_CODE_SET.has(v)) || null;
}
```

**易混对表**(`CONFUSABLE_PAIRS`):

| 易混对 | 色号场景举例 |
|---|---|
| `0` ↔ `O` | A0? 认成 AO? |
| `1` ↔ `I` | A1? 认成 AI? |
| `2` ↔ `Z` | **H2 认成 HZ**(本项目色号 H 系列,高频) |
| `5` ↔ `S` | A5? 认成 AS? |
| `6` ↔ `G` | B6? 认成 BG? |
| `8` ↔ `B` | A8? 认成 AB? |

> 注意:实测 291 色前缀含 `A B C D E F G H M P Q R T Y ZG`(含双字母 ZG),色号 3-4 字符。`fixByConfusables` 的 `replaceAll` 对双字母前缀也成立(如 ZG01 中 G↔6 不会被误纠,因为 Z601 不在词表)。

### 4.6 置信度分级

| 等级 | 条件 | 处理 |
|------|------|------|
| 高 | 词表匹配 + top-1 均分 > 0.85 + top-1/top-2 间距大 | 直接写入,无标记 |
| 中 | 词表匹配 + top-1 均分 0.70–0.85 | 写入,加入 errors 列表(UI 可高亮) |
| 低 | 经易混纠错命中,或 top-1 均分 0.55–0.70 | 写入纠错结果,errors 强标 |
| 失败 | 空格 / 全黑 / top-1 < 0.55 / 无词表匹配 | 透明格,errors 标 |

**阈值需在真实图上校准**:以上是初值,Phase 1 用合成 + 真实图回归后定稿。

**错误格的 UI 处理**:
- `scannerErrors` 列表存 `{row, col, reason, candidates: ['A01', 'A02', ...]}`
- 渲染时给错误 cell 加红色边框(**用独立 overlay 层,不污染 `drawGrid`**——`drawGrid` 在 [generate.js:32](../js/generate.js#L32) 是全模式共用渲染函数)
- 用户点击 cell → 走现有 picker 流程,色号输入框预填 top-3 候选

---

## 五、UI 流程

### 5.1 入口

主页面"上传图片"卡片下方加一个新按钮:**「从图纸扫描导入」**

```
┌──────────────────────────────────┐
│ 📷 上传图片                      │
│   点击选择 / 拖拽                │
└──────────────────────────────────┘
        ↓
┌──────────────────────────────────┐
│ 🧩 从图纸扫描导入                │  ← 新增
│   上传已绘制的图纸截图            │
└──────────────────────────────────┘
```

### 5.2 模态框流程(3 步)

```
Step 1: 上传 + 预览
┌──────────────────────────────────────────┐
│  扫描导入 - 第 1 步 / 共 3 步            │
│  ──────────────────────────────────     │
│  [拖拽或点击上传图纸]                     │
│                                           │
│  ┌────────────────────────┐              │
│  │     (图片预览)         │              │
│  └────────────────────────┘              │
│                                           │
│  行数: [___]  列数: [___]                 │
│                                           │
│            [取消]  [下一步 →]            │
└──────────────────────────────────────────┘

Step 2: 校准对角点
┌──────────────────────────────────────────┐
│  扫描导入 - 第 2 步 / 共 3 步            │
│  ──────────────────────────────────     │
│  请在图上点 2 个对角格子中心(必须)        │
│                                           │
│  ┌────────────────────────┐              │
│  │  ●                     │              │
│  │     ●  (图 + 已点标记) │              │
│  └────────────────────────┘              │
│                                           │
│            [← 上一步]  [识别 →]          │
└──────────────────────────────────────────┘

Step 3: 结果 + 修正
┌──────────────────────────────────────────┐
│  扫描导入 - 第 3 步 / 共 3 步            │
│  ──────────────────────────────────     │
│  识别完成:成功 2456 格 / 失败 12 格       │
│  ⚠️ 失败格子(红框标出)                    │
│  - (3, 5) 识别为 'A0?' 候选:[A01, A02]  │
│  - (8, 12) 无法识别                       │
│                                           │
│  失败格子已标红,点击格子手填              │
│                                           │
│            [取消]  [应用到编辑器 →]      │
└──────────────────────────────────────────┘
```

**关键设计点**:
- 校准步骤**不是可选**——跳过校准会导致大批格子错位(可给"跳过"按钮 fallback 到均分整图,但默认必做)
- 错误格**直接进 lastMergedGrid**(用 top-1 兜底),不阻塞流程
- 用户从模态框点 "应用到编辑器" 后,关闭模态、刷新拼豆图纸视图

### 5.3 错误格交互

- 渲染时给 `scannerErrors` 列表的格子加红色细边框(2px),画在独立 overlay canvas 上
- 点击红色格子 → 现有 picker 弹出,色号输入框预填 `top-3` 候选(逗号分隔)
- 改色成功 → 自动从 `scannerErrors` 移除

---

## 六、错误处理

| 场景 | 表现 | 处理 |
|------|------|------|
| 上传非图片 | alert 提示 | 校验 file.type |
| rows/cols 输入非法(非整数、< 1) | 按钮 disabled | onChange 校验 |
| 没做校准就点"识别" | 按钮 disabled | onChange 校验 |
| 校准点 2 个在同位置 | 拒绝 | 距离 < 50px 报错 |
| 反推 cellSize 异常(< 10 或 > 60) | 警告提示 | "建议检查校准点或行列数" |
| 单格字符超 4 个(词表最大 4) | 失败 | 走低置信度路径 |
| 整图大部分格子失败(>30%) | 警告提示 | 弹"建议检查校准点" |
| 浏览器不支持 OffscreenCanvas | 致命 | fallback 到主线程 + 提示性能差 |

**绝不在算法层 alert**(参考 [color.js:131](../js/color.js#L131) 注释已建立的约定)——所有提示交由 UI 层。算法函数返回状态 / 错误标志,UI 决定怎么提示。

---

## 七、测试策略

### 7.1 单元测试(vitest + jsdom)

项目已有 vitest + jsdom 基础([package.json](../package.json)),测试基础设施具备。

**模板层**(`scanner-templates.test.js`):
- 36 字符 × 3 字体模板全部生成成功
- 模板缓存命中
- binarize 边界值(纯白、纯黑、灰)

**预处理层**(`scanner-preprocess.test.js`)——**最重点**:
- `splitGrid` 行列正确,无重叠/漏切
- `stripGridLines` 能剔除边缘网格线、不伤中央文字
- `preprocessCell` 输出尺寸固定;letterbox 等比缩放正确;**文字极性归一**(深底白字 / 浅底黑字都归一到文字=1)
- `splitByProjection` 单字符 / 多字符 / 粘连 / 倾斜

**识别层**(`scanner-recognize.test.js`):
- `combineWithVocabulary` 第一层(top-1 命中)/ 第二层(笛卡尔积命中)/ 第三层(易混纠错命中)
- `fixByConfusables`:`HZ→H2`、`AO→A0`、`BG→B6` 等典型易混对
- 词表外色号正确返回 `no_vocab_match`

**端到端**(`scanner.test.js`):
- 合成测试图(canvas 画已知色号)→ 识别 → 验证与 ground truth 一致
- 测试 `H2` 和 `H02` 两种写法(本项目导出图用 `code` 原文,[color.js:531](../js/color.js#L531) `getDisplayCode` 直接返回 code)
- 测试低置信度路径(故意画模糊 / 易混字符)

### 7.2 字体泛化测试(通用性核心验证)

**合成图**(可控、可重复):
- 用脚本渲染 N 张 29×29 / 50×50 的 canvas,每格写随机 MARD 色号
- **覆盖多字体**(Arial / Verdana / CJK 回退 / 系统默认)、多字号(8/10/12px)、深底白字 & 浅底黑字、有描边 & 无描边
- 这一层是验证"通用性"的关键——证明不挑字体

**真实图**(待提供):
- 5-10 张不同来源的实际图纸截图(本项目导出 + 别的软件 + 网上找的)
- ground truth 靠"打印后手填"或已有色号记录

### 7.3 验收指标

| 指标 | 目标 | 备注 |
|------|------|------|
| 单格识别准确率(本项目导出图,字体命中模板) | ≥ 95% | 同源 Arial,近乎确定性 |
| 单格识别准确率(其他软件电子截图) | **≥ 85%** | 通用场景主目标,经词表纠错后 |
| 端到端(校准+识别+写 grid,50×50 图) | < 5s | UI 流畅 |
| 易混字符纠错召回率(H2/HZ 类) | ≥ 90% | 词表红利的关键体现 |

> 通用场景 85% 单格准确率,经词表 + 易混纠错后,**端到端整图可用率**(用户只需手填少量格子)预期 90%+。

---

## 八、风险与不确定项

| 风险 | 缓解 |
|------|------|
| **字体未覆盖**(用了模板库外的字体) | 选差异大的代表性无衬线;归一化吸收大部分差异;仍漏则 Phase 2 加"用户提供样本格反推字体" |
| **文字极性不一致**(有的图深底白字、有的浅底黑字) | `unifyPolarity` 在二值化后统一方向(§4.2 易错点) |
| **二值化失败**(渐变背景 / 非纯色底) | Otsu 自适应优先,失败回退固定阈值,极端标低置信 |
| **易混字符误纠**(把合法色号纠成另一个合法色号) | `fixByConfusables` 只在"top-1 不在词表"时触发;且纠错结果标低置信 + errors 高亮,用户可核 |
| **校准点难点准** | UI 上半透明圆点 + 十字辅助线;反推 cellSize 异常时提示 |
| **词表外色号**(MARD 没收录的) | 标"无法识别"让用户手填;Phase 2 可让用户扩展词表 |
| **超大图性能** | 校准后缩放到 1500px 长边 |
| **首次实现周期** | 严格 Phase 1 MVP:2 点校准 + 2-3 无衬线字体 + 逐字切分 + 词表纠错;透视/手写显式延后 |

---

## 九、实施计划

### Phase 1:MVP(目标:通用电子截图能跑通)

| 任务 | 估时 | 依赖 |
|------|------|------|
| scanner-preprocess.js:splitGrid + stripGridLines + preprocessCell(含极性归一)+ splitByProjection | 4h | - |
| scanner-templates.js:无衬线字符模板构建 | 2h | - |
| scanner-recognize.js:recognizeCell + combineWithVocabulary + fixByConfusables | 4h | 前两 |
| ui-scanner.js:3 步模态框 + 校准交互 | 4h | - |
| 合成测试图(多字体)+ 单测(预处理/识别重点) | 3h | 前四 |
| 对接 lastMergedGrid + repaint + 错误格 overlay | 1h | - |
| **合计** | **~18h**(约 2.5 个工作日) | |

**Phase 1 交付**:
- 能上传任意软件生成的规整电子图纸截图
- 本项目导出图准确率 ≥ 95%、其他软件 ≥ 85%
- 错误格标红 + 点击手填流程跑通
- 易混字符(H2/HZ 等)纠错生效

### Phase 2:健壮性 + 本项目图快通道

- Otsu 二值化调优 + 真实图纸回归
- 校准点视觉辅助(十字 / 放大镜)
- 多字体实测覆盖率优化(按真实数据补字体)
- **PNG metadata 快速通道**:改导出端,把 grid 数据(JSON)写入 PNG `tEXt` chunk;导入时优先读 metadata,100% 精确零误差(本项目导出图专属路径,与通用扫描器解耦共存,读不到 metadata 才回退扫描)
- 词表扩展(用户自定义色号)

### Phase 3(可选,升宽档)

- 自动网格检测(投影法)替代手动 rows/cols
- 4 角点透视矫正(支持拍照)
- 多种图源适配

---

## 十、待确认事项

1. ~~校准步骤是否必做?~~ → **必做**(默认),给"跳过"按钮 fallback 均分整图。
2. ~~错误格是否阻塞"应用"?~~ → **不阻塞**(top-1 兜底写入),高亮让用户必须过一遍。
3. **是否需要"重新识别单格"**(对识别错的格子单独重跑)?——待定,Phase 1 不做,看用户反馈。
4. **真实测试图**:你手头是否有几张不同来源的实际图纸截图可作 ground truth?有的话 Phase 1 估时 +1-2h,且能校准置信度阈值。

---

**等评审通过后再开始 Phase 1 实现**。评审重点:
- 二、算法思路 + 2.2 四个成败关键是否认同
- 四、归一化(§4.2)与易混纠错(§4.5)的设计是否到位
- 7.3 验收指标是否可接受(85% 通用 / 95% 本项目导出)
- 10 待确认事项第 3、4 条的答复
