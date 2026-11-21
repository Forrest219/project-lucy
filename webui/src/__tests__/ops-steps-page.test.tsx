// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpsSteps, type OpsStepRow, type OpsStepsResponse } from "../pages/admin/OpsSteps";

const OP_ID = "ops_0123456789abcdef0123456789abcdef";

function makeRow(overrides: Partial<OpsStepRow> = {}): OpsStepRow {
  return {
    key: "current:read_project:0",
    op: "diagnostic_collect",
    opId: OP_ID,
    step: "read_project",
    phase: "enter",
    ts: "2026-11-20T08:00:02.000Z",
    elapsedMs: 2000,
    result: "running",
    reasonCode: "",
    state: "running",
    enteredAt: "2026-11-20T08:00:00.000Z",
    durationMs: 2000,
    ...overrides
  };
}

function makeResponse(overrides: Partial<OpsStepsResponse> = {}): OpsStepsResponse {
  return {
    history: [],
    inFlight: [],
    historyTruncated: false,
    truncationReasons: [],
    stdoutWriteFailed: false,
    stdoutDroppedCount: 0,
    fileWritable: "ok",
    fileDroppedCount: 0,
    formatDroppedCount: 0,
    fileWriteReason: "",
    historyResidual: false,
    ...overrides
  };
}

function successResponse(data: OpsStepsResponse): Response {
  return new Response(JSON.stringify({ ok: true, data }));
}

function renderOpsSteps() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/ops-steps"]}>
        <Routes>
          <Route path="/admin/ops-steps" element={<OpsSteps />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("OpsSteps (/admin/ops-steps)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("E1 首访显示运维步骤页头、面包屑和步骤列表", async () => {
    const fetchMock = vi.fn(async () => successResponse(makeResponse({ inFlight: [makeRow()] })));
    vi.stubGlobal("fetch", fetchMock);

    renderOpsSteps();

    expect(await screen.findByRole("heading", { name: "运维步骤" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "面包屑" })).toHaveTextContent("运行状态/运维步骤");
    expect(screen.getByTestId("ops-steps-page")).toHaveTextContent("按操作号查看进行中、已结束的运维步骤及写入降级");
    expect(await screen.findByTestId("ops-steps-row-current:read_project:0")).toHaveTextContent("read_project");
    expect(screen.getByTestId("ops-steps-inflight-table")).toHaveClass("pl-data-grid", "pl-data-table");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/ops-steps", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("E2 成功读取但没有步骤时说明为空原因", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => successResponse(makeResponse())));

    renderOpsSteps();

    const empty = await screen.findByTestId("ops-steps-empty");
    expect(empty).toHaveTextContent("当前没有已记录的运维步骤");
    expect(empty).toHaveTextContent("执行受支持的运维操作后");
    expect(screen.queryByTestId("ops-steps-filter-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("ops-steps-write-health")).toBeInTheDocument();
  });

  it("E3 手动刷新保留旧行并标记刷新中", async () => {
    const second = deferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(successResponse(makeResponse({ inFlight: [makeRow()] })))
      .mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetchMock);

    renderOpsSteps();
    expect(await screen.findByTestId("ops-steps-row-current:read_project:0")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("ops-steps-refresh"));

    expect(await screen.findByTestId("ops-steps-refreshing")).toHaveTextContent("已显示的步骤保持不变");
    expect(screen.getByTestId("ops-steps-row-current:read_project:0")).toBeInTheDocument();
    expect(screen.getByTestId("ops-steps-inflight")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("ops-steps-refresh")).toBeDisabled();
    expect(screen.getByTestId("ops-steps-refresh")).toHaveAttribute("data-loading", "true");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve(successResponse(makeResponse({
        inFlight: [makeRow({ step: "read_ktx_yaml", key: "current:read_ktx_yaml:0" })]
      })));
      await second.promise;
    });
    expect(await screen.findByTestId("ops-steps-row-current:read_ktx_yaml:0")).toBeInTheDocument();
    expect(screen.queryByTestId("ops-steps-row-current:read_project:0")).not.toBeInTheDocument();
  });

  it("E4 首访错误显示原因并可通过区内重试恢复", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: false,
        error: { code: "READ_FAILED", message: "读取暂时不可用" }
      }), { status: 500 }))
      .mockResolvedValueOnce(successResponse(makeResponse({ inFlight: [makeRow()] })));
    vi.stubGlobal("fetch", fetchMock);

    renderOpsSteps();

    const error = await screen.findByTestId("async-region-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent("运维步骤列表加载失败：读取暂时不可用");
    fireEvent.click(within(error).getByTestId("async-region-retry"));

    expect(await screen.findByTestId("ops-steps-row-current:read_project:0")).toBeInTheDocument();
    expect(screen.queryByTestId("async-region-error")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("E5 筛选无命中时可清除，筛选本身不重新请求", async () => {
    const fetchMock = vi.fn(async () => successResponse(makeResponse({
      inFlight: [makeRow()],
      history: [makeRow({
        key: "history:read_columns:0",
        op: "schema_structure_read",
        step: "read_columns",
        phase: "leave",
        result: "ok",
        state: "ended",
        durationMs: 800
      })]
    })));
    vi.stubGlobal("fetch", fetchMock);

    renderOpsSteps();
    await screen.findByTestId("ops-steps-row-current:read_project:0");

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索运维步骤" }), {
      target: { value: "不存在的步骤" }
    });
    expect(screen.getByTestId("ops-steps-filter-empty")).toHaveTextContent("当前筛选条件下没有匹配");
    expect(screen.getByTestId("ops-steps-clear-filters")).toHaveClass("pl-btn--secondary");
    expect(screen.getByTestId("ops-steps-clear-filters")).toBeEnabled();

    fireEvent.click(screen.getByTestId("ops-steps-clear-filters"));
    expect(screen.getByTestId("ops-steps-row-current:read_project:0")).toBeInTheDocument();
    expect(screen.getByTestId("ops-steps-row-history:read_columns:0")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "按步骤状态筛选" }), {
      target: { value: "running" }
    });
    expect(screen.getByTestId("ops-steps-row-current:read_project:0")).toBeInTheDocument();
    expect(screen.queryByTestId("ops-steps-row-history:read_columns:0")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("E6 按步骤实例分区，同操作混合状态且重复步骤不去重", async () => {
    const shared = "ops_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    vi.stubGlobal("fetch", vi.fn(async () => successResponse(makeResponse({
      inFlight: [makeRow({
        key: "shared:read_project:0",
        opId: shared,
        state: "running"
      })],
      history: [
        makeRow({
          key: "shared:read_ktx_yaml:0",
          opId: shared,
          step: "read_ktx_yaml",
          phase: "leave",
          result: "ok",
          state: "ended",
          durationMs: 1200
        }),
        makeRow({
          key: "previous:read_columns:0",
          opId: "ops_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          op: "schema_structure_read",
          step: "read_columns",
          phase: "enter",
          result: "running",
          state: "previous_incomplete",
          durationMs: null
        }),
        makeRow({
          key: "reload:catalog_reload:0",
          op: "runtime_reload",
          step: "catalog_reload",
          phase: "leave",
          result: "ok",
          state: "ended",
          durationMs: 100
        }),
        makeRow({
          key: "reload:catalog_reload:1",
          op: "runtime_reload",
          step: "catalog_reload",
          phase: "leave",
          result: "ok",
          state: "ended",
          durationMs: 200
        })
      ]
    }))));

    renderOpsSteps();
    const inFlight = await screen.findByTestId("ops-steps-inflight");
    const history = screen.getByTestId("ops-steps-history");

    expect(within(inFlight).getByText(shared)).toBeInTheDocument();
    expect(within(inFlight).getByText("read_project")).toBeInTheDocument();
    expect(within(screen.getByTestId("ops-steps-row-shared:read_project:0")).getAllByText("进行中")).toHaveLength(2);
    expect(within(history).getByText("read_ktx_yaml")).toBeInTheDocument();
    expect(within(history).getAllByText(shared)).toHaveLength(1);
    expect(within(history).getByText("上次进程未完成")).toBeInTheDocument();
    expect(screen.getByTestId("ops-steps-row-reload:catalog_reload:0")).toBeInTheDocument();
    expect(screen.getByTestId("ops-steps-row-reload:catalog_reload:1")).toBeInTheDocument();
    expect(within(history).getAllByText("catalog_reload")).toHaveLength(2);
  });

  it("E7 三类丢行、文件原因、两类截断和历史残行可见，进行中仍保留", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => successResponse(makeResponse({
      inFlight: [makeRow()],
      historyTruncated: true,
      truncationReasons: ["row_limit", "age_limit"],
      stdoutWriteFailed: true,
      stdoutDroppedCount: 2,
      fileWritable: "error",
      fileDroppedCount: 3,
      formatDroppedCount: 4,
      fileWriteReason: "queue_full",
      historyResidual: true
    }))));

    renderOpsSteps();
    await screen.findByTestId("ops-steps-row-current:read_project:0");

    expect(screen.getByTestId("ops-steps-stdout-health")).toHaveTextContent("标准输出：写入失败；丢行 2 行");
    expect(screen.getByTestId("ops-steps-file-health")).toHaveTextContent("文件副本：写入失败；丢行 3 行");
    expect(screen.getByTestId("ops-steps-file-health")).toHaveTextContent("queue_full");
    expect(screen.getByTestId("ops-steps-format-health")).toHaveTextContent("格式化：丢行 4 行");
    expect(screen.getByTestId("ops-steps-truncated")).toHaveTextContent("达到 2000 行上限");
    expect(screen.getByTestId("ops-steps-truncated")).toHaveTextContent("达到 1 小时上限");
    expect(screen.getByTestId("ops-steps-truncated")).toHaveTextContent("进行中的步骤不受历史截断影响");
    expect(screen.getByTestId("ops-steps-residual")).toHaveTextContent("已隔离上次进程的历史残行");
    expect(screen.getByTestId("ops-steps-residual")).toHaveTextContent("不计入当前进程文件丢行");
  });

  it("E8 刷新是页头唯一 primary，清除筛选为 secondary，无导出或业务重试", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => successResponse(makeResponse({ inFlight: [makeRow()] }))));

    renderOpsSteps();
    await screen.findByTestId("ops-steps-row-current:read_project:0");

    const headerActions = screen.getByTestId("page-header-actions");
    expect(within(headerActions).getAllByRole("button")).toHaveLength(1);
    expect(within(headerActions).getByTestId("ops-steps-refresh")).toHaveClass("pl-btn--primary");
    expect(document.querySelectorAll(".pl-btn--primary")).toHaveLength(1);
    expect(screen.getByTestId("ops-steps-clear-filters")).toHaveClass("pl-btn--secondary");
    expect(screen.queryByRole("button", { name: /导出/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /重试业务|重试操作/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /自动|轮询/ })).not.toBeInTheDocument();
  });

  it("E9 决定信息完整且标识防翻译，历史孤立 enter 时长保持未知", async () => {
    const failed = makeRow({
      key: "history:read_columns:failed",
      op: "schema_structure_read",
      step: "read_columns",
      phase: "fail",
      result: "error",
      reasonCode: "unreadable",
      state: "ended",
      durationMs: 2400
    });
    const orphan = makeRow({
      key: "history:list_tables:orphan",
      op: "schema_structure_read",
      step: "list_tables",
      phase: "enter",
      result: "running",
      state: "previous_incomplete",
      enteredAt: "2026-11-20T07:00:00.000Z",
      durationMs: null
    });
    const truncated = makeRow({
      key: "history:read_columns:truncated",
      op: "schema_structure_read",
      step: "read_columns",
      phase: "leave",
      result: "ok",
      state: "ended",
      enteredAt: null,
      durationMs: null
    });
    vi.stubGlobal("fetch", vi.fn(async () => successResponse(makeResponse({
      history: [failed, orphan, truncated]
    }))));

    renderOpsSteps();
    const failedRow = await screen.findByTestId("ops-steps-row-history:read_columns:failed");
    expect(failedRow).toHaveTextContent(OP_ID);
    expect(failedRow).toHaveTextContent("schema_structure_read");
    expect(failedRow).toHaveTextContent("read_columns");
    expect(failedRow).toHaveTextContent("2.4 秒");
    expect(failedRow).toHaveTextContent("失败");
    expect(failedRow).toHaveTextContent("unreadable");
    expect(within(failedRow).getByText(OP_ID)).toHaveAttribute("translate", "no");
    expect(within(failedRow).getByText(OP_ID)).toHaveClass("notranslate");
    expect(within(failedRow).getByText("read_columns")).toHaveAttribute("translate", "no");
    expect(within(failedRow).getByText("read_columns")).toHaveClass("notranslate");
    expect(within(failedRow).getByText("unreadable")).toHaveAttribute("translate", "no");

    const orphanRow = screen.getByTestId("ops-steps-row-history:list_tables:orphan");
    expect(orphanRow).toHaveTextContent("上次进程未完成");
    expect(orphanRow).toHaveTextContent("未知（上次进程未完成）");
    expect(orphanRow).toHaveTextContent("未记录终态");
    expect(within(orphanRow).queryByText("进行中")).not.toBeInTheDocument();
    expect(orphanRow).not.toHaveTextContent("0 毫秒");
    await waitFor(() => {
      expect(orphanRow).toHaveTextContent("未知（上次进程未完成）");
    });

    const truncatedRow = screen.getByTestId("ops-steps-row-history:read_columns:truncated");
    expect(truncatedRow).toHaveTextContent("起始记录已截断");
    expect(truncatedRow).toHaveTextContent("未知（起始记录已截断）");
  });
});
