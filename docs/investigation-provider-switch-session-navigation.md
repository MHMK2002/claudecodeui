# گزارش بررسی Session اشتباه Claude پس از تغییر Provider

تاریخ: 2026-08-16

## نتیجه

انتخاب `Codex · Personal` در مسیر fork گم نشده است. سیستم Session مقصد را درست با این مقادیر ساخته است:

- `provider = codex`
- `provider_profile_id = 3` که در دیتابیس همان profile با عنوان `Personal` است
- `model = gpt-5.6-sol`

Session اضافی Claude از مرحلهٔ داخلی انتقال context می‌آید. `forkSession` برای خلاصه‌کردن گفت‌وگوی قبلی، Claude Agent SDK را با مدل Haiku اجرا می‌کند. چون query گزینهٔ `persistSession: false` ندارد، SDK به‌صورت پیش‌فرض transcript این کار داخلی را در `~/.claude/projects` ذخیره می‌کند. watcher برنامه آن JSONL را مثل یک گفت‌وگوی واقعی کاربر ایندکس و به sidebar broadcast می‌کند.

بنابراین دو Session ساخته می‌شوند:

1. Session واقعی مقصد با Codex Personal؛
2. Session شبح Claude/Haiku متعلق به summarizer داخلی.

این regression با commit `32e4a65` در تاریخ 2026-08-10 وارد شده است؛ همان commit فایل
`fork-context.service.ts` و فراخوانی SDK بدون غیرفعال‌کردن persistence را اضافه کرده است.

## شواهد runtime

در دیتابیس فعال `~/.cloudcli/auth.db` دو رکورد هم‌زمان دیده شد:

| زمان ایجاد | Session | Provider | Profile | Model |
| --- | --- | --- | --- | --- |
| 2026-08-16 12:44:55 | `a270328d-…` | `codex` | `3 / Personal` | `gpt-5.6-sol` |
| 2026-08-16 12:44:56.958Z | `5787cb9e-…` | `claude` | `null` | `null` |

رکورد Claude به فایل زیر اشاره می‌کند:

```text
~/.claude/projects/-Users-mhmk-Archive-Self-claudecodeui/5787cb9e-….jsonl
```

metadata همان JSONL نشان می‌دهد:

- فقط یک prompt کاربر دارد؛
- مدل assistant برابر `claude-haiku-4-5-20251001` است؛
- cwd همان پروژهٔ فعلی است؛
- Session یک top-level Claude session است، نه subagent.

متن assistant این JSONL با `fork_context` ذخیره‌شده روی Session واقعی Codex تطابق بایت‌به‌بایت دارد:

```text
storedLength      = 2264
sdkSummaryLength  = 2264
exactMatch        = true
SHA-256           = 0bdae4dad64315d597d201a9848ed81104234fac268b82e3a9b200279dbdbb34
```

این تطابق ثابت می‌کند Session Claude همان اجرای داخلی summarizer است.

## Trace

### 1. انتخاب Codex Personal

`ComposerProviderMenu` مقدار `provider = codex` و شناسهٔ profile انتخاب‌شده را به `handleSelectComposerProvider` می‌دهد.

`resolveValidSelection` Provider را به Provider دیگری fallback نمی‌کند؛ خروجی آن همان Provider ورودی است:

- `src/shared/hooks/useProviderSelectionCatalog.ts:269`
- `src/components/chat/view/ChatInterface.tsx:544`

### 2. ساخت Session صحیح Codex

برای Session موجود، frontend درخواست fork را با انتخاب کامل مقصد می‌فرستد:

```ts
api.forkSession(openSessionId, {
  provider: targetSelection.provider,
  providerProfileId: targetSelection.providerProfileId,
  model: targetSelection.model,
  carryContext: true,
});
```

- `src/components/chat/view/ChatInterface.tsx:594`

`createAppSession` همین سه مقدار را بدون تغییر در یک INSERT ذخیره می‌کند:

- `server/modules/providers/services/sessions.service.ts:347`
- `server/modules/database/repositories/sessions.db.ts:296`

### 3. اجرای summarizer داخلی Claude

پس از ساخت row مقصد، `forkSession` history قبلی را می‌خواند و `buildForkContext` را صدا می‌زند:

- `server/modules/providers/services/sessions.service.ts:445`
- `server/modules/providers/services/sessions.service.ts:457`

`summarizeWithClaude` یک query با `model = haiku`، prompt حاوی transcript و cwd پروژه اجرا می‌کند، اما persistence را خاموش نمی‌کند:

- `server/modules/providers/services/fork-context.service.ts:178`

نسخهٔ نصب‌شدهٔ `@anthropic-ai/claude-agent-sdk` گزینهٔ `persistSession?: boolean` را دارد و صریحاً می‌گوید مقدار پیش‌فرض `true` است و در `~/.claude/projects` می‌نویسد.

### 4. تبدیل transcript داخلی به Session واقعی UI

Claude SDK فایل JSONL را می‌نویسد. watcher هر JSONL top-level را به synchronizer می‌دهد:

- `server/modules/providers/services/sessions-watcher.service.ts:249`

`ClaudeSessionSynchronizer.synchronizeFile` برای فایل ناشناخته branch یا marker داخلی پیدا نمی‌کند و مستقیماً `sessionsDb.createSession(..., 'claude', ...)` را اجرا می‌کند:

- `server/modules/providers/list/claude/claude-session-synchronizer.provider.ts:134`
- `server/modules/providers/list/claude/claude-session-synchronizer.provider.ts:242`

سپس watcher یک event از نوع `session_upserted` broadcast می‌کند؛ در نتیجه Session شبح فوراً در sidebar دیده می‌شود.

### 5. تفکیک navigation از Session شبح

پس از پاسخ موفق fork، frontend عمداً `onNavigateToSession(newSessionId)` را اجرا می‌کند. `newSessionId`
از پاسخ `forkSession` می‌آید و متعلق به همان row مقصد Codex است. event مربوط به Session شبح فقط یک
sidebar upsert است؛ در رکورد runtime آن نیز `provider_session_id` با `session_id` برابر است، بنابراین مسیر
alias-navigation مربوط به watcher فعال نمی‌شود.

پس رفتن به صفحهٔ Session تازه، رفتار فعلی و صریح provider switch است؛ bug این است که هم‌زمان یک Session
داخلی Claude نیز در فهرست Sessionهای کاربر ظاهر می‌شود، نه اینکه پاسخ fork انتخاب Codex را به Claude تبدیل کند.

## فرضیه‌ها

1. **fallback شدن انتخاب Codex به Claude در frontend** — رد شد؛ resolver Provider ورودی را حفظ می‌کند.
2. **ذخیره‌شدن Provider اشتباه در INSERT مقصد** — رد شد؛ رکورد واقعی مقصد `codex / Personal / gpt-5.6-sol` است.
3. **ایندکس‌شدن اجرای داخلی Claude summarizer** — تأیید قطعی شد؛ زمان، مدل Haiku، مسیر JSONL و تطابق کامل خروجی با `fork_context` همگی یکسان‌اند.

## راه‌حل حداقلی اعمال‌شده

در options مربوط به query خلاصه‌ساز اضافه شد:

```ts
persistSession: false,
```

این گزینه در `summarizeWithClaude` کنار `settingSources: []` قرار گرفت. این اصلاح:

- مانع نوشته‌شدن JSONL داخلی در `~/.claude/projects` می‌شود؛
- در نتیجه watcher چیزی برای ایندکس‌کردن ندارد؛
- خروجی summary و `fork_context` را تغییر نمی‌دهد؛
- مدل داده، route، fork و Session واقعی Codex را دست نمی‌زند.

برای regression test، dependency مربوط به `query` با همان الگوی factory سرویس‌ها injectable شد تا تست
بدون credential یا network، options را capture کند و این دو مورد را ثابت کند:

1. `persistSession === false` به SDK ارسال می‌شود؛
2. متن assistant همچنان به‌عنوان summary برگردانده می‌شود.

تست موجود `forkSession with an explicit cross-provider target...` از قبل ثابت می‌کند target selection برابر
`codex / profile 3 / model انتخابی` در پاسخ و دیتابیس باقی می‌ماند و حفظ شده است.

## وضعیت اصلاح

فیکس در `server/modules/providers/services/fork-context.service.ts` اعمال شد و query خلاصه‌ساز اکنون
`persistSession: false` می‌فرستد. سرویس با یک factory کوچک تست‌پذیر شد و تست رگرسیون زیر اضافه شد:

- `server/modules/providers/tests/fork-context.service.test.ts`

چرخهٔ RED/GREEN ثبت شد: تست قبل از فیکس با `actual = undefined` و `expected = false` شکست خورد و پس از
فیکس پاس شد. verification نهایی:

- تست‌های مرتبط: `16/16` پاس؛
- کل تست‌های server: `471/471` پاس؛
- TypeScript typecheck: پاس؛
- server build: پاس؛
- lint فایل‌های تغییرکرده: بدون issue؛
- lint کامل repository: صفر error و ۱۹۳ warning خارج از فایل‌های این فیکس.

## اثرهای جانبی

- Session summarizer دیگر قابل resume نخواهد بود؛ این مطلوب است چون یک کار داخلی و یک‌بارمصرف است.
- Sessionهای شبحی که قبلاً ساخته شده‌اند خودکار حذف نمی‌شوند. حذف row و JSONL موجود نیازمند عملیات cleanup جداگانه و تأیید صریح کاربر است.
- رفتار فعلیِ «تغییر Provider در Session موجود یعنی ساخت fork و navigation» مستقل از این bug باقی می‌ماند.

## محدوده

کد خلاصه‌ساز و تست رگرسیون آن تغییر کرده‌اند. هیچ دیتابیس، Session یا transcript موجود پاک نشده و هیچ
commit، branch یا push انجام نشده است.
