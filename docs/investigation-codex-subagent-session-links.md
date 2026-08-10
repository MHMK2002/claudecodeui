# گزارش بررسی و اصلاح نمایش ساب‌ایجنت Codex

تاریخ: 2026-08-05

## نتیجه

دو شناسهٔ بررسی‌شده دو سشن اصلی نیستند:

- `15bc044f-b823-4134-a9db-e55be069edee` سشن اصلی است.
- `019fd211-5e53-70f3-b183-20f5f9ff4033` transcript ساب‌ایجنت `dispatch / Erdos` با `parent_session_id` برابر شناسهٔ سشن اصلی است.

ساب‌ایجنت برای نگه‌داری transcript یک ردیف داخلی در جدول `sessions` دارد، اما در مدل UI دیگر به‌عنوان سشن مستقل انتخاب نمی‌شود. هیچ migration یا تغییری در مدل persistence انجام نشد.

## مشکل

پیش از اصلاح، کلیک روی agent یا بازکردن `/session/:childId` همان child row را وارد مسیر عادی انتخاب سشن می‌کرد. در نتیجه URL و بخشی از state ظاهری، ساب‌ایجنت را شبیه یک سشن مستقل نشان می‌دادند. در refresh مستقیم نیز چون child عمداً از فهرست top-level حذف شده است، route resolver نمی‌توانست پروژه و والد آن را پیدا کند.

یک مسیر دوم نیز در پیگیری 2026-08-06 مشخص شد: file watcher بعد از ساخته‌شدن rollout جدید، برای child row یک event عمومی `session_upserted` می‌فرستاد. کلاینت این delta را مطابق قرارداد event مستقیماً وارد `project.sessions` می‌کرد؛ بنابراین ساب‌ایجنت تازه تا refresh بعدی موقتاً مثل سشن مستقل ظاهر می‌شد، با اینکه queryهای دیتابیس آن را درست فیلتر می‌کردند.

علت اصلی ناسازگاری بین این دو قرارداد بود:

1. backend، child را transcript وابسته به والد نگه می‌داشت و از فهرست سشن‌های اصلی حذف می‌کرد.
2. frontend فقط route مستقل `/session/:sessionId` و انتخاب یک `ProjectSession` را برای نمایش transcript می‌شناخت.

## راه‌حل اجراشده

- route canonical ساب‌ایجنت به شکل زیر اضافه شد:

  ```text
  /session/:parentSessionId/subagent/:subagentSessionId
  ```

- لینک قدیمی child، یعنی `/session/019fd211-...`، با metadata واقعی session به route والد‌محور redirect می‌شود.
- endpoint جدید `GET /api/providers/sessions/:sessionId` هویت canonical، پروژه و `parentSessionId` را برای حل deep-link برمی‌گرداند.
- در route جدید، سشن والد selected باقی می‌ماند و فقط transcript نمایش‌داده‌شده به child تغییر می‌کند.
- ردیف والد و ردیف agent highlight مستقل دارند.
- عنوان header نام agent (`Erdos`) را نشان می‌دهد و زیر آن نام سشن والد/پروژه حفظ می‌شود.
- transcript agent read-only است؛ composer و actionهای مستقل session نمایش داده نمی‌شوند.
- Back به `/session/:parentSessionId` برمی‌گردد و composer والد دوباره ظاهر می‌شود.
- شناسهٔ child نامعتبر یا child متعلق به والد دیگر، وضعیت not-found نشان می‌دهد و composer والد را در همان route آشکار نمی‌کند.
- درخواست‌های async در تغییر route/unmount بی‌اثر می‌شوند تا پاسخ قدیمی state مسیر جدید را overwrite نکند.
- event زندهٔ فایل child دیگر با شناسهٔ child منتشر نمی‌شود؛ watcher آن را به upsert سشن والد تبدیل می‌کند و `agentCount` به‌روز والد را می‌فرستد. بنابراین child وارد collection سشن‌های اصلی نمی‌شود و sidebar آن را زیر والد بارگذاری می‌کند.

برای نمونه‌های گزارش‌شده، URL canonical برابر است با:

```text
/session/15bc044f-b823-4134-a9db-e55be069edee/subagent/019fd211-5e53-70f3-b183-20f5f9ff4033
```

## قرارداد داده

- `/api/projects`، recent، archive و search همچنان فقط سشن‌های top-level را برمی‌گردانند.
- `/api/providers/sessions/:parentId/subagents` transcriptهای child همان والد را برمی‌گرداند.
- frontend پیش از نمایش transcript، تطابق هم‌زمان `parentSessionId` و `subagentSessionId` را بررسی می‌کند.
- child row فقط جزئیات persistence و history-loading است و به `selectedSession` مستقل تبدیل نمی‌شود.

## پوشش تست

- تشخیص root در برابر subagent و پاسخ 404 برای session ناشناخته در service.
- ساخت URL parent-scoped و encode شدن شناسه‌ها.
- رد کردن child ناموجود یا child متعلق به والد دیگر.
- بررسی مرورگری redirect لینک قدیمی، navigation از sidebar، highlight والد/agent، نبود composer، بازگشت به والد و route نامعتبر.
- تست RED→GREEN مسیر watcher: پیش از اصلاح event برای `agent-session` تولید می‌شد؛ پس از اصلاح همان تغییر، `parent-session` را با `agentCount = 1` upsert می‌کند.

## محدوده

تغییرات موجود export/fork که از قبل در worktree بودند حفظ شدند و بخشی از این اصلاح محسوب نمی‌شوند. هیچ commit، branch، rebase یا push انجام نشد.
