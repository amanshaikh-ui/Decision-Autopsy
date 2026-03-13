# Decision Autopsy

> Paste a meeting transcript. Ask one question. Get a full AI-powered decision briefing in under a minute.

🔗 **Live Demo:** https://decision-autopsy-one.vercel.app

---

## What It Does

Most meetings end with no clear answer. Decision Autopsy takes the transcript of that meeting and runs it through 7 specialized AI agents — each one analyzing the same conversation from a different angle — and delivers a structured intelligence briefing.

---

## Key Features

| Feature | Description |
|---|---|
| **7-Agent Pipeline** | Autopsy → Evidence Extractor → Optimist → Pessimist → Rebuttal → Moderator → Reaction Simulator |
| **Tone Slider** | Drag from Polite to Savage — changes how aggressively agents argue |
| **Decision Radar** | 5-axis chart with scores computed by Python formulas, not AI guesses |
| **KPI Cards** | Decision Status, Action Readiness, Risk Level, Evidence Strength at a glance |
| **Strict Citation Mode** | Every claim backed by `Speaker (line N): 'quote'` — no hallucination |
| **Reaction Simulator** | Realistic stakeholder reactions inferred from transcript context |
| **Export as Markdown** | Download the full briefing as a clean `.md` file |
| **Text-to-Speech** | Listen to the full briefing hands-free |
| **Live Progress Indicator** | See each of the 9 agent steps completing in real time |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, Tailwind CSS, TypeScript |
| Backend | FastAPI, Python 3.11+ |
| AI | Groq API — LLaMA 3.3 70B |
| Hosting | Vercel (frontend) + Render (backend) |

---

## Local Development

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
source .venv/bin/activate     # macOS/Linux
pip install -r requirements.txt
cp .env.example .env          # add your GROQ_API_KEY
python -m uvicorn app:app --reload
```

API available at **http://localhost:8000**

### Frontend

```bash
cd frontend
npm install
# create .env.local and add: NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev
```

UI available at **http://localhost:3000**

---

## Deployment

- **Backend** → Render (root directory: `backend`, start command: `uvicorn app:app --host 0.0.0.0 --port 10000`)
- **Frontend** → Vercel (root directory: `frontend`)
- Set `GROQ_API_KEY` + `FRONTEND_URL` in Render environment variables
- Set `NEXT_PUBLIC_API_URL` in Vercel environment variables
