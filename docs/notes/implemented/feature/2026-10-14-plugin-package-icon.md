# Agent Note: 插件包图标（package.json `icon`）

Status: implemented

## Problem

DSH 插件管理器在「插件」页为每个包渲染封面图：读取该包导出 `package.json` 顶层的 `icon` 字段，把清单目录内的相对路径图片以 data URL 交给客户端 `<img>`。`dsh-llm-verifier` 从未声明该字段，卡片、列表行与详情页一直落到宿主缺省封面（`PluginArtworkDefault`，青蓝连接块与节点），在同类插件普遍自带 `icon.svg` 的列表里无法与其它插件区分，也丢失了本项目自身的身份表达。

## Decision

新增仓库根目录 `icon.svg`，并在 `package.json` 顶层加入 `"icon": "./icon.svg"`，同时把 `icon.svg` 加进 `files` 字段使其进入发布 tarball。

图标复用插件自己的既有品牌标记：与 `src/client.tsx` 的 `VerifierSidebarIcon` 同一套紫→蓝→青线性渐变（`#8A63FF` → `#4F7BFF` → `#2FC5C9`）圆角方块，上面叠加白色护盾与同渐变的对勾。侧栏徽章与插件页封面因此是同一标识的两种尺寸，而不是两个互不相干的图形。

几何按宿主封面的实际渲染尺寸取值：卡片 48px 框内图片渲染 36px，列表行 40px 框内渲染 30px。图标用 48×48 viewBox，圆角 15、对勾笔画 4.2，在 30–36px 下仍可辨认。`icon.svg` 不含脚本、外部引用、`href`/`xlink:href`、`foreignObject` 或位图嵌套，仅有两个本地 `url(#…)` 渐变引用，既满足宿主把图片当 `<img>` 渲染（不执行其中的脚本与标记）的约束，也避免了 `PluginArtworkSearch` 那类 `foreignObject` 方案在 `<img>` 上下文中必然空白的问题。

## Alternatives considered

- **在 `src/client.tsx` 里注册客户端侧封面组件**：宿主只在 `ui-plugin-manager` 内部为四个官方插件（`shell` / `agent-loop` / `subagent` / `web-search`）硬编码 artwork，第三方插件无法经插件接口注册该位置的封面组件；清单是插件声明自身封面的唯一通道。
- **提交 PNG 而非 SVG**：更小的兼容面，但需要为可能的高分屏分辨率维护多个位图，且丢失矢量在 30px 与 36px 两种渲染尺寸下的清晰度。宿主接受 SVG，故直接交付 SVG。
- **沿用缺省封面**：视觉上与官方缺省插件无法区分，插件页的多插件列表失去辨识度。
- **另起一套全新配色与母题**：会让同一插件在侧栏徽章与插件页呈现两种身份，反而削弱一致性；因此改为一套标记、两种尺寸。

## Consequences

- 插件卡片、列表行与详情页显示自带封面；解码失败或字段缺失时宿主仍回落到缺省封面，插件管理不受影响。
- 宿主的清单读取是每次拉取库存时实时执行（`pluginInventory.list()` → `metaOf` → `readPluginMeta`，无缓存），因此本地 profile 已装的副本（junction 指向本仓库）刷新页面即可看到新图标，无需重启 DSH。
- 图标随 `files` 进入 tarball；根目录新增一个非构建产物文件，`prepublishOnly` 的 `verify:release` 不涉及它，无需改动构建脚本。
- 宿主对清单图标有硬校验（相对路径、SVG/PNG/JPEG/WebP、≤256 KiB、realpath 后须留在清单目录内），任一不满足会整条拒绝并在插件页给出错误提示；本图标 801 字节、位于清单同目录，满足全部条件。
