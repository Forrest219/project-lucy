# Lucy Version Governance Hardening Implementation Plan

> **For Codex:** Execute this plan task-by-task in the current checkout and preserve unrelated WIP.

**Goal:** Make repo-root `VERSION` the enforced Lucy product-version SSOT across npm metadata, Docker images, release CI, Helm, WebUI, and customer delivery artifacts.

**Architecture:** Add a read-only Node gate that validates version format and every committed version projection. Reuse the same policy helpers in tests and release tooling, then add runtime/build gates that compare the final image tag and embedded `LUCY_VERSION` against `VERSION`. Helm keeps `lucy.version` for release metadata compatibility but rejects values that differ from `Chart.appVersion`.

**Tech Stack:** Node.js 22 (`node:test`), Bash, GitHub Actions, Docker Buildx, Helm 3, TypeScript/Vite.

---

### Task 1: Add the SSOT gate

**Files:**
- Create: `scripts/lucy-version-governance.mjs`
- Create: `scripts/lucy-version-governance.test.mjs`
- Modify: `package.json`

1. Write tests for valid product versions, accepted customer/release tags, rejected mismatches, and committed projection drift.
2. Run the tests and confirm the current package-lock/source-bundle drift fails.
3. Implement `npm run lint:version` and exported tag/version validators.
4. Run the tests and gate until they pass after later projection fixes.

### Task 2: Bind build and release images to `VERSION`

**Files:**
- Modify: `scripts/build-customer-amd64-image.sh`
- Modify: `.github/workflows/lucy-release.yml`

1. Reject invalid `LUCY_VERSION` and customer image tags whose product segment differs.
2. Resolve `LUCY_VERSION` from `VERSION` in CI, pass it as a Docker build argument, record it in image identity, and verify it from the final pulled image.
3. Run shell syntax checks and governance tests.

### Task 3: Make release metadata consume the SSOT

**Files:**
- Modify: `scripts/release-artifacts.mjs`
- Modify: `scripts/release-artifacts.test.mjs`
- Modify: `package-lock.json`

1. Include `VERSION` in the customer source bundle.
2. Read product version from `VERSION`; fail when `package.json` or package-lock root metadata differs.
3. Write release metadata/SBOM from the validated product version.
4. Synchronize the two root package-lock version fields.

### Task 4: Close Helm and K8s delivery drift

**Files:**
- Modify: `deploy/k8s/helm/lucy/templates/_helpers.tpl`
- Modify: `deploy/k8s/helm/lucy/templates/configmap.yaml`
- Modify: `deploy/k8s/helm/lucy/templates/NOTES.txt`
- Modify: `scripts/helm-lucy-gate.sh`
- Modify: `scripts/build-k8s-delivery-package.sh`
- Modify: `scripts/build-k8s-delivery-package.test.mjs`
- Modify: `deploy/k8s/K8S_CONTRACT.md`

1. Fail Helm rendering when `lucy.version` differs from `Chart.appVersion`.
2. Assert rendered Lucy/KTX env values and add a negative mismatch gate.
3. Read Chart/app versions dynamically when building the delivery package.
4. Update the authoritative K8s contract to distinguish Lucy `0.17.0` from bundled KTX `0.16.0`.

### Task 5: Clarify policy and validate runtime projections

**Files:**
- Modify: `docs/version-matrix.md`
- Modify: `webui/server/lucy-version.ts`
- Modify: `webui/src/lib/lucyVersion.ts`
- Modify: `webui/vite.config.ts`
- Add or modify targeted tests under `webui/server/__tests__/` and `webui/src/__tests__/`.

1. Replace decimal-style bump wording with explicit second-component increments and define the third component.
2. Reject invalid build-time versions and prevent invalid runtime/UI labels.
3. Add focused resolver/formatter tests.

### Task 6: Verify the complete delivery path

1. Run `npm run lint:version`, its Node tests, `npm run lint:spec`, and release/package regression tests.
2. Run targeted WebUI tests and a custom-version production build.
3. Run `bash scripts/helm-lucy-gate.sh`.
4. Run `bash -n` on modified shell scripts and validate the workflow YAML parse.
5. Run `bash scripts/build-customer-amd64-image.sh`; require G1-G4c and G8 to pass, or report an environmental blocker with the exact gate reached.

