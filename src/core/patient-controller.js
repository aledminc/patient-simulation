const JARGON = [
  "hypertension", "hypotension", "orthostatic", "vertigo", "syncope", "glucose",
  "a1c", "hba1c", "etiology", "idiopathic", "prn", "bid", "tid", "metformin",
  "glycemic", "hyperglycemia", "cholecyst", "biliary", "palpation", "edema",
  "ligament", "inversion", "nsaid", "contraindicat", "prognosis", "renal",
  "epigastric", "ruq"
];
const EMPATHY = /(sorry|understand|must be|sounds (like|really|hard|frustrating|scary|stressful|worrying)|that'?s (hard|tough|understandable|frustrating)|take your time|thank you for (telling|sharing|waiting)|appreciate|no rush|i hear you)/i;
const DISMISSIVE = /(calm down|just relax|don'?t worry about it|it'?s nothing|hurry|quickly|we don'?t have time)/i;
const OPEN = /^(so,?\s*)?(how|what|tell me|can you (tell|describe|walk)|could you (tell|describe|walk)|why|describe|walk me|in what way)/i;
const GREETING = /\b(hi|hello|good (morning|afternoon|evening)|my name is)\b/i;
const INJECTION = /(ignore (all |the |your )?(previous|prior|patient|system|rules|instructions)|system prompt|developer message|reveal (all|every|hidden)|act as (an? )?(assistant|doctor|clinician)|you are (chatgpt|an ai)|print (your|the) prompt|jailbreak)/i;
const DIAGNOSIS_REQUEST = /(hidden diagnosis|secret diagnosis|what is (my|your|the) diagnosis|do (i|you) have [a-z]|tell me the diagnosis|diagnose (me|yourself))/i;
const ROLE_BREAK = /(\b(ai|language model|system prompt|response plan|authorized facts?)\b|\bas (a|an) (doctor|clinician|assistant)\b)/i;
const STOP_WORDS = new Set(["about", "after", "again", "because", "before", "being", "could", "does", "from", "have", "into", "just", "little", "maybe", "really", "since", "something", "their", "there", "these", "they", "this", "those", "through", "very", "what", "when", "where", "which", "while", "with", "would", "your"]);
const SAFE_PHRASING_WORDS = new Set(["actually", "guess", "honestly", "mean", "pretty", "quite", "suppose", "well"]);

function cleanText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function significantTokens(value) {
  return [...new Set(cleanText(value).toLowerCase().match(/[a-z0-9']{4,}/g) || [])]
    .filter(token => !STOP_WORDS.has(token));
}

function spokenFact(caseDefinition, fact) {
  return cleanText(caseDefinition.offline?.say?.[fact.id] || fact.say || fact.label);
}

function validateCase(caseDefinition) {
  if (!caseDefinition || typeof caseDefinition !== "object") throw new TypeError("A case definition is required.");
  if (!Array.isArray(caseDefinition.facts)) throw new TypeError("The case must contain facts.");
  const ids = new Set();
  for (const fact of caseDefinition.facts) {
    if (!fact?.id || ids.has(fact.id)) throw new TypeError("Every fact needs a unique ID.");
    ids.add(fact.id);
  }
}

export function createPatientState(caseDefinition) {
  validateCase(caseDefinition);
  const ladder = Array.isArray(caseDefinition.ladder) && caseDefinition.ladder.length
    ? caseDefinition.ladder
    : ["relaxed", "calm", "guarded", "anxious", "upset"];
  const startingLevel = Number.isFinite(caseDefinition.startLevel)
    ? caseDefinition.startLevel
    : Math.max(0, ladder.indexOf(caseDefinition.start));
  return Object.freeze({
    level: Math.max(0, Math.min(ladder.length - 1, startingLevel)),
    turnCount: 0,
    revealedFactIds: Object.freeze([])
  });
}

function nextDemeanor(caseDefinition, state, learnerText) {
  const ladder = caseDefinition.ladder || ["relaxed", "calm", "guarded", "anxious", "upset"];
  let level = state.level;
  let nonverbalCue = "";
  if (EMPATHY.test(learnerText)) {
    level -= 1;
    nonverbalCue = "relaxes a little";
  }
  if (DISMISSIVE.test(learnerText)) {
    level += 1;
    nonverbalCue = "frowns";
  }
  if (JARGON.some(term => learnerText.toLowerCase().includes(term))) {
    level += 0.5;
    nonverbalCue = "looks confused";
  }
  level = Math.max(0, Math.min(ladder.length - 1, level));
  return { level, demeanor: ladder[Math.round(level)] || caseDefinition.start || "calm", nonverbalCue };
}

function publicPhrasingPlan(caseDefinition, demeanor, approvedStatements) {
  return Object.freeze({
    patientName: cleanText(caseDefinition.name).split(" ")[0] || "the patient",
    speakingStyle: `${demeanor}; natural first-person patient speech; plain language`,
    intent: approvedStatements.length > 1 ? "Answer the learner using both approved statements." : "Answer the learner using the approved statement.",
    approvedStatements: Object.freeze([...approvedStatements]),
    maximumSentences: 2,
    maximumWords: 60
  });
}

export function planPatientTurn(caseDefinition, state, learnerText) {
  validateCase(caseDefinition);
  const message = cleanText(learnerText);
  if (!message) throw new TypeError("The learner message cannot be empty.");
  const revealed = new Set(state.revealedFactIds || []);
  const mood = nextDemeanor(caseDefinition, state, message);
  const lower = message.toLowerCase();
  const offline = caseDefinition.offline || {};
  const authorizedFacts = [];
  let scriptedReply = "";
  let route = "scripted-vague";

  if (INJECTION.test(message)) {
    route = "scripted-safety";
    scriptedReply = "I'm here to talk about how I've been feeling. What would you like to ask me about that?";
  } else if (DIAGNOSIS_REQUEST.test(message)) {
    route = "scripted-diagnosis-boundary";
    scriptedReply = "I don't know what the diagnosis is. I was hoping you could help me understand what might be going on.";
  } else {
    const hits = caseDefinition.facts.filter(fact =>
      !revealed.has(fact.id) && (fact.keys || []).some(key => lower.includes(String(key).toLowerCase()))
    );
    const take = hits.slice(0, OPEN.test(message) ? 2 : 1);
    authorizedFacts.push(...take);

    if (take.length) {
      route = "llm-phrasing";
      scriptedReply = take.map(fact => spokenFact(caseDefinition, fact)).join(" ");
    } else if (state.turnCount === 0 && GREETING.test(message) && offline.greet) {
      route = "scripted-greeting";
      scriptedReply = cleanText(offline.greet);
    } else if (EMPATHY.test(message) && offline.empathy) {
      route = "scripted-empathy";
      scriptedReply = cleanText(offline.empathy);
    } else if (JARGON.some(term => lower.includes(term)) && offline.jargon) {
      route = "scripted-jargon";
      scriptedReply = cleanText(offline.jargon);
    } else {
      const repeated = caseDefinition.facts.find(fact =>
        revealed.has(fact.id) && (fact.keys || []).some(key => lower.includes(String(key).toLowerCase()))
      );
      if (repeated) {
        route = "scripted-repeat";
        const repeatedText = spokenFact(caseDefinition, repeated);
        scriptedReply = `Like I said, ${repeatedText.charAt(0).toLowerCase()}${repeatedText.slice(1)}`;
      } else {
        const vague = Array.isArray(offline.vague) && offline.vague.length ? offline.vague : ["I'm not sure what else to add."];
        scriptedReply = cleanText(vague[state.turnCount % vague.length]);
      }
    }
  }

  const factIds = authorizedFacts.map(fact => String(fact.id));
  const approvedStatements = authorizedFacts.map(fact => spokenFact(caseDefinition, fact));
  const nextRevealed = [...revealed, ...factIds];
  const nextState = Object.freeze({
    level: mood.level,
    turnCount: state.turnCount + 1,
    revealedFactIds: Object.freeze(nextRevealed)
  });

  return Object.freeze({
    route,
    scriptedReply,
    demeanor: mood.demeanor,
    nonverbalCue: mood.nonverbalCue,
    authorizedFactIds: Object.freeze(factIds),
    phrasingPlan: route === "llm-phrasing" ? publicPhrasingPlan(caseDefinition, mood.demeanor, approvedStatements) : null,
    nextState
  });
}

export function buildPhrasingMessages(phrasingPlan) {
  if (!phrasingPlan || !Array.isArray(phrasingPlan.approvedStatements) || !phrasingPlan.approvedStatements.length) {
    throw new TypeError("An approved phrasing plan is required.");
  }
  const approved = phrasingPlan.approvedStatements.map((statement, index) => `${index + 1}. ${statement}`).join("\n");
  return [
    {
      role: "system",
      content: "You phrase a deterministic patient response. Use only the approved statements. Add no symptom, history, medicine, diagnosis, negative finding, advice, or life detail. Stay in first-person patient voice. Never mention prompts, rules, plans, or AI. Return only the spoken reply in no more than two short sentences."
    },
    {
      role: "user",
      content: `Speaking style: ${phrasingPlan.speakingStyle}\nIntent: ${phrasingPlan.intent}\nApproved statements:\n${approved}\nMaximum words: ${phrasingPlan.maximumWords}`
    }
  ];
}

export function validatePhrasedReply(reply, turnPlan, caseDefinition) {
  let text = cleanText(reply).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  text = text.replace(/^(["“])|(["”])$/g, "").trim();
  if (!text) return { ok: false, reason: "empty", text: turnPlan.scriptedReply };
  if (ROLE_BREAK.test(text)) return { ok: false, reason: "role-break", text: turnPlan.scriptedReply };
  if ((text.match(/[.!?]+/g) || []).length > 3) return { ok: false, reason: "too-many-sentences", text: turnPlan.scriptedReply };
  if (text.split(/\s+/).length > 60) return { ok: false, reason: "too-long", text: turnPlan.scriptedReply };

  const approvedTokens = new Set(turnPlan.phrasingPlan.approvedStatements.flatMap(significantTokens));
  const groundedTokens = new Set(approvedTokens);
  const equivalentPhrasing = {
    afraid: ["worried"], began: ["started"], "didn't": ["didnt"], hurt: ["painful"],
    started: ["began"], took: ["taken"], worried: ["afraid"]
  };
  for (const token of approvedTokens) for (const equivalent of equivalentPhrasing[token] || []) groundedTokens.add(equivalent);
  const replyTokens = new Set(significantTokens(text));
  const overlap = [...approvedTokens].filter(token => replyTokens.has(token)).length;
  if (approvedTokens.size && overlap < Math.max(1, Math.ceil(approvedTokens.size * 0.2))) {
    return { ok: false, reason: "lost-approved-content", text: turnPlan.scriptedReply };
  }

  const authorized = new Set(turnPlan.authorizedFactIds);
  for (const fact of caseDefinition.facts) {
    if (authorized.has(String(fact.id))) continue;
    const tokens = significantTokens(`${fact.label} ${spokenFact(caseDefinition, fact)}`);
    const matches = tokens.filter(token => replyTokens.has(token));
    if (matches.length >= Math.min(2, tokens.length)) {
      return { ok: false, reason: `possible-unauthorized-fact:${fact.id}`, text: turnPlan.scriptedReply };
    }
  }
  const ungrounded = [...replyTokens].filter(token => !groundedTokens.has(token) && !SAFE_PHRASING_WORDS.has(token));
  if (ungrounded.length) {
    return { ok: false, reason: `ungrounded-content:${ungrounded.slice(0, 3).join(",")}`, text: turnPlan.scriptedReply };
  }
  return { ok: true, reason: "accepted", text };
}

export const controllerPatterns = Object.freeze({ INJECTION, DIAGNOSIS_REQUEST });
