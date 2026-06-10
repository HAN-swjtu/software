# 员工管理系统

本项目是《软件系统设计与应用》课程设计的员工管理系统，采用前端静态页面、Node.js/Express 后端接口和 MySQL 数据库实现。系统包含员工、部门、考勤、薪资、假期、离职、绩效、培训、招聘等业务模块。

## 项目结构

```text
员工管理项目/
├─ login.html                    登录页面
├─ index.html                    系统主页面
├─ style.css                     全局页面样式
├─ auth.js                       登录逻辑，调用后端 /api/login
├─ main.js                       主页面导航、角色权限、面板切换
├─ app.js                        我的信息、账号密码修改等公共功能
├─ employee-module.js            员工信息、部门基础数据相关前端逻辑
├─ attendance-module.js          考勤管理前端逻辑
├─ salary-module.js              薪资管理前端逻辑
├─ leave-module.js               假期管理前端逻辑
├─ resign-module.js              离职管理前端逻辑
├─ performance-module.js         绩效管理前端逻辑
├─ training-module.js            培训管理前端逻辑
├─ recruit-module.js             招聘管理前端逻辑
├─ ems_database.sql              基础数据库脚本
└─ server/
   ├─ server.js                  后端服务入口，包含 MySQL 连接配置和 API 挂载
   ├─ package.json               后端依赖配置
   ├─ migrate.sql                基础迁移脚本
   ├─ dept-migrate.sql           部门模块数据库脚本
   ├─ leave-migrate.sql          假期模块数据库脚本
   ├─ salary-migrate.sql         薪资模块数据库脚本
   ├─ performance-migrate.sql    绩效模块数据库脚本
   ├─ training-migrate.sql       培训模块数据库脚本
   ├─ recruit-migrate.sql        招聘模块数据库脚本
   ├─ resign-migrate.sql         离职模块数据库脚本
   ├─ performance-apis.js        绩效管理后端接口
   ├─ training-apis.js           培训管理后端接口
   ├─ recruit-apis.js            招聘管理后端接口
   └─ resign-apis.js             离职管理后端接口
```

## 环境要求

- Node.js 18 或更高版本
- MySQL 8 或更高版本
- Edge、Chrome 等现代浏览器
- Git

## 数据库导入

先创建数据库：

```bat
mysql -u你的用户名 -p -e "DROP DATABASE IF EXISTS ems; CREATE DATABASE ems CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

在项目根目录依次导入 SQL 文件：

```bat
cd /d D:\员工管理项目
mysql -u你的用户名 -p --default-character-set=utf8mb4 ems < ems_database.sql
mysql -u你的用户名 -p --default-character-set=utf8mb4 ems < server\migrate.sql
mysql -u你的用户名 -p --default-character-set=utf8mb4 ems < server\dept-migrate.sql
mysql -u你的用户名 -p --default-character-set=utf8mb4 ems < server\leave-migrate.sql
mysql -u你的用户名 -p --default-character-set=utf8mb4 ems < server\salary-migrate.sql
mysql -u你的用户名 -p --default-character-set=utf8mb4 ems < server\performance-migrate.sql
mysql -u你的用户名 -p --default-character-set=utf8mb4 ems < server\training-migrate.sql
mysql -u你的用户名 -p --default-character-set=utf8mb4 ems < server\recruit-migrate.sql
mysql -u你的用户名 -p --default-character-set=utf8mb4 ems < server\resign-migrate.sql
mysql -u你的用户名 -p --default-character-set=utf8mb4 ems < server\remove-position.sql
```

说明：后端启动时也会检查并初始化绩效管理相关表；如果已经启动过后端，一般不需要重复导入 `server\performance-migrate.sql`。手动导入适合全新数据库或需要确认表结构时使用。

如果需要修复或补充演示数据，可在 `server` 目录运行对应脚本，例如：

```bat
cd /d D:\员工管理项目\server
node restore-chinese.js
node fix-dept-managers.js
node fix-training-chinese.js
node seed-recruit-demo.js
```

## 后端配置

后端数据库连接配置在：

```text
server/server.js
```

当前默认配置为：

```js
host: '127.0.0.1'
user: 'hanxu'
password: '123456'
database: 'ems'
```

如果本机 MySQL 用户名或密码不同，需要先修改 `server/server.js` 中的连接配置。

## 安装依赖

```bat
cd /d D:\员工管理项目\server
npm install
```

## 启动后端

```bat
cd /d D:\员工管理项目\server
npm start
```

启动成功后，后端地址为：

```text
http://localhost:3001/api
```

如果出现 `EADDRINUSE: address already in use :::3001`，说明 3001 端口已经有服务在运行。可以直接使用已有服务，或关闭原来的后端窗口后重新启动。

## 打开前端

后端启动后，用浏览器打开：

```text
D:\员工管理项目\login.html
```

登录成功后会进入 `index.html` 主界面。

## 常用账号

| 角色 | 账号 | 密码 | 用途 |
| --- | --- | --- | --- |
| 系统管理员 | `root` | `123456` | 本地管理员登录 |
| HR专员 | `linjing` | `admin` | 员工、培训等管理 |
| 招聘专员 | `mahao` | `admin` | 招聘岗位、简历、Offer |
| 部门主管 | `chenhua` | `admin` | 审批、面试评价、培训需求 |
| 普通员工 | `zhaotao` | `admin` | 个人业务、培训报名 |

如果重新导入数据库后账号数据发生变化，以 `employees` 表中的用户名和密码为准。

## 绩效管理模块

绩效管理模块已接入主菜单和后端 API，相关文件如下：

```text
performance-module.js
server/performance-apis.js
server/performance-migrate.sql
```

主要流程：

1. HR 专员配置 KPI 指标库，保存草稿并发布考核周期。
2. 普通员工进入“绩效管理”填写本周期自评。
3. 部门主管查看下属自评，提交主管评分、绩效等级、面谈记录和改进建议。
4. HR 专员对主管已评记录进行归档。
5. 招聘专员可查询已归档绩效记录，用作招聘参考。

角色权限：

| 角色 | 绩效管理权限 |
| --- | --- |
| HR专员 / root | 指标库配置、发布、归档、查询 |
| 部门主管 | 查看下属记录、主管评分与面谈 |
| 普通员工 | 查看 KPI、提交自评、查看本人结果 |
| 招聘专员 | 查询已归档绩效记录 |

## 小组协作建议

每次修改前先拉取最新代码：

```bat
git pull origin main
```

修改后提交：

```bat
git status
git add .
git commit -m "说明本次修改内容"
git push origin main
```

如果多人同时修改同一个文件，先 `git pull origin main`，解决冲突后再提交。
