# 纸上谈币 官网

本目录为单页官网，绑定域名 **纸上谈币.com**。

## 部署与域名绑定步骤

### 1. 部署静态站点

任选一种方式，把 `website` 目录下的文件（含 `index.html`、`logo.png`、`CNAME`）发布到可访问的地址：

- **GitHub Pages**  
  - 将本仓库（或仅 `website` 目录）推送到 GitHub，在仓库 **Settings → Pages** 里选择分支/目录并开启 Pages。  
  - 根目录若有 `CNAME` 且内容为 `纸上谈币.com`，GitHub 会识别为自定义域名。
- **Vercel / Netlify / Cloudflare Pages**  
  - 导入本仓库，将站点根目录设为 `website`（或把 `website` 内容放到项目根再部署）。  
  - 在控制台里添加自定义域名：`纸上谈币.com`（以及可选 `www.纸上谈币.com`）。

### 2. 在域名注册商处配置 DNS

在购买 **纸上谈币.com** 的域名服务商（阿里云、腾讯云、Cloudflare、GoDaddy 等）的 DNS 解析里添加记录：

| 类型 | 主机记录 | 记录值 | 说明 |
|------|----------|--------|------|
| **若使用 GitHub Pages** | | | |
| A | @ | 185.199.108.153 | 根域名 纸上谈币.com |
| A | @ | 185.199.109.153 | 同上 |
| A | @ | 185.199.110.153 | 同上 |
| A | @ | 185.199.111.153 | 同上 |
| CNAME | www | Zephyr886.github.io | 若使用 www 子域名 |

（若使用 Vercel/Netlify/Cloudflare，在对应产品的「自定义域名」页面会提示你填的主机记录和记录值，按提示填即可。）

### 3. 在托管平台里保存自定义域名

- **GitHub Pages**：Settings → Pages → Custom domain 填 `纸上谈币.com`，保存。若启用 HTTPS，勾选 Enforce HTTPS。  
- **Vercel/Netlify/Cloudflare**：在项目/站点的 Domains 里添加 `纸上谈币.com`，按提示完成验证。

DNS 生效通常需要几分钟到几小时。生效后访问 **https://纸上谈币.com** 即可打开本站。
