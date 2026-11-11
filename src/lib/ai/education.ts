/** Patient education leaflets in simple English. Four topics also have a short Arabic version. */

export interface Leaflet {
  id: string;
  title: string;
  keys: string[];
  en: string[];
  /** Short Arabic summary. A qualified person must check it before it is given to a patient. */
  ar?: { title: string; text: string };
}

export const LEAFLETS: Leaflet[] = [
  {
    id: "fever", title: "Fever", keys: ["fever", "temperature", "pyrexia"],
    en: [
      "A fever means your body temperature is 38 C or higher. It is often your body fighting an infection.",
      "What you can do: rest, drink plenty of fluids, wear light clothes, and take a fever medicine as your doctor told you.",
      "Go to a doctor or the emergency department right away if: the fever is above 39 C, you have trouble breathing, a stiff neck, a fit, confusion, or a rash that does not fade, or the fever lasts more than 3 days.",
    ],
    ar: { title: "الحمى", text: "الحمى هي ارتفاع درجة حرارة الجسم. اشرب كثيرا من السوائل، وارتح، وتناول خافض الحرارة حسب توجيه الطبيب. راجع الطبيب فورا إذا زادت الحرارة عن 39 درجة، أو ظهر ضيق في التنفس، أو تشنج، أو استمرت الحمى أكثر من 3 أيام." },
  },
  {
    id: "diabetes", title: "Diabetes", keys: ["diabetes", "blood sugar", "glucose", "hyperglyc"],
    en: [
      "Diabetes means there is too much sugar in your blood. It can harm your eyes, kidneys, nerves and heart over time.",
      "What you can do: take your medicine every day, eat less sugar and white bread or rice, walk for 30 minutes most days, and check your sugar as your doctor told you.",
      "Go to the emergency department if: you feel very thirsty, very sleepy or confused, you vomit and cannot keep fluids down, or your sugar is very high or very low.",
    ],
    ar: { title: "السكري", text: "السكري هو ارتفاع السكر في الدم. التزم بأدويتك، وقلل السكريات والنشويات، وامش 30 دقيقة يوميا، وافحص السكر حسب توجيه الطبيب. راجع الطوارئ عند العطش الشديد أو النعاس أو التشوش أو القيء المستمر." },
  },
  {
    id: "hypertension", title: "High Blood Pressure", keys: ["hypertension", "blood pressure"],
    en: [
      "High blood pressure often has no signs, but it can cause a stroke or heart attack over time.",
      "What you can do: take your medicine every day even if you feel well, eat less salt, stay active, do not smoke, and check your pressure as your doctor told you.",
      "Call the emergency number if: you have chest pain, a sudden weak face or arm, trouble speaking, or a very bad headache.",
    ],
    ar: { title: "ارتفاع ضغط الدم", text: "خذ دواءك كل يوم حتى لو شعرت أنك بخير. قلل الملح، وامش بانتظام، وتوقف عن التدخين. اطلب الطوارئ عند ألم الصدر أو ضعف مفاجئ في الوجه أو الذراع أو صعوبة في الكلام." },
  },
  {
    id: "asthma", title: "Asthma", keys: ["asthma", "wheez", "inhaler"],
    en: [
      "Asthma makes the airways narrow. You may cough, wheeze, or feel short of breath.",
      "What you can do: use your reliever inhaler when you wheeze or feel short of breath, use your daily preventer inhaler every day, and stay away from smoke and dust.",
      "Go to the emergency department if: the reliever does not help, it is hard to talk, or your lips look blue.",
    ],
    ar: { title: "الربو", text: "استخدم بخاخ الإنقاذ عند ضيق النفس أو الصفير، واستخدم بخاخ الوقاية يوميا كما وصفه الطبيب. ابتعد عن الدخان والغبار. اطلب الطوارئ إذا لم يتحسن التنفس بعد البخاخ أو أصبح الكلام صعبا." },
  },
  {
    id: "pneumonia", title: "Pneumonia", keys: ["pneumonia", "chest infection", "cough"],
    en: [
      "Pneumonia is an infection of the lungs. You may have a cough, fever, and feel short of breath.",
      "What you can do: finish all your medicine, rest, drink plenty of fluids, and do not smoke.",
      "Go back to the hospital if: your breathing gets worse, you have chest pain, you feel confused, or the fever comes back after it went away.",
    ],
  },
  {
    id: "gastro", title: "Stomach Infection (Gastroenteritis)", keys: ["gastroenteritis", "diarrhea", "diarrhoea", "vomiting"],
    en: [
      "A stomach infection causes diarrhoea and vomiting. It usually gets better in a few days.",
      "What you can do: drink small sips of fluid often, use oral rehydration salts, eat light food when you can, and wash your hands well.",
      "See a doctor if: you cannot keep fluids down, there is blood in the stool, you feel very weak or dizzy, you pass very little urine, or it lasts more than 3 days.",
    ],
  },
  {
    id: "wound", title: "Wound Care After Surgery", keys: ["surgery", "wound", "operation", "appendic", "arthroplasty", "fracture"],
    en: [
      "Keep the wound clean and dry. Wash your hands before you touch the dressing.",
      "Take your pain medicine as your doctor told you. Move gently as the physiotherapist showed you.",
      "See a doctor if: the wound is red, hot, swollen or leaking, the pain gets worse, or you have a fever.",
    ],
  },
  {
    id: "chest-pain", title: "Chest Pain", keys: ["chest pain", "angina", "myocardial", "heart"],
    en: [
      "Chest pain can come from the heart, lungs, muscles or stomach. Some causes are serious.",
      "What you can do: rest, take the medicine your doctor gave you, and follow your follow-up plan.",
      "Call the emergency number right away if: the pain is heavy or spreads to your arm or jaw, you sweat, feel sick or faint, or are short of breath.",
    ],
  },
];

export function pickLeaflet(text: string): Leaflet {
  const t = text.toLowerCase();
  return LEAFLETS.find((l) => l.keys.some((k) => t.includes(k))) ?? LEAFLETS[0];
}

export function renderLeaflet(l: Leaflet, patientFirstName: string, arabic: boolean): string {
  if (arabic && l.ar) return `${l.ar.title}\n\n${l.ar.text}\n\n(نسخة مختصرة. يجب أن يراجعها مختص قبل تسليمها للمريض.)`;
  return [`${l.title}: what you need to know`, `For: ${patientFirstName}`, "", ...l.en.flatMap((p) => [p, ""]), "Ask your doctor or nurse if you have any questions."].join("\n").trim();
}
