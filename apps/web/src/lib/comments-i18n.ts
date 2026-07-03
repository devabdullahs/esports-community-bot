import type { Locale } from "@/lib/i18n";

// Feature-local copy for the comments UI (English + Arabic), kept beside the
// feature. Wording is polished for both locales.
export type CommentsCopy = {
  title: string;
  postLike: string;
  postLiked: string;
  empty: string;
  loadError: string;
  signInToComment: string;
  signIn: string;
  joinToComment: string;
  verifyToComment: string;
  joinDiscord: string;
  composerPlaceholder: string;
  replyPlaceholder: string;
  send: string;
  sending: string;
  reply: string;
  cancel: string;
  edit: string;
  save: string;
  saving: string;
  remove: string;
  removeConfirm: string;
  removeDialogDescription: string;
  removeSuccess: string;
  pending: string;
  pendingHint: string;
  removed: string;
  edited: string;
  like: string;
  replyingTo: string;
  showReplies: (n: number) => string;
  // Reporting
  report: string;
  reportTitle: string;
  reportDescription: string;
  reportReasonLabel: string;
  reportDetailLabel: string;
  reportDetailPlaceholder: string;
  reportSubmit: string;
  reportSubmitting: string;
  reportSuccess: string;
  reportHeldSuccess: string;
  reportAlreadyReported: string;
  reasons: { spam: string; harassment: string; hate: string; sexual: string; other: string };
  // Moderator inline controls
  reportedCount: (n: number) => string;
  statusHidden: string;
  statusRejected: string;
  statusPending: string;
  modApprove: string;
  modHide: string;
  modRestore: string;
  modDelete: string;
  modActioned: string;
};

export const commentsCopy: Record<Locale, CommentsCopy> = {
  en: {
    title: "Comments",
    postLike: "Like",
    postLiked: "Liked",
    empty: "No comments yet — be the first to comment.",
    loadError: "Could not load comments. Please try again.",
    signInToComment: "Sign in with Discord to join the conversation.",
    signIn: "Sign in",
    joinToComment: "Join our Discord community to comment.",
    verifyToComment: "You need the verified-member role in our Discord to comment.",
    joinDiscord: "Join Discord",
    composerPlaceholder: "Share your thoughts…",
    replyPlaceholder: "Write a reply…",
    send: "Comment",
    sending: "Posting…",
    reply: "Reply",
    cancel: "Cancel",
    edit: "Edit",
    save: "Save",
    saving: "Saving…",
    remove: "Delete",
    removeConfirm: "Delete this comment?",
    removeDialogDescription: "This removes the comment from the public thread. Replies stay visible.",
    removeSuccess: "Comment deleted successfully.",
    pending: "Pending review",
    pendingHint: "Only you can see this until a moderator approves it.",
    removed: "This comment was removed.",
    edited: "edited",
    like: "Like",
    replyingTo: "Replying",
    showReplies: (n) => `${n} ${n === 1 ? "reply" : "replies"}`,
    report: "Report",
    reportTitle: "Report this comment",
    reportDescription: "Tell the moderators what's wrong. Reports are private.",
    reportReasonLabel: "Reason",
    reportDetailLabel: "Details (optional)",
    reportDetailPlaceholder: "Add anything that helps the moderators…",
    reportSubmit: "Submit report",
    reportSubmitting: "Submitting…",
    reportSuccess: "Thanks — the moderators will review this.",
    reportHeldSuccess: "Thanks — this comment has been hidden pending review.",
    reportAlreadyReported: "You've already reported this comment.",
    reasons: {
      spam: "Spam or scam",
      harassment: "Harassment or bullying",
      hate: "Hate speech or violence",
      sexual: "Sexual or inappropriate",
      other: "Something else",
    },
    reportedCount: (n) => `${n} ${n === 1 ? "report" : "reports"}`,
    statusHidden: "Hidden",
    statusRejected: "Rejected",
    statusPending: "Pending",
    modApprove: "Approve",
    modHide: "Hide",
    modRestore: "Restore",
    modDelete: "Delete",
    modActioned: "Done.",
  },
  ar: {
    title: "التعليقات",
    postLike: "إعجاب",
    postLiked: "أعجبني",
    empty: "لا توجد تعليقات بعد — كن أول من يعلّق.",
    loadError: "تعذّر تحميل التعليقات. حاول مرة أخرى.",
    signInToComment: "سجّل الدخول عبر ديسكورد للمشاركة في النقاش.",
    signIn: "تسجيل الدخول",
    joinToComment: "انضم إلى مجتمعنا على ديسكورد للتعليق.",
    verifyToComment: "تحتاج إلى رتبة العضو الموثّق في ديسكورد لكي تعلّق.",
    joinDiscord: "انضم إلى ديسكورد",
    composerPlaceholder: "شاركنا رأيك…",
    replyPlaceholder: "اكتب ردًا…",
    send: "تعليق",
    sending: "جارٍ النشر…",
    reply: "رد",
    cancel: "إلغاء",
    edit: "تعديل",
    save: "حفظ",
    saving: "جارٍ الحفظ…",
    remove: "حذف",
    removeConfirm: "هل تريد حذف هذا التعليق؟",
    removeDialogDescription: "سيتم إزالة التعليق من النقاش العام، وستبقى الردود ظاهرة.",
    removeSuccess: "تم حذف التعليق بنجاح.",
    pending: "قيد المراجعة",
    pendingHint: "لا يراه غيرك حتى يوافق عليه المشرف.",
    removed: "تم حذف هذا التعليق.",
    edited: "مُعدّل",
    like: "إعجاب",
    replyingTo: "ردًا على",
    showReplies: (n) => `${n} ${n === 1 ? "رد" : "ردود"}`,
    report: "إبلاغ",
    reportTitle: "الإبلاغ عن هذا التعليق",
    reportDescription: "أخبر المشرفين بالمشكلة. تبقى البلاغات خاصة.",
    reportReasonLabel: "السبب",
    reportDetailLabel: "تفاصيل (اختياري)",
    reportDetailPlaceholder: "أضف ما يساعد المشرفين…",
    reportSubmit: "إرسال البلاغ",
    reportSubmitting: "جارٍ الإرسال…",
    reportSuccess: "شكرًا — سيراجع المشرفون هذا التعليق.",
    reportHeldSuccess: "شكرًا — تم إخفاء التعليق بانتظار المراجعة.",
    reportAlreadyReported: "لقد أبلغت عن هذا التعليق مسبقًا.",
    reasons: {
      spam: "رسائل مزعجة أو احتيال",
      harassment: "تحرّش أو تنمّر",
      hate: "خطاب كراهية أو عنف",
      sexual: "محتوى جنسي أو غير لائق",
      other: "سبب آخر",
    },
    reportedCount: (n) => `${n} ${n === 1 ? "بلاغ" : "بلاغات"}`,
    statusHidden: "مخفي",
    statusRejected: "مرفوض",
    statusPending: "قيد المراجعة",
    modApprove: "اعتماد",
    modHide: "إخفاء",
    modRestore: "استعادة",
    modDelete: "حذف",
    modActioned: "تم.",
  },
};
