# 拼豆图纸生成器 · 代码体检报告

- **日期**:2026-06-24
- **范围**:全仓库 JS / CSS / HTML / 测试 / 数据
- **方法**:静态阅读 + node 实验验证 + 运行现有测试 / lint

## 概览

纯前端 Canvas 应用,ESM 模块化,无运行时依赖,可直接静态托管。

- 代码量约 5600 行(JS + CSS + HTML + MD)
- 测试 48 个全过([color.test.js](../test/color.test.js) 41 + [pixelation-mode.test.js](../test/ui/pixelation-mode.test.js) 7);`npm run lint` 干净
- 工程基础扎实(纯函数化、Oklab 缓存、一次性 getImageData 优化、熨烫效果插件化注册表)
- 主要欠:**1 处必现 bug** + 循环依赖注入债 + 纯算法缺测试 + 色板数据冗余

---

## 一、确认的 Bug(建议优先修)

### 1. 改色时必抛 TypeError —— [editor.js:77](../js/editor.js#L77)

```js
recentCodes = [code, ...recentCodes.filter(c => c !== code)].slice(0, 12);
```

`recentCodes` 是从 [state.js:41](../js/state.js#L41) `export let recentCodes` 导入的 binding。ESM 跨模块 import 的 `let` 是**只读 live binding**,直接赋值会抛 `TypeError: Assignment to constant variable`(已用 node 复现)。state.js 早就提供了 [pushRecentCode()](../js/state.js#L87) mutator 就是干这个的,但 editor.js 没用。

**影响路径**:点击拼豆格子 → 选色浮窗 → 点相似色 / 最近色 → [applyColorChange](../js/editor.js#L68)。
第 74 行 `lastMergedGrid[row][col]=newColor` 已先执行(数据变了),到第 77 行抛错 → 后续局部重绘(78–91)与 `closePicker()` 全部跳过。用户感知:**点了没反应、浮窗不关、控制台报错,且数据与画面不一致**。

> 这是全仓库扫描出的**唯一**一处对只读 binding 的直接赋值。
> **修复**:把第 77 行换成 `pushRecentCode(code);` 即可。建议在浏览器 DevTools 走一遍改色路径确认复现。

### 2. [generate.js:238,240](../js/generate.js#L238) 用 `BeadGenerate.drawGrid(...)` —— 冗余且脆弱

`drawGrid` 是本模块 [第 33 行](../js/generate.js#L33) 定义的函数,直接调 `drawGrid(...)` 即可。当前能跑是因运行时 `BeadGenerate` 已初始化,但无谓依赖了 export const 的求值顺序。

---

## 二、架构 / 可维护性

### 3. 循环依赖用"动态 import + setter 注入"打破,可读性差 —— [main.js:21-78](../js/main.js#L21)、[state.js:102-119](../js/state.js#L102)

`setRepaintCurrentMode` / `setRecomputePreservingRefine` 是占位 no-op,靠 main.js 在 attach 时回填真实实现,里面又套了 3 层 `import().then()`。数据流极难追踪,是 ESM 迁移遗留的技术债。

**根因**:state.js 同时被 editor / generate / ui 循环引用。把"渲染调度"从 state 抽到独立模块(如 `render-bus.js`)形成单向依赖,可消掉这层注入。

### 4. 算法层耦合 UI —— [color.js:159](../js/color.js#L159) `alert('采样区过大')`

算法函数里直接弹 alert,违反分层且无法单测。应返回状态 / 超长标志,由 UI 层决定提示方式。

### 5. 测试覆盖严重不足

- 现有 48 个用例集中在 color 距离 / 像素化下拉。
- **缺口**(均为纯算法,本该有单测):
  - [mergeSimilarColors](../js/color.js#L425)
  - [despeckleIsolatedCells](../js/color.js#L496)
  - bg 采样 [auto](../js/color.js#L83) / [points](../js/color.js#L122)
  - editor [undo/redo diff](../js/editor.js#L25)
- 按 testing 规则,纯工具函数覆盖率 ≥ 90%。

### 6. 文档过时 —— [README.md:109](../README.md#L109)

仍写"本 change 保留 IIFE + `window.*` 风格",但 ESM 迁移已完成(docs 里有对应 verify report)。

---

## 三、瘦身

### 7. palettes.js 可省约 240 行 —— [palettes.js:592-832](../js/palettes.js#L592)

验证结论:`p221` 完全是 `p291` 的子集(221 条 hex 与 p291 中同 code 条目 0 不一致)。可改为派生:

```js
const PRESET_221_CODES = new Set(['A01', /* ... */]); // 只存 code
export const BEAD_PALETTE_221 = BEAD_PALETTE_291.filter(c => PRESET_221_CODES.has(c.code));
```

838 行 → 约 600 行,且杜绝两份色板未来 drift。

### 8. 配色清单大量内联 style —— [ui-events.js:209-264](../js/ui-events.js#L209)(17 处)

表格样式全用 `style.cssText` 拼字符串,本应是 CSS class,也方便后续统一改样式。

### 9. example_pic.png(160 KB)

未被 git 跟踪、无引用,已在 .gitignore —— 仅占本地磁盘,可删可留,不是仓库负担。

> CSS 共 31 KB / 1423 行(base 401 + components 458 + sections 564),低于 50 KB 预算,体积正常。

---

## 四、功能建议(供参考,未动手)

| 功能 | 价值 | 说明 |
|---|---|---|
| 配色清单导出 / 打印 | 高 | 现在只能看,[清单渲染](../js/ui-events.js#L192) 加"导出 CSV / 打印"按钮,买豆对照方便 |
| 项目保存 / 载入 | 高 | 刷新即丢。localStorage 或 JSON 导入导出(图 + 参数 + 精修历史),断点续作 |
| 撤销 / 重做按钮 | 中 | [canUndo / canRedo](../js/editor.js#L52) 已实现但 UI 无入口,移动端用不了快捷键 |
| 大图分板 | 中 | 104 不够时切成多块板(如 2×2)分别导出,是拼豆真实需求 |
| 色号显示开关 | 中 | 小格文字看不清,加显隐开关;或缩放后才显示 |
| 镜像 / 对称编辑 | 低 | 对称图案减半工作量 |

---

## 附:验证依据

- **recentCodes 赋值抛错**:用最小 ESM 样例(`export let x` + 导入方 `x = 1`)node 实跑,确认 `TypeError: Assignment to constant variable`。
- **p221 ⊂ p291**:node 脚本加载 [palettes.js](../js/palettes.js),逐一比对 221 条 code 在 p291 中存在且 hex 一一致,结果 0 不一致;COLOR_MAPPING 的 291 个 key 也全部落在 p291。
- **全仓扫描只读赋值**:枚举 state.js 所有 `export let` binding,在其余 js 文件中匹配 `binding =`(非声明、非比较、非属性赋值),仅命中 [editor.js:77](../js/editor.js#L77) 一处。
- **测试 / lint**:`npm run test` → 2 files / 48 tests passed;`npm run lint` → 无输出(通过)。
