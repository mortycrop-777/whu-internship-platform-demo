# 个人记录与画像 · 数据模型 v0.1

> 状态：草案。用于把“实习记录输入 → AI 抽取 → 个人画像 → 个性化输出”这条想法落成可实现的数据结构。

## 1. 设计原则

- 原始记录、AI 抽取、个人画像三层分开，互不覆盖。
- 每条 AI 抽取都保留 `record_id` 和 `evidence`，可以追溯回原文。
- 用户必须能确认、修改、删除 AI 抽取的内容。
- 个人记录默认私有；教师端只看匿名聚合。
- 初期用 SQLite + JSON 字段，后续需要岗位匹配时再拆技能/项目关联表。

## 2. 表结构

### users

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 用户 ID |
| role | enum | student / teacher / enterprise |
| account_hash | string | 学号/工号哈希，不存明文 |
| display_name | string | 展示名 |
| grade | string | 年级，如“网传 2023” |
| major | string | 专业 |
| privacy_settings | JSON | 是否允许教师查看聚合、是否允许生成等 |
| created_at | datetime | 创建时间 |

### cohorts

一个年级/学期的应实习学生范围，也是看板“应实习人数”的分母来源。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 届次 ID |
| term | string | 学期，如 `2026-fall` |
| name | string | 届次名称，如 `网传 2023 级` |
| expected_count | integer | 去重后的应实习学生人数 |
| status | enum | draft / importing / active / archived |
| imported_at | datetime | 最近一次名单导入完成时间 |
| created_by | UUID | 导入教师 |

### cohort_imports

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 导入任务 ID |
| cohort_id | UUID | 所属届次 |
| file_name | string | 原始文件名 |
| status | enum | previewed / queued / processing / succeeded / failed |
| total_rows | integer | 原始数据行数 |
| valid_rows | integer | 校验通过行数 |
| invalid_rows | integer | 校验失败行数 |
| imported_by | UUID | 操作教师 |
| created_at / finished_at | datetime | 导入时间 |

### cohort_members

名单中的学生与已创建账号的对应关系。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 成员 ID |
| cohort_id | UUID | 所属届次 |
| user_id | UUID | 自动创建的学生账号 |
| import_id | UUID | 来源导入任务 |
| student_no_hash | string | 学号确定性哈希，用于查重和登录查找 |
| student_no_ciphertext | string | 学号密文，仅授权场景解密 |
| identity_no_ciphertext | string | 身份证号密文，使用 KMS 加密，禁止明文落库和写日志 |
| must_change_password | boolean | 首次登录是否必须改密 |
| account_created_at | datetime | 账号创建时间 |

导入约束：

- 学号和身份证号必须在同一届次内唯一，批量导入在单个数据库事务中完成。
- 初始密码按“身份证后六位”生成后立即使用 Argon2/bcrypt 哈希，只保存哈希，不保存明文密码。
- `must_change_password = true`，学生首次登录必须先设置新密码。
- 前端、日志、导出文件只展示脱敏身份证号，例如 `4201**********0012`。
- 重新导入名单不得自动删除已有学生账号，需先进入差异预览并由教师确认新增、更新、移除。

### records

用户自己写的原始内容，是事实来源。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 记录 ID |
| user_id | UUID | 所属学生 |
| type | enum | weekly_report / project / work / progress / reflection |
| title | string | 标题 |
| raw_text | text | 用户原文，不覆盖 |
| occurred_at | date | 事情发生时间 |
| status | enum | draft / submitted |
| visibility | enum | private（默认）/ shared |
| client_request_id | string | 幂等键，防重复提交 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### record_items

AI 从 `records` 中抽取出的原子信息，可修改、可重新生成。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 条目 ID |
| record_id | UUID | 来源记录 |
| user_id | UUID | 冗余用户 ID，便于查询 |
| item_type | enum | project / task / skill / achievement / metric / challenge / reflection |
| title | string | 一句话标题 |
| detail | text | 展开说明 |
| role | string | 担任角色 |
| skills | JSON | 技能数组 |
| tools | JSON | 工具数组 |
| quantified_result | JSON | 量化结果，如 `{"value":3,"unit":"篇"}` |
| evidence | text | 原文证据句 |
| confidence | float | 0–1，AI 置信度 |
| user_confirmed | boolean | 用户是否确认 |
| created_at | datetime | 创建时间 |

### extraction_jobs

AI 抽取是异步任务，不能假设接口立即返回结果。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 任务 ID |
| record_id | UUID | 对应记录 |
| status | enum | queued / processing / succeeded / failed |
| model | string | 使用的模型 |
| error | text | 失败原因 |
| created_at | datetime | 创建时间 |
| finished_at | datetime | 完成时间 |

### profiles

当前个人画像，由已确认的 `record_items` 汇总而成。

| 字段 | 类型 | 说明 |
|---|---|---|
| user_id | UUID | 主键 |
| headline | string | 一句话简介 |
| summary | text | AI 生成的画像摘要，可编辑 |
| target_direction | string | 目标方向，如“融媒体 / 新媒体采编” |
| skills | JSON | `[{name, level, evidence_item_ids}]` |
| strengths | JSON | 优势列表 |
| project_highlights | JSON | 项目亮点 |
| version | integer | 画像版本号 |
| updated_at | datetime | 更新时间 |

### profile_snapshots

画像历史版本，用于展示成长轨迹。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 快照 ID |
| user_id | UUID | 所属学生 |
| version | integer | 对应画像版本 |
| snapshot | JSON | 完整画像快照 |
| source_record_ids | JSON | 生成时的来源记录 |
| created_at | datetime | 生成时间 |

### attachments（可选）

作品、报告、图片等附件。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 附件 ID |
| record_id | UUID | 所属记录 |
| file_url | string | 文件地址 |
| file_type | string | pdf / docx / image |
| extracted_text | text | 解析出的文本（可选） |
| created_at | datetime | 上传时间 |

### report_summaries

周报的 AI 摘要，保留版本和人工编辑结果。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 摘要 ID |
| report_id | UUID | 所属周报 |
| summary_text | text | 摘要正文，约 150 字 |
| status | enum | queued / processing / succeeded / failed |
| source_hash | string | 生成时周报原文的哈希，用于判断是否过期 |
| model | string | 使用的模型 |
| prompt_version | string | 提示词版本 |
| generated_by | enum | ai / manual |
| requested_by | UUID | 首次触发摘要生成的教师 |
| version | integer | 摘要版本 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

索引：`report_summaries(report_id, version)` 唯一；`report_summaries(status)`。

### weekly_reports

教师端批改的周报实体。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 周报 ID |
| student_id | UUID | 学生 |
| week | string | 周次，如“第 6 周” |
| unit | string | 实习单位 |
| content_html | text | 本周工作内容（富文本） |
| reflection | text | 收获与反思 |
| next_plan | text | 下周计划 |
| status | enum | 待评价 / 已评价 |
| submitted_at | datetime | 提交时间 |

### weekly_report_attachments

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 附件 ID |
| report_id | UUID | 周报 |
| kind | enum | image / file |
| file_name | string | 文件名 |
| file_url | string | 对象存储地址 |
| mime_type | string | MIME 类型 |
| size_bytes | integer | 文件大小 |
| created_at | datetime | 上传时间 |

### internship_placements

教师端「实习落实」看板的数据源。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 落实记录 ID |
| student_id | UUID | 学生 |
| term | string | 学期/批次，如 2026-fall |
| placement_type | enum | 学院安排 / 自己投递 |
| status | enum | 未填报 / 已填报 / 审核中 / 待结果 / 已确认 |
| unit_id | UUID | 意向或确认单位 |
| position | string | 岗位 |
| confirmed_at | datetime | 单位确认接收时间；为空则未落实 |
| updated_at | datetime | 最近更新时间 |

“已落实”以 `confirmed_at` 非空为准；落实率 = 已确认人数 / 应实习人数。

### placement_timelines

教师可编辑的实习时间轴。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 时间轴 ID |
| term | string | 学期/批次 |
| milestones | JSON | `[{date,label}]`，日期为 ISO 格式，如 `2026-12-01` / 开始投递 |
| updated_by | UUID | 最后编辑教师 |
| updated_at | datetime | 更新时间 |

### volunteer_applications

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 志愿申请 ID |
| student_id | UUID | 学生 |
| term | string | 学期/批次 |
| first_choice | UUID | 第一志愿单位 |
| second_choice | UUID | 第二志愿单位 |
| position | string | 意向岗位 |
| adjust | boolean | 是否服从调剂 |
| reason | text | 申请理由 |
| status | enum | 待提交 / 审核中 / 已通过 |
| submitted_at | datetime | 提交时间 |

### application_attachments

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 附件 ID |
| application_id | UUID | 所属志愿申请 |
| kind | enum | resume / portfolio |
| file_name | string | 原始文件名 |
| file_url | string | 对象存储地址（私有） |
| mime_type | string | MIME 类型 |
| size_bytes | integer | 文件大小 |
| scan_status | enum | uploaded / scanning / clean / rejected |
| created_at | datetime | 上传时间 |

### enterprise_jobs

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 岗位 ID |
| enterprise_id | UUID | 发布企业 |
| title | string | 岗位名称 |
| city | string | 城市 |
| quota | integer | 名额 |
| requirements | text | 岗位要求 |
| status | enum | 在招 / 已结束 |
| term | string | 学期/批次 |
| created_at | datetime | 发布时间 |

### challenge_applications

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 揭榜申请 ID |
| job_id | UUID | 岗位 |
| student_id | UUID | 学生 |
| status | enum | 待处理 / 已通过 / 已拒绝 |
| applied_at | datetime | 报名时间 |

### internships

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 实习记录 ID |
| student_id | UUID | 学生 |
| start_date | date | 实习开始日期 |
| expected_end_date | date | 预计结束日期，默认开始后 20 周 |
| actual_end_date | date | 实际结束日期 |
| start_edit_count | integer | 修改次数，审计用；当前产品不限制次数 |
| status | enum | 未开始 / 进行中 / 已结束 |
| created_at / updated_at | datetime | 时间 |

### student_profiles

| 字段 | 类型 | 说明 |
|---|---|---|
| student_id | UUID | 学生 |
| name | string | 姓名 |
| class_name | string | 班级 |
| unit | string | 实习单位 |
| department | string | 单位部门 |
| mentor | string | 实习导师 |
| mentor_contact | string | 导师联系方式，可为空 |
| address | string | 实习期居住地址 |
| emergency_contact | string | 紧急联系人 |
| emergency_phone | string | 紧急联系人电话 |
| updated_at | datetime | 更新时间 |

### weekly_report_evaluations

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 评价 ID |
| report_id | UUID | 周报 |
| teacher_id | UUID | 教师 |
| level | enum | 特别优秀 / 优秀 / 合格 |
| tags | JSON | 创新报告 / 被摘录报告 / 延交 |
| base_score | decimal | 每周基础分 6 |
| total_score | decimal | 自动计算后的本周得分 |
| comment | text | 评语 |
| created_at / updated_at | datetime | 时间 |

评分规则：总 20 周，每周基础分 6；特别优秀 +2、优秀 +1、合格 +0；创新报告 +0.25、被摘录报告 +0.15、延交 -1。

## 3. 示例

一条记录：

```json
{
  "id": "rec_001",
  "type": "weekly_report",
  "title": "第 6 周实习周报",
  "raw_text": "本周参与汉阳知音公众号推文排版 3 篇，跟老师去江滩拍短视频，完成 1 条 45 秒粗剪。",
  "occurred_at": "2026-10-24",
  "status": "submitted",
  "visibility": "private"
}
```

抽取条目：

```json
[
  {
    "item_type": "achievement",
    "title": "完成 3 篇公众号推文排版",
    "skills": ["秀米排版"],
    "tools": ["秀米"],
    "quantified_result": {"value": 3, "unit": "篇"},
    "evidence": "参与汉阳知音公众号推文排版 3 篇",
    "confidence": 0.93,
    "user_confirmed": false
  },
  {
    "item_type": "skill",
    "title": "短视频粗剪",
    "skills": ["剪映", "短视频剪辑"],
    "quantified_result": {"value": 1, "unit": "条"},
    "evidence": "完成 1 条 45 秒粗剪",
    "confidence": 0.88,
    "user_confirmed": false
  }
]
```

画像：

```json
{
  "headline": "网传大三，偏融媒体内容生产",
  "summary": "有公众号排版和短视频粗剪经验，正在积累独立采写能力。",
  "target_direction": "融媒体 / 新媒体采编",
  "skills": [
    {"name": "公众号排版", "level": "熟练", "evidence_item_ids": ["item_01", "item_02", "item_03"]},
    {"name": "短视频剪辑", "level": "入门", "evidence_item_ids": ["item_04"]}
  ],
  "version": 3
}
```

## 4. 索引建议

- `records(user_id, occurred_at)`
- `record_items(user_id, item_type)`
- `record_items(record_id)`
- `extraction_jobs(record_id, status)`
- `profiles(user_id)`
- `profile_snapshots(user_id, version)`

## 5. 隐私边界

- 个人记录和画像默认只有本人可读。
- 教师端只能读取匿名聚合数据，不能读取 `records.raw_text`。
- 调用外部模型前，姓名、学号、单位中的敏感信息先脱敏。
- 删除记录时，关联的抽取条目和画像需要重新计算，不能留下孤儿数据。
