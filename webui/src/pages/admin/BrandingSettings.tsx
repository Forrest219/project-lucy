import { FormEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "../../components/PageHeader";
import { BrandMark } from "../../components/BrandMark";
import { apiDelete, apiGet, apiPut, ApiError } from "../../lib/apiClient";
import { BRANDING_QUERY_KEY, type BrandingInfo } from "../../lib/branding";

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function BrandingSettings() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [productTitle, setProductTitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: BRANDING_QUERY_KEY,
    queryFn: () => apiGet<BrandingInfo>("/api/branding")
  });

  useEffect(() => {
    if (!query.data) return;
    setProductTitle(query.data.productTitleOverride);
    setTagline(query.data.taglineOverride);
  }, [query.data]);

  const saveTextMutation = useMutation({
    mutationFn: () =>
      apiPut<BrandingInfo>("/api/branding", {
        productTitle,
        tagline
      }),
    onSuccess: (data) => {
      setFormError(null);
      queryClient.setQueryData(BRANDING_QUERY_KEY, data);
      toast.success("品牌外观已保存");
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "保存失败");
    }
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const contentBase64 = await fileToBase64(file);
      return apiPut<BrandingInfo>("/api/branding/logo", {
        filename: file.name,
        contentBase64
      });
    },
    onSuccess: (data) => {
      setFormError(null);
      queryClient.setQueryData(BRANDING_QUERY_KEY, data);
      toast.success("客户 Logo 已更新");
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "上传失败");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiDelete<BrandingInfo>("/api/branding/logo"),
    onSuccess: (data) => {
      setFormError(null);
      queryClient.setQueryData(BRANDING_QUERY_KEY, data);
      toast.success("已恢复默认 Logo");
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "恢复失败");
    }
  });

  const branding = query.data;
  const previewTitle = productTitle.trim() || branding?.defaults.productTitle || "Lucy WebUI";
  const previewTagline = tagline.trim() || branding?.defaults.tagline || "Data Agent MCP";
  const previewLogoUrl = branding?.logoUrl ?? null;

  function onSaveText(event: FormEvent) {
    event.preventDefault();
    saveTextMutation.mutate();
  }

  function onPickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    uploadMutation.mutate(file);
  }

  return (
    <div className="pl-page">
      <PageHeader
        title="品牌外观"
        description="配置客户 Logo、产品名称与副标题。同一张 Logo 用于侧栏与登录页；推荐 48×48 PNG（透明底），宽高须在 32–160 像素。"
        breadcrumbs={["访问治理", "品牌外观"]}
        backAction={
          <Link to="/admin/usage" className="pl-page-header-back">
            ‹ 返回使用概况
          </Link>
        }
      />

      {query.isError && (
        <div className="pl-card p-4 text-sm text-danger" role="alert">
          {query.error instanceof ApiError ? query.error.message : "加载品牌配置失败"}
        </div>
      )}

      {formError && (
        <div className="pl-card p-4 text-sm text-danger" role="alert" data-testid="branding-form-error">
          {formError}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div className="grid gap-6">
          <section className="pl-card grid gap-4 p-5" data-testid="branding-logo-section">
            <div className="grid gap-1">
              <h2 className="text-base font-semibold">客户 Logo</h2>
              <p className="text-sm text-fg-muted">
                支持{" "}
                <span translate="no" className="notranslate">
                  PNG / JPEG / GIF
                </span>
                ，最大 512 KB。不支持{" "}
                <span translate="no" className="notranslate">
                  SVG / WebP
                </span>
                。超尺寸不会自动裁切，请缩小后再传。
              </p>
            </div>
            <div className="flex items-center gap-4">
              <BrandMark productTitle={previewTitle} logoUrl={previewLogoUrl} />
              <div className="grid gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,.png,.jpg,.jpeg,.gif"
                  className="sr-only"
                  data-testid="branding-logo-input"
                  onChange={onPickFile}
                />
                <button
                  type="button"
                  className="pl-btn pl-btn-primary"
                  disabled={uploadMutation.isPending}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadMutation.isPending ? "上传中…" : "上传 Logo"}
                </button>
                <button
                  type="button"
                  className="pl-btn pl-btn-secondary"
                  disabled={!branding?.hasCustomLogo || deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate()}
                >
                  恢复默认 Logo
                </button>
              </div>
            </div>
          </section>

          <section className="pl-card grid gap-4 p-5" data-testid="branding-text-section">
            <div className="grid gap-1">
              <h2 className="text-base font-semibold">产品名称与副标题</h2>
              <p className="text-sm text-fg-muted">留空则使用默认文案。最长 64 个字符。</p>
            </div>
            <form className="grid gap-3" onSubmit={onSaveText}>
              <label className="grid gap-1">
                <span className="text-sm font-medium">产品名称</span>
                <input
                  className="pl-input notranslate"
                  translate="no"
                  value={productTitle}
                  onChange={(e) => setProductTitle(e.target.value)}
                  placeholder={branding?.defaults.productTitle ?? "Lucy WebUI"}
                  maxLength={64}
                  data-testid="branding-product-title"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-medium">副标题</span>
                <input
                  className="pl-input notranslate"
                  translate="no"
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  placeholder={branding?.defaults.tagline ?? "Data Agent MCP"}
                  maxLength={64}
                  data-testid="branding-tagline"
                />
              </label>
              <div>
                <button
                  type="submit"
                  className="pl-btn pl-btn-primary"
                  disabled={saveTextMutation.isPending}
                >
                  {saveTextMutation.isPending ? "保存中…" : "保存"}
                </button>
              </div>
            </form>
          </section>
        </div>

        <aside className="pl-card grid gap-4 p-5 h-fit" data-testid="branding-preview">
          <h2 className="text-base font-semibold">预览</h2>
          <div className="grid gap-3">
            <p className="text-xs text-fg-muted">侧栏品牌区</p>
            <div className="pl-brand-block pointer-events-none notranslate" translate="no">
              <BrandMark productTitle={previewTitle} logoUrl={previewLogoUrl} />
              <div className="pl-brand-text">
                <strong className="pl-brand-title">{previewTitle}</strong>
                <span className="pl-brand-tagline notranslate" translate="no">
                  {previewTagline}
                </span>
              </div>
            </div>
            <p className="text-xs text-fg-muted mt-2">登录页</p>
            <div className="flex items-center gap-2 notranslate" translate="no">
              <BrandMark productTitle={previewTitle} logoUrl={previewLogoUrl} />
              <strong className="text-lg">{previewTitle}</strong>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
