/**
 * Every string on the public pages (Home with sign-in, Forgot Password, Contact), in English and Arabic.
 * Wording follows CT-HIS (CT-CoreApp dev.2.0, public/i18n/en.json and ar.json) where the HIS has the string.
 */
export type Lang = "en" | "ar";

const en = {
  // header
  home: "Home",
  contact: "Contact",
  other: "العربية",
  otherLabel: "التبديل إلى العربية",
  nav: "Main",
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
  // contact (/contact)
  supportTitle: "Support",
  contactTitle: "Contact Us",
  contactLead: "Reach out to our team for any questions or support you may need.",
  hours: "Support Hours",
  hoursValue: "Sunday to Thursday, 8 am to 8 pm",
  visit: "Visit Us",
  address: "8132 Prince Musaad Bin Abdulaziz St., As Sulimaniyah, Riyadh 12232",
  website: "Website",
  formTitle: "Send a Message",
  formLead: "Fill out the form below and we'll respond as soon as possible.",
  firstName: "First Name",
  lastName: "Last Name",
  phone: "Phone Number",
  message: "Your Message",
  messagePlaceholder: "How can we assist you today?",
  required: "Required",
  send: "Send Message",
  sending: "Sending...",
  sent: (e: string) => `Thank you. Our support team will reply to ${e}.`,
  // footer
  rights: (y: number) => `© ${y} Ebttikar. All rights reserved.`,
};

const ar: typeof en = {
  home: "الرئيسية",
  contact: "اتصل بنا",
  other: "English",
  otherLabel: "Switch to English",
  nav: "الرئيسية",
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
  supportTitle: "الدعم",
  contactTitle: "اتصل بنا",
  contactLead: "تواصل مع فريقنا لأي أسئلة أو دعم قد تحتاجه.",
  hours: "ساعات الدعم",
  hoursValue: "من الأحد إلى الخميس، 8 صباحًا إلى 8 مساءً",
  visit: "زرنا",
  address: "8132 شارع الأمير مساعد بن عبدالعزيز، السليمانية، الرياض 12232",
  website: "الموقع الإلكتروني",
  formTitle: "أرسل رسالة",
  formLead: "املأ النموذج أدناه وسنرد عليك في أقرب وقت ممكن.",
  firstName: "الاسم الأول",
  lastName: "اسم العائلة",
  phone: "رقم الهاتف",
  message: "رسالتك",
  messagePlaceholder: "كيف يمكننا مساعدتك اليوم؟",
  required: "مطلوب",
  send: "إرسال الرسالة",
  sending: "جاري الإرسال...",
  sent: (e: string) => `شكرًا لك. سيرد فريق الدعم على ${e}.`,
  rights: (y: number) => `© ${y} ابتكار. جميع الحقوق محفوظة.`,
};

export const LOGIN_TEXT = { en, ar };
export type LoginText = typeof en;

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/** Text links on the public pages: brand green on light, cyan on dark, with a focus ring. */
export const linkClass =
  "rounded font-medium text-[#035d53] underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:text-[#39edd5]";

/** The one primary action on the public pages: Onasi Mint with Dark Green text (CT-HIS DESIGN.md). */
export const mintButton =
  "h-11 w-full border-transparent text-[15px] bg-[#0ce69f] text-[#032c26] hover:bg-[#0bd492] dark:bg-[#0ce69f] dark:text-[#032c26] dark:hover:bg-[#0bd492] focus-visible:ring-[#032c26] dark:focus-visible:ring-[#39edd5]";
