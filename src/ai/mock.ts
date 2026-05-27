import { GeneratedPaper } from "./paper.schema";
import { GenerationInput } from "./types";

const DIFFS = ["easy", "moderate", "hard"] as const;
const LETTERS = "ABCDEFGH";

/**
 * Deterministic mock generator used when GEMINI_API_KEY is not set. Builds a valid,
 * schema-correct paper from the assignment so the full pipeline (queue → socket → DB)
 * works end-to-end without an LLM. Swapped out automatically once the key is configured.
 */
export function mockPaper(input: GenerationInput): GeneratedPaper {
  let runningIndex = 0;
  const answerKey: { index: number; answer: string }[] = [];

  const sections = input.questionTypes.map((qt, si) => {
    const isMcq = /multiple choice|mcq/i.test(qt.type);
    const questions = Array.from({ length: qt.numQuestions }, (_, qi) => {
      runningIndex += 1;
      const options = isMcq
        ? Array.from({ length: 4 }, (_, oi) => `Sample option ${LETTERS[oi]} for Q${runningIndex}`)
        : [];
      answerKey.push({
        index: runningIndex,
        answer: isMcq ? options[0] : `Sample answer for question ${runningIndex} (${qt.type}).`,
      });
      return {
        text: `[${qt.type}] Sample question ${qi + 1} about "${input.title}".`,
        difficulty: DIFFS[(qi + si) % DIFFS.length],
        marks: qt.marks,
        options,
      };
    });

    return {
      title: `Section ${LETTERS[si] ?? si + 1}`,
      instruction: `Attempt all questions. Each question carries ${qt.marks} mark(s).`,
      questions,
    };
  });

  return {
    meta: {
      subject: "General",
      class: "",
      timeAllowed: "45 minutes",
      maxMarks: input.totalMarks,
    },
    sections,
    answerKey,
  };
}
