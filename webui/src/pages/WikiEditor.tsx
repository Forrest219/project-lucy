import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus, FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader";
import { TemplatePicker } from "../components/TemplatePicker";
import { WikiDeleteDirectoryDialog } from "../components/WikiDeleteDirectoryDialog";
import { WikiLibraryHome } from "../components/WikiLibraryHome";
import { WikiMoveDocumentDialog } from "../components/WikiMoveDocumentDialog";
import { WikiNewDirectoryDialog } from "../components/WikiNewDirectoryDialog";
import { WikiNewDocumentDialog } from "../components/WikiNewDocumentDialog";
import { WikiReadView } from "../components/WikiReadView";
import { WikiEditView } from "../components/WikiEditView";
import { WikiRenameDirectoryDialog } from "../components/WikiRenameDirectoryDialog";
import { WikiRestorePreflight } from "../components/WikiRestorePreflight";
import { WikiSavePreflight } from "../components/WikiSavePreflight";
import { WikiTree } from "../components/WikiTree";
import { WikiUploadPreflight } from "../components/WikiUploadPreflight";
import { WikiVersionHistoryDialog } from "../components/WikiVersionHistoryDialog";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import {
  draftKeyForSlRef,
  findWikiBySlRef,
  nextNewNoteKey
} from "../lib/slRef";
import {
  buildSavePreflightState,
  directoryOfWikiKey,
  wikiDraftVersion
} from "../lib/wiki";
import type {
  SourcesResponse,
  WikiFrontmatter,
  WikiListResponse,
  WikiMovePreview,
  WikiMoveResult,
  WikiPage,
  WikiPreview,
  WikiVersionDetail,
  WikiVersionListResponse,
  WikiVersionRestorePreview,
  WikiVersionRestoreResult,
  WikiDirectoryCreateInput,
  WikiDirectoryCreateResult,
  WikiDirectoryRenamePreview,
  WikiDirectoryRenameResult,
  WikiDirectorySummary,
  WikiSummary,
  WikiUploadPreview
} from "../lib/types";

type PageMode = "library" | "loaded" | "draft";
type WikiUiMode = "read" | "edit";
type WikiUploadMode = "create" | "replace";

/**
 * Compute the effective key + mode for the editor. The URL is the
 * source of truth:
 *   - `?key=...`     -> loaded (or draft if no matching page)
 *   - `?sl_ref=...`  -> matched page (loaded) or new draft
 *   - `?dir=...`     -> library scoped to that directory (Spec 105)
 *   - neither        -> library select prompt
 */
function resolveKey(
  keyParam: string,
  slRef: string | null,
  pages: WikiSummary[]
): { key: string; mode: PageMode } {
  if (keyParam) {
    return { key: keyParam, mode: pages.some((p) => p.key === keyParam) ? "loaded" : "draft" };
  }
  if (slRef) {
    const matched = findWikiBySlRef(pages, slRef);
    if (matched) {
      return { key: matched.key, mode: "loaded" };
    }
    return { key: draftKeyForSlRef(slRef, pages.map((p) => p.key)), mode: "draft" };
  }
  return { key: "", mode: "library" };
}

function normalizeDirParam(raw: string | null): string {
  if (!raw) return "";
  return decodeURIComponent(raw)
    .trim()
    .replaceAll("\\", "/")
    .replaceAll(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

export function WikiEditor() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const slRefRaw = searchParams.get("sl_ref");
  const slRef = slRefRaw ? decodeURIComponent(slRefRaw) : null;
  const keyParamRaw = searchParams.get("key") ?? "";
  const keyParam = keyParamRaw ? decodeURIComponent(keyParamRaw) : "";
  const dirParam = normalizeDirParam(searchParams.get("dir"));
  const listQuery = useQuery({
    queryKey: queryKeys.wiki,
    queryFn: () => apiGet<WikiListResponse>("/api/wiki")
  });
  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: () => apiGet<SourcesResponse>("/api/sources")
  });

  const pages = listQuery.data?.pages ?? [];
  const serverDirectories = listQuery.data?.directories ?? [];
  const tables = sourcesQuery.data?.tables ?? [];

  const knownSlRefs = useMemo(() => {
    const set = new Set<string>();
    for (const table of tables) {
      set.add(`${table.conn}/${table.schema}/${table.table}`);
    }
    return set;
  }, [tables]);

  // The effective key is derived from URL + page list on every render.
  // No useState for this — the URL is the single source of truth.
  const resolved = useMemo(
    () => resolveKey(keyParam, slRef, pages),
    [keyParam, pages, slRef]
  );
  const key = resolved.key;
  const mode = resolved.mode;

  /** Spec 105: tree selection highlight — URL dir, else parent of open doc. */
  const selectedDirectory = useMemo(() => {
    if (mode !== "library" && key) {
      return directoryOfWikiKey(key) || dirParam;
    }
    return dirParam;
  }, [dirParam, key, mode]);

  // Local buffer for the frontmatter / body the user is editing.
  // The dirty flag tells us to skip applying loaded-page content
  // back over local edits on subsequent renders.
  const [frontmatter, setFrontmatter] = useState<WikiFrontmatter>({});
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState<WikiPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<string | null>(null);
  const [uiMode, setUiMode] = useState<WikiUiMode>("read");
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [newDirectoryOpen, setNewDirectoryOpen] = useState(false);
  const [newDirectoryParent, setNewDirectoryParent] = useState("global");
  const [newDirectoryError, setNewDirectoryError] = useState<string | null>(null);
  const [newDocumentOpen, setNewDocumentOpen] = useState(false);
  const [newDocumentDirectory, setNewDocumentDirectory] = useState("global");
  const [newDocumentError, setNewDocumentError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadMode, setUploadMode] = useState<WikiUploadMode>("create");
  const [uploadTargetKey, setUploadTargetKey] = useState("");
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadMarkdown, setUploadMarkdown] = useState("");
  const [uploadPreview, setUploadPreview] = useState<WikiUploadPreview | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [deleteDirectoryPath, setDeleteDirectoryPath] = useState<string | null>(null);
  const [deleteDirectoryError, setDeleteDirectoryError] = useState<string | null>(null);
  const [renameDirectoryPath, setRenameDirectoryPath] = useState<string | null>(null);
  const [renameDirectoryName, setRenameDirectoryName] = useState("");
  const [renameDirectoryPreview, setRenameDirectoryPreview] =
    useState<WikiDirectoryRenamePreview | null>(null);
  const [renameDirectoryError, setRenameDirectoryError] = useState<string | null>(null);
  const [renameDirectoryLoading, setRenameDirectoryLoading] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTargetDirectory, setMoveTargetDirectory] = useState("");
  const [movePreview, setMovePreview] = useState<WikiMovePreview | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveLoading, setMoveLoading] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [restorePreflightOpen, setRestorePreflightOpen] = useState(false);
  const [restorePreview, setRestorePreview] = useState<WikiVersionRestorePreview | null>(null);
  const [restorePreviewError, setRestorePreviewError] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadPreviewRequestRef = useRef(0);
  const moveTargetDirectoryRef = useRef("");
  const renameDirectoryPathRef = useRef("");
  const renameDirectoryNameRef = useRef("");
  const dirtyRef = useRef(false);
  const [isDirty, setIsDirty] = useState(false);
  function markDirty() {
    dirtyRef.current = true;
    setIsDirty(true);
  }
  function markClean() {
    dirtyRef.current = false;
    setIsDirty(false);
  }
  const sourceRef = useRef<string>(`${key}::${mode}::init`);
  const preserveBufferForKeyRef = useRef<string | null>(null);
  const lastResolvedKeyRef = useRef<string>(key);
  // Refs that always reflect the latest content / frontmatter. Updated
  // synchronously from the change handlers so the Save Preflight and
  // debounced dry-run see fresh values even before React commits the
  // batched state update. We intentionally do NOT mirror `content` /
  // `frontmatter` back into the ref during render, otherwise a render
  // triggered by an unrelated state change would clobber the latest
  // edit before downstream consumers have a chance to read it.
  const contentRef = useRef(content);
  const frontmatterRef = useRef(frontmatter);
  // Live draft version. Updated every time the editor buffer changes.
  // Stored in a ref so the async runDryRun closure can compare it
  // against the version it started with without going stale.
  const currentDraftVersionRef = useRef<string>(wikiDraftVersion({}, ""));
  const currentDraftVersion = useMemo(
    () => wikiDraftVersion(frontmatter, content),
    [content, frontmatter]
  );
  useEffect(() => {
    currentDraftVersionRef.current = currentDraftVersion;
  }, [currentDraftVersion]);

  useEffect(() => {
    if (lastResolvedKeyRef.current === key) {
      return;
    }
    lastResolvedKeyRef.current = key;
    setUiMode("read");
    setPreflightOpen(false);
    setVersionHistoryOpen(false);
    setSelectedVersionId(null);
    setRestorePreflightOpen(false);
    setRestorePreview(null);
    setRestorePreviewError(null);
  }, [key]);

  // When an object handoff comes in as only `?sl_ref=...`, resolve it
  // once the Wiki list is loaded and mirror the resolved key back into
  // the URL. This keeps the URL shareable and makes the selected page
  // explicit after auto-match or draft generation.
  useEffect(() => {
    if (!slRef || keyParam || !listQuery.data) {
      return;
    }
    const next: Record<string, string> = { key, sl_ref: slRef };
    setSearchParams(next, { replace: true });
  }, [key, keyParam, listQuery.data, setSearchParams, slRef]);

  // Seed the local buffer with `sl_ref` whenever a new draft key is
  // generated from the URL. We only do this on the transition into a
  // draft so existing pages are not overwritten.
  useEffect(() => {
    if (mode !== "draft") {
      return;
    }
    if (preserveBufferForKeyRef.current === key) {
      preserveBufferForKeyRef.current = null;
      sourceRef.current = `${key}::${mode}::preserved`;
      return;
    }
    const sourceKey = `${key}::${mode}::seeded`;
    if (sourceRef.current === sourceKey) {
      return;
    }
    if (slRef) {
      frontmatterRef.current = { sl_refs: [slRef] };
      setFrontmatter({ sl_refs: [slRef] });
    } else {
      frontmatterRef.current = {};
      setFrontmatter({});
    }
    contentRef.current = "";
    setContent("");
    setPreview(null);
    dirtyRef.current = false;
    setIsDirty(false);
    sourceRef.current = sourceKey;
  }, [key, mode, slRef]);

  const pageQuery = useQuery({
    queryKey: queryKeys.wikiPage(key),
    queryFn: () => apiGet<WikiPage>(`/api/wiki/${encodeURIComponent(key)}`),
    enabled: Boolean(key) && mode === "loaded"
  });

  const versionsQuery = useQuery({
    queryKey: queryKeys.wikiVersions(key),
    queryFn: () =>
      apiGet<WikiVersionListResponse>(`/api/wiki/${encodeURIComponent(key)}/versions`),
    enabled: versionHistoryOpen && Boolean(key) && mode === "loaded"
  });

  const versionDetailQuery = useQuery({
    queryKey: [...queryKeys.wikiVersions(key), selectedVersionId],
    queryFn: () =>
      apiGet<WikiVersionDetail>(
        `/api/wiki/${encodeURIComponent(key)}/versions/${encodeURIComponent(
          selectedVersionId ?? ""
        )}`
      ),
    enabled:
      versionHistoryOpen &&
      Boolean(key) &&
      mode === "loaded" &&
      Boolean(selectedVersionId)
  });

  // UX-WIKI-025 / Spec 80: do not auto-select the newest version when 版本记录
  // opens. Detail stays lazy until the user clicks 查看 on a non-current row.

  // Apply page detail to local state when the user has not edited
  // anything since the last reset. We never clobber unsaved edits.
  useEffect(() => {
    if (mode !== "loaded") {
      return;
    }
    if (!pageQuery.data) {
      return;
    }
    // The buffer was hydrated for a draft on this key — keep that
    // state unless the user explicitly starts editing. The dirty flag
    // is set by every change handler, so once the user types anything
    // we MUST NOT overwrite their input.
    if (dirtyRef.current) {
      return;
    }
    const sourceKey = `${key}::${mode}::loaded`;
    if (sourceRef.current === sourceKey) {
      return;
    }
    setFrontmatter(pageQuery.data.frontmatter);
    frontmatterRef.current = pageQuery.data.frontmatter;
    setContent(pageQuery.data.content);
    contentRef.current = pageQuery.data.content;
    setPreview(null);
    sourceRef.current = sourceKey;
  }, [key, mode, pageQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiPut<WikiPreview>(`/api/wiki/${encodeURIComponent(key)}`, {
        dryRun: false,
        frontmatter,
        content
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.wiki });
      queryClient.invalidateQueries({ queryKey: queryKeys.wikiPage(key) });
      queryClient.invalidateQueries({ queryKey: queryKeys.wikiVersions(key) });
      queryClient.invalidateQueries({ queryKey: queryKeys.diff });
      markClean();
      sourceRef.current = `${key}::${mode}::saved`;
      toast.success("Wiki 已保存");
      setPreflightOpen(false);
      setUiMode("read");
    },
    onError: (error) => {
      toast.error(`保存失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  });

  const uploadCommitMutation = useMutation({
    mutationFn: () => {
      if (!uploadPreview) {
        throw new Error("缺少上传预检结果。");
      }
      return apiPost<WikiUploadPreview>("/api/wiki/upload/commit", {
        key: uploadPreview.targetKey,
        markdown: uploadPreview.proposedMarkdown,
        sourceFileName: uploadPreview.sourceFileName,
        overwrite: uploadMode === "replace" || uploadPreview?.exists === true
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.wiki });
      queryClient.invalidateQueries({ queryKey: queryKeys.wikiPage(result.key) });
      queryClient.invalidateQueries({ queryKey: queryKeys.wikiVersions(result.key) });
      queryClient.invalidateQueries({ queryKey: queryKeys.diff });
      markClean();
      sourceRef.current = `${result.key}::uploaded`;
      setUiMode("read");
      setUploadOpen(false);
      setUploadPreview(null);
      setUploadError(null);
      setSearchParams({ key: result.key }, { replace: true });
      toast.success(uploadMode === "replace" ? "Markdown 已覆盖" : "Markdown 已上传");
    },
    onError: (error) => {
      toast.error(`上传失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  });

  const restorePreviewMutation = useMutation({
    mutationFn: (versionId: string) =>
      apiPost<WikiVersionRestorePreview>(
        `/api/wiki/${encodeURIComponent(key)}/versions/${encodeURIComponent(
          versionId
        )}/restore/preview`,
        {}
      ),
    onMutate: () => {
      setRestorePreview(null);
      setRestorePreviewError(null);
      setRestorePreflightOpen(true);
    },
    onSuccess: (result) => {
      setRestorePreview(result);
      setRestorePreviewError(null);
    },
    onError: (error) => {
      setRestorePreviewError(error instanceof Error ? error.message : "未知错误");
    }
  });

  const restoreMutation = useMutation({
    mutationFn: () => {
      if (!restorePreview) {
        throw new Error("缺少恢复预检结果。");
      }
      return apiPost<WikiVersionRestoreResult>(
        `/api/wiki/${encodeURIComponent(key)}/versions/${encodeURIComponent(
          restorePreview.versionId
        )}/restore`,
        {}
      );
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.wiki });
      queryClient.invalidateQueries({ queryKey: queryKeys.wikiPage(result.key) });
      queryClient.invalidateQueries({ queryKey: queryKeys.wikiVersions(result.key) });
      queryClient.invalidateQueries({ queryKey: queryKeys.diff });
      markClean();
      sourceRef.current = `${result.key}::restored`;
      setUiMode("read");
      setRestorePreflightOpen(false);
      setRestorePreview(null);
      setRestorePreviewError(null);
      setVersionHistoryOpen(false);
      setSelectedVersionId(null);
      toast.success("已恢复历史版本");
    },
    onError: (error) => {
      toast.error(`恢复失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  });

  const createDirectoryMutation = useMutation({
    mutationFn: (input: WikiDirectoryCreateInput | { parent: string; name: string }) =>
      apiPost<WikiDirectoryCreateResult>("/api/wiki/directories", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.wiki });
      setNewDirectoryOpen(false);
      setNewDirectoryError(null);
      toast.success("目录已创建");
    },
    onError: (error) => {
      setNewDirectoryError(error instanceof Error ? error.message : "未知错误");
    }
  });

  const deleteDirectoryMutation = useMutation({
    mutationFn: (directoryPath: string) =>
      apiDelete<{ path: string; deleted: boolean; filePath: string }>(
        `/api/wiki/directories/${encodeURIComponent(directoryPath)}`
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.wiki });
      setDeleteDirectoryPath(null);
      setDeleteDirectoryError(null);
      toast.success(`已删除目录 ${result.path}`);
    },
    onError: (error) => {
      const message =
        error instanceof Error ? error.message : "未知错误";
      setDeleteDirectoryError(message);
    }
  });

  const renamePreviewMutation = useMutation({
    mutationFn: (input: { sourcePath: string; newName: string }) =>
      apiPost<WikiDirectoryRenamePreview>("/api/wiki/directories/rename/preview", input),
    onMutate: (input) => {
      renameDirectoryPathRef.current = input.sourcePath;
      renameDirectoryNameRef.current = input.newName;
      setRenameDirectoryLoading(true);
      setRenameDirectoryError(null);
    },
    onSuccess: (result, input) => {
      if (
        renameDirectoryPathRef.current !== input.sourcePath ||
        renameDirectoryNameRef.current !== input.newName
      ) {
        return;
      }
      setRenameDirectoryPreview(result);
      setRenameDirectoryError(null);
    },
    onError: (error, input) => {
      if (
        renameDirectoryPathRef.current !== input.sourcePath ||
        renameDirectoryNameRef.current !== input.newName
      ) {
        return;
      }
      setRenameDirectoryPreview(null);
      setRenameDirectoryError(error instanceof Error ? error.message : "未知错误");
    },
    onSettled: (_data, _error, input) => {
      if (
        renameDirectoryPathRef.current !== input.sourcePath ||
        renameDirectoryNameRef.current !== input.newName
      ) {
        return;
      }
      setRenameDirectoryLoading(false);
    }
  });

  const renameDirectoryMutation = useMutation({
    mutationFn: (input: { sourcePath: string; newName: string }) =>
      apiPost<WikiDirectoryRenameResult>("/api/wiki/directories/rename", input),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.wiki });
      if (key && key.startsWith(`${result.sourcePath}/`)) {
        const nextKey = `${result.targetPath}${key.slice(result.sourcePath.length)}`;
        queryClient.invalidateQueries({ queryKey: queryKeys.wikiPage(key) });
        queryClient.invalidateQueries({ queryKey: queryKeys.wikiPage(nextKey) });
        queryClient.invalidateQueries({ queryKey: queryKeys.wikiVersions(key) });
        queryClient.invalidateQueries({ queryKey: queryKeys.wikiVersions(nextKey) });
        markClean();
        sourceRef.current = `${nextKey}::renamed`;
        setSearchParams({ key: nextKey }, { replace: true });
      } else if (
        dirParam === result.sourcePath ||
        dirParam.startsWith(`${result.sourcePath}/`)
      ) {
        const nextDir = `${result.targetPath}${dirParam.slice(result.sourcePath.length)}`;
        markClean();
        sourceRef.current = `${nextDir}::directory-renamed`;
        setSearchParams({ dir: nextDir }, { replace: true });
      }
      setRenameDirectoryPath(null);
      setRenameDirectoryName("");
      setRenameDirectoryPreview(null);
      setRenameDirectoryError(null);
      toast.success("目录已重命名");
    },
    onError: (error) => {
      setRenameDirectoryError(error instanceof Error ? error.message : "未知错误");
    }
  });

  const movePreviewMutation = useMutation({
    mutationFn: (targetDirectory: string) =>
      apiPost<WikiMovePreview>(
        `/api/wiki/${encodeURIComponent(key)}/move/preview`,
        { targetDirectory }
      ),
    onMutate: (targetDirectory) => {
      moveTargetDirectoryRef.current = targetDirectory;
      setMoveTargetDirectory(targetDirectory);
      setMoveLoading(true);
      setMoveError(null);
      setMovePreview(null);
    },
    onSuccess: (result, targetDirectory) => {
      if (moveTargetDirectoryRef.current !== targetDirectory) {
        return;
      }
      setMovePreview(result);
      setMoveError(null);
    },
    onError: (error, targetDirectory) => {
      if (moveTargetDirectoryRef.current !== targetDirectory) {
        return;
      }
      setMovePreview(null);
      setMoveError(error instanceof Error ? error.message : "未知错误");
    },
    onSettled: (_data, _error, targetDirectory) => {
      if (moveTargetDirectoryRef.current !== targetDirectory) {
        return;
      }
      setMoveLoading(false);
    }
  });

  const moveMutation = useMutation({
    mutationFn: (targetDirectory: string) =>
      apiPost<WikiMoveResult>(
        `/api/wiki/${encodeURIComponent(key)}/move`,
        { targetDirectory }
      ),
    onSuccess: (result) => {
      const previousKey = key;
      queryClient.invalidateQueries({ queryKey: queryKeys.wiki });
      queryClient.invalidateQueries({ queryKey: queryKeys.wikiPage(result.key) });
      queryClient.invalidateQueries({ queryKey: queryKeys.wikiPage(previousKey) });
      queryClient.invalidateQueries({ queryKey: queryKeys.wikiVersions(result.key) });
      queryClient.invalidateQueries({ queryKey: queryKeys.wikiVersions(previousKey) });
      queryClient.invalidateQueries({ queryKey: queryKeys.diff });
      markClean();
      sourceRef.current = `${result.key}::moved`;
      setUiMode("read");
      setMoveOpen(false);
      setMovePreview(null);
      setMoveError(null);
      setSearchParams({ key: result.key }, { replace: true });
      toast.success("文档已移动");
    },
    onError: (error) => {
      setMoveError(error instanceof Error ? error.message : "未知错误");
    }
  });

  const previewBody = useMemo(
    () => ({ dryRun: true, frontmatter, content }),
    [content, frontmatter]
  );

  // Refs that always reflect the latest content / frontmatter. Updated
  // synchronously from the change handlers so the Save Preflight and
  // debounced dry-run see fresh values even before React commits the
  // batched state update. We intentionally do NOT mirror `content` /
  // `frontmatter` back into the ref during render, otherwise a render
  // triggered by an unrelated state change would clobber the latest
  // edit before downstream consumers have a chance to read it.
  // Debounced dry-run preview. Only PUTs with dryRun: true.
  useEffect(() => {
    if (!key.endsWith(".md")) {
      return;
    }
    const timeout = window.setTimeout(() => {
      runDryRunRef.current();
    }, 350);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, previewBody]);

  const runDryRunRef = useRef<() => void>(() => undefined);
  const runDryRun = useCallback(() => {
    if (!key.endsWith(".md")) {
      return;
    }
    const body = {
      dryRun: true,
      frontmatter: frontmatterRef.current,
      content: contentRef.current
    };
    const startedVersion = wikiDraftVersion(body.frontmatter, body.content);
    setPreviewLoading(true);
    apiPut<WikiPreview>(`/api/wiki/${encodeURIComponent(key)}`, body)
      .then((data) => {
        // Drop the response if the user kept editing while the
        // request was in flight. A later runDryRun will pick up the
        // current draft and the Save Preflight must never show a diff
        // that does not match the editor buffer.
        if (currentDraftVersionRef.current !== startedVersion) {
          return;
        }
        setPreview(data);
        setPreviewVersion(startedVersion);
        setPreviewError(null);
      })
      .catch((caught: unknown) => {
        if (currentDraftVersionRef.current !== startedVersion) {
          return;
        }
        setPreview(null);
        setPreviewVersion(null);
        setPreviewError(caught instanceof Error ? caught.message : "预览失败");
      })
      .finally(() => {
        if (currentDraftVersionRef.current === startedVersion) {
          setPreviewLoading(false);
        }
      });
  }, [key]);
  runDryRunRef.current = runDryRun;

  function updateFrontmatter(next: WikiFrontmatter) {
    markDirty();
    frontmatterRef.current = next;
    setFrontmatter(next);
  }

  function updateContent(next: string) {
    markDirty();
    contentRef.current = next;
    setContent(next);
  }

  function applyTemplate(templateContent: string) {
    markDirty();
    contentRef.current = templateContent;
    setContent(templateContent);
    setUiMode("edit");
  }

  function confirmDiscardUnsaved(message: string): boolean {
    if (!dirtyRef.current) {
      return true;
    }
    return window.confirm(message);
  }

  function navigateTo(nextKey: string) {
    if (
      !confirmDiscardUnsaved(
        "当前编辑未保存。切换文档会放弃未保存内容，是否继续？"
      )
    ) {
      return;
    }
    const next: Record<string, string> = { key: nextKey };
    if (slRef) {
      next.sl_ref = slRef;
    }
    markClean();
    sourceRef.current = `${nextKey}::navigated`;
    setSearchParams(next, { replace: true });
  }

  function navigateToDirectory(directory: string) {
    const nextDir = normalizeDirParam(directory);
    if (!nextDir) {
      return;
    }
    if (
      !confirmDiscardUnsaved(
        "当前编辑未保存。切换目录会放弃未保存内容，是否继续？"
      )
    ) {
      return;
    }
    markClean();
    sourceRef.current = `${nextDir}::directory`;
    setSearchParams({ dir: nextDir }, { replace: true });
  }

  const currentDirectory = useMemo(() => {
    if (selectedDirectory) {
      return selectedDirectory;
    }
    if (!key || !key.includes("/")) {
      return "global";
    }
    return key.split("/").slice(0, -1).join("/") || "global";
  }, [key, selectedDirectory]);

  const uploadDirectories = useMemo(() => {
    const directories = new Set<string>(["global"]);
    for (const directory of serverDirectories) {
      directories.add(normalizeDirectoryInput(directory.path));
    }
    for (const page of pages) {
      const segments = page.key.split("/").filter(Boolean);
      if (segments.length > 1) {
        const directorySegments = segments.slice(0, -1);
        for (let index = 1; index <= directorySegments.length; index += 1) {
          directories.add(directorySegments.slice(0, index).join("/"));
        }
      }
    }
    directories.add(currentDirectory);
    return Array.from(directories).sort((a, b) => a.localeCompare(b));
  }, [currentDirectory, pages, serverDirectories]);

  function normalizeDirectoryInput(value: string): string {
    return value.trim().replaceAll("\\", "/").replaceAll(/\/+/g, "/").replace(/^\/+|\/+$/g, "") || "global";
  }

  function normalizeOptionalDirectoryInput(value: string): string {
    return value.trim().replaceAll("\\", "/").replaceAll(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
  }

  function normalizeFileNameInput(value: string): string {
    const trimmed = value.trim().replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? "";
    if (!trimmed) {
      return "new-note.md";
    }
    return trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
  }

  function validateDirectory(directory: string): string | null {
    const segments = directory.split("/").filter(Boolean);
    if (segments.length === 0) {
      return "目标目录不能为空。";
    }
    if (segments.some((segment) => segment === "." || segment === "..")) {
      return "目标目录不能包含 `.` 或 `..`。";
    }
    return null;
  }

  function openNewDirectoryDialog(parentDirectory = currentDirectory) {
    if (
      !confirmDiscardUnsaved(
        "当前编辑未保存。新建目录会放弃未保存内容，是否继续？"
      )
    ) {
      return;
    }
    setNewDirectoryParent(normalizeDirectoryInput(parentDirectory));
    setNewDirectoryError(null);
    setNewDirectoryOpen(true);
  }

  function startNewDirectory(input: { parent: string; name: string }) {
    const parent = normalizeOptionalDirectoryInput(input.parent);
    if (parent) {
      const parentError = validateDirectory(parent);
      if (parentError) {
        setNewDirectoryError(parentError);
        return;
      }
    }
    const name = input.name.trim().replaceAll("\\", "/");
    if (!name) {
      setNewDirectoryError("目录名称不能为空。");
      return;
    }
    if (name.includes("/") || name === "." || name === ".." || name.startsWith(".")) {
      setNewDirectoryError("目录名称必须是单个目录名。");
      return;
    }
    // M56 UX-WIKI-008: an empty parent means the user explicitly chose
    // "顶层目录". Forward that intent with `{ path: name }` instead of
    // silently nesting the new directory under the legacy `global`
    // bucket.
    if (parent === "") {
      createDirectoryMutation.mutate({ path: name });
      return;
    }
    createDirectoryMutation.mutate({ parent, name });
  }

  function openDeleteDirectoryDialog(directoryPath: string) {
    if (
      !confirmDiscardUnsaved(
        "当前编辑未保存。删除目录会放弃未保存内容，是否继续？"
      )
    ) {
      return;
    }
    if (!directoryPath) {
      // The pseudo "根目录" bucket is not user-managed, so refuse it.
      toast.error("根目录不可删除。");
      return;
    }
    setDeleteDirectoryPath(directoryPath);
    setDeleteDirectoryError(null);
  }

  function cancelDeleteDirectory() {
    setDeleteDirectoryPath(null);
    setDeleteDirectoryError(null);
  }

  function confirmDeleteDirectory() {
    if (!deleteDirectoryPath) {
      return;
    }
    deleteDirectoryMutation.mutate(deleteDirectoryPath);
  }

  function openRenameDirectoryDialog(directoryPath: string) {
    if (
      !confirmDiscardUnsaved(
        "当前编辑未保存。重命名目录会放弃未保存内容，是否继续？"
      )
    ) {
      return;
    }
    if (!directoryPath) {
      toast.error("根目录不可重命名。");
      return;
    }
    const currentName = directoryPath.split("/").filter(Boolean).at(-1) ?? "";
    setRenameDirectoryPath(directoryPath);
    setRenameDirectoryName(currentName);
    setRenameDirectoryPreview(null);
    setRenameDirectoryError(null);
    renameDirectoryPathRef.current = directoryPath;
    renameDirectoryNameRef.current = currentName;
  }

  function cancelRenameDirectory() {
    setRenameDirectoryPath(null);
    setRenameDirectoryName("");
    setRenameDirectoryPreview(null);
    setRenameDirectoryError(null);
    setRenameDirectoryLoading(false);
  }

  function handleRenameDirectoryNameChange(value: string) {
    if (!renameDirectoryPath) {
      return;
    }
    setRenameDirectoryName(value);
    renameDirectoryNameRef.current = value;
    const trimmed = value.trim();
    if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) {
      setRenameDirectoryPreview(null);
      setRenameDirectoryError(
        trimmed.includes("/") || trimmed.includes("\\")
          ? "目录名称必须是单个目录名。"
          : null
      );
      return;
    }
    renamePreviewMutation.mutate({
      sourcePath: renameDirectoryPath,
      newName: trimmed
    });
  }

  function confirmRenameDirectory() {
    if (!renameDirectoryPath || !renameDirectoryName.trim()) {
      return;
    }
    renameDirectoryMutation.mutate({
      sourcePath: renameDirectoryPath,
      newName: renameDirectoryName.trim()
    });
  }

  function openMoveDialog() {
    if (!key) {
      toast.error("请先选择已保存的 Markdown 文档。");
      return;
    }
    if (mode !== "loaded") {
      toast.error("只能移动已保存的 Markdown 文档。");
      return;
    }
    if (
      uiMode === "edit" &&
      dirtyRef.current &&
      !window.confirm("当前编辑未保存。移动文档会保留未保存内容，但源文档不会被更新，是否继续？")
    ) {
      return;
    }
    const currentDirectory = key.includes("/") ? key.split("/").slice(0, -1).join("/") : "";
    moveTargetDirectoryRef.current = currentDirectory;
    setMoveTargetDirectory(currentDirectory);
    setMovePreview(null);
    setMoveError(null);
    setMoveOpen(true);
    movePreviewMutation.mutate(currentDirectory);
  }

  function closeMoveDialog() {
    setMoveOpen(false);
    setMovePreview(null);
    setMoveError(null);
  }

  function handleMoveTargetDirectoryChange(next: string) {
    setMoveTargetDirectory(next);
    movePreviewMutation.mutate(next);
  }

  function confirmMove() {
    if (!movePreview || movePreview.exists) {
      return;
    }
    moveMutation.mutate(movePreview.targetDirectory);
  }

  function openNewDocumentDialog(directory = currentDirectory) {
    if (
      !confirmDiscardUnsaved(
        "当前编辑未保存。新建文档会放弃未保存内容，是否继续？"
      )
    ) {
      return;
    }
    setNewDocumentDirectory(normalizeDirectoryInput(directory));
    setNewDocumentError(null);
    setNewDocumentOpen(true);
  }

  function startNewWiki(input: { directory: string; fileName: string }) {
    const directory = normalizeDirectoryInput(input.directory);
    const directoryError = validateDirectory(directory);
    if (directoryError) {
      setNewDocumentError(directoryError);
      return;
    }
    const fileName = normalizeFileNameInput(input.fileName);
    if (fileName === "." || fileName === ".." || fileName.includes("/") || fileName.includes("\\")) {
      setNewDocumentError("文件名必须是单个 Markdown 文件名。");
      return;
    }
    const draftKey =
      fileName === "new-note.md"
        ? nextNewNoteKey(pages.map((p) => p.key), directory)
        : `${directory}/${fileName}`.replaceAll(/\/+/g, "/");
    if (pages.some((page) => page.key === draftKey)) {
      setNewDocumentError("目标文档已存在，请换一个文件名。");
      return;
    }
    const next: Record<string, string> = { key: draftKey };
    if (slRef) {
      next.sl_ref = slRef;
    }
    setNewDocumentOpen(false);
    setNewDocumentError(null);
    setSearchParams(next, { replace: true });
    markClean();
    sourceRef.current = `${draftKey}::navigated`;
    setUiMode("edit");
  }

  function openSavePreflight() {
    if (!key) {
      toast.error("请先选择或新建 Markdown 文档。");
      return;
    }
    if (!key.endsWith(".md")) {
      toast.error("路径必须以 .md 结尾才能保存。");
      return;
    }
    // Always force a fresh dry-run when the modal opens. If the
    // current draft is still covered by a recent preview we still
    // re-issue the request so Diff / Raw can never lag behind the
    // editor buffer.
    setPreview(null);
    setPreviewVersion(null);
    setPreviewError(null);
    runDryRun();
    setPreflightOpen(true);
  }

  function switchToEdit() {
    if (!key) {
      toast.error("请先选择或新建 Markdown 文档。");
      return;
    }
    if (uiMode === "edit") {
      return;
    }
    setUiMode("edit");
  }

  function openVersionHistory() {
    if (!key || mode !== "loaded") {
      toast.error("请先选择已保存的 Markdown 文档。");
      return;
    }
    if (
      uiMode === "edit" &&
      dirtyRef.current &&
      !window.confirm("当前编辑未保存。查看版本记录会保留当前编辑，但恢复历史版本前需要确认，是否继续？")
    ) {
      return;
    }
    setSelectedVersionId(null);
    setVersionHistoryOpen(true);
  }

  function requestBackToRead() {
    if (
      uiMode === "edit" &&
      !confirmDiscardUnsaved("当前编辑未保存。取消编辑会放弃未保存内容，是否继续？")
    ) {
      return;
    }
    if (mode === "loaded" && pageQuery.data) {
      setFrontmatter(pageQuery.data.frontmatter);
      frontmatterRef.current = pageQuery.data.frontmatter;
      setContent(pageQuery.data.content);
      contentRef.current = pageQuery.data.content;
      sourceRef.current = `${key}::${mode}::cancelled`;
    }
    if (mode === "draft") {
      setContent("");
      contentRef.current = "";
      setFrontmatter(slRef ? { sl_refs: [slRef] } : {});
      frontmatterRef.current = slRef ? { sl_refs: [slRef] } : {};
    }
    markClean();
    setUiMode("read");
  }

  function openUpload(modeToOpen: WikiUploadMode) {
    if (
      !confirmDiscardUnsaved(
        modeToOpen === "replace"
          ? "当前编辑未保存。上传覆盖会放弃未保存内容，是否继续？"
          : "当前编辑未保存。上传新文档会放弃未保存内容，是否继续？"
      )
    ) {
      return;
    }
    if (modeToOpen === "replace" && !key) {
      toast.error("请先选择要覆盖的 Markdown 文档。");
      return;
    }
    setUploadMode(modeToOpen);
    setUploadPreview(null);
    setUploadError(null);
    uploadInputRef.current?.click();
  }

  async function previewUpload(
    targetKey: string,
    markdown: string,
    modeToPreview: WikiUploadMode,
    sourceFileName: string
  ) {
    const requestId = uploadPreviewRequestRef.current + 1;
    uploadPreviewRequestRef.current = requestId;
    setUploadLoading(true);
    setUploadOpen(true);
    setUploadError(null);
    setUploadPreview(null);
    try {
      const result = await apiPost<WikiUploadPreview>("/api/wiki/upload/preview", {
        key: targetKey,
        markdown,
        sourceFileName,
        overwrite: modeToPreview === "replace"
      });
      if (uploadPreviewRequestRef.current !== requestId) {
        return;
      }
      setUploadPreview(result);
    } catch (error) {
      if (uploadPreviewRequestRef.current !== requestId) {
        return;
      }
      setUploadError(error instanceof Error ? error.message : "未知错误");
    } finally {
      if (uploadPreviewRequestRef.current === requestId) {
        setUploadLoading(false);
      }
    }
  }

  async function handleUploadFile(file: File | undefined) {
    if (!file) {
      return;
    }
    if (!file.name.endsWith(".md")) {
      toast.error("请选择 .md Markdown 文件。");
      return;
    }
    const markdown = await file.text();
    const fileName = file.name.split(/[\\/]/).pop() ?? file.name;
    setUploadFileName(fileName);
    const targetKey =
      uploadMode === "replace"
        ? key
        : `${currentDirectory}/${fileName}`.replaceAll(/\/+/g, "/");
    setUploadTargetKey(targetKey);
    setUploadMarkdown(markdown);
    await previewUpload(targetKey, markdown, uploadMode, fileName);
    if (uploadInputRef.current) {
      uploadInputRef.current.value = "";
    }
  }

  function handleUploadDirectoryChange(directory: string) {
    if (!uploadFileName || !uploadMarkdown) {
      return;
    }
    const normalizedDirectory = normalizeDirectoryInput(directory);
    const targetKey = `${normalizedDirectory}/${uploadFileName}`.replaceAll(/\/+/g, "/");
    setUploadTargetKey(targetKey);
    void previewUpload(targetKey, uploadMarkdown, "create", uploadFileName);
  }

  async function handleDownloadMarkdown() {
    if (!key) {
      toast.error("请先选择 Markdown 文档。");
      return;
    }
    if (
      uiMode === "edit" &&
      dirtyRef.current &&
      !window.confirm("当前有未保存编辑。下载的是已保存版本，是否继续？")
    ) {
      return;
    }
    try {
      const response = await fetch(`/api/wiki/${encodeURIComponent(key)}/raw`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const markdown = await response.text();
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = key.split("/").pop() ?? "wiki.md";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(`下载失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  // Cmd/Ctrl+S opens the Save Preflight. This is the single source of
  // truth for the shortcut and is wired on `window` so it works no
  // matter where focus currently lives.
  useEffect(() => {
    function handle(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }
      if (event.key.toLowerCase() !== "s") {
        return;
      }
      event.preventDefault();
      if (!key) {
        toast.error("请先选择或新建 Markdown 文档。");
        return;
      }
      if (uiMode !== "edit") {
        setUiMode("edit");
      }
      openSavePreflight();
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiMode, key, frontmatter, content]);

  const preflightState = useMemo(
    () =>
      buildSavePreflightState({
        key,
        preview,
        previewError,
        frontmatter,
        content,
        knownSlRefs,
        previewLoading,
        currentDraftVersion,
        previewVersion
      }),
    [content, currentDraftVersion, frontmatter, key, knownSlRefs, preview, previewError, previewLoading, previewVersion]
  );

  return (
    <div className="pl-page-stack">
      <PageHeader
        title={
          uiMode === "edit" ? (
            <span className="pl-wiki-header-edit-title">
              编辑 Wiki 文档
            </span>
          ) : (
            "业务 Wiki"
          )
        }
        description={
          uiMode === "read"
            ? "管理业务口径、指标说明和分析 Playbook 的 Markdown 文档。"
            : "粘贴或撰写 Markdown；保存前通过保存预检查看 Diff 与校验。"
        }
        badges={null}
        actions={
          <div className="pl-wiki-header-actions" data-testid="wiki-header-actions">
            {uiMode === "read" ? (
              mode === "library" ? (
                <>
                  <button
                    className="pl-btn pl-btn--primary"
                    data-testid="wiki-upload-button"
                    onClick={() => openUpload("create")}
                    type="button"
                  >
                    上传 Markdown
                  </button>
                  <button
                    className="pl-btn pl-btn--ghost"
                    data-testid="wiki-new-button"
                    onClick={() => openNewDocumentDialog()}
                    type="button"
                  >
                    新建文档
                  </button>
                </>
              ) : mode === "loaded" ? (
                <>
                  <button
                    className="pl-btn pl-btn--ghost"
                    data-testid="wiki-download-button"
                    onClick={handleDownloadMarkdown}
                    title="下载当前打开的 Markdown 文档到本地"
                    type="button"
                  >
                    下载当前 Markdown
                  </button>
                  <button
                    className="pl-btn pl-btn--ghost"
                    data-testid="wiki-move-button"
                    onClick={openMoveDialog}
                    type="button"
                  >
                    移动到目录
                  </button>
                  <button
                    className="pl-btn pl-btn--ghost"
                    data-testid="wiki-version-button"
                    onClick={openVersionHistory}
                    type="button"
                  >
                    版本记录
                  </button>
                  <button
                    className="pl-btn pl-btn--ghost"
                    data-testid="wiki-upload-replace-button"
                    onClick={() => openUpload("replace")}
                    type="button"
                  >
                    上传覆盖
                  </button>
                  <button
                    className="pl-btn pl-btn--primary"
                    data-testid="wiki-edit-button"
                    onClick={switchToEdit}
                    type="button"
                  >
                    编辑
                  </button>
                </>
              ) : null
            ) : (
              <>
                {isDirty ? (
                  <span
                    className="pl-wiki-header-status"
                    data-testid="wiki-status-pill"
                    data-status="dirty"
                  >
                    有未保存修改
                  </span>
                ) : mode === "draft" ? (
                  <span
                    className="pl-wiki-header-status"
                    data-testid="wiki-status-pill"
                    data-status="draft"
                  >
                    未保存草稿
                  </span>
                ) : null}
                <button
                  className="pl-btn pl-btn--ghost"
                  data-testid="wiki-back-to-read"
                  onClick={requestBackToRead}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="pl-btn pl-btn--primary"
                  data-testid="wiki-save-preflight-button"
                  disabled={saveMutation.isPending}
                  onClick={openSavePreflight}
                  type="button"
                >
                  保存预检
                </button>
              </>
            )}
          </div>
        }
      />

      <section
        aria-label="业务 Wiki 工作区"
        className={clsx(
          "pl-editor-layout",
          "pl-wiki-layout",
          `pl-wiki-layout--${uiMode}`,
          previewTab && uiMode === "edit" && "pl-wiki-layout--preview-tab"
        )}
        data-key={key || undefined}
        data-mode={uiMode}
        data-preview-tab={previewTab || undefined}
        data-testid="wiki-layout"
      >
        <aside
          aria-label="业务 Wiki 目录"
          className="grid content-start gap-3 pl-wiki-sidebar"
          data-testid="wiki-sidebar"
        >
          <div className="pl-wiki-sidebar-header">
            <h2 className="pl-wiki-sidebar-title">目录</h2>
            <div className="pl-wiki-sidebar-actions">
              <button
                aria-label="新建目录"
                className="pl-wiki-sidebar-action"
                data-testid="wiki-sidebar-create-directory"
                onClick={() => openNewDirectoryDialog()}
                title="新建目录"
                type="button"
              >
                <FolderPlus aria-hidden="true" focusable="false" size={15} />
              </button>
              <button
                aria-label="在当前目录新建文档"
                className="pl-wiki-sidebar-action"
                data-testid="wiki-sidebar-create-document"
                onClick={() => openNewDocumentDialog()}
                title="新建文档"
                type="button"
              >
                <FilePlus aria-hidden="true" focusable="false" size={15} />
              </button>
            </div>
          </div>
          {slRef ? (
            <p
              className="pl-notice pl-wiki-context-hint"
              data-testid="wiki-context-hint"
              title={slRef}
            >
              当前上下文：<code className="notranslate" translate="no">{slRef}</code>
              {mode === "loaded" ? "（已匹配）" : "（新草稿）"}
            </p>
          ) : null}
          <WikiTree
            activeKey={key}
            directories={serverDirectories}
            directoryPanelActive={mode === "library" && Boolean(selectedDirectory)}
            onCreateDirectory={openNewDirectoryDialog}
            onCreateDocument={openNewDocumentDialog}
            onDeleteDirectory={openDeleteDirectoryDialog}
            onRenameDirectory={openRenameDirectoryDialog}
            onSelect={navigateTo}
            onSelectDirectory={navigateToDirectory}
            pages={pages}
            selectedDirectory={selectedDirectory}
          />
        </aside>

        <div className="grid gap-4 pl-wiki-main">
          <div
            className={clsx(
              "pl-wiki-body",
              mode === "library" && "pl-wiki-body--library"
            )}
            data-testid="wiki-body"
          >
            {mode === "library" ? (
              <WikiLibraryHome
                directories={serverDirectories}
                onSelect={navigateTo}
                pages={pages}
                selectedDirectory={selectedDirectory || null}
              />
            ) : uiMode === "read" ? (
              <WikiReadView
                content={content}
                frontmatter={frontmatter}
                keyName={key}
                knownSources={knownSlRefs}
                knownTables={tables}
                onApplyTemplate={applyTemplate}
                onOpenTemplatePicker={() => setTemplatePickerOpen(true)}
                onSwitchToEdit={switchToEdit}
              />
            ) : (
              <WikiEditView
                content={content}
                frontmatter={frontmatter}
                onContentChange={updateContent}
                onFrontmatterChange={updateFrontmatter}
                previewTab={previewTab}
                onPreviewTabChange={setPreviewTab}
              />
            )}
          </div>
        </div>
      </section>

      <TemplatePicker
        onClose={() => setTemplatePickerOpen(false)}
        onPick={(picked) => {
          applyTemplate(picked.content);
          setTemplatePickerOpen(false);
          toast.success("模板已填充，请补全高亮字段后保存预检。");
        }}
        open={templatePickerOpen}
      />

      <WikiNewDirectoryDialog
        defaultParentDirectory={newDirectoryParent}
        directories={uploadDirectories}
        error={newDirectoryError}
        onCancel={() => {
          setNewDirectoryOpen(false);
          setNewDirectoryError(null);
        }}
        onConfirm={startNewDirectory}
        open={newDirectoryOpen}
      />

      <WikiNewDocumentDialog
        defaultDirectory={newDocumentDirectory}
        defaultFileName="new-note.md"
        directories={uploadDirectories}
        error={newDocumentError}
        onCancel={() => {
          setNewDocumentOpen(false);
          setNewDocumentError(null);
        }}
        onConfirm={startNewWiki}
        onOpenNewDirectory={(currentDirectory) => {
          setNewDocumentOpen(false);
          setNewDocumentError(null);
          openNewDirectoryDialog(currentDirectory);
        }}
        open={newDocumentOpen}
      />

      <WikiSavePreflight
        isSaving={saveMutation.isPending}
        onCancel={() => setPreflightOpen(false)}
        onConfirmSave={() => saveMutation.mutate()}
        open={preflightOpen}
        state={preflightState}
      />

      <WikiVersionHistoryDialog
        error={
          versionsQuery.error instanceof Error
            ? versionsQuery.error.message
            : selectedVersionId && versionDetailQuery.error instanceof Error
              ? versionDetailQuery.error.message
              : null
        }
        isDetailLoading={versionDetailQuery.isFetching}
        isLoading={versionsQuery.isLoading}
        keyName={key}
        onClose={() => {
          setVersionHistoryOpen(false);
          setSelectedVersionId(null);
        }}
        onRestore={(versionId) => restorePreviewMutation.mutate(versionId)}
        onSelectVersion={setSelectedVersionId}
        open={versionHistoryOpen}
        restoreLoading={restorePreviewMutation.isPending || restoreMutation.isPending}
        retentionLimit={versionsQuery.data?.retentionLimit ?? 5}
        selectedVersion={versionDetailQuery.data ?? null}
        selectedVersionId={selectedVersionId}
        versions={versionsQuery.data?.versions ?? []}
      />

      <WikiRestorePreflight
        error={restorePreviewError}
        isLoading={restorePreviewMutation.isPending}
        isRestoring={restoreMutation.isPending}
        onCancel={() => {
          setRestorePreflightOpen(false);
          setRestorePreview(null);
          setRestorePreviewError(null);
        }}
        onConfirm={() => restoreMutation.mutate()}
        open={restorePreflightOpen}
        preview={restorePreview}
      />

      <input
        accept=".md,text/markdown,text/plain"
        aria-label="选择 Markdown 文件"
        className="sr-only"
        data-testid="wiki-upload-input"
        onChange={(event) => {
          void handleUploadFile(event.target.files?.[0]);
        }}
        ref={uploadInputRef}
        type="file"
      />

      <WikiDeleteDirectoryDialog
        directoryPath={deleteDirectoryPath}
        error={deleteDirectoryError}
        isDeleting={deleteDirectoryMutation.isPending}
        onCancel={cancelDeleteDirectory}
        onConfirm={confirmDeleteDirectory}
      />

      <WikiRenameDirectoryDialog
        error={renameDirectoryError}
        isLoading={renameDirectoryLoading}
        isRenaming={renameDirectoryMutation.isPending}
        newName={renameDirectoryName}
        onCancel={cancelRenameDirectory}
        onConfirm={confirmRenameDirectory}
        onNewNameChange={handleRenameDirectoryNameChange}
        preview={renameDirectoryPreview}
        sourcePath={renameDirectoryPath}
      />

      <WikiMoveDocumentDialog
        directories={uploadDirectories}
        error={moveError}
        isLoading={moveLoading}
        isMoving={moveMutation.isPending}
        keyName={key}
        onCancel={closeMoveDialog}
        onConfirm={confirmMove}
        onTargetDirectoryChange={handleMoveTargetDirectoryChange}
        open={moveOpen && mode === "loaded"}
        preview={movePreview}
        targetDirectory={moveTargetDirectory}
      />

      <WikiUploadPreflight
        error={uploadError}
        directories={uploadDirectories}
        isCommitting={uploadCommitMutation.isPending}
        isLoading={uploadLoading}
        mode={uploadMode}
        onCancel={() => {
          setUploadOpen(false);
          setUploadPreview(null);
          setUploadError(null);
        }}
        onConfirm={() => uploadCommitMutation.mutate()}
        onTargetDirectoryChange={handleUploadDirectoryChange}
        open={uploadOpen}
        preview={uploadPreview}
        targetDirectory={
          (uploadPreview?.targetKey ?? uploadTargetKey).includes("/")
            ? (uploadPreview?.targetKey ?? uploadTargetKey).split("/").slice(0, -1).join("/")
            : currentDirectory
        }
      />
    </div>
  );
}
