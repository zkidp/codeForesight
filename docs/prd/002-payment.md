---
id: req-002
title: 支付接入
priority: P1
tags: [payment, backend]
expects:
  routes:
    - { method: POST, path: /api/payment/create }
    - { method: POST, path: /api/payment/webhook }
  handlers:
    - src/handlers/payment.ts:createPayment
    - src/handlers/payment.ts:handleWebhook
  db_models:
    - Order
    - Payment
---

# 支付接入

## 验收标准
- [ ] 创建订单返回支付链接
- [ ] webhook 校验签名
- [ ] 支付成功更新订单状态
