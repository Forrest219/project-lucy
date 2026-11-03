# 登录账户

## UX-ADMIN-ACCOUNTS-001: 列表、新建表单和 OIDC 说明叠在同一页

Status: Open
Route: /admin/accounts
Feedback: 2026-10-30 走查。登录账户把列表、新建表单和 OIDC 说明纵向叠在一起。所有者那一行直接放着停用和删除。
Expected: 主任务先是账户列表。新建和身份源说明不要抢同一屏。停用和删除不要贴在所有者行的主信息上。
Browser Check: 发版走查打开 `/admin/accounts`。不新建、不停用、不删除。
