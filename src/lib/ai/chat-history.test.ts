import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AGENTS } from "./agents";
import { answer, topicOf, type Answer } from "./assistant";
import { ABOUT_QUESTIONS, chatDate, chatTopics, fixedAnswer, forStorage, loadChats, MAX_CHATS, putChat, removeChat, saveChats, searchChats, titleOf, type SavedChat } from "./chat-history";

const ans = (text: string): Answer => ({ agent: null, text, items: [], followUps: [], sources: [] });
const chat = (id: string, at: string, question: string): SavedChat => ({ id, title: titleOf(question), at, turns: [{ id: 1, at, question, answer: ans("ok") }] });

describe("Onasi AI chat history", () => {
  // The tests run without a browser: a small stand-in for its storage.
  beforeEach(() => {
    const data = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
    };
  });
  afterAll(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });

  it("names a chat after its first question, shortened", () => {
    expect(titleOf("  Who can go   home today? ")).toBe("Who can go home today?");
    expect(titleOf("x".repeat(80))).toHaveLength(60);
    expect(titleOf(" ")).toBe("New chat");
  });

  it("keeps chats newest first, replaces a chat by id and caps the list", () => {
    let list: SavedChat[] = [];
    list = putChat(list, chat("a", "2026-11-14T09:00:00Z", "Who can go home today?"));
    list = putChat(list, chat("b", "2026-11-15T09:00:00Z", "Write the shift handoff."));
    expect(list.map((c) => c.id)).toEqual(["b", "a"]);
    list = putChat(list, { ...chat("a", "2026-11-15T10:00:00Z", "Who can go home today?") });
    expect(list.map((c) => c.id)).toEqual(["a", "b"]);
    for (let i = 0; i < MAX_CHATS + 5; i++) list = putChat(list, chat(`n${i}`, `2026-11-16T10:${String(i).padStart(2, "0")}:00Z`, `Question ${i}`));
    expect(list).toHaveLength(MAX_CHATS);
    expect(removeChat(list, list[0].id)).toHaveLength(MAX_CHATS - 1);
  });

  it("keeps each user's chats apart in the browser", () => {
    saveChats("U1", [chat("a", "2026-11-15T09:00:00Z", "Who can go home today?")]);
    expect(loadChats("U1")).toHaveLength(1);
    expect(loadChats("U2")).toEqual([]);
    localStorage.setItem("onasi-ai-chats-v1:U3", "not json");
    expect(loadChats("U3")).toEqual([]);
  });

  it("does not keep the action buttons of a finding", () => {
    const a: Answer = { ...ans("One item."), items: [{ id: "p1", level: "high", patient: "Saad Almutairi", visit: "V100001", text: "Notify the doctor", why: "Critical potassium", action: { kind: "notify", label: "Notify", to: "Dr. Khalid Alharbi", message: "Critical result" } }] };
    expect(forStorage(a).items[0]).not.toHaveProperty("action");
    expect(putChat([], { id: "a", title: "t", at: "2026-11-15T09:00:00Z", turns: [{ id: 1, at: "2026-11-15T09:00:00Z", question: "q", answer: a }] })[0].turns[0].answer.items[0]).not.toHaveProperty("action");
    expect(a.items[0].action).toBeDefined(); // the live answer is not touched
  });

  it("searches titles and questions", () => {
    const list = [chat("a", "2026-11-15T09:00:00Z", "Who can go home today?"), chat("b", "2026-11-15T10:00:00Z", "Write the shift handoff.")];
    expect(searchChats(list, "HANDOFF").map((c) => c.id)).toEqual(["b"]);
    expect(searchChats(list, " ")).toHaveLength(2);
    expect(searchChats(list, "potassium")).toEqual([]);
  });

  it("writes the date in plain words", () => {
    const now = new Date(2026, 10, 15, 14, 0);
    expect(chatDate(new Date(2026, 10, 15, 9, 5).toISOString(), now)).toBe("Today, 09:05");
    expect(chatDate(new Date(2026, 10, 14, 23, 30).toISOString(), now)).toBe("Yesterday, 23:30");
    expect(chatDate(new Date(2026, 10, 2, 8, 0).toISOString(), now)).toBe("2 Nov 2026");
  });

  it("offers one topic per agent that is on, and every question reaches that agent", () => {
    const topics = chatTopics();
    expect(topics.map((t) => t.id)).toEqual([...AGENTS.map((a) => a.id), "about"]);
    for (const t of topics.filter((x) => x.agent)) {
      expect(t.questions.length).toBeGreaterThan(1);
      for (const { q } of t.questions) {
        expect(topicOf(q), q).toBe(t.agent);
        expect(answer(q).agent).toBe(t.agent);
      }
    }
    expect(topics.at(-1)!.questions).toHaveLength(ABOUT_QUESTIONS.length);
    expect(fixedAnswer("No.")).toMatchObject({ agent: null, text: "No.", items: [], followUps: [] });
  });
});
