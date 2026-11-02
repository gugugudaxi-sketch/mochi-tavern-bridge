# Mochi 酒馆互通 · 测试版

在酒馆「扩展 → 安装扩展」粘贴 `https://github.com/gugugudaxi-sketch/mochi-tavern-bridge`，完成后刷新酒馆。

服务端仅首次安装需要在 Termux 的酒馆根目录运行一次下面的命令，然后重启酒馆：

```sh
node "$(find data public/scripts/extensions/third-party -name install-server.mjs -path '*/mochi-tavern-bridge/*' -print -quit)"
```

脚本会安装本机通信插件并开启服务端插件选项，保留原配置备份和已有配对/记忆。以后更新扩展后，如服务端也有更新，可重跑此命令。

重启后：酒馆扩展复制配对码 → Mochi设置「酒馆互通」填写 http://127.0.0.1:18181 和配对码 → 保存并测试 → 回酒馆刷新角色列表并绑定。

只互通最近文字，不导入面具、角色卡或世界书。支持手动和前台自动同步。测试版，需 Android APK 与同手机 Termux 酒馆配合使用。
