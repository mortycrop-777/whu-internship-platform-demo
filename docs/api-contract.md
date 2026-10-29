# API 契约 v0.1

> Base URL：`/api/v1`  
> 状态：草案，随产品想法迭代。所有接口默认返回 JSON。

## 0. 通用约定

### 认证

请求头：`Authorization: Bearer <token>`

### 成功响应

```json
{ "ok": true, "data": {} }
```

### 失败响应

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "raw_text 不能为空",
    "details": {}
  }
}
```

常用错误码：`AUTH_REQUIRED`、`FORBIDDEN`、`NOT_FOUND`、`VALIDATION_ERROR`、`RATE_LIMITED`、`AI_TIMEOUT`、`AI_FAILED`。

### 分页

请求：`?page=1&page_size=20`  
响应：`{ "items": [], "page": 1, "page_size": 20, "total": 0 }`

### 异步任务

AI 抽取和个性化生成都返回任务，不阻塞请求：

```json
{ "job_id": "job_123", "status": "queued" }
```

状态：`queued` / `processing` / `succeeded` / `failed`

### 学生名单导入

教师批量导入本届学生名单时采用“先预览、后确认”的两步流程。文件为 UTF-8 CSV 或 Excel，必填列：`学号`、`姓名`、`身份证号`。

`POST /teacher/cohorts/{cohort_id}/student-imports/preview`

请求：`multipart/form-data`，字段 `file`。响应返回原始行数、可导入行数、错误行数，以及只含脱敏身份证号的行级校验结果。

`POST /teacher/cohorts/{cohort_id}/student-imports`

请求体传入 `preview_id` 和 `confirm=true`。服务端再次执行唯一性校验，在事务中写入学生、账号和届次成员关系，并更新 `cohorts.expected_count`。

响应 `202`：

```json
{
  "job_id": "import_001",
  "cohort_id": "cohort_2026_fall",
  "status": "queued"
}
```

`GET /teacher/cohort-imports/{import_id}`

返回导入状态、成功创建账号数、跳过数和失败明细。身份证号不得出现在响应、日志或错误消息中。

账号规则：

- 登录账号为学号。
- 初始密码为身份证号后六位，服务端只保存密码哈希。
- `must_change_password=true`，首次登录强制改密。
- 同一学号或身份证号重复时整行拒绝并返回明确错误。
- 应实习人数以去重后的有效导入人数为准。

## 1. 认证

### POST /auth/login

```json
{ "role": "student", "account": "2023xxxx", "password": "******" }
```

响应：

```json
{
  "token": "jwt...",
  "user": { "id": "u_01", "display_name": "李明", "role": "student" }
}
```

### GET /me

返回当前用户与隐私设置。

### POST /auth/logout

使当前 token 失效。

## 2. 个人记录

### POST /records

创建一条记录，同时触发 AI 抽取。

```json
{
  "type": "weekly_report",
  "title": "第 6 周实习周报",
  "raw_text": "本周参与公众号推文排版 3 篇……",
  "occurred_at": "2026-10-24",
  "attachments": [],
  "client_request_id": "client_abc_001"
}
```

响应 `201`：

```json
{
  "record": { "id": "rec_001", "status": "submitted" },
  "extraction_job": { "id": "job_001", "status": "queued" }
}
```

`client_request_id` 用于幂等，重复提交返回同一条记录。

### GET /records

查询自己的记录，支持 `type`、`status`、`page`、`page_size`。

### GET /records/{record_id}

返回记录详情、抽取条目和附件。

### PATCH /records/{record_id}

修改标题、原文、发生时间；修改原文后需要重新抽取。

### DELETE /records/{record_id}

删除记录，并触发画像重算。

## 3. AI 抽取

### POST /records/{record_id}/extract

手动重新触发抽取。若已有 `queued/processing` 任务，返回原任务。

响应 `202`：

```json
{ "job_id": "job_001", "status": "queued" }
```

### GET /extraction-jobs/{job_id}

```json
{
  "id": "job_001",
  "status": "succeeded",
  "items": [
    {
      "id": "item_01",
      "item_type": "achievement",
      "title": "完成 3 篇公众号推文排版",
      "skills": ["秀米排版"],
      "quantified_result": {"value": 3, "unit": "篇"},
      "evidence": "参与公众号推文排版 3 篇",
      "confidence": 0.93,
      "user_confirmed": false
    }
  ]
}
```

### PATCH /record-items/{item_id}

用户修改抽取结果，例如修正技能、量化结果或标题。

### POST /record-items/{item_id}/confirm

用户确认该条目进入画像。

### DELETE /record-items/{item_id}

删除错误的抽取条目。

## 4. 个人画像

### GET /profile

```json
{
  "headline": "网传大三，偏融媒体内容生产",
  "summary": "有公众号排版和短视频粗剪经验……",
  "target_direction": "融媒体 / 新媒体采编",
  "skills": [
    {"name": "公众号排版", "level": "熟练", "evidence_item_ids": ["item_01"]}
  ],
  "strengths": ["内容排版", "现场拍摄"],
  "version": 3,
  "updated_at": "2026-10-29T10:00:00+08:00"
}
```

### POST /profile/rebuild

根据已确认的 `record_items` 重建画像，返回异步任务。

### GET /profile/snapshots

返回画像历史版本列表。

### GET /profile/snapshots/{version}

返回某个版本的完整画像。

## 5. 个性化输出

### POST /outputs/generate

```json
{
  "type": "internship_summary",
  "record_range": "all",
  "tone": "professional",
  "length": "medium"
}
```

类型：`internship_summary` / `resume_points` / `interview_story`

响应 `202`：

```json
{ "output_id": "out_001", "status": "queued" }
```

### GET /outputs/{output_id}

```json
{
  "id": "out_001",
  "status": "succeeded",
  "content": "在汉阳区融媒体中心的实习中……",
  "citations": ["item_01", "item_04"],
  "generated_at": "2026-10-29T10:05:00+08:00"
}
```

### PATCH /outputs/{output_id}

用户编辑生成结果，保留原始 AI 版本和用户编辑版本。

## 6. 现有模块（沿用 Demo）

### POST /ask

```json
{ "question": "汉阳区融媒体中心实习都做什么？" }
```

响应：

```json
{
  "answer": "……",
  "sources": [{"id": 1, "title": "……", "url": "……"}],
  "not_found": false
}
```

### GET /stats

教师端聚合统计，只返回匿名数据，k ≥ 5。

## 6.1 周报列表与评价

### GET /reports

教师周报列表，支持 `status`、`q`、`page`、`page_size`。

```json
{
  "items": [
    {
      "id": "rep_001",
      "student": "李明",
      "week": "第 6 周",
      "unit": "汉阳区融媒体中心",
      "submitted_at": "2026-10-28T21:40:00+08:00",
      "status": "待评价",
      "total_score": null
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 4
}
```

列表中的 `total_score` 在待评价时为 `null`，评价完成后返回系统自动计算的分数。

### GET /reports/{report_id}

返回周报全文：`content`、`reflection`、`next_plan`、`status`、提交时间。

### POST /reports/{report_id}/evaluation

```json
{
  "level": "特别优秀",
  "tags": ["创新报告", "被摘录报告"],
  "late": false,
  "comment": "本周产出清晰，继续保持。"
}
```

服务端自动计算：`6 + 等级加分 + 创新 0.25 + 被摘录 0.15 - 延交 1`。响应返回 `total_score`。

提交后 `reports.status` 变为 `已评价`。重复提交视为更新评价。

## 6.2 教师数据看板

### GET /teacher/dashboard/placement/summary

参数：`term`（如 `2026-fall`）。

返回：

```json
{
  "term": "2026-fall",
  "should_intern": 236,
  "confirmed": 198,
  "pending": 38,
  "placement_rate": 0.839,
  "partners": 42,
  "status_breakdown": {
    "confirmed": 198,
    "reviewing": 16,
    "submitted": 10,
    "not_submitted": 12
  },
  "unit_distribution": [
    { "type": "省级媒体", "count": 68 },
    { "type": "央媒", "count": 52 },
    { "type": "商业媒体", "count": 44 },
    { "type": "企业", "count": 34 }
  ],
  "risks": [
    { "type": "not_submitted", "count": 12 },
    { "type": "conflict", "count": 5 },
    { "type": "capacity_shortage", "count": 3 }
  ]
}
```

`unit_distribution` 可直接用于环形图；`placement_type` 分布可另加 `college` / `self` 两个字段。

### GET /teacher/dashboard/placement/students

参数：`term`、`status`、`page`、`page_size`。返回需要跟进的学生列表（含姓名，仅教师可见）。每项包含 `placement_type`（学院安排 / 自己投递）、`intended_unit`、`status`（含“待结果”）。

### GET /teacher/dashboard/placement/timeline

参数：`term`。返回教师可编辑的时间轴节点。

### PATCH /teacher/dashboard/placement/timeline

```json
{
  "term": "2026-fall",
  "milestones": [
    {"date": "2026-12-01", "label": "开始投递"},
    {"date": "2027-02-15", "label": "开始实习"},
    {"date": "2027-06-30", "label": "结束实习"}
  ]
}
```

仅教师可编辑；保存后更新 `placement_timelines.updated_by`。

### GET /placement/timeline

学生端和教师端共用，参数：`term`。学生只读；教师通过上面的 PATCH 接口编辑。

### GET /teacher/dashboard/questions

参数：`range=30d`。返回学生问题看板的聚合数据：总提问数、已回答、未命中、趋势、高频问题、内容缺口和行动建议。

权限：实习落实看板允许教师看到学生姓名用于跟进；学生问题看板只返回匿名聚合数据（k ≥ 5）。

### GET /teacher/challenges

教师端查看企业岗位与报名情况，返回岗位、名额、报名人数和报录比。

```json
{
  "items": [
    {
      "id": "job_01",
      "company": "新华社新媒体",
      "title": "新媒体编辑",
      "city": "北京",
      "quota": 3,
      "applicant_count": 8,
      "ratio": 2.7,
      "status": "在招"
    }
  ]
}
```

### GET /teacher/challenges/{job_id}/applicants

返回报名学生列表：姓名、年级、报名时间、状态。教师只读，录用仍由企业操作。

## 6.3 志愿填报与附件

### POST /uploads/presign

```json
{
  "filename": "李明-简历.pdf",
  "mime_type": "application/pdf",
  "size": 286000,
  "purpose": "resume"
}
```

响应返回 `upload_url` 和 `file_id`，前端直接 PUT 到对象存储，不经过应用服务器。

### POST /applications

```json
{
  "term": "2026-fall",
  "first_choice": "unit_01",
  "second_choice": "unit_02",
  "position": "新媒体采编",
  "adjust": true,
  "reason": "……",
  "attachment_ids": ["file_01", "file_02"]
}
```

约束：

- 简历：`resume`，PDF / DOC / DOCX，≤10MB，必须上传。
- 作品集：`portfolio`，PDF / ZIP / JPG / PNG，≤20MB，最多 3 个。
- 文件只存对象存储，数据库存元数据和访问权限；上传后做病毒扫描。
- 附件默认私有，学生本人可读；教师仅在申请审核范围内可读。

### GET /applications/{application_id}

返回申请详情与附件列表（附件只返回 `file_id` 和短期签名访问地址）。

### DELETE /applications/{application_id}/attachments/{attachment_id}

学生可在提交前删除附件；提交后如需替换，应创建新的申请版本。

## 6.4 实习开始时间

### POST /internships

学生第一次点击“开启实习生活”时创建。

```json
{ "start_date": "2026-10-29" }
```

响应返回 `id`、`start_date`、`expected_end_date`、`status`。一个学生同一学期只能创建一条。

### GET /internships/me

返回自己的实习记录和 `start_edit_count`。

### PATCH /internships/{internship_id}

```json
{
  "start_date": "2026-10-25",
  "expected_end_date": "2027-03-18"
}
```

规则：

- 开始日期和预计结束日期均可修改，不限次数。
- `start_edit_count` 仍递增，仅用于审计。
- 教师端 `GET /teacher/students` 返回 `internship_start_date`，用于学生台账展示。
- `GET /teacher/students` 支持组合查询参数：`q`（学生姓名）、`class_name`、`unit`、`status`。

### GET/PUT /students/me/profile

学生个人信息：姓名、班级、实习单位、单位部门、实习导师、导师联系方式、居住地址、紧急联系人、紧急联系人电话。保存后教师端实习卡片读取同一份数据。

### GET /teacher/students/{student_id}/internship-card

教师查看学生实习卡片，字段与学生个人信息一致，并附实习起止日期。

## 7. 周报 AI 摘要

### POST /reports/{report_id}/summary

为周报生成约 150 字摘要，异步执行。

```json
{ "job_id": "sumjob_001", "status": "queued" }
```

### GET /reports/{report_id}/summary

未生成时返回：

```json
{ "status": "not_generated", "summary": null }
```

已生成时返回：

```json
{
  "status": "succeeded",
  "summary": "本周在汉阳区融媒体中心完成公众号推文排版 3 篇……",
  "generated_by": "ai",
  "generated_at": "2026-10-29T14:20:00+08:00",
  "source_hash": "sha256:...",
  "version": 1
}
```

**生成策略（按需生成）**

1. 教师从列表进入周报详情页，前端先 `GET /reports/{report_id}/summary`；列表页不触发摘要生成。
2. 如果返回 `not_generated`，再调用 `POST /reports/{report_id}/summary` 触发异步生成。
3. 前端显示骨架屏，轮询任务或摘要状态；成功后缓存。
4. 同一份周报、同一 `source_hash` 已成功生成时，后续打开直接返回缓存，不再调用模型。
5. 如果该周报已有 `queued/processing` 任务，`POST` 返回原任务，避免重复调用。
6. 不做“全部周报预生成”；批量生成只能由教师显式触发。
7. 前端成功状态只展示摘要正文，不显示“重新生成/编辑”；只有 `status = failed` 时显示「重新生成」。`PATCH` 编辑接口保留为后台能力，当前 UI 不暴露。

### GET /reports/{report_id}/evaluation

学生查看已评价周报的教师评分与评语。仅 `status = 已评价` 时可读。
返回 `level`、`tags`、`total_score` 和 `comment`，学生端用颜色标注特别优秀 / 优秀 / 合格。

### POST /uploads/presign（周报图片/附件）

`purpose` 使用 `report_image` 或 `report_file`；周报正文支持富文本，图片和附件通过对象存储直传，数据库保存元数据。

### POST /records/from-chat

学生端经验问答里的「实习记录」对话模式使用：把用户输入的实习成果转为个人记录。

```json
{ "message": "本周完成 3 篇推文排版和 1 条短视频粗剪" }
```

响应触发 `extraction_job`，抽取项目、任务、技能和成果；用户确认后写入 `records` 与 `record_items`。

### PATCH /reports/{report_id}/summary

教师编辑摘要，保存为 `generated_by: manual` 的新版本。

```json
{ "summary": "教师修改后的摘要……" }
```

### POST /reports/{report_id}/summary/regenerate

强制重新生成；不覆盖人工编辑版本，生成新版本。

### GET /summary-jobs/{job_id}

返回 `queued / processing / succeeded / failed` 和失败原因。

### POST /reports/summaries/batch

批量生成待评价周报的摘要。

```json
{ "report_ids": ["rep_001", "rep_002"] }
```

规则：同一 `report_id + source_hash` 已成功生成时直接复用；周报原文变更后 `source_hash` 不一致，摘要标记为过期并提示重新生成。教师只能操作自己权限范围内的周报。

## 8. 权限矩阵

| 资源 | 学生 | 教师 | 企业 |
|---|---|---|---|
| 个人记录 | 本人读写 | 不可读原文 | 不可读 |
| 抽取条目 | 本人读写 | 不可读 | 不可读 |
| 个人画像 | 本人读写 | 不可读 | 不可读 |
| 教师看板 | 不可读 | 匿名聚合 | 不可读 |
| 岗位/揭榜 | 可读可申请 | 可读 | 本人企业可读写 |
| 实习评分 | 可读本人 | 可读聚合 | 本人企业可写 |
| 实习时间轴 | 可读 | 可读可编辑 | 不可读 |
| 企业岗位 / 揭榜报名 | 可读可申请 | 可读 | 本人企业可读写 |
| 实习开始时间 | 本人读写（仅可改一次） | 可读 | 不可读 |

## 9. 待确认

- 学生数据能否调用公网模型；不能则需本地模型。
- 教师是否需要查看某个学生的画像（需要学生授权）。
- 个性化总结是否允许导出为 Word/PDF。
- 画像重建是实时还是每天定时。
