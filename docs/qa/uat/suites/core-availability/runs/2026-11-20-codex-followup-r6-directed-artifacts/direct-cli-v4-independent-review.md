# SC11 direct CLI v4 fixture-only static review

**APPROVED for fresh actual validation of this fixture-only revision.** No P1/P2 found in the reviewed --init/process-evidence delta. Exact driver227dfe89…/test51594fca… hashes match the freeze; full hashes are in the sibling identity JSON. No tests, compile, Docker, listeners or SQL were started by A.

The main synthetic direct-CLI container alone gains --init before the image argument. Actual HostConfig.Init plus observed PID1 comm/state, bootstrap PPid1, app→bootstrap parent relationship and original listener PID/startTicks are required before cases. No product/canonical helper/image/auth/config budget changes occur; v3 YAML value/type/secret-safe normalization, save404 early classification, default20/60, stop10/startReady20, owner8s and tight1500ms remain unchanged.

New process facts read only /proc stat/comm and private bootstrap numeric PIDs. They record original daemon identity, state, PPid/startTicks and a bounded parent chain, including the old non-listener process after save and at final evidence capture. They do not read cmdline/environ or credential scalars. Unknown reads fail/record evidence error instead of inventing absence. Bootstrap writes only its own fixture metadata.

Read original orphan probe results: under Node PID1, the known orphan becomes Z/PPid1; with docker-init PID1 it is absent after the same experiment. Both actual containers exit0/non-OOM and removal commands return0, with inspect reporting no such object. The original wrapper's exit1/cleanupfalse is preserved; its separate addendum correctly identifies the case-sensitive text mismatch and does not rerun/rewrite the result or claim the v3 daemon had actually been observed as Z.

This probe qualifies the fixture reaping mechanism, not native KTX stop correctness or SC11 PASS. The new actual case must still reach the real owner and inspect its new originalDaemonAfterSave/final facts: --init alone is not evidence that the actual previous daemon terminated, and listener change alone must not be narrated as a fresh process-terminal observation. Report absent/Z/live/unknown as actually observed and retain failure/phase gaps. No old v2/v3 result may be relabeled on the basis of the kernel probe.

The added private facts are before assertions and inside bounded final evidence collection; cleanup remains own-container/volume-only. Author20/20 plus compile evidence was read, not rerun. Actual resource permission and all scenario adjudication remain with M.
