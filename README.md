# Bubble Arena · 泡泡堂玩法 HTML5 重绘版

用JavaScript和Phaser重写的网格炸弹小游戏，无需Flash。参考[4399《Q版泡泡堂》](https://www.4399.com/flash/3881.htm)的玩法，画面为重新绘制，并非原版完整复刻或官方作品。

[在线试玩](https://huangzhijun.online/play/bubble-arena/) · [个人博客产品区](https://huangzhijun.online/#products)

## 玩法

- 单人闯关、同机双人合作、2–4人远程对战、双人远程合作。
- 15×13地图、三分钟对局、可破坏箱子、连锁爆炸与道具。
- 方向键或WASD移动，空格放炸弹。房主可暂停和再开一局。
- 同机双人：玩家1用WASD和空格，玩家2用方向键和Enter。
- 手机：左手虚拟摇杆移动、松手停止，右手点按放弹；支持双指同时操作。移动中点按会在下一格放弹。顶部菜单返回选择需要确认。PC继续使用键盘，手机不显示同机键盘双人模式。

远程联机：选「好友联机」→创建房间→把邀请链接发给好友→好友加入并准备→房主开始。房主保持网页打开，离开后房间结束。

## 本地运行

需要已有Python 3，使用浏览器打开页面，不要直接打开本地HTML文件。

```sh
python -m http.server 5173 --bind 127.0.0.1 --directory dist
```

打开 `http://127.0.0.1:5173/`。浏览器库已随包提供，单机不依赖CDN。联机需要网络连接到PeerJS公共信令服务，由WebRTC在玩家之间传输数据。也可以配置自己的PeerServer和ICE服务器，见[PeerJS文档](https://peerjs.com/docs/)。

## 架构与验证

`dist/game.js`负责游戏规则和Phaser绘制；`dist/online.js`负责房间和输入/状态同步。房主运行唯一游戏模拟，好友只发送控制输入并显示收到的状态。无需游戏后端、数据库、账号或安装后台服务，静态HTTPS托管即可。

```sh
node tests/arena.test.cjs
node tests/mobile-controls.test.cjs
node --check dist/game.js
node --check dist/online.js
```

14项核心方法与9项移动输入检查通过。此前两个实际浏览器通过真实PeerJS/WebRTC验证加入、准备、移动、放弹、暂停、对战结果及重开；合作模式的人物同步已验证。方法检查使用绘制/DOM桩，不替代浏览器验收；本次手机显示与实机操作仍待复验。

两台不同网络设备、三/四人同时操作、手机联机和断线重入尚未完整实测。连接可用性受双方网络及公共信令/中继服务影响。没有持久房间、排行榜或账号；房主页面后台运行可能受浏览器节流影响。

当前美术、音乐、动画、地图、AI、计分和特殊武器细节与原版有差异。原版SWF、导出的素材和音乐均未纳入仓库。

## 开源与来源

自有代码采用MIT许可，详见[LICENSE](LICENSE)。第三方Phaser 3.90.0和PeerJS 1.5.5保留各自MIT许可。重绘图像使用AI生成并整理为精灵图集，音效由浏览器合成。来源和许可边界见[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
