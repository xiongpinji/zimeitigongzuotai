# P2-2 / H1-S2c2a：授权本地录屏逐字节来源观察

主库 `d40606f` 加入 `observeAuthorizedLocalSourceSha256` 和与持久 runner 组合的 `createAuthorizedLocalHotClipRunner`。调用方必须给出绝对的授权媒体根目录、视频路径和取消信号。观察器拒绝根目录外路径、目录、缺失文件与根目录及其子级符号链接；逐块读入实际文件字节并计算 SHA-256，读前后核对打开句柄与路径的文件身份、大小及纳秒级修改/变更时间。失败只抛 `source_unavailable` 固定消息，绝不返回媒体字节或原始路径。持久 runner 仍把观察到的摘要与排队任务中的来源摘要比较，失配时不启动 HotClip sidecar。

## 本机离线证据

先加入观察器测试，初跑因模块不存在而 RED；加入本地逐块读取后，观察器 4 项通过。随后新增完整接线用例，初跑因 `createAuthorizedLocalHotClipRunner` 不存在而 **1 failed、13 passed**；接线后，合成录屏真实字节首次匹配可启动合成 sidecar，改写同一路径后的第二任务以 `source_hash_mismatch` 结束，sidecar 启动计数仍为 1。测试媒体仅在 OS 临时目录，不使用用户录屏。

Windows Node v22.23.3 合跑观察器、产物/恢复、调度、队列、投影和 sidecar 六组套件为 **126 passed、2 skipped**（共 128 项）；两个 skipped 是符号链接断言，Windows 本机建链权限路径未验收。`tsc --noEmit --project app/tsconfig.json` 和 `electron-vite build` 均退出码 0。该构建只证明项目可编译；本观察器尚未被 Electron 产品入口调用，也未进入当前应用主包的实用路径。

## 尚未通过的门槛

读前后文件身份核对不能锁定 sidecar 随后打开的文件；观察结束到子进程打开之间仍有替换竞态。Windows 无 `O_NOFOLLOW`，符号链接检查也不能冒充不可绕过的 OS 文件句柄租约。授权根目录目前由调用方注入，尚未有产品 UI/IPC、媒体权限登记或持锁单写者接线；没有实测真实大体积录屏、真实 HotClip 及高光盲审。此项仅证明合成媒体的本地来源摘要端口可用，不把候选称为独立成片、发布许可或平台认定原创。
