Newtel UCM Queue Connector - Windows
====================================

هذه حزمة مستقلة ولا تحتوي نظام eBook أو قاعدة بيانات أو أسرار.

المتطلبات:
- جهاز Windows داخل شبكة الشركة.
- اتصال إلى UCM وإلى الإنترنت.
- Node.js LTS مثبت على الجهاز.
- اترك هذا المجلد في مكان دائم ولا تنقله بعد التثبيت.

التشغيل:
1. فك ZIP في C:\Newtel-UCM-Connector
2. اضغط بالزر اليمين على 01-SETUP.bat واختر Run as administrator.
3. املأ ملف الإعدادات الذي يفتح محلياً واحفظه. لا ترسله ولا ترفعه إلى Git.
4. اضغط بالزر اليمين على 02-INSTALL.bat واختر Run as administrator.
5. شغّل 03-STATUS.bat للتحقق.

تحديث v5: تثبيت شهادة Queue Connector ببصمة SHA-256
- لا تغيّر إعدادات UCM، ولا تستبدل كلمات السر الحالية.
- أوقف المهمة، ثم استبدل ملفات الحزمة في نفس المجلد؛ الإعدادات تبقى في ProgramData.
- إذا كانت شهادة CA غير متاحة، أضف UCM_TLS_FINGERPRINT_SHA256 إلى ucm.env.
- يجب تأكيد البصمة مع مسؤول UCM عبر قناة موثوقة، وليس اعتمادها تلقائياً من الشبكة.
- استخدم اسم مضيف مطابقاً للشهادة في UCM_WS_URL وUCM_WS_ORIGIN.
- 06-CHECK-CONNECTION.bat يفحص TLS وWebSocket فقط، بدون تسجيل دخول أو إرسال داتا.
- UPGRADE_OK لا يعني نجاح تسجيل الدخول؛ بعدها أعد تشغيل المهمة وافحص ucm_connected.
- تغيير شهادة UCM أو تجديدها يوقف الاتصال حتى تأكيد البصمة الجديدة وتحديثها.
- خيار البصمة يخص Queue Connector فقط، ولا يغيّر CDR أو اتصال Cloudflare.

تحديث CDR وKPI بدون Queue Connector:
- أضف UCM_API_BASE_URL وUCM_CDR_MODE وCLOUDFLARE_CDR_ENDPOINT إلى ملف ucm.env كما في القالب.
- شغّل 05-BACKFILL-KPI.bat وأدخل تاريخ البداية والنهاية.

للإيقاف والإزالة:
- شغّل 04-UNINSTALL.bat كمسؤول.
- ملف الإعدادات والسجلات يبقيان محلياً في:
  C:\ProgramData\Newtel\UcmConnector

المهمة تعمل تلقائياً عند Startup باسم NewtelUcmQueueConnector، وتعيد التشغيل بعد الفشل.
