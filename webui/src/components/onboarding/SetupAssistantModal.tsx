import { useEffect, useState } from "react";
import { X, Check } from "lucide-react";
import {
  SETUP_STEPS,
  type SetupStep,
  setAssistantDraft,
  getAssistantDraft,
  clearAssistantDraft
} from "../../lib/setupAssistant";
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
  existingIds?: string[];
};

export function SetupAssistantModal({
  open,
  onClose,
  initialStep = 1,
  initialConnectionId = "",
  existingIds = []
}: SetupAssistantModalProps) {
  const [step, setStep] = useState<SetupStep>(initialStep);
  const [connectionId, setConnectionId] = useState(initialConnectionId);
  const [schema, setSchema] = useState("");
  const [enabledTables, setEnabledTables] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      if (initialConnectionId) {
        setConnectionId(initialConnectionId);
        const draft = getAssistantDraft(initialConnectionId);
        if (draft?.step && !initialStep) {
          setStep(draft.step);
        } else {
          setStep(initialStep);
        }
      } else {
        setStep(initialStep);
      }
    }
  }, [open, initialStep, initialConnectionId]);

  if (!open) return null;

  const handleStepChange = (nextStep: SetupStep) => {
    setStep(nextStep);
    if (connectionId) {
      setAssistantDraft(connectionId, { step: nextStep, connectionId, selectedTables: enabledTables });
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
      data-testid="setup-assistant-modal"
    >
      <div className="pl-modal-panel max-w-3xl my-8 p-0 overflow-hidden shadow-2xl border border-border-default rounded-xl bg-bg-surface">
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
              <h2 className="text-lg font-bold text-fg-default mt-1 notranslate" translate="no">
                {currentMeta.title}
              </h2>
              <p className="text-xs text-fg-muted mt-0.5 notranslate" translate="no">
                {currentMeta.subtitle}
              </p>
            </div>

            <button
              type="button"
              className="text-fg-muted hover:text-fg-default p-1 rounded hover:bg-bg-surface transition-colors"
              onClick={onClose}
              title="稍后在控制台中配置"
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
                  >
                    {s.step}. {s.title}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step Body */}
        <div className="p-6">
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
