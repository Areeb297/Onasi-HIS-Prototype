/**
 * Opens the Onasi AI chat from anywhere in the app. The chat lives in the floating button at the bottom right,
 * so a page that wants to ask a question sends it here and the button's panel opens with that question.
 */
type Listener = (question?: string) => void;
const listeners = new Set<Listener>();

export function openAssistant(question?: string) {
  listeners.forEach((l) => l(question));
}

export function onOpenAssistant(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
