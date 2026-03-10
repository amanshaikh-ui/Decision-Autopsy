"""
LLM agents powered by Groq.
All agents return structured dicts (parsed from JSON responses).
Supports optional Strict Citation Mode via strict_citations=True.

Decision Radar pipeline (v4):
  Transcript → index_transcript → run_evidence_extractor (LLM)
             → compute_radar_scores (pure Python, no LLM)
             → RadarData
"""

import os
import re
import json
from groq import Groq
from dotenv import load_dotenv
from prompts import (
    AUTOPSY_SYSTEM, AUTOPSY_USER,
    OPTIMIST_SYSTEM, OPTIMIST_USER,
    PESSIMIST_SYSTEM, PESSIMIST_USER,
    REBUTTAL_SYSTEM, REBUTTAL_USER,
    MODERATOR_SYSTEM, MODERATOR_USER,
    REACTION_SIM_SYSTEM, REACTION_SIM_USER,
    EVIDENCE_EXTRACTOR_SYSTEM, EVIDENCE_EXTRACTOR_USER,
    CITATION_RULES,
    get_tone_instruction,
    fmt_for_moderator,
)

load_dotenv()

MODEL = "llama-3.3-70b-versatile"
_client: Groq | None = None


def _get_client() -> Groq:
    global _client
    if _client is None:
        _client = Groq(api_key=os.getenv("GROQ_API_KEY"))
    return _client


def _chat(system: str, user: str, temperature: float = 0.3) -> str:
    """Call the model with JSON mode enabled — guarantees parseable output."""
    response = _get_client().chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=temperature,
        response_format={"type": "json_object"},
    )
    return response.choices[0].message.content.strip()


def _parse_json(raw: str) -> dict:
    """
    Parse JSON defensively:
    1. Direct parse (JSON mode output).
    2. Strip ``` fences.
    3. Regex extract first {...} block.
    """
    s = raw.strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass

    fence = re.match(r"^```(?:json)?\s*\n([\s\S]*?)\n?```$", s, re.IGNORECASE)
    if fence:
        try:
            return json.loads(fence.group(1).strip())
        except json.JSONDecodeError:
            pass

    match = re.search(r"\{[\s\S]*\}", s)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not parse JSON from model response:\n{raw[:500]}")


# ---------------------------------------------------------------------------
# Transcript indexing
# ---------------------------------------------------------------------------

def index_transcript(raw: str) -> str:
    """
    Convert a raw transcript into a line-indexed string for citation-aware prompting
    and for the evidence extractor agent.

    Detects common speaker patterns:
      - "Speaker: text"
      - "[Speaker] text" / "[Speaker]: text"
      - "Speaker (timestamp): text"

    Output format:
      Line 1 | CEO: "We promised the client a March launch."
      Line 2 | Engineering Lead: "There are still two unresolved security issues."
      Line 3 | "No identifiable speaker here."
    """
    SPEAKER_PATTERNS = [
        re.compile(r"^([A-Za-z][A-Za-z\s,'.\-]{1,40}?)\s*\([^)]{1,30}\):\s*(.+)$"),
        re.compile(r"^\[([^\]]{1,40})\]\s*:?\s*(.+)$"),
        re.compile(r"^([A-Za-z][A-Za-z\s,'.\-]{1,40}?):\s+(.+)$"),
    ]

    non_empty = [ln.rstrip() for ln in raw.split("\n") if ln.strip()]
    lines_out = []

    for i, line in enumerate(non_empty, start=1):
        matched = False
        for pat in SPEAKER_PATTERNS:
            m = pat.match(line)
            if m:
                speaker = m.group(1).strip()
                text = m.group(2).strip()
                lines_out.append(f'Line {i} | {speaker}: "{text}"')
                matched = True
                break
        if not matched:
            lines_out.append(f'Line {i} | "{line}"')

    return "\n".join(lines_out)


# ---------------------------------------------------------------------------
# Agent helpers
# ---------------------------------------------------------------------------

def _tx(transcript: str, strict_citations: bool, indexed_tx: str) -> str:
    """Return the right transcript string based on citation mode."""
    return indexed_tx if strict_citations and indexed_tx else transcript


def _cite(prompt: str, strict_citations: bool) -> str:
    """Append citation rules to prompt when mode is active."""
    return prompt + CITATION_RULES if strict_citations else prompt


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------

def run_autopsy_agent(
    transcript: str, question: str,
    strict_citations: bool = False, indexed_tx: str = ""
) -> dict:
    tx = _tx(transcript, strict_citations, indexed_tx)
    user = _cite(AUTOPSY_USER.format(transcript=tx, question=question), strict_citations)
    raw = _chat(AUTOPSY_SYSTEM, user, temperature=0.2)
    return _parse_json(raw)


def run_optimist_agent(
    transcript: str, question: str, decision: str,
    strict_citations: bool = False, indexed_tx: str = "", tone: int = 3
) -> dict:
    tx = _tx(transcript, strict_citations, indexed_tx)
    system = OPTIMIST_SYSTEM + "\n\n" + get_tone_instruction(tone)
    user = _cite(
        OPTIMIST_USER.format(transcript=tx, question=question, decision=decision),
        strict_citations,
    )
    raw = _chat(system, user)
    return _parse_json(raw)


def run_pessimist_agent(
    transcript: str, question: str, decision: str, optimist: dict,
    strict_citations: bool = False, indexed_tx: str = "", tone: int = 3
) -> dict:
    tx = _tx(transcript, strict_citations, indexed_tx)
    system = PESSIMIST_SYSTEM + "\n\n" + get_tone_instruction(tone)
    user = _cite(
        PESSIMIST_USER.format(
            transcript=tx,
            question=question,
            decision=decision,
            optimist_summary=optimist.get("summary", ""),
        ),
        strict_citations,
    )
    raw = _chat(system, user)
    return _parse_json(raw)


def run_rebuttal_agent(
    transcript: str, pessimist: dict,
    strict_citations: bool = False, indexed_tx: str = ""
) -> dict:
    tx = _tx(transcript, strict_citations, indexed_tx)
    user = _cite(
        REBUTTAL_USER.format(
            transcript=tx,
            pessimist_summary=pessimist.get("summary", ""),
            pessimist_evidence=", ".join(pessimist.get("evidence", [])),
        ),
        strict_citations,
    )
    raw = _chat(REBUTTAL_SYSTEM, user)
    return _parse_json(raw)


def run_moderator_agent(
    autopsy: dict, optimist: dict, pessimist: dict, rebuttal: dict,
    strict_citations: bool = False, tone: int = 3
) -> dict:
    system = MODERATOR_SYSTEM + "\n\n" + get_tone_instruction(tone)
    ctx = fmt_for_moderator(autopsy, optimist, pessimist, rebuttal)
    user = _cite(MODERATOR_USER.format(**ctx), strict_citations)
    raw = _chat(system, user, temperature=0.3)
    return _parse_json(raw)


def run_reaction_simulator(
    transcript: str, autopsy: dict,
    strict_citations: bool = False, indexed_tx: str = ""
) -> dict:
    # Citation rules intentionally NOT applied to Reaction Simulator —
    # the fixed schema (role/sentiment/concern/quote) has no room for inline
    # evidence keys, and appending CITATION_RULES causes the model to add
    # extra fields + newlines that break Groq's JSON validator.
    # The indexed transcript is still passed so quotes can naturally reference lines.
    tx = _tx(transcript, strict_citations, indexed_tx)
    user = REACTION_SIM_USER.format(
        transcript=tx,
        decision=autopsy.get("decision", ""),
        status=autopsy.get("status", ""),
    )
    raw = _chat(REACTION_SIM_SYSTEM, user)
    return _parse_json(raw)


# ---------------------------------------------------------------------------
# Evidence Extractor — LLM labels signals; scores are computed in code below
# ---------------------------------------------------------------------------

def run_evidence_extractor(
    transcript: str, question: str, decision: str, indexed_tx: str = ""
) -> dict:
    """
    Extract structured evidence signals from the transcript using an LLM.
    The LLM classifies signals; it does NOT assign numeric scores.

    Always uses the indexed transcript (built internally if not supplied).
    Falls back gracefully to empty signals on any parse failure.

    Returns: {"signals": [...], "missing_evidence": [...]}
    """
    tx = indexed_tx if indexed_tx else index_transcript(transcript)
    user = EVIDENCE_EXTRACTOR_USER.format(
        transcript=tx,
        decision=decision,
        question=question,
    )
    try:
        raw = _chat(EVIDENCE_EXTRACTOR_SYSTEM, user, temperature=0.1)
        result = _parse_json(raw)
        # Sanitise output — ensure required keys exist and are lists
        if not isinstance(result.get("signals"), list):
            result["signals"] = []
        if not isinstance(result.get("missing_evidence"), list):
            result["missing_evidence"] = []
        # Filter out malformed signal entries
        valid_types = {"support", "risk", "constraint", "validation", "unknown"}
        valid_stances = {"support", "oppose", "neutral", "unclear"}
        valid_strengths = {"strong", "medium", "weak"}
        result["signals"] = [
            s for s in result["signals"]
            if isinstance(s, dict)
            and s.get("type") in valid_types
            and s.get("stance") in valid_stances
            and s.get("strength") in valid_strengths
        ]
        return result
    except Exception:
        # Safe fallback — conservative defaults; never crash the app
        return {"signals": [], "missing_evidence": []}


# ---------------------------------------------------------------------------
# Deterministic radar scoring — pure Python, no LLM
# ---------------------------------------------------------------------------

def compute_radar_scores(signals: list, missing_evidence: list) -> dict:
    """
    Compute Decision Radar scores from extracted evidence signals.
    All formulas are explicit and deterministic — no LLM involved.

    Returns a dict with:
      evidence_strength, risk_level, stakeholder_alignment,
      uncertainty, action_readiness,
      status, reason, signal_counts
    """

    def _count(**criteria) -> int:
        """Count signals that match ALL given field=value criteria."""
        return sum(
            1 for s in signals
            if all(s.get(k) == v for k, v in criteria.items())
        )

    # ------------------------------------------------------------------ #
    # A. Evidence Strength (0–10)
    # More direct support/validation → higher; more opposition → lower.
    # ------------------------------------------------------------------ #
    ev = 0.0
    ev += _count(type="support",    strength="strong")    * 2.0
    ev += _count(type="validation", strength="strong")    * 2.0
    ev += _count(type="support",    strength="medium")    * 1.0
    ev += _count(type="validation", strength="medium")    * 1.0
    ev += _count(type="support",    strength="weak")      * 0.5
    ev += _count(type="validation", strength="weak")      * 0.5
    ev -= _count(stance="oppose",   strength="strong")    * 1.0
    ev -= _count(stance="oppose",   strength="medium")    * 0.5
    evidence_strength = int(min(10, max(0, round(ev))))

    # ------------------------------------------------------------------ #
    # B. Risk Level (0–10)
    # More unresolved risks and constraints → higher.
    # ------------------------------------------------------------------ #
    rl = 0.0
    rl += _count(type="risk",       strength="strong")    * 2.0
    rl += _count(type="risk",       strength="medium")    * 1.0
    rl += _count(type="risk",       strength="weak")      * 0.5
    rl += _count(type="constraint", strength="strong")    * 1.0
    risk_level = int(min(10, max(0, round(rl))))

    # ------------------------------------------------------------------ #
    # C. Stakeholder Alignment (0–10)
    # High when most speakers lean the same way; low when split.
    # ------------------------------------------------------------------ #
    support_stances = sum(1 for s in signals if s.get("stance") == "support")
    oppose_stances  = sum(1 for s in signals if s.get("stance") == "oppose")
    total_stances   = support_stances + oppose_stances
    if total_stances == 0:
        stakeholder_alignment = 0
    else:
        alignment_ratio = max(support_stances, oppose_stances) / total_stances
        stakeholder_alignment = int(round(alignment_ratio * 10))

    # ------------------------------------------------------------------ #
    # D. Uncertainty (0–10)
    # More missing facts and unclassifiable signals → higher.
    # ------------------------------------------------------------------ #
    unknown_count = sum(1 for s in signals if s.get("type") == "unknown")
    unc = len(missing_evidence) * 2 + unknown_count
    uncertainty = int(min(10, max(0, unc)))

    # ------------------------------------------------------------------ #
    # E. Action Readiness (0–10)
    # Starts at 10; deducted by risks, uncertainty, misalignment.
    # ------------------------------------------------------------------ #
    strong_risk_count = _count(type="risk",       strength="strong")
    medium_risk_count = _count(type="risk",       strength="medium")
    strong_val_count  = _count(type="validation", strength="strong")

    ar = 10.0
    ar -= strong_risk_count * 2.0
    ar -= medium_risk_count * 1.0
    if uncertainty >= 6:
        ar -= 2.0
    if stakeholder_alignment <= 5:
        ar -= 2.0
    ar += strong_val_count * 1.0
    action_readiness = int(min(10, max(0, round(ar))))

    # ------------------------------------------------------------------ #
    # Decision Status (derived from computed scores)
    # ------------------------------------------------------------------ #
    if uncertainty >= 8:
        status = "Not enough info"
    elif action_readiness >= 7 and evidence_strength >= 6 and risk_level <= 4:
        status = "Go"
    elif action_readiness >= 5 and uncertainty <= 6:
        status = "Proceed with caution"
    else:
        status = "Hold"

    # ------------------------------------------------------------------ #
    # Reason string (code-generated, ≤18 words)
    # ------------------------------------------------------------------ #
    if uncertainty >= 8:
        reason = "Uncertainty is too high for a confident decision."
    elif status == "Go":
        reason = "Strong support and low risk suggest readiness."
    elif risk_level >= 6 and stakeholder_alignment <= 5:
        reason = "High risk and mixed alignment lower readiness."
    elif risk_level >= 6:
        reason = "High risk and missing validation lower readiness."
    elif uncertainty >= 6:
        reason = "Key evidence gaps make a confident call premature."
    else:
        reason = "Moderate signals — proceed with defined conditions."

    # ------------------------------------------------------------------ #
    # Signal counts by type (for UI transparency row)
    # ------------------------------------------------------------------ #
    signal_counts = {
        "support":    sum(1 for s in signals if s.get("type") == "support"),
        "risk":       sum(1 for s in signals if s.get("type") == "risk"),
        "validation": sum(1 for s in signals if s.get("type") == "validation"),
        "unknown":    sum(1 for s in signals if s.get("type") == "unknown"),
    }

    return {
        "evidence_strength":     evidence_strength,
        "risk_level":            risk_level,
        "stakeholder_alignment": stakeholder_alignment,
        "uncertainty":           uncertainty,
        "action_readiness":      action_readiness,
        "status":                status,
        "reason":                reason,
        "signal_counts":         signal_counts,
    }
