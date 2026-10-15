# scripts/dev — 开发期一次性排查脚本

此目录存放开发过程中用于检索卡牌数据、排查效果实现、测量场地纸卡位坐标的临时脚本，
不参与构建、测试或启动流程。需要时在**仓库根目录**下运行，例如：

```bash
node scripts/dev/find-costs.cjs
node scripts/dev/measure-mat.mjs <场地纸原图路径>
```

正式流程使用的脚本（启动器、打包、压测、卡表生成等）仍位于 `scripts/` 根目录。
