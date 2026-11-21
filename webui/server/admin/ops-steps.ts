import type { FastifyInstance } from "fastify";
import { getOpsStepJournal } from "../runtime/ops-step-journal.js";

type OpsStepReadInjector = (token: string | undefined) => Promise<void>;

let readInjector: OpsStepReadInjector | null = null;

/** Test-only hook. Production never registers an injector. */
export function setOpsStepReadInjector(injector: OpsStepReadInjector | null): void {
  readInjector = injector;
}

type OpsStepFilters = {
  opId?: string;
  op?: string;
  step?: string;
  state?: string;
  uatFault?: string;
};

type FilterableOpsStepView = {
  opId: string;
  op: string;
  step: string;
  state: string;
};

function matchesFilters(view: FilterableOpsStepView, filters: OpsStepFilters): boolean {
  return (filters.opId === undefined || view.opId === filters.opId)
    && (filters.op === undefined || view.op === filters.op)
    && (filters.step === undefined || view.step === filters.step)
    && (filters.state === undefined || view.state === filters.state);
}

export function registerOpsStepRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: OpsStepFilters }>("/api/admin/ops-steps", async (request) => {
    await readInjector?.(request.query.uatFault);
    const readModel = getOpsStepJournal().read();
    const filters = request.query;
    return {
      ok: true,
      data: {
        ...readModel,
        history: readModel.history.filter((view) => matchesFilters(view, filters)),
        inFlight: readModel.inFlight.filter((view) => matchesFilters(view, filters))
      }
    };
  });
}
