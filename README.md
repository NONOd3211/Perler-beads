# 拼豆图纸生成器

纯前端 Canvas 应用 —— 上传图片,一键生成可直接对照制作的拼豆图纸,附带配色清单。零运行时依赖,ESM 模块化,可静态托管。

> 仓库:[github.com/NONOd3211/Perler-beads](https://github.com/NONOd3211/Perler-beads)

## 功能特性

- **图片上传**:点击或拖拽,支持 JPG / PNG,透明 PNG 效果最佳
- **网格尺寸**:52×52 标准格 / 104×104 精细格
- **5 品牌色号映射**:MARD / COCO / 漫漫 / 盼盼 / 咪小窝,同一图纸可切换品牌色号
- **处理模式**:
    - 卡通(主色):α-加权 RGB 众数,适合海报 / 插画
    - 真实(α-加权):α-加权 k-means(k=2),适合写实照片 / 透明 PNG
- **色板**:221 色精选(默认)/ 291 色完整
- **去背景**(高级):
    - auto 边角采样(4 角多数投票)
    - manual 点击选取(BFS 同色扩展)
    - 判定阈值 / 采样阈值可调,支持撤销 / 清空
- **颜色合并阈值**(高级):0–100,值越大色块越纯、细节越少
- **实时预览**:原图 ↔ 拼豆网格左右对比
- **放大查看**:网格图 ⇄ 成品预览,普通烫 / 毛巾烫效果切换,滚轮缩放 / 拖动平移
- **单格改色**:点击豆子 → 相似色 / 手动输入色号 / 最近色号
- **配色清单**:色号、颜色样、数量、占比汇总
- **导出 PNG**:透明背景,可直接打印对照

## 技术栈

- **前端**:原生 JavaScript(ESM 模块化)+ HTML5 Canvas + CSS3,无框架、无运行时 npm 依赖
- **颜色科学**:Oklab 感知色彩空间
- **测试**:Vitest(51 用例)
- **代码质量**:ESLint + Prettier
- **本地开发**:`http-server`

## 项目结构

```
public/
├── index.html              入口页面(<script type="module">)
├── css/
│   ├── base.css            重置 + 设计变量 + 全局
│   ├── sections.css        各功能区 section 样式
│   └── components.css      组件(modal / button / 配色清单表格 ...)
└── js/
    ├── main.js             浏览器入口,串联各 attach
    ├── state.js            运行时可变状态 + mutator
    ├── color.js            颜色算法(距离 / 合并 / 去斑 / 采样 / getDisplayCode)
    ├── oklab.js            Oklab 转换 + 模块级缓存
    ├── palettes.js         色板数据(p221 派生自 p291)+ 5 品牌映射
    ├── generate.js         网格生成 + 区域代表色提取
    ├── editor.js           单格改色 / 撤销重做 / 相似色
    ├── fused-preview.js    熨烫预览渲染调度
    ├── ui-core.js          DOM 元素引用收集
    ├── ui-events.js        通用事件(上传 / 下载 / 配色清单 / 品牌 ...)
    ├── ui-mode.js          grid ⇄ fused 模式状态机
    ├── ui-fuse.js          熨烫效果状态机
    ├── ui-modals.js        zoom / editor modal
    └── fuse-effects/       熨烫效果插件(plain / towel,注册表式扩展)
test/
├── color.test.js               颜色算法(41)
├── editor.test.js              改色(3)
└── ui/pixelation-mode.test.js  像素化模式(7)
```

## 开发

环境要求:Node 18+、npm 8+。

```bash
npm install          # 安装 devDependencies
npm run dev          # 本地 server → http://localhost:8080
npm run lint         # ESLint 检查
npm run format       # Prettier 格式化
npm run format:check # Prettier 检查(不写文件)
npm test             # Vitest 单元测试
npm run test:watch   # Vitest watch 模式
```

## 部署

运行时零 npm 依赖,`public/` 目录即完整站点。

- **Cloudflare Pages**(推荐,仓库已配 [`wrangler.jsonc`](wrangler.jsonc),`assets` 指向 `./public`):绑定仓库后 push 到 `main` 自动部署,或本地 `npx wrangler pages deploy public`
- **任意静态托管**:`public/` 直接丢 NGINX / GitHub Pages / Vercel 等

## 算法说明

颜色匹配与区域合并对齐参考项目 [Zippland/perler-beads](https://github.com/Zippland/perler-beads),核心差异为保留本项目的 2 色板 × 5 品牌映射与 PNG 输出流程。

### 颜色距离

- 公式:Oklab 感知色彩空间的欧氏距离 × 100,值域 [0, 100]
- 链路:sRGB → 线性 RGB → LMS → cube root → Oklab 矩阵 → 欧氏距离
- 实现:[`public/js/oklab.js`](public/js/oklab.js)(转换)+ [`public/js/color.js`](public/js/color.js)(距离)
- 缓存:模块级 `Map<"r,g,b", {L,a,b}>`,跨色板切换与重生成共享

### 像素化模式

- **卡通(主色,默认)**:α-加权 RGB 众数(按 α 累加,key = `r,g,b`),不透明图退化为出现次数最多;适合卡通 / 海报风格
- **真实(α-加权)**:α-加权 k-means(k=2),选离全局均值最远的簇作主体色;适合写实照片 / 带透明边的 PNG
- UI「处理模式」下拉切换,选择即触发重生成

### 颜色合并

两步处理(去斑 → 合并):

1. **去斑(despeckle)**:4 邻检测孤立"翻盘"格子(邻居 ≥ 3 个一致且与本格 Oklab 距离 > 20),用邻居主色替换 —— 清掉 JPEG / 降采样伪影噪声
2. **合并(merge)**:全局按颜色频率排序,高频色吸收所有 Oklab 距离 < 阈值的低频色(与位置无关,确定性强)

阈值:Oklab × 100 单位,UI 滑块 0–100,默认 0(0 = 不合并,仅靠去斑清理噪声;值越大合并越激进)。

### 全透明格

- 软阈值:格内 α_max < 30 视为透明(保留 α ∈ [30, 128] 的反走样过渡像素)
- 全透明格不分配 bead color,渲染时跳过填色与文字,导出 PNG 时留白
- 去背景识别的「背景格」走同一路径(携带 `{ transparent: true }` 标记)

### 去背景

可选功能,把背景 cell 识别为透明(沿用 transparent 链路,PNG 导出背景自然透明)。在**已生成的拼豆图纸 grid cell 维度**工作:先生成完整 grid,再做 bgRemoval pass 把背景 cell 标 `{ transparent: true }`。两种模式:

- **auto(边角采样)**:读 grid 4 角 cell 代表色 → Oklab 距离 < 8 归组 → 取 count ≥ 2 的组为代表。容忍 1–2 角被主体占用;全部不同时 fallback 为 4 角单色
- **manual(点击选取)**:用户点击 cell → BFS 4 邻接连通同色 cells(Oklab 距离 < `sampleMatchThr`)→ α-weighted mean 入样本(同色距离 < 8 去重)

阈值(Oklab × 100,UI 滑块 0–50):

- `bgThreshold`(判定阈值):cell 代表色与样本距离 < 此值则透明,默认 12
- `sampleMatchThr`(采样阈值):BFS 扩展颜色阈值,仅 manual 模式可见,默认 12

PNG 导出使用独立隐藏 `exportCanvas`(只画 grid 不画 overlay),保证导出干净透明。
