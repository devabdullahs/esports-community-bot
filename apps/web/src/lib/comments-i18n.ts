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
  },
};
