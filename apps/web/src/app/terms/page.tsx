import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "Terms of Service",
    description:
      "Terms for using the Esports Community Bot website, Discord bot, tournament tracking, news, and prediction features.",
    path: "/terms",
  });
}

const LAST_UPDATED = "2026-06-12";

const CONTENT = {
  en: {
    title: "Terms of Service",
    lastUpdated: `Last updated: ${LAST_UPDATED}`,
    sections: [
      {
        heading: "1. Service Description",
        body: [
          "Esports Community Bot is a free, non-commercial community project that provides a Discord bot and web dashboard for esports fans. The service includes live tournament tracking, bilingual community news (English and Arabic), a media directory, EWC prediction boards, public leaderboards, and Discord profile showcase sync.",
          "The service is provided at no charge and is operated as a hobby project by community volunteers. There are no paid tiers, advertisements, or monetised features.",
        ],
      },
      {
        heading: "2. Predictions — For Entertainment Only",
        body: [
          "The prediction system is a community entertainment feature only. Participants pick teams or club results each week and accumulate points on a public leaderboard.",
          "There are no monetary prizes, cash rewards, or anything of financial value associated with prediction scores or leaderboard standings. The platform does not facilitate, enable, or encourage betting or gambling of any kind. Predictions are purely for fun and community engagement.",
        ],
      },
      {
        heading: "3. Acceptable Use",
        body: [
          "You agree to use the service in a manner consistent with Discord's Terms of Service and Community Guidelines.",
          "You must not:",
        ],
        list: [
          "Attempt to exploit bugs, circumvent scoring logic, or manipulate leaderboard results through unauthorised means.",
          "Scrape, crawl, or automate requests to the web dashboard in ways that could degrade service availability.",
          "Use the service to harass, abuse, or harm other community members.",
          "Attempt to gain unauthorised access to admin areas or another member's profile.",
          "Misrepresent your identity or affiliation when interacting with community staff.",
        ],
      },
      {
        heading: "4. Content Responsibility",
        body: [
          "News posts, game page content, and media entries are written and published by community staff (admins and social managers) through the dashboard CMS. Staff are responsible for the accuracy and appropriateness of content they publish.",
          "Tournament data (schedules, results, standings) is sourced from Liquipedia and is used under the Creative Commons Attribution-ShareAlike 3.0 licence (CC-BY-SA 3.0). Liquipedia is credited in every match embed and leaderboard footer.",
          "This service is not affiliated with Discord, Inc., Liquipedia, the Esports World Cup Foundation, or any tournament organiser. Use of their names and marks is purely descriptive.",
        ],
      },
      {
        heading: "5. Availability Disclaimer",
        body: [
          'The service is provided "as is" and "as available" without warranties of any kind, express or implied. Operators make no guarantee of uptime, accuracy of scores, or continuity of any feature.',
          "The service may be changed, interrupted, or discontinued at any time without prior notice. Operators are not liable for any loss or inconvenience resulting from service disruption.",
        ],
      },
      {
        heading: "6. Termination",
        body: [
          "Operators and community administrators may suspend or permanently remove access for any account found to be abusing the service, violating these terms, or acting in a manner harmful to the community — without obligation to provide advance notice.",
        ],
      },
      {
        heading: "7. Third-Party Services",
        body: [
          "The service integrates with Discord (authentication, bot commands, and profile showcase) and Cloudflare (traffic proxying, TLS, and optional object storage for images). Your use of those platforms is also governed by their respective terms of service.",
          "Tournament data is sourced from Liquipedia under CC-BY-SA 3.0. The source code of this project is available on GitHub under the MIT licence.",
        ],
      },
      {
        heading: "8. Changes to These Terms",
        body: [
          "These terms may be updated from time to time. The date at the top of this page reflects the most recent revision. Continued use of the service after changes are posted constitutes acceptance of the revised terms.",
          "Significant changes will be announced in the community Discord server.",
        ],
      },
      {
        heading: "9. Contact",
        body: [
          "If you have questions about these terms, please reach out in the community Discord server or open an issue in the GitHub repository.",
        ],
      },
    ],
  },
  ar: {
    title: "شروط الخدمة",
    lastUpdated: `آخر تحديث: ${LAST_UPDATED}`,
    sections: [
      {
        heading: "١. وصف الخدمة",
        body: [
          "بوت مجتمع الرياضات الإلكترونية مشروع مجتمعي مجاني وغير تجاري يوفّر بوت ديسكورد ولوحة ويب لمحبّي الرياضات الإلكترونية. تشمل الخدمة متابعة البطولات المباشرة، وأخباراً مجتمعية ثنائية اللغة (العربية والإنجليزية)، ودليلاً إعلامياً، ولوحات توقعات EWC، وجداول صدارة عامة، ومزامنة عرض ملف ديسكورد.",
          "تُقدَّم الخدمة مجاناً وتُدار كمشروع هواية من قِبل متطوعي المجتمع. لا توجد اشتراكات مدفوعة أو إعلانات أو ميزات مموّلة.",
        ],
      },
      {
        heading: "٢. التوقعات — للترفيه فقط",
        body: [
          "نظام التوقعات ميزة ترفيهية مجتمعية بحتة. يختار المشاركون الفرق أو نتائج الأندية أسبوعياً ويتراكمون نقاطاً في جدول الصدارة العام.",
          "لا توجد جوائز مالية أو مكافآت نقدية أو أي قيمة مادية مرتبطة بنقاط التوقعات أو مراكز جدول الصدارة. لا تُسهّل المنصة أو تدعم المراهنة أو القمار بأي شكل من الأشكال. التوقعات للمتعة والتفاعل المجتمعي حصراً.",
        ],
      },
      {
        heading: "٣. الاستخدام المقبول",
        body: [
          "تتعهد باستخدام الخدمة بما يتوافق مع شروط خدمة ديسكورد وإرشادات مجتمعه.",
          "يُحظر عليك:",
        ],
        list: [
          "محاولة استغلال الثغرات أو التحايل على منطق الاحتساب أو التلاعب بنتائج الجدول بوسائل غير مصرّح بها.",
          "استخدام أدوات زحف أو أتمتة طلبات على لوحة الويب بطريقة قد تُضرّ بتوافر الخدمة.",
          "استخدام الخدمة لمضايقة أعضاء المجتمع أو إيذائهم.",
          "محاولة الوصول غير المصرّح به إلى مناطق المشرفين أو ملف عضو آخر.",
          "انتحال هوية أو انتماء مزيّف عند التواصل مع فريق المجتمع.",
        ],
      },
      {
        heading: "٤. مسؤولية المحتوى",
        body: [
          "تُكتب المنشورات الإخبارية ومحتوى صفحات الألعاب وقيود الوسائط وتُنشر من قِبل فريق المجتمع (المشرفين ومديري وسائل التواصل الاجتماعي) عبر نظام إدارة المحتوى في اللوحة. الفريق مسؤول عن دقة ومناسبة المحتوى الذي ينشرونه.",
          "بيانات البطولات (الجداول والنتائج والترتيب) مصدرها Liquipedia وتُستخدم بموجب رخصة المشاع الإبداعي النسب-الترخيص بالمثل 3.0 (CC-BY-SA 3.0). يُعزى الفضل لـ Liquipedia في كل تضمين للمباريات وتذييل جداول الصدارة.",
          "هذه الخدمة غير تابعة لشركة Discord أو Liquipedia أو مؤسسة كأس العالم للرياضات الإلكترونية أو أي جهة تنظيمية للبطولات.",
        ],
      },
      {
        heading: "٥. إخلاء مسؤولية التوافر",
        body: [
          'تُقدَّم الخدمة "كما هي" و"حسب التوافر" دون أي ضمانات صريحة أو ضمنية. لا يضمن المشغّلون وقت التشغيل أو دقة النتائج أو استمرارية أي ميزة.',
          "قد تتغير الخدمة أو تتعطل أو تُوقف في أي وقت دون إشعار مسبق. لا يتحمل المشغّلون المسؤولية عن أي خسارة أو إزعاج ناتج عن انقطاع الخدمة.",
        ],
      },
      {
        heading: "٦. إنهاء الوصول",
        body: [
          "يحق للمشغّلين ومشرفي المجتمع تعليق أو إلغاء وصول أي حساب يُثبت إساءته استخدام الخدمة أو انتهاكه لهذه الشروط أو تصرّفه بما يضر المجتمع — دون التزام بإشعار مسبق.",
        ],
      },
      {
        heading: "٧. الخدمات الخارجية",
        body: [
          "تتكامل الخدمة مع ديسكورد (المصادقة، وأوامر البوت، وعرض الملف الشخصي) وCloudflare (توجيه حركة المرور، وTLS، وتخزين الصور الاختياري). استخدامك لتلك المنصات يخضع أيضاً لشروط خدمتها الخاصة.",
          "بيانات البطولات مصدرها Liquipedia بموجب CC-BY-SA 3.0. الكود المصدري لهذا المشروع متاح على GitHub بموجب رخصة MIT.",
        ],
      },
      {
        heading: "٨. التعديلات على هذه الشروط",
        body: [
          "قد تُحدَّث هذه الشروط من وقت لآخر. يعكس التاريخ في أعلى هذه الصفحة آخر مراجعة. استمرار استخدام الخدمة بعد نشر التعديلات يُعدّ قبولاً للشروط المعدّلة.",
          "سيُعلن عن التعديلات الجوهرية في سيرفر ديسكورد المجتمعي.",
        ],
      },
      {
        heading: "٩. التواصل",
        body: [
          "إن كانت لديك أسئلة حول هذه الشروط، يرجى التواصل عبر سيرفر ديسكورد المجتمعي أو فتح طلب (issue) في مستودع GitHub.",
        ],
      },
    ],
  },
} as const;

export default async function TermsPage() {
  const locale = await getRequestLocale();
  const content = CONTENT[locale];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-5 py-10 sm:px-8">
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
          </section>
        ))}
      </div>
    </main>
  );
}
