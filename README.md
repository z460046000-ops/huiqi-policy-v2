# 惠企政策平台 V2

独立发布版本，对应本地 8768 项目。

- [访问首页](https://z460046000-ops.github.io/huiqi-policy-v2/#dashboard)
- [访问落地页](https://z460046000-ops.github.io/huiqi-policy-v2/landing.html)

## 发布

静态 HTML、CSS、JavaScript 项目，无需构建。GitHub Pages 从 main 分支根目录发布，使用相对路径和 hash 路由。

## 版本隔离

本仓库独立于 workspace-preview。项目存储使用 huiqi-policy-v2，研究员视角使用 huiqi-policy-v2-research，落地页推荐读取同一 V2 项目存储。首次打开使用此版本的初始数据，不迁移其他版本或本地浏览器中的项目。

## 功能边界

政策资料、匹配评分和文本建议沿用当前前端实现，未接入实时模型或政府提交接口。上传和项目记录保存在浏览器本机。DOCX 解析按需加载 jsDelivr 的 mammoth 1.8.0。

## 素材

首页图标来自 3dicons（CC0），来源见 assets/start-art/source.json。字体许可证见 assets/landing/font-license.txt。专家人像为生成的虚构角色形象。
