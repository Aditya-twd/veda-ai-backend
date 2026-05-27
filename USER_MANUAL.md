# User Manual

A guide to running and using VedaAI. The product is a web app for teachers; this manual covers the
end-user flow and a copy-paste API walkthrough for technical reviewers.

- **Live app:** https://veda-ai-frontend-five.vercel.app
- **API base (local):** `http://localhost:5000/api`

---

## Part 1 — Using the app (end user)

### 1. Sign in
Open the app. You have two options:
- **Continue with Google** — signs you in with your Google account.
- **Continue as guest** — logs you in as a demo teacher instantly (no account needed). Best for a
  quick review.

### 2. Onboarding (Google users only)
First-time Google users are asked for their **school** (name, and optionally location/sector). This
appears on the header of generated papers. Guest users skip this — the demo school is preset.

### 3. Create an assignment
From the dashboard, choose **Create assignment** and fill the two-step form:
1. **Details** — a **title**, an optional **due date**, and an optional **reference document**
   (PDF or image) to base questions on.
2. **Question types** — add one or more rows, each with a **type** (e.g. Multiple Choice, Short
   Answer), the **number of questions**, and **marks per question**. Totals update live. You can add
   freeform **instructions** (e.g. "keep it moderate difficulty, focus on photosynthesis").

### 4. Generate
Click **Generate**. A progress indicator shows the stages in real time
(*Generating questions → Saving paper*). This runs in the background, so it's resilient to a slow
model call. If the AI service is temporarily unavailable, you'll still receive a clearly-labelled
**sample paper** rather than an error.

### 5. Review the paper
When it completes you'll see the full **question paper** — organized into sections, each question
showing its difficulty and marks — followed by the **answer key**.

### 6. Edit (AI Toolkit)
Open the paper in the editor to refine it:
- **Edit any question manually** — text, options, marks, difficulty, or its answer.
- **Add or remove questions.**
- **Regenerate a whole section** with the AI, optionally with an instruction (e.g. "make these
  harder"). The answer key stays in sync automatically.
Changes are saved back to the paper.

### 7. Export to PDF
Download the finished paper as a **PDF** — formatted with proper math/Unicode symbols and clean page
breaks, ready to print or share.

---

## Part 2 — API walkthrough (technical reviewer)

You can drive the whole flow from the command line. This assumes the backend is running locally with
MongoDB + Redis configured and the worker running (see [`README.md`](./README.md) → *Getting started*).

### 0. Health
```bash
curl http://localhost:5000/api/health
# → services: { mongo:"connected", redis:"configured", gemini:"configured" }
```

### 1. Log in (guest) and capture the token
```bash
TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/guest \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
```

### 2. Create an assignment
```bash
RESP=$(curl -s -X POST http://localhost:5000/api/assignments \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "title":"Photosynthesis Quiz (Class 8 Biology)",
    "dueDate":"10-06-2026",
    "questionTypes":[
      {"type":"MCQ","numQuestions":2,"marks":1},
      {"type":"Short Answer","numQuestions":1,"marks":3}
    ],
    "additionalInstructions":"Topic: Photosynthesis. Moderate difficulty."
  }')
ID=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['_id'])")
echo "assignment: $ID"
```

### 3. Trigger generation
```bash
curl -s -X POST "http://localhost:5000/api/assignments/$ID/generate" \
  -H "Authorization: Bearer $TOKEN"
# → { "data": { "assignmentId": "...", "jobId": "1", "status": "queued" } }
```

### 4. Poll until complete
```bash
watch -n2 "curl -s http://localhost:5000/api/assignments/$ID \
  -H 'Authorization: Bearer $TOKEN' \
  | python3 -c \"import sys,json;print(json.load(sys.stdin)['data']['status'])\""
# draft → generating → completed
```
(A real client receives `generation:*` events over Socket.IO instead of polling.)

### 5. Fetch the generated paper
```bash
curl -s "http://localhost:5000/api/papers/by-assignment/$ID" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
# sections[].questions[], answerKey[], generatedBy, isFallback
```

### 6. Regenerate a section (AI edit)
```bash
PAPER=$(curl -s "http://localhost:5000/api/papers/by-assignment/$ID" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['_id'])")

curl -s -X POST "http://localhost:5000/api/papers/$PAPER/sections/0/regenerate" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"instruction":"make these questions harder"}' | python3 -m json.tool
```

### 7. Download the PDF
```bash
curl -s "http://localhost:5000/api/papers/$PAPER/pdf" \
  -H "Authorization: Bearer $TOKEN" -o paper.pdf
```

See [`README.md`](./README.md) for the complete endpoint reference and [`ARCHITECTURE.md`](./ARCHITECTURE.md)
for how each step works under the hood.
