---
id: req-001
title: 用户登录
priority: P0
tags: [auth, backend]
expects:
  routes:
    - { method: POST, path: /api/auth/login }
    - { method: POST, path: /api/auth/logout }
  handlers:
    - src/handlers/auth.ts:loginHandler
    - src/handlers/auth.ts:logoutHandler
  hooks:
    - src/middleware/withAuth.ts:withAuth
  db_models:
    - User
    - Session
---

# 用户登录

## 背景
让用户可以通过邮箱+密码登录，签发 JWT。

## 架构

```mermaid
sequenceDiagram
  Client->>API: POST /api/auth/login
  API->>DB: SELECT user
  API->>Client: JWT
```

## 验收标准
- [ ] 登录成功返回 JWT
- [ ] 密码错误返回 401
- [ ] Session 持久化到 DB
- [ ] 提供 logout 接口
