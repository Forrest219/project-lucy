import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPost, isStaleResponseError } from "../../lib/apiClient";

const PRESETS = [
  { id: "30d", days: 30, label: "30 天" },
  { id: "90d", days: 90, label: "90 天" },
  { id: "180d", days: 180, label: "180 天" },
  { id: "365d", days: 365, label: "1 年" }
] as const;

function computePresetDate(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

type RenewResponse = {
  written: boolean;
  label: string;
  expires_at: string;
  old_expires_at?: string | null;
  runtimeAck?: boolean;
};

export function RenewTokenDialog({
  userId,
  label,
  onClose,
  onSuccess
}: {
  userId: string;
  label: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [expiresAt, setExpiresAt] = useState(() => computePresetDate(365));

  const renewMutation = useMutation({
    mutationFn: (body: { expires_at: string; repair?: boolean }) =>
      apiPost<RenewResponse>(
        `/api/admin/agents/${encodeURIComponent(userId)}/tokens/${encodeURIComponent(label)}/renew`,
        body
      ),
    onSuccess: (data) => {
      toast.success(`已续期至 ${data.expires_at}`);
      onSuccess();
      onClose();
    },
    onError: (err: Error) => {
      if (isStaleResponseError(err)) return;
      toast.error(`续期失败：${err.message}`);
    }
  });

  const min = useMemo(() => computePresetDate(1), []);
  const max = useMemo(() => computePresetDate(365), []);

  return (
    <div className="pl-modal-backdrop" role="dialog" aria-modal="true" data-testid="renew-token-dialog">
      <div className="pl-modal-panel max-w-md">
        <h3 className="text-lg font-semibold text-fg-default mb-2">
          延长有效期 · <span className="notranslate font-mono" translate="no">{label}</span>
        </h3>
        <p className="text-sm text-fg-muted mb-4 leading-relaxed">
          续期只更新过期时间，不会重新签发明文；客户端配置无需替换。怀疑泄露请改用换签并吊销旧{" "}
          <span className="notranslate" translate="no">Token</span>。
        </p>

        <label className="grid gap-1.5 mb-3">
          <span className="text-sm font-medium text-fg-default">过期时间（必填）</span>
          <input
            type="date"
            className="pl-input"
            aria-label="续期过期时间"
            data-testid="renew-token-expiry"
            min={min}
            max={max}
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </label>

        <div className="mb-4">
          <span className="text-xs text-fg-muted mb-1.5 block">快捷预设</span>
          <div
            className="pl-segmented-control pl-segmented-control--cols-4"
            role="group"
            aria-label="快捷预设"
            data-testid="renew-token-expiry-presets"
          >
            {PRESETS.map((preset) => {
              const date = computePresetDate(preset.days);
              const active = expiresAt === date;
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`pl-segmented-control-item${active ? " pl-segmented-control-item--active" : ""}`}
                  aria-pressed={active}
                  data-testid={`renew-token-expiry-preset-${preset.id}`}
                  onClick={() => setExpiresAt(date)}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="pl-btn pl-btn--ghost"
            onClick={onClose}
            disabled={renewMutation.isPending}
          >
            取消
          </button>
          <button
            type="button"
            className="pl-btn pl-btn--primary"
            data-testid="renew-token-confirm"
            disabled={renewMutation.isPending || !expiresAt}
            onClick={() => renewMutation.mutate({ expires_at: expiresAt })}
          >
            {renewMutation.isPending ? "续期中…" : "确认续期"}
          </button>
        </div>
      </div>
    </div>
  );
}
