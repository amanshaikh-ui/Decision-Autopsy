import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv()

from agents import (
    index_transcript,
    run_autopsy_agent,
    run_optimist_agent,
    run_pessimist_agent,
    run_rebuttal_agent,
    run_moderator_agent,
    run_reaction_simulator,
    run_evidence_extractor,
    compute_radar_scores,
)

app = FastAPI(title="Decision Autopsy API", version="4.0.0")

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

# Build the allowed origins list — always includes localhost for dev,
# the configured FRONTEND_URL, and all known Vercel deployment domains.
_ALLOWED_ORIGINS = list({
    "http://localhost:3000",
    "http://localhost:3001",
    FRONTEND_URL,
    # Vercel production + preview domains for this project
    "https://decision-autopsy-one.vercel.app",
    "https://decision-autopsy-git-main-aman7756068021s-projects.vercel.app",
    "https://decision-autopsy-1718uvq4w-aman7756068021s-projects.vercel.app",
})

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_origin_regex=r"https://decision-autopsy.*\.vercel\.app",  # catches any future preview URLs
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request
# ---------------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    transcript: str
    question: str
    strict_citations: bool = False  # default OFF — fully backward-compatible


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class VerdictData(BaseModel):
    recommendation: str
    confidence: str
    why: str


class AutopsyData(BaseModel):
    decision: str
    status: str
    top_risks: list[str] = Field(default_factory=list)
    missing_evidence: list[str] = Field(default_factory=list)
    supporting_evidence: list[str] = Field(default_factory=list)


class SideData(BaseModel):
    summary: str
    evidence: list[str] = Field(default_factory=list)


class ModeratorData(BaseModel):
    disagreement: str
    stronger_side: str
    what_settles_it: list[str] = Field(default_factory=list)


class RebuttalData(BaseModel):
    bullets: list[str] = Field(default_factory=list)


class StakeholderReaction(BaseModel):
    role: str
    sentiment: str  # "Positive" | "Neutral" | "Negative"
    concern: str
    quote: str


class ReactionSimData(BaseModel):
    stakeholders: list[StakeholderReaction] = Field(default_factory=list)


# --- Decision Radar (v4 — deterministic scores) ---

class RadarScores(BaseModel):
    """
    Five dimensions, each computed from extracted evidence signals.
    No LLM assigns these numbers — they come from explicit Python formulas.
    """
    evidence_strength: int      # How strongly does evidence support a conclusion?
    risk_level: int             # How serious are the identified risks?
    stakeholder_alignment: int  # How aligned are the speakers?
    uncertainty: int            # How much critical info is missing?
    action_readiness: int       # How ready is the team to act?


class SignalCounts(BaseModel):
    """Breakdown of extracted evidence signals by type (for UI transparency)."""
    support: int = 0
    risk: int = 0
    validation: int = 0
    unknown: int = 0


class RadarData(BaseModel):
    scores: RadarScores
    status: str                              # "Go" | "Proceed with caution" | "Hold" | "Not enough info"
    reason: str                              # short code-generated explanation
    signal_counts: SignalCounts
    summary: str = ""                        # kept for backward compat (now empty)


class AnalyzeResponse(BaseModel):
    verdict: VerdictData
    autopsy: AutopsyData
    optimist: SideData
    pessimist: SideData
    moderator: ModeratorData
    rebuttal: RebuttalData
    reactions: ReactionSimData
    radar: RadarData


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {"status": "ok", "message": "Decision Autopsy API v4 is running"}


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    if not req.transcript.strip():
        raise HTTPException(status_code=400, detail="Transcript cannot be empty.")
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    try:
        sc = req.strict_citations

        # Always build the indexed transcript — needed by the evidence extractor
        # and optionally by citation-mode agents.
        indexed_tx = index_transcript(req.transcript)
        citation_tx = indexed_tx if sc else ""  # only passed to agents in citation mode

        # 1. Autopsy + Verdict
        raw_autopsy = run_autopsy_agent(
            req.transcript, req.question,
            strict_citations=sc, indexed_tx=citation_tx
        )
        decision = raw_autopsy.get("decision", "")

        verdict = VerdictData(
            recommendation=raw_autopsy.get("recommendation", ""),
            confidence=raw_autopsy.get("confidence", "Medium"),
            why=raw_autopsy.get("why", ""),
        )
        autopsy = AutopsyData(
            decision=decision,
            status=raw_autopsy.get("status", "Unresolved"),
            top_risks=raw_autopsy.get("top_risks", []),
            missing_evidence=raw_autopsy.get("missing_evidence", []),
            supporting_evidence=raw_autopsy.get("supporting_evidence", []),
        )

        # 2. Evidence Extractor — LLM classifies signals; scores computed in code
        raw_evidence = run_evidence_extractor(
            req.transcript, req.question, decision,
            indexed_tx=indexed_tx,          # always use indexed for line numbers
        )
        ev_signals  = raw_evidence.get("signals", [])
        ev_missing  = raw_evidence.get("missing_evidence", [])

        # 3. Optimist
        raw_optimist = run_optimist_agent(
            req.transcript, req.question, decision,
            strict_citations=sc, indexed_tx=citation_tx
        )
        optimist = SideData(**raw_optimist)

        # 4. Pessimist
        raw_pessimist = run_pessimist_agent(
            req.transcript, req.question, decision, raw_optimist,
            strict_citations=sc, indexed_tx=citation_tx
        )
        pessimist = SideData(**raw_pessimist)

        # 5. Rebuttal
        raw_rebuttal = run_rebuttal_agent(
            req.transcript, raw_pessimist,
            strict_citations=sc, indexed_tx=citation_tx
        )
        rebuttal = RebuttalData(**raw_rebuttal)

        # 6. Moderator
        raw_moderator = run_moderator_agent(
            raw_autopsy, raw_optimist, raw_pessimist, raw_rebuttal,
            strict_citations=sc
        )
        moderator = ModeratorData(**raw_moderator)

        # 7. Reaction Simulator
        raw_reactions = run_reaction_simulator(
            req.transcript, raw_autopsy,
            strict_citations=sc, indexed_tx=citation_tx
        )
        reactions = ReactionSimData(
            stakeholders=[
                StakeholderReaction(**s)
                for s in raw_reactions.get("stakeholders", [])
            ]
        )

        # 8. Decision Radar — deterministic scores from extracted signals
        radar_dict = compute_radar_scores(ev_signals, ev_missing)
        radar = RadarData(
            scores=RadarScores(
                evidence_strength     = radar_dict["evidence_strength"],
                risk_level            = radar_dict["risk_level"],
                stakeholder_alignment = radar_dict["stakeholder_alignment"],
                uncertainty           = radar_dict["uncertainty"],
                action_readiness      = radar_dict["action_readiness"],
            ),
            status        = radar_dict["status"],
            reason        = radar_dict["reason"],
            signal_counts = SignalCounts(**radar_dict["signal_counts"]),
            summary       = "",
        )

        return AnalyzeResponse(
            verdict=verdict,
            autopsy=autopsy,
            optimist=optimist,
            pessimist=pessimist,
            moderator=moderator,
            rebuttal=rebuttal,
            reactions=reactions,
            radar=radar,
        )

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
