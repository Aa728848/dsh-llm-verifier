# Agent Note: 设置页表单控件盒模型统一

Status: implemented

## Problem

设置页同一列里的控件"排布不统一"：下拉框比数字输入框明显更高更宽，文本输入框又更窄，右边缘参差。根因是两种互不兼容的控件实现被混用：

- 数字/文本用宿主组件 `Input`（`@deepseek-ai/dsh-client-ui-primitives`）。它渲染为 `<span class="wrap"><input/></span>`，`style` 被透传到**内层 input**，而外层 `.wrap` 是 `display:inline-flex` 且 CSS 里硬编码 `height:32px`、背景 `--dsw-alias-bg-layer-1`——宽度收缩到内容。
- 下拉框用本插件自定义的 `selectStyle`：`height:36px`、背景 `--dsw-specific-input-major`、`width:100%`。

叠加 `controlCell` 的 `flex:'0 1 268px', minWidth:170`（可收缩），长标签会进一步压窄控件列，使行与行的宽度也不一致。

## Decision

1. **单一盒模型常量**：新增 `controlStyle`（`box-sizing:border-box`、`width:100%`、`height:36`、`border-radius:8`、统一前景/背景/边框 token、`font:inherit`、`font-size:14`、`line-height:22px`、`outline:none`）。`selectStyle` 与 `inputStyle` 均**逐字**由它派生，只各自补 padding（下拉多留箭头槽 `0 34px 0 12px`，输入 `0 12px`）。
2. **表单控件改用原生元素**：数字、文本与附加裁判网格内的 label 输入框全部换成原生 `<input style={inputStyle}>`，从 primitives 的导入中移除 `Input`；原有行为（editing 状态机、`aria-label`/`aria-invalid`、单位后缀、滑块、placeholder）逐项保留。
3. **控件列不可收缩**：`controlCell` 改为 `flex:'0 0 268px', maxWidth:'100%', minWidth:0`；删掉原来的 `minWidth:170`（它既允许长标签压窄控件列，又会让 min-content 宽度溢出容器）。
4. **开关对齐**：40px 开关包一层 `toggleCell`（`width:100%` + `justify-content:flex-end`），落在与输入/下拉同一右边缘。
5. **回归防线**：`src/client.test.ts` 新增 `client settings layout` 四条源码级不变量——共享常量存在且 select/input 必须由它派生、控件必须为原生且 select 全部绑定派生样式、`controlCell` 不得含可收缩写法或正数 `minWidth`、开关必须被右对齐容器包裹。测试用变异验证过（故意改坏三处均被抓到）。

窄屏回退：`row` 保留 `flex-wrap:wrap`，容器不足时整行换行，控件列占满一行但 `justify-content:flex-end` 仍贴同一右边缘，换行前后对齐规则一致。

**验证基线**：`pnpm run build` 通过；`npx vitest run`（`DSH_HOME=''`）25 文件 670 passed / 2 skipped。另用无头 Edge 对真实常量做几何测量：修复后 select/number/text 三者均为 `268×36` 且右边缘同为 920px；修复前文本输入为 32px 高、宽度收缩到内容。

## Alternatives considered

- **继续用宿主 `Input`，只补样式**：其外层 inline-flex 包裹层无法通过 `style` 撑开（`style` 透传到内层 input），且 32px 高度写死在 CSS Module 里，改不动。未采用。
- **给 `Input` 传 `className` 覆盖**：CSS Module 的类名是哈希，宿主未暴露可覆盖的稳定钩子；依赖内部类名属于脆弱耦合。未采用。
- **只统一高度、不动宽度**：文本输入框"窄一条"的观感来自外层收缩，只统一高度不解决问题。未采用。
- **把控件列也做响应式栅格**：与宿主原生设置页的单列右对齐观感不符，且改动面更大。未采用。
- **引入 jsdom/react-dom 做真实渲染断言**：仓库没有这两个依赖，为一条布局不变量增加运行时依赖不划算；改用与既有一致的源码扫描 + 无头浏览器人工核验。未采用。

## Consequences

- 设置页所有控件同高同宽、右边缘严格对齐，换行时规则不变；后续新增字段只要走 `controlStyle` 派生即自动对齐。
- 约束：新增控件不得再引入宿主的 `Input`（回归测试会失败）；若将来宿主提供可撑开的表单控件，应同步替换常量与测试，而不是并存两套盒模型。
- 本插件不再依赖 primitives 的 `Input`，客户端包体积略降；`lib/client.js` 已随 build 更新。
