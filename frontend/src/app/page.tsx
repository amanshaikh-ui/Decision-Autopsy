"use client";

import React, { useState, useRef, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VerdictData {
  recommendation: string;
  confidence: "Low" | "Medium" | "High";
  why: string;
}

interface AutopsyData {
  decision: string;
  status: "Proposed" | "Leaning" | "Unresolved" | "Decided";
  top_risks: string[];
  missing_evidence: string[];
  supporting_evidence: string[];
}

interface SideData {
  summary: string;
  evidence: string[];
}

interface ModeratorData {
  disagreement: string;
  stronger_side: string;
  what_settles_it: string[];
}

interface RebuttalData {
  bullets: string[];
}

interface StakeholderReaction {
  role: string;
  sentiment: "Positive" | "Neutral" | "Negative";
  concern: string;
  quote: string;
}

interface ReactionSimData {
  stakeholders: StakeholderReaction[];
}

interface RadarScores {
  evidence_strength: number;      // computed from support/validation signals
  risk_level: number;             // computed from risk/constraint signals
  stakeholder_alignment: number;  // computed from stance distribution
  uncertainty: number;            // computed from missing evidence + unknowns
  action_readiness: number;       // computed from risks + uncertainty + alignment
}

interface SignalCounts {
  support: number;
  risk: number;
  validation: number;
  unknown: number;
}

interface RadarData {
  scores: RadarScores;
  status: string;        // "Go" | "Proceed with caution" | "Hold" | "Not enough info"
  reason: string;        // code-generated short explanation
  signal_counts: SignalCounts;
  summary: string;       // kept for compat; may be empty
}

interface AnalysisResult {
  verdict: VerdictData;
  autopsy: AutopsyData;
  optimist: SideData;
  pessimist: SideData;
  moderator: ModeratorData;
  rebuttal: RebuttalData;
  reactions: ReactionSimData;
  radar: RadarData;
}

// Radar status → visual style
const radarStatusStyle: Record<string, { badge: string; dot: string }> = {
  "Go":                    { badge: "bg-emerald-500/20 text-emerald-300 border-emerald-700", dot: "bg-emerald-400" },
  "Proceed with caution":  { badge: "bg-yellow-500/20 text-yellow-300 border-yellow-700",   dot: "bg-yellow-400" },
  "Hold":                  { badge: "bg-red-500/20 text-red-300 border-red-700",             dot: "bg-red-400"   },
  "Not enough info":       { badge: "bg-slate-500/20 text-slate-300 border-slate-600",       dot: "bg-slate-400" },
};

// ---------------------------------------------------------------------------
// Citation rendering — splits text on "Speaker (line N): "quote"" patterns
// and highlights them with subtle amber monospace chips.
// Used whenever Strict Citation Mode is ON.
// ---------------------------------------------------------------------------

// Matches: Speaker (line N): "snippet" or Speaker (line N): 'snippet'
const CITE_RE = /([A-Za-z][A-Za-z\s,.']{1,40}?\(line \d+\):\s*(?:"[^"]*"|'[^']*'))/g;
const LINE_NUM_RE = /\(line (\d+)\)/;

function renderWithCitations(
  text: string,
  onCiteClick?: (line: number) => void
): React.ReactNode {
  if (!text.includes("(line ")) return <span>{text}</span>;
  const parts = text.split(CITE_RE);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 !== 1) return <span key={i}>{part}</span>;
        const lineMatch = part.match(LINE_NUM_RE);
        const lineNum = lineMatch ? parseInt(lineMatch[1], 10) : null;
        return (
          <cite
            key={i}
            title={lineNum ? `Click to jump to line ${lineNum} in transcript` : "Transcript citation"}
            onClick={lineNum && onCiteClick ? () => onCiteClick(lineNum) : undefined}
            className={`not-italic font-mono text-[10px] text-amber-400/80 bg-amber-950/40
                       border border-amber-800/40 rounded px-1 mx-0.5 inline-block leading-normal
                       whitespace-nowrap align-middle
                       ${lineNum && onCiteClick ? "cursor-pointer hover:bg-amber-900/60 hover:text-amber-300 hover:border-amber-600 transition-colors" : ""}`}
          >
            {part}
          </cite>
        );
      })}
    </>
  );
}

// CiteText: wraps a string and optionally applies citation rendering
function CiteText({
  text,
  cite,
  className = "",
  onCiteClick,
}: {
  text: string;
  cite: boolean;
  className?: string;
  onCiteClick?: (line: number) => void;
}) {
  return (
    <span className={className}>
      {cite ? renderWithCitations(text, onCiteClick) : text}
    </span>
  );
}

// CitedBulletList: like BulletList but citation-aware per item
function CitedBulletList({
  items,
  color = "text-slate-300",
  cite = false,
  onCiteClick,
}: {
  items: string[];
  color?: string;
  cite?: boolean;
  onCiteClick?: (line: number) => void;
}) {
  if (!items.length) return <p className="text-slate-500 text-xs italic">None identified.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className={`text-sm flex gap-2 ${color}`}>
          <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-current shrink-0 opacity-60" />
          <span>{cite ? renderWithCitations(item, onCiteClick) : item}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Transcript highlighting
// ---------------------------------------------------------------------------

type SegmentType = "none" | "supporting";
interface Segment { text: string; type: SegmentType }

function buildSegments(text: string, supporting: string[]): Segment[] {
  type Mark = { start: number; end: number };
  const marks: Mark[] = [];
  for (const s of supporting) {
    if (!s) continue;
    const i = text.indexOf(s);
    if (i !== -1) marks.push({ start: i, end: i + s.length });
  }
  marks.sort((a, b) => a.start - b.start);
  const segs: Segment[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.start < pos) continue;
    if (m.start > pos) segs.push({ text: text.slice(pos, m.start), type: "none" });
    segs.push({ text: text.slice(m.start, m.end), type: "supporting" });
    pos = m.end;
  }
  if (pos < text.length) segs.push({ text: text.slice(pos), type: "none" });
  return segs.length ? segs : [{ text, type: "none" }];
}

const hlClass: Record<SegmentType, string> = {
  none: "",
  supporting: "bg-emerald-500/25 text-emerald-200 rounded px-0.5",
};

// ---------------------------------------------------------------------------
// Markdown export
// ---------------------------------------------------------------------------

function buildMarkdown(transcript: string, question: string, r: AnalysisResult): string {
  const bul = (arr: string[]) => arr.map((x) => `- ${x}`).join("\n") || "_None_";
  const stakeholders = r.reactions.stakeholders
    .map((s) => `- **${s.role}** (${s.sentiment}): ${s.concern} — _"${s.quote}"_`)
    .join("\n");
  const scores = r.radar.scores;
  return `# Decision Autopsy

**Question:** ${question}

## Instant Verdict
- **Recommendation:** ${r.verdict.recommendation}
- **Confidence:** ${r.verdict.confidence}
- **Why:** ${r.verdict.why}

## Decision Autopsy
- **Decision:** ${r.autopsy.decision}
- **Status:** ${r.autopsy.status}

**Top Risks:**
${bul(r.autopsy.top_risks)}

**Missing Evidence:**
${bul(r.autopsy.missing_evidence)}

## Optimist
${r.optimist.summary}

${bul(r.optimist.evidence)}

## Pessimist
${r.pessimist.summary}

${bul(r.pessimist.evidence)}

## Moderator
- **Core disagreement:** ${r.moderator.disagreement}
- **Stronger side:** ${r.moderator.stronger_side}

**What settles it:**
${bul(r.moderator.what_settles_it)}

## Reaction Simulator
${stakeholders}

## Decision Radar
- Status: ${r.radar.status}
- Evidence Strength: ${scores.evidence_strength}/10
- Risk Level: ${scores.risk_level}/10
- Stakeholder Alignment: ${scores.stakeholder_alignment}/10
- Uncertainty: ${scores.uncertainty}/10
- Action Readiness: ${scores.action_readiness}/10

${r.radar.reason}
Signal counts — Support: ${r.radar.signal_counts.support}, Risk: ${r.radar.signal_counts.risk}, Validation: ${r.radar.signal_counts.validation}, Unknown: ${r.radar.signal_counts.unknown}

## Rebuttal
${bul(r.rebuttal.bullets)}

---
## Transcript
${transcript}
`;
}

// ---------------------------------------------------------------------------
// Copy summary
// ---------------------------------------------------------------------------

function buildCopySummary(question: string, r: AnalysisResult): string {
  return [
    `Question: ${question}`,
    `Verdict: ${r.verdict.recommendation} (${r.verdict.confidence}) — ${r.verdict.why}`,
    `Optimist: ${r.optimist.summary}`,
    `Pessimist: ${r.pessimist.summary}`,
    `Moderator: ${r.moderator.stronger_side}`,
    `Radar: ${r.radar.status} — ${r.radar.reason}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// TTS script
// ---------------------------------------------------------------------------

function buildAudioScript(r: AnalysisResult): string {
  const settles = r.moderator.what_settles_it.slice(0, 2).join(". ");
  return [
    "Decision briefing.",
    `Verdict: ${r.verdict.recommendation}. Confidence: ${r.verdict.confidence}. ${r.verdict.why}.`,
    `Optimist: ${r.optimist.summary}.`,
    `Pessimist: ${r.pessimist.summary}.`,
    `Moderator: ${r.moderator.stronger_side}. ${settles}.`,
    `Decision radar status: ${r.radar.status}. ${r.radar.reason}`,
  ].join(" ");
}

// ---------------------------------------------------------------------------
// UI primitives
// ---------------------------------------------------------------------------

const confidenceStyle: Record<string, string> = {
  High: "bg-emerald-500/20 text-emerald-300 border-emerald-700",
  Medium: "bg-yellow-500/20 text-yellow-300 border-yellow-700",
  Low: "bg-red-500/20 text-red-300 border-red-700",
};

const statusStyle: Record<string, string> = {
  Decided: "bg-sky-500/20 text-sky-300 border-sky-700",
  Leaning: "bg-yellow-500/20 text-yellow-300 border-yellow-700",
  Proposed: "bg-slate-500/20 text-slate-300 border-slate-600",
  Unresolved: "bg-red-500/20 text-red-300 border-red-700",
};

const sentimentStyle: Record<string, { card: string; dot: string; label: string }> = {
  Positive: { card: "bg-emerald-900/25 border-emerald-800/50", dot: "bg-emerald-400", label: "text-emerald-400" },
  Neutral: { card: "bg-slate-800/60 border-slate-700/50", dot: "bg-slate-400", label: "text-slate-400" },
  Negative: { card: "bg-red-900/25 border-red-800/50", dot: "bg-red-400", label: "text-red-400" },
};

function Badge({ label, style }: { label: string; style: string }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${style}`}>{label}</span>
  );
}

function BulletList({ items, color = "text-slate-300" }: { items: string[]; color?: string }) {
  if (!items.length) return <p className="text-slate-500 text-xs italic">None identified.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className={`text-sm flex gap-2 ${color}`}>
          <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-current shrink-0 opacity-60" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function SectionLabel({ text, color }: { text: string; color: string }) {
  return <p className={`text-[11px] font-bold uppercase tracking-[0.12em] mb-3 ${color}`}>{text}</p>;
}

const Card = React.forwardRef<HTMLDivElement, { children: React.ReactNode; className?: string }>(
  ({ children, className = "" }, ref) => (
    <div
      ref={ref}
      className={`bg-slate-900/70 border border-slate-800/80 rounded-2xl p-5 shadow-xl shadow-black/20 ${className}`}
      style={{ backdropFilter: "blur(8px)" }}
    >
      {children}
    </div>
  )
);
Card.displayName = "Card";

function CollapsibleCard({
  title,
  accent,
  children,
  defaultOpen = false,
}: {
  title: string;
  accent: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between group">
        <span className={`text-[11px] font-bold uppercase tracking-[0.12em] ${accent}`}>{title}</span>
        <span className={`text-slate-600 text-xs transition group-hover:text-slate-400 ${open ? "rotate-180" : ""}`}>
          <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 transition-transform duration-200" style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      </button>
      {open && <div className="mt-4 border-t border-slate-800 pt-4">{children}</div>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Agent progress steps — timing is approximate but matches real pipeline order
// ---------------------------------------------------------------------------

const AGENT_STEPS = [
  { label: "Dissecting the decision",        ms: 0    },
  { label: "Extracting evidence signals",    ms: 6000  },
  { label: "Building Optimist case",         ms: 12000 },
  { label: "Building Pessimist case",        ms: 18000 },
  { label: "Running Rebuttal",               ms: 23000 },
  { label: "Moderator synthesizing debate",  ms: 28000 },
  { label: "Simulating stakeholder reactions", ms: 34000 },
  { label: "Computing radar scores",         ms: 40000 },
  { label: "Assembling final briefing",      ms: 44000 },
];

function LoadingSpinner() {
  const [activeStep, setActiveStep] = useState(0);

  // Advance through steps on a timer that mirrors the real agent pipeline
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    AGENT_STEPS.forEach((step, i) => {
      if (i === 0) return; // step 0 is already active
      timers.push(setTimeout(() => setActiveStep(i), step.ms));
    });
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="w-full max-w-2xl">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">

        {/* GIF + headline */}
        <div className="flex items-center gap-4 mb-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/loading.gif"
            alt="Analyzing…"
            className="w-14 h-14 object-contain shrink-0"
            style={{ imageRendering: "pixelated" }}
          />
          <div>
            <p className="text-white font-semibold text-sm">Running autopsy…</p>
            <p className="text-slate-500 text-xs mt-0.5">7 agents · ~45 seconds</p>
          </div>
        </div>

        {/* Step list */}
        <div className="space-y-2">
          {AGENT_STEPS.map((step, i) => {
            const done   = i < activeStep;
            const active = i === activeStep;
            const pending = i > activeStep;
            return (
              <div key={i} className="flex items-center gap-3">
                {/* Icon */}
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all duration-300
                  ${done    ? "bg-emerald-500/20 border border-emerald-600"  : ""}
                  ${active  ? "bg-brand-500/20 border border-brand-500"      : ""}
                  ${pending ? "bg-slate-800 border border-slate-700"         : ""}`}>
                  {done && (
                    <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                      <path d="M2 6l3 3 5-5" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                  {active && (
                    <span className="w-2 h-2 rounded-full bg-brand-500 animate-pulse" />
                  )}
                  {pending && (
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                  )}
                </div>

                {/* Label */}
                <span className={`text-xs transition-all duration-300
                  ${done    ? "text-emerald-400 line-through decoration-emerald-700" : ""}
                  ${active  ? "text-white font-semibold"                             : ""}
                  ${pending ? "text-slate-600"                                       : ""}`}>
                  {step.label}
                </span>

                {/* Active shimmer bar */}
                {active && (
                  <div className="flex-1 h-0.5 rounded-full bg-slate-800 overflow-hidden ml-1">
                    <div className="h-full bg-brand-500/60 rounded-full animate-pulse w-3/4" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reaction Simulator card
// ---------------------------------------------------------------------------

function StakeholderCard({ s, cite = false }: { s: StakeholderReaction; cite?: boolean }) {
  const style = sentimentStyle[s.sentiment] ?? sentimentStyle.Neutral;
  return (
    <div className={`rounded-xl border p-3 ${style.card}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
        <span className="text-white text-xs font-semibold flex-1">{s.role}</span>
        <span className={`text-xs font-medium ${style.label}`}>{s.sentiment}</span>
      </div>
      <p className="text-slate-400 text-xs mb-1.5">
        {cite ? renderWithCitations(s.concern) : s.concern}
      </p>
      <p className={`text-xs italic ${style.label}`}>
        &ldquo;{cite ? renderWithCitations(s.quote) : s.quote}&rdquo;
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decision Radar — pure SVG pentagon chart
// ---------------------------------------------------------------------------

const RADAR_AXES: { key: keyof RadarScores; label: string }[] = [
  { key: "evidence_strength",     label: "Evidence" },
  { key: "risk_level",            label: "Risk" },
  { key: "stakeholder_alignment", label: "Alignment" },
  { key: "uncertainty",           label: "Uncertainty" },
  { key: "action_readiness",      label: "Readiness" },
];

const N = RADAR_AXES.length;
const CX = 120, CY = 120, R = 80;

function radarAngle(i: number) {
  return (Math.PI * 2 * i) / N - Math.PI / 2;
}

function radarPoint(i: number, value: number): [number, number] {
  const a = radarAngle(i);
  const r = (Math.max(0, Math.min(10, value)) / 10) * R;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

function outerPoint(i: number, extra = 0): [number, number] {
  const a = radarAngle(i);
  return [CX + (R + extra) * Math.cos(a), CY + (R + extra) * Math.sin(a)];
}

function gridPoints(level: number): string {
  return Array.from({ length: N }, (_, i) => {
    const a = radarAngle(i);
    const r = (level / 10) * R;
    return `${CX + r * Math.cos(a)},${CY + r * Math.sin(a)}`;
  }).join(" ");
}

function RadarChart({ scores }: { scores: RadarScores }) {
  const values = RADAR_AXES.map((a) => scores[a.key] ?? 5);
  const dataPoints = values.map((v, i) => radarPoint(i, v));
  const polygon = dataPoints.map(([x, y]) => `${x},${y}`).join(" ");

  return (
    <svg viewBox="0 0 240 240" className="w-full max-w-[260px] mx-auto">
      {/* Grid rings */}
      {[2, 4, 6, 8, 10].map((lvl) => (
        <polygon
          key={lvl}
          points={gridPoints(lvl)}
          fill="none"
          stroke="#1e293b"
          strokeWidth={lvl === 10 ? 1 : 0.6}
        />
      ))}

      {/* Axis spokes */}
      {Array.from({ length: N }, (_, i) => {
        const [ox, oy] = outerPoint(i);
        return (
          <line key={i} x1={CX} y1={CY} x2={ox} y2={oy} stroke="#1e293b" strokeWidth="0.8" />
        );
      })}

      {/* Score polygon */}
      <polygon
        points={polygon}
        fill="rgba(79,102,247,0.18)"
        stroke="rgb(79,102,247)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* Score dots */}
      {dataPoints.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3.5" fill="rgb(79,102,247)" />
      ))}

      {/* Axis labels + score values */}
      {RADAR_AXES.map((axis, i) => {
        const [lx, ly] = outerPoint(i, 22);
        const cos = Math.cos(radarAngle(i));
        const anchor = Math.abs(cos) < 0.15 ? "middle" : cos > 0 ? "start" : "end";
        const [dx, dy] = dataPoints[i];
        return (
          <g key={i}>
            <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle"
              fill="#64748b" fontSize="9" fontWeight="500">
              {axis.label}
            </text>
            <text x={dx} y={dy - 7} textAnchor="middle" dominantBaseline="auto"
              fill="#e2e8f0" fontSize="8" fontWeight="700">
              {values[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const EXAMPLE_TRANSCRIPT = `CEO: We promised investors a Q1 launch. It's already March. We need to ship Friday.
Engineering Lead: We have 14 open bugs. Three of them are critical — one causes data loss on Android.
Product Manager: The core user journey works fine. The bugs are edge cases. Beta users gave us 4.2 stars.
Engineering Lead: Edge cases that affect 20% of Android users are not edge cases. That's one in five people losing their data.
Sales Lead: The client signed based on a Friday launch date. If we slip, we risk the contract.
Designer: The onboarding flow still has usability issues. Our own testers got confused at step 3.
CEO: We can patch the data loss bug tonight. Ship Friday, hotfix Saturday.
Engineering Lead: We've said "hotfix tomorrow" three times this sprint. It never happens.
QA Lead: We haven't done a full regression test since the last major refactor two weeks ago.
Product Manager: Competitors are launching next month. First-mover advantage is real.
Engineering Lead: Shipping broken software is not first-mover advantage. It's first-mover liability.`;

const EXAMPLE_QUESTION = "Should we launch the product this Friday?";

export default function Home() {
  const [transcript, setTranscript] = useState("");
  const [question, setQuestion] = useState("");
  const [strictCitations, setStrictCitations] = useState(false);
  const [tone, setTone] = useState(3);          // 1=Polite … 5=Savage
  const [activeTone, setActiveTone] = useState(3); // tone used for current result
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeCitations, setActiveCitations] = useState(false); // reflects what the result was generated with
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const [transcriptViewerOpen, setTranscriptViewerOpen] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const transcriptViewerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Record<number, HTMLElement | null>>({});

  async function runAnalysis() {
    if (!transcript.trim() || !question.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    stopAudio();
    try {
      const res = await fetch(`${API_URL}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, question, strict_citations: strictCitations, tone }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Analysis failed");
      }
      setResult(await res.json());
      setActiveCitations(strictCitations);
      setActiveTone(tone);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function playAudio() {
    if (!result || !("speechSynthesis" in window)) return;
    stopAudio();
    const utt = new SpeechSynthesisUtterance(buildAudioScript(result));
    utt.rate = 0.95;
    utt.onend = () => setSpeaking(false);
    utt.onerror = () => setSpeaking(false);
    utteranceRef.current = utt;
    window.speechSynthesis.speak(utt);
    setSpeaking(true);
  }

  function stopAudio() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }

  async function copySummary() {
    if (!result) return;
    await navigator.clipboard.writeText(buildCopySummary(question, result));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function jumpToLine(lineNum: number) {
    setTranscriptViewerOpen(true);
    setHighlightedLine(lineNum);
    // Scroll after the viewer has opened and rendered
    setTimeout(() => {
      const el = lineRefs.current[lineNum];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        transcriptViewerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      // Clear flash after 2.5 seconds
      setTimeout(() => setHighlightedLine(null), 2500);
    }, 120);
  }

  function exportMarkdown() {
    if (!result) return;
    const blob = new Blob([buildMarkdown(transcript, question, result)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "decision-autopsy.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  const segments = result ? buildSegments(transcript, result.autopsy.supporting_evidence) : [];
  const hasHighlights = result && result.autopsy.supporting_evidence.length > 0;

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-14 gap-8"
          style={{ background: "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(99,102,241,0.12) 0%, transparent 70%), #020617" }}>

      {/* Homepage link — top right */}
      <div className="w-full max-w-2xl flex justify-end mb-[-1rem]">
        <a
          href="https://homepage-nu-silk.vercel.app/"
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300
                     border border-slate-800 hover:border-slate-700 bg-slate-900/60
                     rounded-full px-3 py-1.5 transition"
        >
          <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3">
            <path d="M2 8.5L8 2l6 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M4 7v7h3v-4h2v4h3V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          About this project
        </a>
      </div>

      {/* Header */}
      <header className="text-center max-w-xl flex flex-col items-center gap-3">
        <h1 className="text-4xl font-extrabold tracking-tight text-white">
          Decision{" "}
          <span className="bg-gradient-to-r from-brand-400 to-violet-400 bg-clip-text text-transparent">
            Autopsy
          </span>
        </h1>
        <p className="text-slate-400 text-sm">AI-powered decision intelligence for teams</p>
        <div className="flex items-center gap-2 mt-1">
          {["Paste transcript", "Ask a question", "Get a briefing"].map((s, i) => (
            <span key={s} className="flex items-center gap-2">
              <span className="text-xs text-slate-500 bg-slate-900 border border-slate-800 rounded-full px-3 py-1">{s}</span>
              {i < 2 && <span className="text-slate-700 text-xs">→</span>}
            </span>
          ))}
        </div>
      </header>

      {/* Input card */}
      <div className="w-full max-w-2xl bg-slate-900/80 border border-slate-800 rounded-3xl p-7 shadow-2xl shadow-black/40 space-y-5"
           style={{ backdropFilter: "blur(12px)" }}>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="transcript" className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">
              <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 text-slate-500">
                <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M5 6h6M5 9h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Decision Transcript
            </label>
            <button
              type="button"
              onClick={() => { setTranscript(EXAMPLE_TRANSCRIPT); setQuestion(EXAMPLE_QUESTION); }}
              className="flex items-center gap-1.5 text-[11px] font-medium text-brand-400
                         hover:text-brand-300 transition px-2 py-1 rounded-lg
                         bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/20"
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3">
                <path d="M2 8h12M8 2l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Try an example
            </button>
          </div>
          <textarea
            id="transcript"
            rows={8}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Paste the transcript or description of the decision here…"
            className="w-full rounded-2xl bg-slate-800/60 border border-slate-700/60 text-slate-100
                       placeholder-slate-600 px-4 py-3 text-sm resize-y focus:outline-none
                       focus:ring-2 focus:ring-brand-500/70 focus:border-brand-500/50 transition"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="question" className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">
            <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 text-slate-500">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M8 5.5C8 5.5 6.5 5.5 6.5 7C6.5 8.5 8 8.5 8 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="8" cy="11.5" r="0.75" fill="currentColor"/>
            </svg>
            Your Question
          </label>
          <input
            id="question"
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Was this the right call?"
            className="w-full rounded-2xl bg-slate-800/60 border border-slate-700/60 text-slate-100
                       placeholder-slate-600 px-4 py-3 text-sm focus:outline-none
                       focus:ring-2 focus:ring-brand-500/70 focus:border-brand-500/50 transition"
            onKeyDown={(e) => e.key === "Enter" && runAnalysis()}
          />
        </div>

        {/* Tone slider */}
        {(() => {
          const TONE_LABELS = ["", "Polite", "Balanced", "Blunt", "Harsh", "Savage"];
          const TONE_COLORS = ["", "text-sky-400", "text-emerald-400", "text-slate-300", "text-orange-400", "text-red-400"];
          const TONE_TRACK  = ["", "bg-sky-500", "bg-emerald-500", "bg-slate-500", "bg-orange-500", "bg-red-500"];
          return (
            <div className="flex flex-col gap-2 px-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-300">Tone</span>
                  <span className={`text-xs font-bold transition-colors ${TONE_COLORS[tone]}`}>
                    {TONE_LABELS[tone]}
                    {tone === 5 && " 🔥"}
                  </span>
                </div>
                <span className="text-[11px] text-slate-500">
                  {tone <= 2 ? "Diplomatic and measured"
                    : tone === 3 ? "Direct, no fluff"
                    : tone === 4 ? "Sharp and unsparing"
                    : "Brutally honest, no mercy"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-slate-600 shrink-0">Polite</span>
                <div className="relative flex-1 h-5 flex items-center">
                  <div className="w-full h-1 rounded-full bg-slate-800">
                    <div
                      className={`h-full rounded-full transition-all ${TONE_TRACK[tone]}`}
                      style={{ width: `${((tone - 1) / 4) * 100}%` }}
                    />
                  </div>
                  <input
                    type="range" min={1} max={5} step={1} value={tone}
                    onChange={(e) => setTone(Number(e.target.value))}
                    className="absolute inset-0 w-full opacity-0 cursor-pointer h-5"
                    aria-label="Tone slider"
                  />
                  {/* tick marks */}
                  <div className="absolute inset-x-0 flex justify-between px-0 pointer-events-none">
                    {[1,2,3,4,5].map((v) => (
                      <span key={v} className={`w-1.5 h-1.5 rounded-full transition-colors ${v <= tone ? TONE_TRACK[tone] : "bg-slate-700"}`} />
                    ))}
                  </div>
                </div>
                <span className="text-[10px] text-slate-600 shrink-0">Savage</span>
              </div>
            </div>
          );
        })()}

        {/* Strict Citation Mode toggle */}
        <div className="flex items-center justify-between px-1">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold text-slate-300">Strict Citation Mode</span>
            <span className="text-[11px] text-slate-500">
              {strictCitations
                ? "Every claim will be grounded in transcript evidence"
                : "Compact output — toggle ON for cited analysis"}
            </span>
          </div>
          <button
            role="switch"
            aria-checked={strictCitations}
            onClick={() => setStrictCitations((v) => !v)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2
                        transition-colors duration-200 focus:outline-none focus:ring-2
                        focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-900
                        ${strictCitations
                          ? "border-amber-500 bg-amber-500"
                          : "border-slate-600 bg-slate-700"}`}
          >
            <span
              className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform duration-200
                          ${strictCitations ? "translate-x-5" : "translate-x-0.5"}`}
            />
          </button>
        </div>

        <button
          onClick={runAnalysis}
          disabled={loading || !transcript.trim() || !question.trim()}
          className="w-full py-3.5 rounded-2xl font-semibold text-sm tracking-wide transition-all
                     active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed
                     flex items-center justify-center gap-2.5
                     bg-gradient-to-r from-brand-500 to-violet-500
                     hover:from-brand-400 hover:to-violet-400
                     text-white shadow-lg shadow-brand-500/20"
        >
          {loading ? (
            <>
              <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Running…
            </>
          ) : (
            <>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.84Z"/>
              </svg>
              Run Autopsy
            </>
          )}
        </button>

        {/* Short transcript warning */}
        {transcript.trim() && transcript.trim().split("\n").filter(l => l.trim()).length < 4 && (
          <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-amber-950/40 border border-amber-800/50">
            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-amber-400 shrink-0 mt-0.5">
              <path d="M8 2L14 13H2L8 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M8 6v3M8 11v0.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <div>
              <p className="text-amber-400 text-xs font-semibold">Short transcript detected</p>
              <p className="text-amber-600 text-[11px] mt-0.5">
                Only {transcript.trim().split("\n").filter(l => l.trim()).length} lines found. The analysis works best with 6+ lines of conversation. Results may be limited.
              </p>
            </div>
          </div>
        )}

        {error && (
          <p className="text-red-400 text-xs bg-red-900/20 border border-red-800 rounded-xl px-4 py-2">
            {error}
          </p>
        )}
      </div>

      {loading && <LoadingSpinner />}

      {result && (
        <div className="w-full max-w-2xl flex flex-col gap-4">

          {/* Action bar */}
          <div className="flex flex-wrap gap-2 justify-between items-center bg-slate-900/60 border border-slate-800/60 rounded-2xl px-4 py-2.5"
               style={{ backdropFilter: "blur(8px)" }}>
            {/* Left: badges */}
            {(() => {
              const TONE_LABELS = ["", "Polite", "Balanced", "Blunt", "Harsh", "Savage"];
              const TONE_BADGE  = ["", "bg-sky-950/60 border-sky-800/60 text-sky-400", "bg-emerald-950/60 border-emerald-800/60 text-emerald-400", "bg-slate-800/60 border-slate-700/60 text-slate-300", "bg-orange-950/60 border-orange-800/60 text-orange-400", "bg-red-950/60 border-red-800/60 text-red-400"];
              return (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">Results</span>
                  <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${TONE_BADGE[activeTone]}`}>
                    {activeTone === 5 ? "🔥" : "🎚️"} {TONE_LABELS[activeTone]}
                  </span>
                  {activeCitations && (
                    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full
                                     bg-amber-950/60 border border-amber-800/60 text-amber-400 text-[11px] font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                      Citations ON
                    </span>
                  )}
                </div>
              );
            })()}
            {/* Right: action buttons */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={speaking ? stopAudio : playAudio}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-700/80
                           text-slate-400 hover:text-white hover:border-slate-500 hover:bg-slate-800/60
                           text-xs font-medium transition"
              >
                {speaking ? (
                  <><span className="w-2 h-2 rounded-sm bg-red-400 inline-block animate-pulse" />Stop</>
                ) : (
                  <><svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                    <path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.84Z" />
                  </svg>Listen</>
                )}
              </button>
              <button
                onClick={copySummary}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-700/80
                           text-slate-400 hover:text-white hover:border-slate-500 hover:bg-slate-800/60
                           text-xs font-medium transition"
              >
                {copied ? (
                  <><svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 text-emerald-400"><path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span className="text-emerald-400">Copied</span></>
                ) : (
                  <><svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" stroke="currentColor" strokeWidth="1.5"/></svg>
                  Copy</>
                )}
              </button>
              <button
                onClick={exportMarkdown}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-700/80
                           text-slate-400 hover:text-white hover:border-slate-500 hover:bg-slate-800/60
                           text-xs font-medium transition"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
                  <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
                </svg>
                Export
              </button>
            </div>
          </div>

          {/* KPI headline row */}
          {(() => {
            const s = result.radar.scores;
            const status = result.radar.status;
            const statusKpi =
              status === "Go"                   ? { bg: "bg-emerald-500/10", border: "border-emerald-600/40", text: "text-emerald-400", dot: "bg-emerald-400" }
              : status === "Proceed with caution" ? { bg: "bg-amber-500/10",   border: "border-amber-600/40",   text: "text-amber-400",   dot: "bg-amber-400"   }
              : status === "Hold"                 ? { bg: "bg-rose-500/10",    border: "border-rose-600/40",    text: "text-rose-400",    dot: "bg-rose-400"    }
              :                                    { bg: "bg-slate-800",       border: "border-slate-700",      text: "text-slate-400",   dot: "bg-slate-400"   };

            const kpis = [
              {
                label: "Action Readiness",
                value: `${s.action_readiness}/10`,
                sub: s.action_readiness >= 7 ? "High" : s.action_readiness >= 5 ? "Moderate" : "Low",
                subColor: s.action_readiness >= 7 ? "text-emerald-400" : s.action_readiness >= 5 ? "text-amber-400" : "text-rose-400",
                bar: s.action_readiness / 10,
                barColor: s.action_readiness >= 7 ? "bg-emerald-500" : s.action_readiness >= 5 ? "bg-amber-500" : "bg-rose-500",
              },
              {
                label: "Risk Level",
                value: `${s.risk_level}/10`,
                sub: s.risk_level >= 7 ? "High" : s.risk_level >= 4 ? "Moderate" : "Low",
                subColor: s.risk_level >= 7 ? "text-rose-400" : s.risk_level >= 4 ? "text-amber-400" : "text-emerald-400",
                bar: s.risk_level / 10,
                barColor: s.risk_level >= 7 ? "bg-rose-500" : s.risk_level >= 4 ? "bg-amber-500" : "bg-emerald-500",
              },
              {
                label: "Evidence Strength",
                value: `${s.evidence_strength}/10`,
                sub: s.evidence_strength >= 7 ? "Strong" : s.evidence_strength >= 4 ? "Moderate" : "Weak",
                subColor: s.evidence_strength >= 7 ? "text-emerald-400" : s.evidence_strength >= 4 ? "text-amber-400" : "text-rose-400",
                bar: s.evidence_strength / 10,
                barColor: s.evidence_strength >= 7 ? "bg-emerald-500" : s.evidence_strength >= 4 ? "bg-amber-500" : "bg-rose-500",
              },
            ];

            return (
              <div className="grid grid-cols-2 gap-3">
                {/* Status card — spans full width on small, left column on larger */}
                <div className={`col-span-2 sm:col-span-1 rounded-2xl border p-4 flex flex-col justify-between ${statusKpi.bg} ${statusKpi.border}`}>
                  <p className="text-slate-400 text-xs font-medium uppercase tracking-widest mb-2">Decision Status</p>
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusKpi.dot}`} />
                    <span className={`text-xl font-bold ${statusKpi.text}`}>{status}</span>
                  </div>
                  <p className="text-slate-500 text-xs mt-2 leading-relaxed">{result.radar.reason}</p>
                </div>

                {/* 3 metric cards */}
                {kpis.map((k) => (
                  <div key={k.label} className="rounded-2xl border border-slate-800 bg-slate-900 p-4 flex flex-col gap-2">
                    <p className="text-slate-400 text-xs font-medium uppercase tracking-widest">{k.label}</p>
                    <div className="flex items-end justify-between">
                      <span className="text-2xl font-bold text-white">{k.value}</span>
                      <span className={`text-xs font-semibold ${k.subColor}`}>{k.sub}</span>
                    </div>
                    {/* progress bar */}
                    <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
                      <div className={`h-full rounded-full ${k.barColor}`} style={{ width: `${k.bar * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* 1 — Instant Verdict */}
          <div className="relative">
            <div className="absolute left-0 top-4 bottom-4 w-0.5 rounded-full bg-gradient-to-b from-brand-500 to-violet-500" />
            <Card className="border-brand-500/30 pl-6">
              <SectionLabel text="Instant Verdict" color="text-brand-400" />
              <p className="text-white font-bold text-xl mb-3 leading-snug">
                <CiteText text={result.verdict.recommendation} cite={activeCitations} onCiteClick={jumpToLine} />
              </p>
              <div className="flex flex-wrap gap-2 items-center">
                <Badge
                  label={`${result.verdict.confidence} confidence`}
                  style={confidenceStyle[result.verdict.confidence] ?? confidenceStyle.Medium}
                />
                <CiteText text={result.verdict.why} cite={activeCitations} className="text-slate-400 text-sm" onCiteClick={jumpToLine} />
              </div>
            </Card>
          </div>

          {/* 2 — Decision Autopsy */}
          <div className="relative">
            <div className="absolute left-0 top-4 bottom-4 w-0.5 rounded-full bg-violet-500/60" />
          <Card className="pl-6">
              <SectionLabel text="Decision Autopsy" color="text-violet-400" />
              <p className="text-slate-200 text-sm font-medium mb-1">
                <CiteText text={result.autopsy.decision} cite={activeCitations} onCiteClick={jumpToLine} />
              </p>
              <div className="mb-4">
                <Badge
                  label={result.autopsy.status}
                  style={statusStyle[result.autopsy.status] ?? statusStyle.Unresolved}
                />
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <SectionLabel text="Top Risks" color="text-orange-400" />
                  <CitedBulletList items={result.autopsy.top_risks} color="text-orange-200" cite={activeCitations} onCiteClick={jumpToLine} />
                </div>
                <div>
                  <SectionLabel text="Missing Evidence" color="text-red-400" />
                  <CitedBulletList items={result.autopsy.missing_evidence} color="text-red-200" cite={activeCitations} onCiteClick={jumpToLine} />
                </div>
              </div>
            </Card>
          </div>

          {/* 3 & 4 — Optimist / Pessimist side by side on wide, stacked on mobile */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="relative">
              <div className="absolute left-0 top-4 bottom-4 w-0.5 rounded-full bg-emerald-500/60" />
              <Card className="pl-6 h-full">
                <SectionLabel text="Optimist" color="text-emerald-400" />
                <p className="text-slate-200 text-sm mb-3">
                  <CiteText text={result.optimist.summary} cite={activeCitations} onCiteClick={jumpToLine} />
                </p>
                <CitedBulletList items={result.optimist.evidence} color="text-emerald-200" cite={activeCitations} onCiteClick={jumpToLine} />
              </Card>
            </div>
            <div className="relative">
              <div className="absolute left-0 top-4 bottom-4 w-0.5 rounded-full bg-orange-500/60" />
              <Card className="pl-6 h-full">
                <SectionLabel text="Pessimist" color="text-orange-400" />
                <p className="text-slate-200 text-sm mb-3">
                  <CiteText text={result.pessimist.summary} cite={activeCitations} onCiteClick={jumpToLine} />
                </p>
                <CitedBulletList items={result.pessimist.evidence} color="text-orange-200" cite={activeCitations} onCiteClick={jumpToLine} />
              </Card>
            </div>
          </div>

          {/* 5 — Moderator */}
          <div className="relative">
            <div className="absolute left-0 top-4 bottom-4 w-0.5 rounded-full bg-sky-500/60" />
          <Card className="pl-6">
            <SectionLabel text="Moderator" color="text-sky-400" />
            <div className="space-y-3">
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Core disagreement</p>
                <p className="text-slate-200 text-sm">
                  <CiteText text={result.moderator.disagreement} cite={activeCitations} onCiteClick={jumpToLine} />
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Stronger side</p>
                <p className="text-slate-200 text-sm">
                  <CiteText text={result.moderator.stronger_side} cite={activeCitations} onCiteClick={jumpToLine} />
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-2">What settles it</p>
                <CitedBulletList items={result.moderator.what_settles_it} color="text-sky-200" cite={activeCitations} onCiteClick={jumpToLine} />
              </div>
            </div>
          </Card>
          </div>

          {/* 6 — Reaction Simulator */}
          <div className="relative">
            <div className="absolute left-0 top-4 bottom-4 w-0.5 rounded-full bg-fuchsia-500/60" />
            <Card className="pl-6">
              <SectionLabel text="Reaction Simulator" color="text-fuchsia-400" />
              <div className="grid grid-cols-1 gap-2.5">
                {result.reactions.stakeholders.map((s, i) => (
                  <StakeholderCard key={i} s={s} cite={activeCitations} />
                ))}
              </div>
            </Card>
          </div>

          {/* 7 — Decision Radar */}
          <Card>
            {/* Header row: label + status badge */}
            <div className="flex items-center justify-between mb-1">
              <SectionLabel text="Decision Radar" color="text-indigo-400" />
              {(() => {
                const s = radarStatusStyle[result.radar.status] ?? radarStatusStyle["Hold"];
                return (
                  <span className={`flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded border ${s.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                    {result.radar.status}
                  </span>
                );
              })()}
            </div>

            {/* Radar chart — unchanged SVG */}
            <RadarChart scores={result.radar.scores} />

            {/* Score grid */}
            <div className="mt-3 grid grid-cols-5 gap-1 text-center">
              {RADAR_AXES.map((axis) => (
                <div key={axis.key}>
                  <p className="text-slate-500 text-[10px]">{axis.label}</p>
                  <p className="text-white text-sm font-bold">{result.radar.scores[axis.key]}</p>
                </div>
              ))}
            </div>

            {/* Code-generated reason */}
            <p className="mt-3 text-slate-400 text-xs text-center italic">
              {result.radar.reason}
            </p>

            {/* Signal counts transparency row */}
            <div className="mt-3 pt-3 border-t border-slate-800 flex flex-wrap justify-center gap-x-4 gap-y-1">
              {[
                { label: "Support",    count: result.radar.signal_counts.support,    color: "text-emerald-400" },
                { label: "Risk",       count: result.radar.signal_counts.risk,       color: "text-orange-400"  },
                { label: "Validation", count: result.radar.signal_counts.validation, color: "text-sky-400"     },
                { label: "Unknown",    count: result.radar.signal_counts.unknown,    color: "text-slate-400"   },
              ].map(({ label, count, color }) => (
                <span key={label} className="flex items-center gap-1 text-[11px]">
                  <span className={`font-semibold ${color}`}>{count}</span>
                  <span className="text-slate-500">{label}</span>
                </span>
              ))}
              <span className="flex items-center gap-1 text-[11px]">
                <span className="font-semibold text-slate-400">{result.radar.signal_counts.support + result.radar.signal_counts.risk + result.radar.signal_counts.validation + result.radar.signal_counts.unknown}</span>
                <span className="text-slate-600">signals total</span>
              </span>
            </div>
          </Card>

          {/* 8 — Rebuttal (collapsed) */}
          <CollapsibleCard title="Rebuttal — Optimist responds" accent="text-slate-400" defaultOpen={false}>
            <CitedBulletList items={result.rebuttal.bullets} color="text-slate-300" cite={activeCitations} onCiteClick={jumpToLine} />
          </CollapsibleCard>

          {/* 9 — Transcript viewer — always shown when result exists */}
          {(() => {
            const lines = transcript.split("\n").filter((l) => l.trim());
            return (
              <Card ref={transcriptViewerRef as React.Ref<HTMLDivElement>}>
                <button
                  onClick={() => setTranscriptViewerOpen((o) => !o)}
                  className="w-full flex items-center justify-between group"
                >
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                      Transcript Viewer
                    </p>
                    {activeCitations && (
                      <span className="text-[10px] text-amber-500/80 font-medium">
                        · click citations to jump here
                      </span>
                    )}
                  </div>
                  <svg
                    viewBox="0 0 16 16" fill="none"
                    className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-transform duration-200"
                    style={{ transform: transcriptViewerOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                  >
                    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>

                {transcriptViewerOpen && (
                  <div className="mt-4 border-t border-slate-800 pt-4">
                    {hasHighlights && (
                      <div className="flex gap-3 mb-3 text-xs">
                        <span className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/50" />
                          <span className="text-slate-500">Supporting evidence</span>
                        </span>
                        {activeCitations && (
                          <span className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/40" />
                            <span className="text-slate-500">Cited line</span>
                          </span>
                        )}
                      </div>
                    )}
                    <div className="bg-slate-800/60 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                      {lines.map((line, idx) => {
                        const lineNum = idx + 1;
                        const isHighlighted = highlightedLine === lineNum;
                        // check if this line text appears in supporting evidence
                        const isSupporting = result?.autopsy.supporting_evidence.some(
                          (ev) => line.includes(ev.slice(0, 20))
                        );
                        return (
                          <div
                            key={lineNum}
                            ref={(el) => { lineRefs.current[lineNum] = el; }}
                            className={`flex gap-3 px-4 py-1.5 text-sm transition-all duration-300
                              ${isHighlighted
                                ? "bg-amber-500/20 border-l-2 border-amber-400"
                                : isSupporting
                                  ? "bg-emerald-500/8 border-l-2 border-emerald-700/50"
                                  : "border-l-2 border-transparent"
                              }`}
                          >
                            <span className="text-slate-600 text-xs font-mono w-5 shrink-0 pt-0.5 select-none">
                              {lineNum}
                            </span>
                            <span className={`leading-relaxed ${isHighlighted ? "text-amber-200" : isSupporting ? "text-emerald-200" : "text-slate-300"}`}>
                              {line}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </Card>
            );
          })()}

        </div>
      )}
    </main>
  );
}
