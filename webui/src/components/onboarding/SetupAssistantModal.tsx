import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import {
  SETUP_STEPS,
  deriveAssistantResumeState,
  type SetupStep,
  setAssistantDraft,
  getAssistantDraft,
  clearAssistantDraft
} from "../../lib/setupAssistant";
import type { ConnectionInfo, SourcesResponse } from "../../lib/types";
import { queryKeys } from "../../lib/queryKeys";
import { Step1ConnectDb } from "./Step1ConnectDb";
import { Step2UploadManifest } from "./Step2UploadManifest";
import { Step3SelectTables } from "./Step3SelectTables";
import { Step4SemanticOverlay } from "./Step4SemanticOverlay";
import { Step5BusinessWiki } from "./Step5BusinessWiki";
import { Step6ConnectAgent } from "./Step6ConnectAgent";

export type SetupAssistantModalProps = {
  open: boolean;
  onClose: () => void;
  initialStep?: SetupStep;
  initialConnectionId?: string;
  initialConnection?: ConnectionInfo | null;
  initialSources?: SourcesResponse | null;
  existingIds?: string[];
};

export function SetupAssistantModal({
  open,
  onClose,
  initialStep = 1,
  initialConnectionId = "",
  initialConnection = null,
  initialSources = null,
  existingIds = []
}: SetupAssistantModalProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<SetupStep>(initialStep);
  const [connectionId, setConnectionId] = useState(initialConnectionId);
  const [schema, setSchema] = useState("");
  const [enabledTables, setEnabledTables] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const hydrationKeyRef = useRef("");
  const hydrationKey = useMemo(
    () =>
      JSON.stringify({
        open,
        initialStep,
        initialConnectionId,
        connectionId: initialConnection?.id
      }),
    [open, initialStep, initialConnectionId, initialConnection?.id]
  );

  useEffect(() => {
    if (open && hydrationKeyRef.current !== hydrationKey) {
      hydrationKeyRef.current = hydrationKey;
      if (initialConnection) {
        const resumeState = deriveAssistantResumeState({
          connection: initialConnection,
          sources: initialSources,
          draft: getAssistantDraft(initialConnection.id)
        });
        setConnectionId(initialConnection.id);
        setSchema(resumeState.schema);
        setEnabledTables(resumeState.enabledTables);
        setStep(resumeState.step);
      } else if (initialConnectionId) {
        setConnectionId(initialConnectionId);
        setStep(initialStep);
      } else {
        setConnectionId("");
        setSchema("");
        setEnabledTables([]);
        setStep(initialStep);
      }
      setDirty(false);
      setShowDiscardConfirm(false);
    } else if (!open) {
      hydrationKeyRef.current = "";
    }
  }, [open, hydrationKey, initialStep, initialConnectionId, initialConnection, initialSources]);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => titleRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  const handleStepChange = (nextStep: SetupStep) => {
    setStep(nextStep);
    if (connectionId) {
      setAssistantDraft(connectionId, { step: nextStep, connectionId, selectedTables: enabledTables });
    }
    setDirty(false);
    setShowDiscardConfirm(false);
    void queryClient.invalidateQueries({ queryKey: queryKeys.project });
    void queryClient.invalidateQueries({ queryKey: queryKeys.sources });
  };

  const requestClose = () => {
    if (dirty) {
      setShowDiscardConfirm(true);
      return;
    }
    onClose();
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (showDiscardConfirm) setShowDiscardConfirm(false);
      else requestClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      ) ?? []
    ).filter((element) => !element.hasAttribute("hidden"));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleFinish = () => {
    if (connectionId) {
      clearAssistantDraft(connectionId);
    }
    onClose();
  };

  const currentMeta = SETUP_STEPS.find((s) => s.step === step) || SETUP_STEPS[0];

  return (
    <div
      className="pl-modal-backdrop z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="setup-assistant-title"
      aria-describedby="setup-assistant-description"
      onKeyDown={handleDialogKeyDown}
      data-testid="setup-assistant-modal"
    >
      <div ref={dialogRef} className="pl-modal-panel max-w-3xl my-8 p-0 overflow-hidden shadow-2xl border border-border-default rounded-xl bg-bg-surface">
        {/* Header with Title & Stepper */}
        <div className="bg-bg-subtle px-6 py-5 border-b border-border-default">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                  Lucy Setup Assistant
                </span>
                {currentMeta.isOptional ? (
                  <span className="text-[10px] bg-fg-muted/10 text-fg-muted px-1.5 py-0.5 rounded font-medium">
                    可选
                  </span>
                ) : null}
              </div>
              <h2
                ref={titleRef}
                id="setup-assistant-title"
                tabIndex={-1}
                className="text-lg font-bold text-fg-default mt-1 notranslate outline-none"
                translate="no"
              >
                {currentMeta.title}
              </h2>
              <p id="setup-assistant-description" className="text-xs text-fg-muted mt-0.5 notranslate" translate="no">
                {currentMeta.subtitle}
              </p>
            </div>

            <button
              type="button"
              className="text-fg-muted hover:text-fg-default p-1 rounded hover:bg-bg-surface transition-colors"
              onClick={requestClose}
              aria-label="关闭接入向导"
              title="关闭接入向导"
              data-testid="setup-modal-close-btn"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Stepper Bar */}
          <div className="mt-5 flex items-center justify-between gap-2">
            {SETUP_STEPS.map((s) => {
              const isCompleted = s.step < step;
              const isCurrent = s.step === step;
              return (
                <div key={s.step} className="flex-1 flex flex-col items-center gap-1.5">
                  <div
                    className={`w-full h-1.5 rounded-full transition-colors ${
                      isCompleted
                        ? "bg-success"
                        : isCurrent
                        ? "bg-primary"
                        : "bg-border-default"
                    }`}
                    aria-hidden="true"
                  />
                  <span
                    className={`text-[10px] truncate max-w-[80px] text-center notranslate ${
                      isCurrent
                        ? "font-bold text-primary"
                        : isCompleted
                        ? "text-fg-default font-medium"
                        : "text-fg-muted"
                    }`}
                    translate="no"
                    aria-current={isCurrent ? "step" : undefined}
                  >
                    {s.step}. {s.title}
                    <span className="sr-only">
                      {isCompleted ? "，已完成" : isCurrent ? "，当前步骤" : "，待进行"}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step Body */}
        <div
          className="p-6"
          onChangeCapture={() => setDirty(true)}
          onInputCapture={() => setDirty(true)}
          onClickCapture={(event) => {
            if ((event.target as HTMLElement).closest("[data-setup-dirty]")) setDirty(true);
          }}
        >
          {showDiscardConfirm ? (
            <div className="mb-4 p-3 border border-warning/40 bg-warning/10 rounded-lg" role="alert" data-testid="setup-discard-confirm">
              <p className="text-sm font-medium text-fg-default">放弃未保存的更改？</p>
              <p className="text-xs text-fg-muted mt-1">本步骤中尚未保存的输入将被丢弃。</p>
              <div className="flex justify-end gap-2 mt-3">
                <button type="button" className="pl-btn pl-btn--ghost text-xs" onClick={() => setShowDiscardConfirm(false)}>
                  继续编辑
                </button>
                <button type="button" className="pl-btn pl-btn--danger text-xs" onClick={onClose} data-testid="setup-discard-close">
                  放弃并关闭
                </button>
              </div>
            </div>
          ) : null}
          {step === 1 && (
            <Step1ConnectDb
              existingIds={existingIds}
              onSuccess={({ connectionId: newId, schema: newSchema }) => {
                setConnectionId(newId);
                setSchema(newSchema);
                handleStepChange(2);
              }}
            />
          )}

          {step === 2 && (
            <Step2UploadManifest
              connectionId={connectionId}
              schema={schema}
              onSuccess={() => handleStepChange(3)}
              onSkip={() => handleStepChange(3)}
            />
          )}

          {step === 3 && (
            <Step3SelectTables
              connectionId={connectionId}
              schema={schema}
              initialTables={enabledTables}
              onSuccess={(tables) => {
                setEnabledTables(tables);
                handleStepChange(4);
              }}
              onBack={() => handleStepChange(2)}
            />
          )}

          {step === 4 && (
            <Step4SemanticOverlay
              connectionId={connectionId}
              enabledTables={enabledTables}
              onSuccess={() => handleStepChange(5)}
              onSkip={() => handleStepChange(5)}
              onBack={() => handleStepChange(3)}
            />
          )}

          {step === 5 && (
            <Step5BusinessWiki
              connectionId={connectionId}
              onSuccess={() => handleStepChange(6)}
              onSkip={() => handleStepChange(6)}
              onBack={() => handleStepChange(4)}
            />
          )}

          {step === 6 && (
            <Step6ConnectAgent
              connectionId={connectionId}
              defaultTable={enabledTables[0]}
              onFinish={handleFinish}
            />
          )}
        </div>
      </div>
    </div>
  );
}
