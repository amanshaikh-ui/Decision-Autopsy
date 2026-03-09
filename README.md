# Decision Autopsy

> AI-powered post-mortem analysis for past decisions.

Paste a decision transcript, ask a question, and get a full structured analysis:

| Agent | Role |
|---|---|
| **Decision Autopsy** | Identifies the decision, supporting evidence, ignored risks, and missing evidence |
| **Optimist** | Makes the strongest case that the decision was reasonable |
| **Pessimist** | Makes the strongest case that the decision was flawed |
| **Rebuttal** | Optimist responds to the Pessimist's critique |
| **Moderator** | Neutral synthesis and overall verdict |

Evidence cited by agents is **highlighted in the transcript viewer** (green = supporting, orange = ignored risk). All output can be **exported as Markdown**.

---

## Project Structure

```
decision-autopsy/
├── backend/
│   ├── app.py            FastAPI routes + Pydantic models
│   ├── agents.py         LLM agent functions (OpenAI)
│   ├── prompts.py        All prompt templates
│   ├── retriever.py      RAG retrieval stub (pluggable)
│   ├── requirements.txt
│   ├── render.yaml       Render deployment config
│   └── .env.example
└── frontend/
    ├── src/app/
    │   ├── layout.tsx
    │   ├── page.tsx      Full interactive UI
    │   └── globals.css
    ├── vercel.json       Vercel deployment config
    └── .env.local.example
```

---

## Local Development

### Prerequisites

- Python 3.11+
- Node.js 20+
- OpenAI API key

### Backend

```bash
cd backend

python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt

# Configure environment
copy .env.example .env      # Windows
cp .env.example .env        # macOS/Linux
# Open .env and set OPENAI_API_KEY

uvicorn app:app --reload
```

API available at **http://localhost:8000**
Interactive docs at **http://localhost:8000/docs**

### Frontend

```bash
cd frontend

npm install

# Configure environment
copy .env.local.example .env.local      # Windows
cp .env.local.example .env.local        # macOS/Linux
# NEXT_PUBLIC_API_URL defaults to http://localhost:8000

npm run dev
```

UI available at **http://localhost:3000**

---

## Deployment

### Backend → Render

1. Push this repo to GitHub.
2. Go to [render.com](https://render.com) → **New → Web Service**.
3. Connect your GitHub repo and select the **`backend`** folder as the root directory.
4. Use these settings:

   | Setting | Value |
   |---|---|
   | Runtime | Python |
   | Build Command | `pip install -r requirements.txt` |
   | Start Command | `uvicorn app:app --host 0.0.0.0 --port 10000` |

5. Add environment variables in the Render dashboard:

   | Key | Value |
   |---|---|
   | `OPENAI_API_KEY` | `sk-...` |
   | `FRONTEND_URL` | Your Vercel URL (add after deploying frontend) |

6. Deploy. Note the Render service URL (e.g. `https://decision-autopsy-backend.onrender.com`).

### Frontend → Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project**.
2. Import your GitHub repo.
3. Set **Root Directory** to `frontend`.
4. Add environment variable:

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | Your Render backend URL |

5. Deploy.
6. Copy the Vercel URL and paste it as `FRONTEND_URL` in your Render environment variables, then redeploy the backend.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, Tailwind CSS, TypeScript |
| Backend | FastAPI, Uvicorn, Python 3.11+ |
| AI | OpenAI API (GPT-4o) |
| Hosting | Vercel (frontend) + Render (backend) |
