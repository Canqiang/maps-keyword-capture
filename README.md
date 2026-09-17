# Maps Keyword Capture

按关键词采集 Google Maps 店铺列表与原始截图，保留广告、展示顺序和自然排名，面向同集群独立 Kubernetes Job。

## 当前状态

项目初始化阶段。已包含需求、数据类型、输入示例和部署设计；**尚未实现浏览器采集、广告识别、截图或上传，也尚未部署到集群**。

本项目不要求输入目标店铺。每次保存搜索结果中的所有已采集店铺，之后可以按店铺筛选、跨期比较、制作报告。

## 已确定的行为

- 默认每个关键词采集前 20 条展示结果，广告也占一条，可配置上限。
- 分别保存 `displayPosition`（含广告的列表顺序）和 `organicRank`（排除广告）。
- 广告必须明确标注；无法判断时保存 `unknown`，不猜测自然排名。
- 同店的广告与自然结果分别保留；滚动重叠造成的重复观察不重复计数。
- 保存原始列表和地图截图，保留查询词、广告标识与上下文，不修改页面制造排名。
- 每个关键词输出 CSV、JSON、多张 PNG；批次输出 manifest。
- 查询条件与时间保存在元数据中；一次查询结果不代表固定排名或 SEO 因果效果。

## 技术方向

Node.js / TypeScript + Playwright + 正式版 Google Chrome + Kubernetes Job + 私有对象存储。

安装 Playwright 包不代表已安装 Google Chrome。未来运行器使用 `channel: "chrome"`；专用 Linux 镜像需另行安装和验证 Chrome，并记录实际版本。

## 开发准备

```bash
npm ci
npm run typecheck
```

以上仅验证数据类型。目前没有可执行的采集命令。依赖通过 lockfile 固定，尚未验证浏览器组合。

## 目录

```text
src/contracts.ts          输入、结果与批次状态定义
examples/keywords.json   关键词输入示例
docs/spec.md             排名、广告、去重和输出约定
docs/deployment.md       独立 Job 设计及验证步骤
```

## 下一阶段

1. 实现本地 Chrome 采集：关键词输入、结果等待、滚动、广告标识、截图、JSON/CSV。
2. 用 3–5 个关键词在目标 Pod 验证实际访问、截图与验证码状态。
3. 接入对象存储，上传后读回验证；完成容器镜像和 Job 清单。
4. 验证部分失败、超时、进程回收及 Pod 删除后的文件持久保存。

先手动触发 Job；定时调度和管理界面不属于初始化范围。
