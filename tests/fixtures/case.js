export const TEST_CASE = Object.freeze({
  id: "test-case",
  name: "Jordan Lee",
  start: "guarded",
  startLevel: 2,
  ladder: ["relaxed", "calm", "guarded", "anxious", "upset"],
  persona: "A guarded adult patient who speaks briefly.",
  facts: [
    { id: "onset", label: "The pain began after dinner last night.", keys: ["when", "start", "began"] },
    { id: "medicine", label: "Jordan took two antacid tablets without relief.", keys: ["medicine", "tablet", "take"] },
    { id: "fear", label: "Jordan fears needing surgery.", keys: ["worr", "afraid", "fear"] }
  ],
  offline: {
    greet: "Hello. I'm a little nervous.",
    say: {
      onset: "It began after dinner last night.",
      medicine: "I took two antacid tablets, but they didn't help.",
      fear: "I'm afraid I might need surgery."
    },
    vague: ["I'm not sure what you mean.", "Could you ask me another way?"],
    empathy: "Thank you. That helps me feel a little calmer.",
    jargon: "I don't understand that medical word."
  }
});

