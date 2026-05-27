import { GenerationInput } from "./types";

/**
 * Turns the assignment form into a strict, structured prompt. The model is told to
 * return ONLY JSON in our paper shape — sections, questions, difficulty, marks, answer key.
 */
export function buildPrompt(input: GenerationInput): {
  systemInstruction: string;
  userPrompt: string;
} {
  const systemInstruction = [
    "You are an expert school examination paper setter.",
    "Generate a well-structured question paper as STRICT JSON ONLY — no markdown, no prose, no code fences.",
    "The JSON must match exactly this TypeScript shape:",
    `{
  "meta": { "subject": string, "class": string, "timeAllowed": string, "maxMarks": number },
  "sections": [
    { "title": string, "instruction": string,
      "questions": [ { "text": string, "difficulty": "easy"|"moderate"|"hard", "marks": number, "options": string[] } ] }
  ],
  "answerKey": [ { "index": number, "answer": string } ]
}`,
    "Rules:",
    "- Group question types into sections (Section A, Section B, ...).",
    "- Each question's `marks` must be an integer and match the requested marks for its type.",
    "- ALL values in `options` and every `answer` MUST be strings — never booleans or numbers. (e.g. write \"True\", not true; \"4\", not 4.)",
    "- For Multiple Choice (MCQ) questions, `options` MUST contain exactly 4 distinct, plausible choices as plain text (do NOT prefix them with 'A)', '(a)', etc.).",
    "- For True/False questions, `options` MUST be exactly [\"True\", \"False\"] and the `answer` MUST be \"True\" or \"False\".",
    "- For Fill in the Blanks, Short, Long, Numerical, Diagram and any other non-MCQ/non-TrueFalse question, `options` MUST be an empty array []. Use a blank like \"_____\" in the text for fill-in-the-blank questions.",
    "- `answerKey` index is the 1-based question number across the whole paper, and there must be exactly one answer entry per question. For MCQ the answer must be the full text of the correct option (matching one of that question's `options`).",
    "- The depth and length of each `answer` MUST scale with that question's marks: 1 mark = a single word or one short line; 2-3 marks = 2-4 complete sentences; 5+ marks = a thorough, well-structured model answer (a full paragraph or more) that addresses every part the question asks for — definitions, explanation, reasoning, and an example/diagram description where relevant. For numerical questions, show the full step-by-step working leading to the final answer, not just the result. Do NOT give one-line answers to high-mark questions.",
    "- Every question MUST include a `difficulty` of exactly \"easy\", \"moderate\" or \"hard\" (lowercase). Mix difficulties sensibly.",
    "- `maxMarks` must equal the sum of all question marks.",
    "- Infer `subject` and `class` from the material/instructions; if unknown, choose sensible values.",
  ].join("\n");

  const typeLines = input.questionTypes
    .map((q) => `  - ${q.type}: ${q.numQuestions} questions × ${q.marks} mark(s) each`)
    .join("\n");

  const userPrompt = [
    `Title: ${input.title}`,
    `School: ${input.school}`,
    input.dueDate ? `Due date: ${new Date(input.dueDate).toDateString()}` : "",
    "",
    "Requested question types:",
    typeLines,
    "",
    `Total questions: ${input.totalQuestions}`,
    `Total marks: ${input.totalMarks}`,
    input.additionalInstructions ? `\nAdditional instructions: ${input.additionalInstructions}` : "",
    input.file
      ? "\nBase the questions on the attached document/image where relevant."
      : "",
    "\nReturn the JSON now.",
  ]
    .filter(Boolean)
    .join("\n");

  return { systemInstruction, userPrompt };
}

/**
 * Prompt for regenerating a SINGLE section of an existing paper (AI Teacher's Toolkit).
 * Keeps the same question type, count, and marks as the current section unless the
 * teacher's instruction says otherwise. Returns ONLY `{ "questions": [...] }`.
 */
export function buildSectionEditPrompt(input: {
  subject: string;
  className: string;
  sectionTitle: string;
  sectionInstruction: string;
  questions: { text: string; marks: number; options: string[] }[];
  instruction: string;
}): { systemInstruction: string; userPrompt: string } {
  const isMcqLike = input.questions.some((q) => q.options.length > 0);
  const count = input.questions.length;

  const systemInstruction = [
    "You are an expert school examination paper setter editing ONE section of an existing question paper.",
    "Return STRICT JSON ONLY — no markdown, no prose, no code fences — matching exactly:",
    `{ "questions": [ { "text": string, "difficulty": "easy"|"moderate"|"hard", "marks": number, "options": string[], "answer": string } ] }`,
    "Rules:",
    `- Produce ${count} question(s) unless the instruction clearly asks for a different number.`,
    "- Keep the SAME question type and marks-per-question as the current section's questions.",
    "- ALL values in `options` and every `answer` MUST be strings — never booleans or numbers.",
    isMcqLike
      ? "- These are option-based questions: give exactly the same kind of `options` (4 for MCQ, [\"True\",\"False\"] for True/False), and `answer` must be the full text of the correct option."
      : "- These are NOT option-based: `options` MUST be an empty array []. Put any blank as \"_____\" in the text where relevant.",
    "- `difficulty` must be exactly \"easy\", \"moderate\" or \"hard\" (lowercase); mix sensibly.",
    "- Each `answer`'s depth MUST scale with its marks: 1 mark = a word/one line; 2-3 marks = 2-4 sentences; 5+ marks = a full, structured model answer covering every part asked (show full working for numericals). Never give one-line answers to high-mark questions.",
  ].join("\n");

  const current = input.questions
    .map((q, i) => `  ${i + 1}. (${q.marks} mark${q.marks === 1 ? "" : "s"}) ${q.text}`)
    .join("\n");

  const userPrompt = [
    input.subject ? `Subject: ${input.subject}` : "",
    input.className ? `Class: ${input.className}` : "",
    `Section: ${input.sectionTitle}`,
    input.sectionInstruction ? `Section instruction: ${input.sectionInstruction}` : "",
    "",
    "Current questions in this section (for type/marks reference):",
    current,
    "",
    input.instruction
      ? `Teacher's instruction for the new version: ${input.instruction}`
      : "Generate a fresh set of equivalent questions for this section.",
    "\nReturn the JSON now.",
  ]
    .filter(Boolean)
    .join("\n");

  return { systemInstruction, userPrompt };
}
