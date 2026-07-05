# WAF Control Plane Backend

Nginx WAF 控制面后端，基于 **NestJS + TypeORM + PostgreSQL** 实现。它不是 WAF 数据面本身，而是面向 Web 控制台和自动化流程的管理 API：负责规则版本管理、站点策略发布、Nginx 配置更新、审计日志、用户鉴权、告警与监控数据聚合。

相关仓库：

- WAF 数据面内核：[`nginx-http-waf-module-v2`](https://github.com/tyx3211/nginx-http-waf-module-v2)
- 控制台前端：[`waf-panel-frontend`](https://github.com/tyx3211/waf-panel-frontend)
- 完整工作区：[`waf-project`](https://github.com/tyx3211/waf-project)

## 功能概览

- **认证与权限**：JWT access/refresh token，内置 `admin/admin` 与 `user/user` 演示账号，支持用户创建、自销账号和角色守卫。
- **站点策略发布**：组合核心规则集、模板规则和自定义规则，生成站点策略 JSON，写入规则目录，并通过 `crossplane` 更新 `nginx.conf`。
- **安全发布流水线**：发布流程包含策略组合、规则文件写入、Nginx 配置更新、`nginx -t` 校验和 reload；失败时回滚配置并记录步骤日志。
- **版本管理**：核心规则集、模板规则和站点策略均保留历史版本；回滚会生成新版本，避免破坏历史记录。
- **全局运行参数**：管理 `trust_xff`、日志等级、动态封禁阈值/窗口/持续时间等 http 级 WAF 参数。
- **审计与观测**：记录操作审计；从 Loki 查询 WAF 审计日志、访问统计、时序数据、攻击类型分布和地理分布。
- **报表与告警**：提供防护报告摘要；支持 SMTP 告警配置和手动告警演练。
- **API 文档**：启动后提供 Swagger 文档，默认路径为 `/api/v1/docs`。

## 架构位置

```text
Vue 控制台
    |
    |  /api/v1
    v
NestJS Backend
    |-- PostgreSQL: 用户、版本、审计、告警配置
    |-- WAF_RULES_DIR: 生成和读取 JSON 规则文件
    |-- crossplane: 解析/重写 nginx.conf
    |-- nginx -t / reload: 配置校验与热加载
    |-- Loki: 查询访问日志和 WAF JSONL 审计日志
    `-- SMTP: 可选告警通道
```

## 快速启动

### 1. 安装依赖

```bash
pnpm install
```

### 2. 准备 PostgreSQL

创建数据库，例如：

```bash
createdb waf
```

### 3. 配置环境变量

常用变量如下，未设置时会使用开发默认值。

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `PORT` | 后端监听端口 | `3000` |
| `DB_HOST` / `DB_PORT` | PostgreSQL 地址与端口 | `127.0.0.1` / `5432` |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | 数据库账号、密码、库名 | `postgres` / 空 / `waf` |
| `JWT_SECRET` | JWT 签名密钥 | `dev-secret` |
| `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | access/refresh token 有效期 | `1h` / `7d` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 内置管理员账号 | `admin` / `admin` |
| `USER_USERNAME` / `USER_PASSWORD` | 内置普通用户账号 | `user` / `user` |
| `WAF_RULES_DIR` | WAF JSON 规则根目录 | `/usr/local/nginx/WAF_RULES_JSON` |
| `NGINX_CONF` | Nginx 配置文件路径 | `/usr/local/nginx/conf/nginx.conf` |
| `NGINX_BIN` | Nginx 可执行文件路径 | `/usr/local/nginx/sbin/nginx` |
| `CROSSPLANE_BIN` | crossplane 命令 | `crossplane` |
| `NGINX_BACKUP_DIR` | Nginx 配置备份目录 | `/usr/local/nginx/conf/.backup` |
| `LOKI_URL` | Loki 地址，留空则相关查询不可用 | 空 |
| `SMTP_ENABLED` / `SMTP_HOST` / `SMTP_PORT` | 邮件告警配置 | `false` / 空 / `587` |

### 4. 运行数据库迁移

```bash
pnpm migration:run
```

### 5. 启动开发服务

```bash
pnpm start:dev
```

访问：

- API 前缀：`http://localhost:3000/api/v1`
- Swagger：`http://localhost:3000/api/v1/docs`
- 健康检查：`http://localhost:3000/api/v1/health`

## 常用命令

```bash
pnpm build             # 编译 NestJS 项目
pnpm start:prod        # 运行 dist/main
pnpm test              # 单元测试
pnpm test:e2e          # e2e 测试
pnpm openapi:export    # 导出 OpenAPI 到 exports/openapi.v1.json
pnpm migration:run     # 执行 TypeORM 迁移
pnpm migration:revert  # 回滚最近一次迁移
```

仓库中还保留了若干 `scripts/e2e-*.sh`，用于发布链路、回滚链路、Loki 联调和多站点场景的冒烟验证。

## API 模块

| 模块 | 路径前缀 | 说明 |
| --- | --- | --- |
| Auth | `/auth` | 登录、刷新 token、当前用户信息 |
| Users | `/users` | 用户列表、创建用户、账号自销 |
| ServerPolicy | `/servers` | 站点列表、策略发布、运行态参数、版本回滚 |
| CoreRules | `/core-rules` | 核心规则集版本管理与恢复出厂 |
| Templates | `/templates` | 模板规则版本管理与删除 |
| Audit | `/audit/ops` | 操作审计查询与详情 |
| Loki | `/logs/loki` | WAF/Access 日志、统计、时序与地理聚合 |
| WAF Metrics | `/waf-metrics` | 面向前端大屏的摘要、TopN 和地理数据 |
| Reports | `/reports` | 防护报告摘要 |
| Alerts | `/alerts` | 告警配置与手动发送 |
| Health | `/health` | DB、Loki、SMTP 组件健康检查 |

## 设计备注

- 所有业务响应由全局拦截器包装为统一 envelope：`{ code, message, data, timestamp }`。
- 发布、运行态更新和回滚围绕全局 Nginx 配置锁执行，避免并发写 `nginx.conf`。
- 策略发布失败会保存失败版本和审计日志，并尽量从备份恢复 Nginx 配置。
- `client/` 目录可放置前端构建产物，后端会静态托管非 `/api/*` 路径。

## 当前边界

这是控制面原型/课程项目形态的实现，重点验证 **WAF 数据面可被结构化规则和 Web 控制台管理** 这一链路。生产化部署仍需要补充更严格的权限模型、密钥管理、审计保留策略、前后端联调测试和高可用部署方案。
