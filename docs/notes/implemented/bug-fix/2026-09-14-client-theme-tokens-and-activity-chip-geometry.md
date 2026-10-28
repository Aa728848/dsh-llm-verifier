# Agent Note: 客户端主题 token 与聊天指示器的 dock 卡片几何

Status: implemented

## Problem

两处客户端 UI 缺陷由同一类原因引起：**样式引用了 DSH 并不存在的 CSS 自定义属性，并把"取不到值"的兜底写成了深色字面量**。

1. **统计看板在浅色主题下画出一片深色卡片**。`dashboardCard` 的背景是
   `color-mix(in srgb, var(--dsw-alias-bg-module, #171925) 88%, transparent)`，而宿主的 token 表里
   只有 `--dsw-alias-bg-module-platform`，没有 `--dsw-alias-bg-module`；于是**两种主题都**落到
   `#171925` 这个深色兜底。同一份文件里还有 `--dsw-text-primary`、`--dsw-text-secondary`、
   `--dsw-surface-sunken`、`--dsw-alias-bg-input`、`--dsw-danger`、`--dsw-alias-state-warn-bg`
   六个不存在的名字（CSS 对无法解析的 `var()` 静默丢弃该声明，所以构建、类型检查、单测全都不报错），
   以及十余处只针对深色背景挑的红/绿/黄字面量（`#e76565` / `#77d49b` / `#e3bd63`）、两处
   `rgba(0,0,0,.2)` 的代码块底色。浅色主题下这些要么不可读，要么直接把深色滑块画在白底上。

2. **聊天指示器（"最终验收通过"那一行）位置与外观都不对**。它注册在
   `conversation.input.dock`，但渲染的是一个没有宽度约束的块级 `div`：文字贴着**窗口最左缘**，
   与它所属的输入框（宿主居中、有内容宽度轴）毫无关系；外观上也没有任何卡片容器，只是一颗
   7px 圆点加一行继承来的文字，和同一层里宿主的 Todo / Goal / Queue 三张 dock 卡片不是一个家族。

## Decision

**（1）所有客户端样式只用宿主真实存在的 token，并让状态色随主题解析。**

- 逐个替换为 token 表里的名字（清单见 `packages/client/ui-theme/src/styles/design-platform.css）：
  `--dsw-alias-bg-module` → `--dsw-alias-bg-module-platform`；`--dsw-text-primary` →
  `--dsw-alias-label-primary`；`--dsw-text-secondary` → `--dsw-alias-label-secondary`（`muted` 用
  三级 `--dsw-alias-label-tertiary`）；`--dsw-surface-sunken` → `--dsw-alias-interactive-bg-hover`
  （半透明色阶，落在浅色卡片上压暗、落在深色卡片上提亮）；`--dsw-alias-bg-input` →
  `--dsw-specific-input-major`；`--dsw-danger` → `--dsw-alias-state-error-primary`；
  `--dsw-alias-state-warn-bg` → `--dsw-alias-state-warn-tertiary`。同时删掉那些"token 取不到才生效"
  的深色兜底——它们现在永远不会生效，留着只会让下一个读者以为深色是设计的一部分。
- `--dsw-alias-brand-primary` 虽然存在，但解析为**近黑/近白的墨色**（不是强调蓝）：链接改用
  `--dsw-alias-link`，滑块与侧栏图标改用 `--dsw-alias-state-business-primary`（两种主题下都是蓝）。
- 状态字面量换成状态别名，并新增一个 `toneChip(tone)` 辅助：填充、描边、文字都由**同一个**
  `color-mix(in srgb, var(--dsw-alias-state-*) N%, transparent)` 派生，不再手挑三组 RGBA。
  琥珀色的 500 档当填充、600 档（`--dsw-alias-state-warn-label`）当文字，这是宿主的用法。
- 图表配色抽成 `chartBarColor` / `chartLineColor` 两个常量（业务蓝 + 琥珀），柱、折线、图例共用。
- 代码块 / 决策快照的 `pre` 底色改用 `--dsw-alias-markdown-code-block`（宿主给代码块的那一档）。

**（2）聊天指示器改成与 Todo / Goal / Queue 同族的 dock 卡片。**

- 几何照抄宿主 `GoalBar.module.css`：外层宽度 = `100% - 2×side-clearance - 4×dock-inset` 并
  `margin: 0 auto`，内层 `max-width = card-max-width - 4×dock-inset`、高 36px、圆角 12px、
  `0.5px solid var(--dsw-alias-border-l1)`、底色 `var(--dsw-specific-tip)`。三个宿主自定义属性
  （`--dsh-composer-side-clearance` / `--dsh-composer-dock-inset` / `--dsh-composer-card-max-width`）
  都带兜底值，老宿主不发布它们时仍会居中而不是铺满窗口。
- 状态点改用宿主 primitive 的 `StateDot`：`busy` → `ongoing`（蓝色呼吸环，本身带动画）、
  `ok` → `done`、`error` → `error`；容器加 `role="status"` + `aria-live="polite"`，
  让"通过时宿主本来一句话都不说"的那次结果对读屏也可达。
- 文案映射（`client-i18n.ts` 的 `verifierActivityText`）与轮询策略一字未动。

**（3）把"只准用真实 token"变成回归测试。** `client.test.ts` 新增 `client design tokens`：
递归读取 `src/` 下所有 `.ts/.tsx`，抓出每一个 `var(--dsw-*)` 引用，断言都在白名单
`DESIGN_TOKENS`（即宿主 token 表里本插件用到的那 23 个）内；反向再断言白名单没有多余条目，
避免删掉引用后留下死名单。新增客户端文件自动被覆盖。

## Alternatives considered

- **只改 `dashboardCard` 一处**（把 `--dsw-alias-bg-module` 换成真名）：能消掉截图里最刺眼的
  深色大卡片，但同一页的 `pre`、徽章、表格表头、分段选择器仍然是深色专用配色，浅色下继续不可读；
  而且六个不存在的 token 名字会原样留着，下一个改 UI 的人还会踩。
- **按主题手写两套颜色（读 `document` 上的暗色标记切分支）**：宿主的主题是 `body[data-ds-dark-theme]`
  上的一次切换，自己判主题就必须监听它、并且在 SSR/首帧各写一份分叉；而 token 表已经把这层做好了。
  只有在 token 表确实缺少某一档时才值得这么做——本次没有任何一处需要。
- **不引入 `StateDot`，继续用自制圆点**：可以少一个 primitive 依赖，但"进行中"就只能是一颗静态
  半透明点（内联样式没法定义 keyframes），而宿主那颗 `ongoing` 点自带呼吸动画、且状态色与整个
  UI 同源。该 primitive 在 `peerDependencies` 的下限（`0.1.1-rc.2`）里已经导出。
- **给指示器加 `<style>` 注入 keyframes 自己做动画**：能保留自制圆点，但要在 dock 里插全局样式表，
  污染面比收益大。
- **把指示器做成一条贴左的状态行（只加 padding / max-width）**：位置能对上，但形状仍与宿主同层的
  三张卡片不一致，等于在输入框上方塞进第四种视觉语言。
- **白名单直接内嵌宿主完整的 357 个 token 名**：最"正确"，但这份表在宿主仓库里、会随宿主发版漂移，
  内嵌即腐坏；本插件的契约是"只用我声明的那几个 rung"，因此白名单按实际用量维护并双向校验。

## Consequences

- 统计看板、设置页、侧栏图标在浅色与深色主题下都由宿主 token 解析：卡片是主题自己的模块表面，
  成功/失败/警告徽章随主题换档，代码块用代码块底色。深色主题下的观感不变（原来的字面量本来就
  是按深色挑的），浅色主题不再出现深色卡片与低对比文字。
- 聊天指示器现在与 Todo / Goal / Queue 对齐在同一条内容宽度轴上、高 36px，并且是 `role="status"`
  的可达状态行；窗口很窄时它随输入框一起收缩，宽窗口下不再横贯整屏。
- 回归测试把"token 名必须真实存在"锁死：再写 `--dsw-text-primary` 这类名字会在 `pnpm test` 阶段
  失败，而不是以"这条样式静默消失"的形态进线上。代价是每次新增一个 token 都要同步白名单
  （两个方向的断言会分别提示是"用了未登记的名字"还是"登记了没用的名字"）。
- 已知取舍：dock 卡片在宿主不发布那三个自定义属性时会退到内联兜底值（16/8/952px），此时卡片宽度
  与真实输入框可能差几个像素——比铺满窗口好，但不如宿主自己算得准。
