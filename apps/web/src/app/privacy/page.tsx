import type { Metadata } from "next";
import { localizedPath, type Locale } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const META: Record<Locale, { title: string; description: string }> = {
  en: {
    title: "Privacy Policy",
    description:
      "Privacy details for Esports Community Bot accounts, Discord OAuth, prediction data, cookies, and dashboard usage.",
  },
  ar: {
    title: "سياسة الخصوصية",
    description:
      "تفاصيل الخصوصية لحسابات مجتمع الرياضات الإلكترونية، تسجيل الدخول عبر ديسكورد، بيانات التوقعات، الكوكيز، واستخدام لوحة التحكم.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const meta = META[locale];
  return buildPageMetadata({
    title: meta.title,
    description: meta.description,
    path: localizedPath("/privacy", locale),
    locale,
  });
}

const LAST_UPDATED = "2026-07-08";

const CONTENT = {
  en: {
    title: "Privacy Policy",
    lastUpdated: `Last updated: ${LAST_UPDATED}`,
    sections: [
      {
        heading: "1. Who We Are",
        body: [
          "Esports Community Bot is a free-to-use community project. The site may show curated sponsor or community partner recognition to help cover hosting, development, and future community events. There are no third-party ad networks, tracking pixels, or paid subscriptions, and personal data is not sold or traded.",
        ],
      },
      {
        heading: "2. Data Collected via Discord OAuth (Web Dashboard)",
        body: [
          "When you sign in to the web dashboard with Discord, the following data is collected and stored:",
        ],
        list: [
          "Discord user ID, display name, username, and profile avatar URL.",
          "Email address — collected from Discord's OAuth scope and stored as part of your account record.",
          "Discord OAuth access and refresh tokens — stored encrypted at rest (Better Auth's encryptOAuthTokens is enabled; see auth.ts).",
        ],
        after: [
          "Session records are created for each login, which include your IP address and browser user-agent string. These are stored in the better-auth session table.",
        ],
      },
      {
        heading: "3. Prediction Data",
        body: [
          "If you use the EWC prediction feature (via the /ewc_predict Discord command or the web dashboard), the following is stored:",
        ],
        list: [
          "Your Discord user ID linked to a prediction profile.",
          "Your weekly per-game team picks and season-long club picks.",
          "Your accumulated prediction scores and week-by-week history.",
        ],
        after: [
          "On public leaderboard pages, members are identified by a masked label (e.g., \"Member 1234\") derived from a partial Discord ID. Full Discord IDs are never published on public pages.",
        ],
      },
      {
        heading: "4. Admin Audit Log",
        body: [
          "Actions taken by community staff in the /admin dashboard CMS (publishing news, editing games, managing team rosters) are recorded in an audit log. This log is visible only to super-admin staff and is used for accountability within the moderation team.",
        ],
      },
      {
        heading: "5. Partner Inquiries",
        body: [
          "If you submit a partner inquiry, we store the organization name, contact name, email address, optional website URL, selected partnership interest, message, status, and timestamps. This data is used only to review the inquiry, contact you, and manage partner recognition if approved.",
          "Partner payments are handled outside the app through GitHub Sponsors or a private manual payment path. The app does not collect card or bank details.",
        ],
      },
      {
        heading: "6. Cookies and Local Preferences",
        body: [
          "The following cookies are set by this service:",
        ],
        list: [
          "ewc_locale — stores your language preference (English or Arabic). This is a first-party cookie with a one-year expiry.",
          "Better Auth session cookies — HttpOnly, with Secure flag enabled in production, used to maintain your login session.",
          "Anonymous website analytics IDs — browser-local random visitor and session IDs used to count daily, weekly, and monthly visitors and engagement on public pages.",
        ],
        after: [
          "The first-party analytics tracker records public page paths, anonymous visitor/session IDs, engagement seconds, browser user-agent, and country code from Cloudflare headers. Raw IP addresses are not stored in analytics events. No third-party tracking cookies, ad-network scripts, or third-party analytics scripts are used.",
        ],
      },
      {
        heading: "7. Image Uploads",
        body: [
          "Cover images for news posts are optionally uploaded to Cloudflare R2 object storage. Uploaded files are stored under a news/ key prefix. This storage is operated by the same community operators and is subject to Cloudflare's data processing terms.",
        ],
      },
      {
        heading: "8. Discord Profile Showcase (Role Connection)",
        body: [
          "If you use /ewc_predict link or the dashboard's Sync profile button, your prediction summary is pushed to Discord's Application Role Connection API. This allows your Discord profile to display your EWC prediction rank and points.",
          "This is a user-initiated action. You can remove the showcase at any time by using the Unlink button on your /me profile page or by running /ewc_predict unlink in Discord.",
        ],
      },
      {
        heading: "9. Infrastructure and Data Processors",
        body: [
          "All persistent data is stored in a managed PostgreSQL database hosted on cloud infrastructure in the MENA (Saudi Arabia) region. No third-party analytics or advertising service holds your data.",
          "Public web traffic is routed through Cloudflare, which provides TLS termination and DDoS protection. Cloudflare may process request metadata (IP addresses, headers) in accordance with its own privacy policy.",
          "The service does not share your personal data with any other third party beyond the processors listed here (Discord, the managed database host, Cloudflare, and GitHub Sponsors only if you choose to sponsor through GitHub).",
        ],
      },
      {
        heading: "10. Discord Bot Data",
        body: [
          "The Discord bot stores guild and channel configuration (which channels are designated for leaderboards, match cards, voice status, etc.). It tracks tournaments and match data sourced from Liquipedia (CC-BY-SA 3.0). Members' weekly and season prediction picks are stored as described above.",
          "The bot does not read, log, or store the content of any Discord messages. It only responds to explicit slash command interactions.",
        ],
      },
      {
        heading: "11. Data Retention",
        body: [
          "Account and prediction-link data is retained until you unlink your profile or request deletion. Partner inquiries are retained while they are being reviewed and for a reasonable recordkeeping period after follow-up. Session records are subject to Better Auth's default session expiry.",
          "To request deletion of your data, use the Unlink button on your /me profile page and then contact the community server administrators on Discord. They will remove remaining account records on request.",
        ],
      },
      {
        heading: "12. Minimum Age",
        body: [
          "Use of this service requires a Discord account. You must meet Discord's minimum age requirement (13 years old, or the higher minimum in your country where applicable) to use this service.",
        ],
      },
      {
        heading: "13. Changes to This Policy",
        body: [
          "This policy may be updated from time to time. The date at the top of this page reflects the most recent revision. Significant changes will be announced in the community Discord server.",
        ],
      },
      {
        heading: "14. Contact",
        body: [
          "For privacy-related questions or data deletion requests, contact the community server administrators on Discord or open an issue in the GitHub repository.",
        ],
      },
    ],
  },
  ar: {
    title: "سياسة الخصوصية",
    lastUpdated: `آخر تحديث: ${LAST_UPDATED}`,
    sections: [
      {
        heading: "١. من نحن",
        body: [
          "بوت مجتمع الرياضات الإلكترونية مشروع مجتمعي مجاني الاستخدام. قد يعرض الموقع ظهوراً منسقاً للرعاة أو شركاء المجتمع للمساعدة في تغطية الاستضافة والتطوير وفعاليات المجتمع المستقبلية. لا توجد شبكات إعلانية خارجية أو بكسلات تتبع أو اشتراكات مدفوعة، ولا تُباع البيانات الشخصية أو تُتداول.",
        ],
      },
      {
        heading: "٢. البيانات المجمّعة عبر OAuth لديسكورد (لوحة الويب)",
        body: [
          "عند تسجيل دخولك إلى لوحة الويب عبر ديسكورد، تُجمَّع البيانات التالية وتُخزَّن:",
        ],
        list: [
          "معرّف مستخدم ديسكورد، الاسم المعروض، اسم المستخدم، ورابط صورة الملف الشخصي.",
          "عنوان البريد الإلكتروني — يُجمَّع من نطاق OAuth لديسكورد ويُخزَّن ضمن سجل حسابك.",
          "رموز الوصول والتحديث OAuth لديسكورد — تُخزَّن مشفّرة في حالة السكون (خيار encryptOAuthTokens مفعّل في Better Auth).",
        ],
        after: [
          "تُنشأ سجلات جلسة لكل تسجيل دخول وتتضمن عنوان IP الخاص بك وسلسلة وكيل المتصفح (user-agent). تُخزَّن هذه السجلات في جدول الجلسات الخاص بـ Better Auth.",
        ],
      },
      {
        heading: "٣. بيانات التوقعات",
        body: [
          "إن استخدمت ميزة توقعات EWC (عبر أمر /ewc_predict في ديسكورد أو لوحة الويب)، تُخزَّن البيانات التالية:",
        ],
        list: [
          "معرّف ديسكورد الخاص بك مرتبطاً بملف توقعات.",
          "اختياراتك الأسبوعية للفرق لكل لعبة واختياراتك للأندية طوال الموسم.",
          "نقاط توقعاتك المتراكمة وسجل كل أسبوع.",
        ],
        after: [
          'في صفحات جدول الصدارة العامة، يُعرَّف الأعضاء بتسمية مموّهة (مثل "العضو ١٢٣٤") مشتقة من جزء من معرّف ديسكورد. لا تُنشر معرّفات ديسكورد الكاملة على الصفحات العامة أبداً.',
        ],
      },
      {
        heading: "٤. سجل التدقيق للمشرفين",
        body: [
          "الإجراءات التي يتخذها فريق المجتمع في لوحة /admin (نشر الأخبار، تعديل الألعاب، إدارة قائمة الفريق) تُسجَّل في سجل تدقيق. هذا السجل مرئي فقط للمشرفين الرئيسيين ويُستخدم لضمان المساءلة داخل فريق الإشراف.",
        ],
      },
      {
        heading: "٥. طلبات الشراكة",
        body: [
          "إذا أرسلت طلب شراكة، نخزن اسم الجهة واسم مسؤول التواصل والبريد الإلكتروني ورابط الموقع الاختياري ونوع الشراكة والرسالة والحالة والطوابع الزمنية. تُستخدم هذه البيانات فقط لمراجعة الطلب والتواصل معك وإدارة ظهور الشريك إذا تمت الموافقة.",
          "تتم مدفوعات الشركاء خارج التطبيق عبر GitHub Sponsors أو مسار دفع يدوي خاص. لا يجمع التطبيق بيانات البطاقات أو الحسابات البنكية.",
        ],
      },
      {
        heading: "٦. ملفات تعريف الارتباط والتفضيلات المحلية",
        body: [
          "تضع هذه الخدمة ملفات تعريف الارتباط التالية:",
        ],
        list: [
          "ewc_locale — يخزّن تفضيل اللغة (الإنجليزية أو العربية). ملف تعريف ارتباط من الطرف الأول بصلاحية سنة واحدة.",
          "ملفات تعريف ارتباط الجلسة لـ Better Auth — HttpOnly مع علامة Secure في الإنتاج، تُستخدم للحفاظ على جلسة تسجيل دخولك.",
          "معرّفات إحصائيات الموقع المجهولة — معرّف زائر ومعرّف جلسة عشوائيان داخل المتصفح لاحتساب الزوار يوميًا وأسبوعيًا وشهريًا ومدة التفاعل في الصفحات العامة.",
        ],
        after: [
          "يسجل التتبع الداخلي مسارات الصفحات العامة، ومعرّفات الزائر والجلسة المجهولة، وثواني التفاعل، ووكيل المتصفح، ورمز الدولة من ترويسات Cloudflare. لا يتم تخزين عناوين IP في أحداث الإحصائيات، ولا تُستخدم ملفات تعريف ارتباط تتبع أو سكريبتات شبكات إعلانية أو تحليلات خارجية.",
        ],
      },
      {
        heading: "٧. رفع الصور",
        body: [
          "تُرفع صور الغلاف للمنشورات الإخبارية اختيارياً إلى تخزين الكائنات Cloudflare R2. تُخزَّن الملفات المرفوعة تحت بادئة news/. يُدار هذا التخزين من قِبل مشغّلي المجتمع ذاتهم ويخضع لشروط معالجة البيانات لدى Cloudflare.",
        ],
      },
      {
        heading: "٨. عرض ملف ديسكورد الشخصي (ربط الأدوار)",
        body: [
          "إن استخدمت /ewc_predict link أو زر \"مزامنة الملف\" في اللوحة، يُرسَل ملخص توقعاتك إلى واجهة Application Role Connection في ديسكورد. يتيح ذلك لملفك الشخصي على ديسكورد عرض رتبة ونقاط توقعات EWC.",
          "هذا إجراء يبادر به المستخدم. يمكنك إزالة العرض في أي وقت عبر زر \"فصل الربط\" في صفحة ملفك /me أو بتشغيل /ewc_predict unlink في ديسكورد.",
        ],
      },
      {
        heading: "٩. البنية التحتية ومعالجو البيانات",
        body: [
          "تُخزَّن جميع البيانات الدائمة في قاعدة بيانات PostgreSQL مُدارة على بنية تحتية سحابية في منطقة الشرق الأوسط وشمال أفريقيا (المملكة العربية السعودية). لا تحتفظ أي خدمة تحليلات أو إعلانات خارجية ببياناتك.",
          "تمر حركة مرور الويب العامة عبر Cloudflare الذي يوفّر إنهاء TLS والحماية من هجمات DDoS. قد تعالج Cloudflare بيانات تعريف الطلبات (عناوين IP والرؤوس) وفق سياسة خصوصيتها.",
          "لا تشارك الخدمة بياناتك الشخصية مع أي طرف ثالث آخر غير المعالجين المذكورين هنا (ديسكورد، ومضيف قاعدة البيانات المُدارة، وCloudflare، وGitHub Sponsors فقط إذا اخترت الرعاية عبر GitHub).",
        ],
      },
      {
        heading: "١٠. بيانات بوت ديسكورد",
        body: [
          "يخزّن بوت ديسكورد إعدادات السيرفر والقنوات (القنوات المخصصة لجداول الصدارة وبطاقات المباريات وحالة القناة الصوتية وما إلى ذلك). كما يتتبع البطولات وبيانات المباريات المصدرة من Liquipedia (CC-BY-SA 3.0). تُخزَّن اختيارات توقعات الأعضاء الأسبوعية والموسمية كما هو موضح أعلاه.",
          "لا يقرأ البوت محتوى رسائل ديسكورد ولا يسجّلها ولا يخزّنها. يستجيب فقط للتفاعلات الصريحة عبر أوامر الشرطة المائلة (slash commands).",
        ],
      },
      {
        heading: "١١. مدة الاحتفاظ بالبيانات",
        body: [
          "تُحتفَظ ببيانات الحساب والربط بالملف الشخصي إلى حين فصل ربط ملفك أو طلب الحذف. تُحتفظ طلبات الشراكة أثناء المراجعة ولمدة معقولة بعد المتابعة لأغراض السجلات. تخضع سجلات الجلسات لانتهاء صلاحية الجلسة الافتراضية في Better Auth.",
          "لطلب حذف بياناتك، استخدم زر \"فصل الربط\" في صفحة ملفك /me ثم تواصل مع مشرفي سيرفر المجتمع على ديسكورد. سيقومون بحذف سجلات الحساب المتبقية بناءً على طلبك.",
        ],
      },
      {
        heading: "١٢. الحد الأدنى للعمر",
        body: [
          "يستلزم استخدام هذه الخدمة امتلاك حساب ديسكورد. يجب أن تستوفي متطلب الحد الأدنى للعمر لدى ديسكورد (13 عاماً، أو الحد الأعلى في بلدك حيثما ينطبق) لاستخدام هذه الخدمة.",
        ],
      },
      {
        heading: "١٣. التعديلات على هذه السياسة",
        body: [
          "قد تُحدَّث هذه السياسة من وقت لآخر. يعكس التاريخ في أعلى هذه الصفحة آخر مراجعة. سيُعلن عن التعديلات الجوهرية في سيرفر ديسكورد المجتمعي.",
        ],
      },
      {
        heading: "١٤. التواصل",
        body: [
          "للاستفسارات المتعلقة بالخصوصية أو طلبات حذف البيانات، تواصل مع مشرفي سيرفر المجتمع على ديسكورد أو افتح طلباً (issue) في مستودع GitHub.",
        ],
      },
    ],
  },
} as const;

export default async function PrivacyPage() {
  const locale = await getRequestLocale();
  const content = CONTENT[locale];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{content.title}</h1>
        <p className="text-sm text-muted-foreground">{content.lastUpdated}</p>
      </div>
      <div className="flex flex-col gap-8">
        {content.sections.map((section) => (
          <section key={section.heading} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{section.heading}</h2>
            {section.body.map((paragraph, i) => (
              <p key={i} className="text-sm leading-7 text-muted-foreground">
                {paragraph}
              </p>
            ))}
            {"list" in section && section.list ? (
              <ul className="list-disc ps-5 flex flex-col gap-1.5">
                {section.list.map((item, i) => (
                  <li key={i} className="text-sm leading-6 text-muted-foreground">
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
            {"after" in section && section.after
              ? section.after.map((paragraph, i) => (
                  <p key={`after-${i}`} className="text-sm leading-7 text-muted-foreground">
                    {paragraph}
                  </p>
                ))
              : null}
          </section>
        ))}
      </div>
    </main>
  );
}
