"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  Compass,
  Database,
  FileJson,
  Map,
  Play,
  RefreshCcw,
  Route,
  Search,
  SlidersHorizontal
} from "lucide-react";
import { AgentStep, Budget, Pace, PipelineResult } from "@/lib/travel/types";

type FormState = {
  city: string;
  days: number;
  budget: Budget;
  pace: Pace;
  interests: string;
  notes: string;
};

const defaultForm: FormState = {
  city: "Istanbul",
  days: 3,
  budget: "medium",
  pace: "balanced",
  interests: "history, food, views, local",
  notes: "İlk kez gidiyorum, çok yorucu olmayan ama dolu bir rota istiyorum."
};

const iconMap = {
  "preference-agent": SlidersHorizontal,
  "city-research-agent": Search,
  "local-reality-agent": Database,
  "route-planner-agent": Route,
  "hard-validator": ClipboardCheck,
  "evaluator-agent": BrainCircuit,
  "repair-agent": RefreshCcw,
  "final-itinerary-agent": Map
};

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function stepIcon(step: AgentStep) {
  return iconMap[step.id as keyof typeof iconMap] || FileJson;
}

export default function Home() {
  const [form, setForm] = useState<FormState>(defaultForm);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");

  const selectedStep = useMemo(() => {
    if (!result?.steps.length) return null;
    return result.steps.find((step) => step.id === selectedStepId) || result.steps[0];
  }, [result, selectedStepId]);

  async function runPipeline() {
    setIsRunning(true);
    setError("");

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...form,
          interests: form.interests
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Pipeline failed.");
      }

      setResult(payload);
      setSelectedStepId(payload.steps[0]?.id || "");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Pipeline failed.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-mark" />
            <div>
              <h1>Travel Agent Playground</h1>
              <p>Agentic rota üretim akışını input, output ve skorlarla izle.</p>
            </div>
          </div>
          <div className="status-pill">
            {result ? `${result.steps.length} step · ${result.iterations} iteration` : "Mock search + modular agents"}
          </div>
        </div>
      </header>

      <div className="workspace">
        <aside className="panel control-panel">
          <h2>Run Configuration</h2>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="city">City</label>
              <input
                id="city"
                value={form.city}
                onChange={(event) => setForm({ ...form, city: event.target.value })}
              />
            </div>

            <div className="form-row">
              <div className="field">
                <label htmlFor="days">Days</label>
                <input
                  id="days"
                  type="number"
                  min={1}
                  max={7}
                  value={form.days}
                  onChange={(event) => setForm({ ...form, days: Number(event.target.value) })}
                />
              </div>

              <div className="field">
                <label htmlFor="budget">Budget</label>
                <select
                  id="budget"
                  value={form.budget}
                  onChange={(event) => setForm({ ...form, budget: event.target.value as Budget })}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="pace">Pace</label>
              <select
                id="pace"
                value={form.pace}
                onChange={(event) => setForm({ ...form, pace: event.target.value as Pace })}
              >
                <option value="relaxed">Relaxed</option>
                <option value="balanced">Balanced</option>
                <option value="intense">Intense</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="interests">Interests</label>
              <input
                id="interests"
                value={form.interests}
                onChange={(event) => setForm({ ...form, interests: event.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="notes">Notes</label>
              <textarea
                id="notes"
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
            </div>
          </div>

          <button className="run-button" onClick={runPipeline} disabled={isRunning}>
            <Play size={17} />
            {isRunning ? "Running pipeline" : "Run playground"}
          </button>

          {error ? <div className="error">{error}</div> : null}
        </aside>

        <section className="main-grid">
          <div className="panel flow-panel">
            <div className="flow-header">
              <h2>Agent Flow</h2>
              <span className="status-pill">
                {result ? `Score ${result.evaluation.score}/100` : "Waiting for first run"}
              </span>
            </div>

            {result ? (
              <div className="flow-canvas">
                {result.steps.map((step, index) => {
                  const Icon = stepIcon(step);
                  const isActive = selectedStep?.id === step.id;

                  return (
                    <button
                      key={`${step.id}-${index}`}
                      className={`flow-node ${isActive ? "active" : ""}`}
                      onClick={() => setSelectedStepId(step.id)}
                    >
                      <div className="node-top">
                        <div className="node-icon">
                          <Icon size={17} />
                        </div>
                        <span className="node-index">{String(index + 1).padStart(2, "0")}</span>
                      </div>
                      <strong>{step.title}</strong>
                      <span>{step.role}</span>
                      <span>{step.durationMs} ms · {step.status}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">
                <div>
                  <Compass size={42} />
                  <p>Sol panelden bir şehir girip pipeline’ı çalıştırınca veri akışı burada görünecek.</p>
                </div>
              </div>
            )}
          </div>

          {selectedStep ? (
            <div className="detail-grid">
              <div className="panel detail-panel">
                <div className="section-header">
                  <h3>{selectedStep.title} Input</h3>
                  <span className="status-pill">{selectedStep.id}</span>
                </div>
                <pre className="json-box">{prettyJson(selectedStep.input)}</pre>
              </div>

              <div className="panel detail-panel">
                <div className="section-header">
                  <h3>{selectedStep.title} Output</h3>
                  <span className="status-pill">{selectedStep.durationMs} ms</span>
                </div>
                <pre className="json-box">{prettyJson(selectedStep.output)}</pre>
              </div>
            </div>
          ) : null}

          {result ? (
            <div className="panel result-panel">
              <div className="section-header">
                <h2>Final Itinerary</h2>
                <span className="status-pill">
                  {result.validation.passed ? "Validator passed" : "Validator has issues"}
                </span>
              </div>

              <div className="score-strip">
                <div className="score-box">
                  <b>{result.evaluation.score}</b>
                  <span>Overall</span>
                </div>
                <div className="score-box">
                  <b>{result.evaluation.budgetScore}</b>
                  <span>Budget</span>
                </div>
                <div className="score-box">
                  <b>{result.evaluation.timeEfficiencyScore}</b>
                  <span>Time</span>
                </div>
                <div className="score-box">
                  <b>{result.evaluation.interestMatchScore}</b>
                  <span>Interest match</span>
                </div>
              </div>

              {result.evaluation.issues.length ? (
                <div className="error">
                  <AlertTriangle size={14} /> {result.evaluation.issues.join(" ")}
                </div>
              ) : (
                <p className="status-pill">
                  <CheckCircle2 size={14} /> {result.finalItinerary.narrative}
                </p>
              )}

              <div className="day-list" style={{ marginTop: 16 }}>
                {result.finalItinerary.days.map((day) => (
                  <article className="day-card" key={day.day}>
                    <h4>
                      Day {day.day}: {day.theme}
                    </h4>
                    <ul className="stop-list">
                      {day.stops.map((stop) => (
                        <li key={`${day.day}-${stop.placeId}-${stop.startTime}`}>
                          <span className="time">{stop.startTime}</span>
                          <div>
                            <div className="stop-name">{stop.name}</div>
                            <div className="stop-meta">
                              {stop.durationMinutes} min · transfer {stop.transferMinutes} min
                            </div>
                          </div>
                          <span className="price">${stop.cost}</span>
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
