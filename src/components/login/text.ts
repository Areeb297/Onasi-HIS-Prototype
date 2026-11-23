/**
 * Every string on the sign-in page (sign-in, Forgot Password and Contact Us), in English and Arabic.
 * Wording follows CT-HIS (CT-CoreApp dev.2.0, public/i18n/en.json and ar.json) where the HIS has the string.
 */
export type Lang = "en" | "ar";

const en = {
  // header
  site: "onasi.care",
  portfolio: "Portfolio",
  newTab: "opens in a new tab",
  other: "العربية",
  otherLabel: "التبديل إلى العربية",
  // brand panel
  headline: "Your hospital workspace",
  sub: "Appointments, patient records and care workflows",
  shifts: ["Morning shift", "Evening shift", "Night shift"],
  drag: "Drag to turn",
  sceneLabel: "3D hospital. Drag or use the arrow keys to turn it.",
  // sign in
  title: "Sign In to Onasi HIS",
  lead: "Use your hospital account to continue",
  email: "Provider Email",
  password: "Password",
  show: "Show password",
  hide: "Hide password",
  forgot: "Forgot Password?",
  submit: "Sign In",
  signingIn: "Signing In",
  caps: "Caps Lock is on",
  restricted: "For authorized hospital staff only. Sign-ins and record access are logged.",
  powered: "Powered by",
  // forgot password (/forgot-password)
  back: "Back to Sign In",
  forgotTitle: "Forgot Password?",
  forgotLead: "Enter your email address and we'll send you a link to reset your password.",
  emailAddress: "Email Address",
  emailPlaceholder: "Enter your email address",
  badEmail: "Please enter a valid email address",
  sendLink: "Send Reset Link",
  checkTitle: "Check Your Email",
  checkLead: (e: string) => `We sent a password reset link to ${e}.`,
  checkHint: "Didn't receive the email? Check your spam folder or try again.",
  needHelp: "Need help?",
  contactUs: "Contact Us",
  sending: "Sending...",
  // contact (#/contact), replaces the form on the same screen
  contactTitle: "Contact Us",
  contactLead: "Questions, support or a demo request. Our team will get back to you.",
  fullName: "Full Name",
  organization: "Hospital or Organization",
  phone: "Phone Number",
  products: "Interested In",
  productList: [
    ["HIS", "Hospital Information System"],
    ["DHIS", "Dental HIS"],
    ["HHIS", "Hajj Health System"],
    ["RCM", "Revenue Cycle"],
    ["Telemedicine", "Telemedicine"],
    ["Portal", "Patient Portal"],
    ["EMS", "Emergency Medical System"],
    ["Dashboard", "Dashboards"],
  ],
  message: "Message",
  messagePlaceholder: "How can we help?",
  required: "Required",
  optional: "Optional",
  send: "Send Message",
  cancel: "Cancel",
  sentTitle: "Message Sent",
  sentLead: (e: string) => `Thank you. Our team will reply to ${e}.`,
  // footer
  rights: (y: number) => `© ${y} Ebttikar. All rights reserved.`,
};

const ar: typeof en = {
  site: "onasi.care",
  portfolio: "معرض الأعمال",
  newTab: "يفتح في علامة تبويب جديدة",
  other: "English",
  otherLabel: "Switch to English",
  headline: "مساحة عمل مستشفاك",
  sub: "المواعيد والسجلات الطبية وإجراءات الرعاية",
  shifts: ["المناوبة الصباحية", "المناوبة المسائية", "المناوبة الليلية"],
  drag: "اسحب للتدوير",
  sceneLabel: "مستشفى ثلاثي الأبعاد. اسحب أو استخدم مفاتيح الأسهم لتدويره.",
  title: "تسجيل الدخول إلى Onasi HIS",
  lead: "استخدم حساب المستشفى للمتابعة",
  email: "البريد الإلكتروني",
  password: "كلمة المرور",
  show: "إظهار كلمة المرور",
  hide: "إخفاء كلمة المرور",
  forgot: "نسيت كلمة المرور؟",
  submit: "تسجيل الدخول",
  signingIn: "جارٍ تسجيل الدخول",
  caps: "مفتاح الأحرف الكبيرة مفعّل",
  restricted: "للموظفين المصرّح لهم فقط. يُسجَّل الدخول والاطلاع على السجلات.",
  powered: "بدعم من",
  back: "العودة إلى تسجيل الدخول",
  forgotTitle: "نسيت كلمة المرور؟",
  forgotLead: "أدخل بريدك الإلكتروني وسنرسل لك رابطًا لإعادة تعيين كلمة المرور.",
  emailAddress: "البريد الإلكتروني",
  emailPlaceholder: "أدخل بريدك الإلكتروني",
  badEmail: "أدخل بريدًا إلكترونيًا صحيحًا",
  sendLink: "إرسال رابط إعادة التعيين",
  checkTitle: "تحقق من بريدك الإلكتروني",
  checkLead: (e: string) => `أرسلنا رابط إعادة تعيين كلمة المرور إلى ${e}.`,
  checkHint: "لم يصلك البريد؟ تحقق من مجلد الرسائل غير المرغوب فيها أو حاول مرة أخرى.",
  needHelp: "تحتاج مساعدة؟",
  contactUs: "اتصل بنا",
  sending: "جاري الإرسال...",
  contactTitle: "اتصل بنا",
  contactLead: "للاستفسارات أو الدعم أو طلب عرض توضيحي، سيتواصل معك فريقنا.",
  fullName: "الاسم الكامل",
  organization: "المستشفى أو الجهة",
  phone: "رقم الهاتف",
  products: "مهتم بـ",
  productList: [
    ["HIS", "نظام معلومات المستشفى"],
    ["DHIS", "نظام طب الأسنان"],
    ["HHIS", "نظام صحة الحج"],
    ["RCM", "دورة الإيرادات"],
    ["Telemedicine", "الطب الاتصالي"],
    ["Portal", "بوابة المريض"],
    ["EMS", "نظام الطوارئ الطبية"],
    ["Dashboard", "لوحات المعلومات"],
  ],
  message: "الرسالة",
  messagePlaceholder: "كيف يمكننا مساعدتك؟",
  required: "مطلوب",
  optional: "اختياري",
  send: "إرسال الرسالة",
  cancel: "إلغاء",
  sentTitle: "تم إرسال الرسالة",
  sentLead: (e: string) => `شكرًا لك. سيرد فريقنا على ${e}.`,
  rights: (y: number) => `© ${y} ابتكار. جميع الحقوق محفوظة.`,
};

export const LOGIN_TEXT = { en, ar };
export type LoginText = typeof en;

/** The company sites, linked from the sign-in header. */
export const LINKS = {
  site: "https://onasi.care/",
  portfolio: "https://portfolio.onasi.care/",
};

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/** Text links on the public pages: brand green on light, cyan on dark, with a focus ring. */
export const linkClass =
  "rounded font-medium text-[#035d53] underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:text-[#39edd5]";

/** The one primary action on the public pages: Onasi Mint with Dark Green text (CT-HIS DESIGN.md). */
export const mintButton =
  "h-11 w-full border-transparent text-[15px] bg-[#0ce69f] text-[#032c26] hover:bg-[#0bd492] dark:bg-[#0ce69f] dark:text-[#032c26] dark:hover:bg-[#0bd492] focus-visible:ring-[#032c26] dark:focus-visible:ring-[#39edd5]";
