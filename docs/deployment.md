# 独立 Kubernetes Job 设计（待实现）

## 已选方案

同集群独立 Job，每批运行一次，完成后退出。采集模块不依赖 Core AI Agent 会话，也不复用长驻 sandbox 的生命周期。目前没有镜像、Job 清单或线上资源。

## 镜像与资源

- 使用 Node.js、固定版本 Playwright 与正式 Google Chrome；构建时验证架构兼容性并记录 Chrome 版本，按镜像 digest 发布。
- 以非 root 身份运行；验证 Chrome sandbox 所需的集群能力。不要默认增加 privileged、hostIPC 或 SYS_ADMIN，也不要未经验证直接关闭 Chrome sandbox。
- 配置 init/进程回收、SIGTERM 处理、每关键词 deadline 和整个批次 deadline；超时需要结束浏览器子进程。
- 单浏览器串行起步。CPU request 500m / limit 2，内存 request 1Gi / limit 2Gi、共享内存 256–512Mi 是待压测起点，不是已验证容量。
- 显式设置 ephemeral-storage requests/limits 与临时磁盘 sizeLimit；独立挂载 /dev/shm，内存卷开销要计入总内存预算。
- 限制每次 viewport 和截图数量，不生成超长全页图片。保留浏览器 stderr、退出码与阶段耗时。

## 任务与存储

- 首版手动创建 Job；配置 activeDeadlineSeconds、有限 backoffLimit 和 ttlSecondsAfterFinished。自动重试必须保持逻辑 runId，防止重复数据。
- 后续若需要定时，再使用 CronJob；不是当前默认要求。
- 只给截图任务所需对象存储前缀的权限，通过工作负载身份或独立 Secret 注入，不复制整套 Core AI 配置。
- 本地输出、上传、存储验证是三个不同状态。Pod 删除后，已验证产物和 manifest 仍需可读。
- 验证码记录为 blocked，不自动绕过，也不把挑战页当有效结果。

## 实施验收

1. 本地验证数据提取，再在目标 Pod 跑 3–5 个关键词，包含 bubble tea garden city。
2. 核对包含广告的展示顺序、广告标签、自然排名及同店广告/自然双重出现。
3. 核对滚动重叠不重复计数、较低位置店铺有对应截图、顺序不确定时留空排名。
4. 测试无结果、验证码、超时和部分成功；所有输入关键词都出现在 manifest 中。
5. 上传后独立读回 PNG/JSON/CSV，核对内容和摘要，再验证删除 Pod 后仍可获取。
6. 确认超时、终止和正常完成都无残留浏览器进程；检查实际 CPU、内存与磁盘峰值。

## 官方参考

- [Playwright 与 Google Chrome](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge)
- [Playwright 容器运行](https://playwright.dev/docs/docker)
- [Kubernetes Job](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
- [Google 本地排名说明](https://support.google.com/business/answer/7091?hl=en)
