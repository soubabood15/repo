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

تحديث CDR وKPI بدون Queue Connector:
- أضف UCM_API_BASE_URL وUCM_CDR_MODE وCLOUDFLARE_CDR_ENDPOINT إلى ملف ucm.env كما في القالب.
- شغّل 05-BACKFILL-KPI.bat وأدخل تاريخ البداية والنهاية.

للإيقاف والإزالة:
- شغّل 04-UNINSTALL.bat كمسؤول.
- ملف الإعدادات والسجلات يبقيان محلياً في:
  C:\ProgramData\Newtel\UcmConnector

المهمة تعمل تلقائياً عند Startup باسم NewtelUcmQueueConnector، وتعيد التشغيل بعد الفشل.
