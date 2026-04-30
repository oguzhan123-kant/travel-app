"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  Square,
  RefreshCcw,
  Route,
  Search,
  SlidersHorizontal
} from "lucide-react";
import { AgentStep, Budget, Pace, PipelineResult, PipelineStreamEvent } from "@/lib/travel/types";
import { agentModelIds, agentModelLabels, defaultModel, modelOptions } from "@/lib/travel/models";
import type { AgentModelMap } from "@/lib/travel/models";

type FieldKey =
  | "city"
  | "days"
  | "budget"
  | "pace"
  | "model"
  | "agentModels"
  | "webSearchEnabled"
  | "interests"
  | "notes";

type FormState = {
  city: string;
  days: number;
  budget: Budget;
  pace: Pace;
  model: string;
  agentModels: AgentModelMap;
  webSearchEnabled: boolean;
  interests: string;
  notes: string;
};

const defaultAgentModels = Object.fromEntries(
  agentModelIds.map((agentId) => [agentId, defaultModel])
) as AgentModelMap;

const defaultForm: FormState = {
  city: "Istanbul",
  days: 3,
  budget: "medium",
  pace: "balanced",
  model: defaultModel,
  agentModels: defaultAgentModels,
  webSearchEnabled: true,
  interests: "history, food, views, local",
  notes: "İlk kez gidiyorum, çok yorucu olmayan ama dolu bir rota istiyorum."
};

const defaultEnabledFields: Record<FieldKey, boolean> = {
  city: true,
  days: true,
  budget: true,
  pace: true,
  model: true,
  agentModels: true,
  webSearchEnabled: true,
  interests: true,
  notes: true
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
  if (typeof value === "undefined") {
    return "";
  }

  return JSON.stringify(value, null, 2);
}

function stepIcon(step: AgentStep) {
  return iconMap[step.id as keyof typeof iconMap] || FileJson;
}

function formatCost(cost?: number) {
  if (typeof cost !== "number") return "$0.00000000";
  return `$${cost.toFixed(8)}`;
}

export default function Home() {
  const [form, setForm] = useState<FormState>(defaultForm);
  const [enabledFields, setEnabledFields] = useState(defaultEnabledFields);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isRunning) return;

    const timer = window.setInterval(() => {
      setLiveSteps((steps) =>
        steps.map((step) =>
          step.status === "running"
            ? {
                ...step,
                durationMs: Math.max(0, Date.now() - Date.parse(step.startedAt))
              }
            : step
        )
      );
    }, 250);

    return () => window.clearInterval(timer);
  }, [isRunning]);

  const displaySteps = result?.steps.length ? result.steps : liveSteps;

  const selectedStep = useMemo(() => {
    if (!displaySteps.length) return null;
    return displaySteps.find((step) => step.id === selectedStepId) || displaySteps[0];
  }, [displaySteps, selectedStepId]);

  const runningStep = displaySteps.find((step) => step.status === "running");

  function handleStreamEvent(event: PipelineStreamEvent) {
    if (event.type === "step-start") {
      setLiveSteps((steps) => [...steps, event.step]);
      setSelectedStepId((current) => current || event.step.id);
      return;
    }

    if (event.type === "step-complete") {
      setLiveSteps((steps) => {
        const next = [...steps];
        const index = [...next].reverse().findIndex((step) => step.id === event.step.id && step.status === "running");

        if (index === -1) {
          next.push(event.step);
          return next;
        }

        next[next.length - 1 - index] = event.step;
        return next;
      });
      return;
    }

    if (event.type === "pipeline-complete") {
      setResult(event.result);
      setLiveSteps(event.result.steps);
      setSelectedStepId((current) => current || event.result.steps[0]?.id || "");
      return;
    }

    if (event.type === "pipeline-error") {
      setError(event.error);
    }
  }

  function parseStreamBlock(block: string) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s?/, ""))
      .join("\n");

    if (!data) return;
    handleStreamEvent(JSON.parse(data) as PipelineStreamEvent);
  }

  function stopPipeline() {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
    setError("Run stopped.");
    setLiveSteps((steps) =>
      steps.map((step) =>
        step.status === "running"
          ? {
              ...step,
              status: "failed",
              finishedAt: new Date().toISOString(),
              output: {
                message: "Stopped by user."
              }
            }
          : step
      )
    );
  }

  async function runPipeline() {
    if (isRunning) {
      stopPipeline();
      return;
    }

    const abortController = new AbortController();
    abortRef.current = abortController;
    setIsRunning(true);
    setError("");
    setResult(null);
    setLiveSteps([]);
    setSelectedStepId("");

    try {
      const payload: Record<string, unknown> = {
        city: form.city
      };

      if (enabledFields.days) payload.days = form.days;
      if (enabledFields.budget) payload.budget = form.budget;
      if (enabledFields.pace) payload.pace = form.pace;
      if (enabledFields.model) payload.model = form.model;
      if (enabledFields.agentModels) payload.agentModels = form.agentModels;
      if (enabledFields.webSearchEnabled) payload.webSearchEnabled = form.webSearchEnabled;
      if (enabledFields.interests) {
        payload.interests = form.interests
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      }
      if (enabledFields.notes) payload.notes = form.notes;

      const response = await fetch("/api/plan/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: abortController.signal
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "Pipeline failed.");
      }

      if (!response.body) {
        throw new Error("Streaming response is not available.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          parseStreamBlock(block);
          boundary = buffer.indexOf("\n\n");
        }
      }

      if (buffer.trim()) {
        parseStreamBlock(buffer);
      }
    } catch (runError) {
      if (runError instanceof DOMException && runError.name === "AbortError") {
        setError("Run stopped.");
      } else {
        setError(runError instanceof Error ? runError.message : "Pipeline failed.");
      }
    } finally {
      if (abortRef.current === abortController) {
        abortRef.current = null;
      }
      setIsRunning(false);
    }
  }

  function setGlobalModel(model: string) {
    setForm({
      ...form,
      model,
      agentModels: Object.fromEntries(agentModelIds.map((agentId) => [agentId, model])) as AgentModelMap
    });
  }

  function setAgentModel(agentId: (typeof agentModelIds)[number], model: string) {
    setForm({
      ...form,
      agentModels: {
        ...form.agentModels,
        [agentId]: model
      }
    });
  }

  function toggleField(field: FieldKey) {
    if (field === "city") return;

    setEnabledFields({
      ...enabledFields,
      [field]: !enabledFields[field]
    });
  }

  function FieldLabel({ field, children }: { field: FieldKey; children: React.ReactNode }) {
    return (
      <div className="field-label-row">
        <label>{children}</label>
        <button
          type="button"
          className={`field-toggle ${enabledFields[field] ? "on" : ""}`}
          onClick={() => toggleField(field)}
          aria-pressed={enabledFields[field]}
          disabled={field === "city"}
          title={field === "city" ? "City is required" : enabledFields[field] ? "Disable field" : "Enable field"}
        >
          {enabledFields[field] ? "On" : "Off"}
        </button>
      </div>
    );
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
            {isRunning && runningStep
              ? `${runningStep.title} · ${runningStep.durationMs} ms`
              : result
                ? `${result.steps.length} step · ${result.iterations} iteration`
                : "OpenAI agents + local fallback"}
          </div>
        </div>
      </header>

      <div className="workspace">
        <aside className="panel control-panel">
          <h2>Run Configuration</h2>

          <div className="form-grid">
            <div className="field">
              <FieldLabel field="city">City</FieldLabel>
              <input
                id="city"
                value={form.city}
                onChange={(event) => setForm({ ...form, city: event.target.value })}
              />
            </div>

            <div className="form-row">
              <div className="field">
                <FieldLabel field="days">Days</FieldLabel>
                <input
                  id="days"
                  type="number"
                  min={1}
                  max={7}
                  value={form.days}
                  disabled={!enabledFields.days}
                  onChange={(event) => setForm({ ...form, days: Number(event.target.value) })}
                />
              </div>

              <div className="field">
                <FieldLabel field="budget">Budget</FieldLabel>
                <select
                  id="budget"
                  value={form.budget}
                  disabled={!enabledFields.budget}
                  onChange={(event) => setForm({ ...form, budget: event.target.value as Budget })}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>

            <div className="field">
              <FieldLabel field="pace">Pace</FieldLabel>
              <select
                id="pace"
                value={form.pace}
                disabled={!enabledFields.pace}
                onChange={(event) => setForm({ ...form, pace: event.target.value as Pace })}
              >
                <option value="relaxed">Relaxed</option>
                <option value="balanced">Balanced</option>
                <option value="intense">Intense</option>
              </select>
            </div>

            <div className="field">
              <FieldLabel field="model">Model</FieldLabel>
              <select
                id="model"
                value={form.model}
                disabled={!enabledFields.model}
                onChange={(event) => setGlobalModel(event.target.value)}
              >
                {modelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <FieldLabel field="agentModels">Agent Models</FieldLabel>
              <div className="agent-model-grid">
                {agentModelIds.map((agentId) => (
                  <div className="agent-model-field" key={agentId}>
                    <span>{agentModelLabels[agentId]}</span>
                    <select
                      value={form.agentModels[agentId] || form.model}
                      disabled={!enabledFields.agentModels}
                      onChange={(event) => setAgentModel(agentId, event.target.value)}
                    >
                      {modelOptions.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div className="field">
              <FieldLabel field="webSearchEnabled">Web Search</FieldLabel>
              <button
                type="button"
                className={`wide-toggle ${form.webSearchEnabled ? "on" : ""}`}
                disabled={!enabledFields.webSearchEnabled}
                onClick={() => setForm({ ...form, webSearchEnabled: !form.webSearchEnabled })}
              >
                {form.webSearchEnabled ? "Enabled for research agents" : "Disabled, local/model-only"}
              </button>
            </div>

            <div className="field">
              <FieldLabel field="interests">Interests</FieldLabel>
              <input
                id="interests"
                value={form.interests}
                disabled={!enabledFields.interests}
                onChange={(event) => setForm({ ...form, interests: event.target.value })}
              />
            </div>

            <div className="field">
              <FieldLabel field="notes">Notes</FieldLabel>
              <textarea
                id="notes"
                value={form.notes}
                disabled={!enabledFields.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
            </div>
          </div>

          <button className={`run-button ${isRunning ? "stop" : ""}`} onClick={runPipeline}>
            {isRunning ? <Square size={17} /> : <Play size={17} />}
            {isRunning ? "Stop run" : "Run playground"}
          </button>

          {error ? <div className="error">{error}</div> : null}
        </aside>

        <section className="main-grid">
          <div className="panel flow-panel">
            <div className="flow-header">
              <h2>Agent Flow</h2>
              <span className="status-pill">
                {isRunning
                  ? `${displaySteps.length} request${displaySteps.length === 1 ? "" : "s"} observed`
                  : result
                    ? `Score ${result.evaluation.score}/100`
                    : "Waiting for first run"}
              </span>
            </div>

            {displaySteps.length ? (
              <div className="flow-canvas">
                {displaySteps.map((step, index) => {
                  const Icon = stepIcon(step);
                  const isActive = selectedStep?.id === step.id;

                  return (
                    <button
                      key={`${step.id}-${index}`}
                      className={`flow-node ${step.status} ${isActive ? "active" : ""}`}
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
                      <span>{step.model}</span>
                      <span>
                        {step.durationMs} ms · {step.status === "running" ? "request open" : step.status}
                      </span>
                      <span>
                        {step.meta?.provider || "pending"} · search{" "}
                        {step.meta?.webSearchUsed
                          ? "used"
                          : step.meta?.webSearchEnabled
                            ? "enabled"
                            : "off"}
                      </span>
                      {step.meta?.fallbackReason ? <span>{step.meta.fallbackReason}</span> : null}
                      <span>
                        in {step.usage?.inputTokens || 0} · out {step.usage?.outputTokens || 0} · thinking{" "}
                        {step.usage?.reasoningTokens || 0}
                      </span>
                      <span>{formatCost(step.usage?.costUsd)}</span>
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
              {selectedStep.prompt ? (
                <div className="panel detail-panel prompt-panel">
                  <div className="section-header">
                    <h3>{selectedStep.title} Prompt</h3>
                    <span className="status-pill">{selectedStep.model || form.model}</span>
                  </div>
                  <div className="prompt-grid">
                    <div>
                      <span className="prompt-label">System</span>
                      <pre className="json-box prompt-box">{selectedStep.prompt.system}</pre>
                    </div>
                    <div>
                      <span className="prompt-label">User</span>
                      <pre className="json-box prompt-box">{selectedStep.prompt.user}</pre>
                    </div>
                  </div>
                </div>
              ) : null}

              {selectedStep.meta ? (
                <div className="panel detail-panel meta-panel">
                  <div className="section-header">
                    <h3>{selectedStep.title} Runtime</h3>
                    <span className="status-pill">{selectedStep.meta.provider}</span>
                  </div>
                  <pre className="json-box">{prettyJson(selectedStep.meta)}</pre>
                </div>
              ) : null}

              <div className="panel detail-panel">
                <div className="section-header">
                  <h3>{selectedStep.title} Input</h3>
                  <span className="status-pill">
                    in {selectedStep.usage?.inputTokens || 0} · cached {selectedStep.usage?.cachedInputTokens || 0}
                  </span>
                </div>
                <pre className="json-box">{prettyJson(selectedStep.input)}</pre>
              </div>

              <div className="panel detail-panel">
                <div className="section-header">
                  <h3>{selectedStep.title} Output</h3>
                  <span className="status-pill">
                    {selectedStep.status === "running"
                      ? "waiting"
                      : `out ${selectedStep.usage?.outputTokens || 0} · thinking ${
                          selectedStep.usage?.reasoningTokens || 0
                        } · ${formatCost(selectedStep.usage?.costUsd)}`}
                  </span>
                </div>
                <pre className="json-box">
                  {selectedStep.status === "running" ? "Waiting for response..." : prettyJson(selectedStep.output)}
                </pre>
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
