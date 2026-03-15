---
name: deploy-verify
description: This skill should be used when the user asks to "check deploy", "verify deployment", "compare expected state", "/allclear deploy", or wants to know if the cluster matches the expected configuration. Use it to compare expected Kubernetes state from kustomize overlays or helm charts against actual cluster state, reporting mismatches for image tags, configmaps, and other resources.
version: 1.0.0
allowed-tools: Bash
---

# AllClear Deploy Verification

kubectl available: !`command -v kubectl >/dev/null 2>&1 && echo "yes" || echo "no"`

## Steps

1. **Check prerequisites.** If kubectl is "no" above, print exactly:
   `AllClear deploy: kubectl not available — skipping deploy verification`
   Then stop. Do not proceed. Do not execute any further steps.

2. **Check cluster permissions.** Run:
   ```bash
   kubectl auth can-i get pods >/dev/null 2>&1; AUTH_EXIT=$?
   ```
   If `AUTH_EXIT` is non-zero, print exactly:
   `AllClear deploy: insufficient cluster permissions — check kubeconfig context`
   Then stop. Do not proceed.

3. **Parse arguments.** Read the user's invocation for:
   - First positional argument = environment name (e.g., "production", "staging"). If not provided, default to searching for "production" or "prod".
   - `--diff` flag = if present, show full unified diff output in the final report.
   Store the resolved environment name as `ENV` and whether `--diff` was passed as `SHOW_DIFF`.

4. **Detect overlay path.** Search for a kustomize overlay in the following order (substitute `ENV` for the environment name):
   1. `k8s/overlays/<ENV>/`
   2. `deploy/overlays/<ENV>/`
   3. `kustomize/overlays/<ENV>/`
   4. `overlays/<ENV>/`
   5. `k8s/<ENV>/` (flat layout without "overlays" subdirectory)
   6. Project root `kustomization.yaml` (single-environment projects)

   For each candidate, check if a `kustomization.yaml` file exists there:
   ```bash
   OVERLAY_PATH=""
   for DIR in "k8s/overlays/$ENV" "deploy/overlays/$ENV" "kustomize/overlays/$ENV" "overlays/$ENV" "k8s/$ENV"; do
     if [ -f "$DIR/kustomization.yaml" ]; then
       OVERLAY_PATH="$DIR"
       break
     fi
   done
   if [ -z "$OVERLAY_PATH" ] && [ -f "kustomization.yaml" ]; then
     OVERLAY_PATH="."
   fi
   ```

   If no kustomize overlay is found, check for Helm:
   ```bash
   USE_HELM=""
   CHART_PATH=""
   if [ -f "Chart.yaml" ]; then
     USE_HELM="yes"; CHART_PATH="."
   elif [ -d "helm/" ] && [ -f "helm/Chart.yaml" ]; then
     USE_HELM="yes"; CHART_PATH="helm/"
   fi
   ```

   If neither kustomize (`OVERLAY_PATH` is empty) nor Helm (`USE_HELM` is empty) is detected, print a message listing all locations that were searched and stop gracefully. Do not error out.

5. **Compare expected vs actual state.** Use `set +e` or capture exit code explicitly — do NOT let exit code 1 stop execution, because `kubectl diff` exits 1 when diffs are found (this is the informational case, not an error). Exit code 0 means in sync; exit code 1 means differences found; exit code >1 means a real kubectl error.

   For **kustomize**:
   ```bash
   set +e
   DIFF_OUTPUT=$(kubectl diff -k "$OVERLAY_PATH" 2>&1)
   DIFF_EXIT=$?
   set -e
   # DIFF_EXIT == 0: in sync
   # DIFF_EXIT == 1: differences found (informational — not an error)
   # DIFF_EXIT > 1: kubectl error (real failure)
   ```
   If `DIFF_EXIT > 1`, print the error output and stop.

   For **Helm**:
   First check if the helm-diff plugin is installed:
   ```bash
   helm plugin list 2>/dev/null | grep -q "diff"
   HELM_DIFF_AVAILABLE=$?
   ```
   If helm-diff is available (`HELM_DIFF_AVAILABLE == 0`):
   ```bash
   set +e
   DIFF_OUTPUT=$(helm diff upgrade "$RELEASE_NAME" "$CHART_PATH" -f values.yaml 2>&1)
   DIFF_EXIT=$?
   set -e
   ```
   If helm-diff is not available, fall back to the template pipeline:
   ```bash
   set +e
   DIFF_OUTPUT=$(helm template "$RELEASE_NAME" "$CHART_PATH" -f values.yaml 2>&1 | kubectl diff -f - 2>&1)
   DIFF_EXIT=$?
   set -e
   ```
   Note in the output that the helm-diff plugin was not found and the `helm template | kubectl diff -f -` fallback was used.

6. **Extract image tags.** Compare expected image tags from the overlay against tags running in the cluster. (Covers DPLY-02.)

   Expected tags from kustomize overlay:
   ```bash
   EXPECTED_IMAGES=$(kubectl kustomize "$OVERLAY_PATH" 2>/dev/null | grep 'image:' | awk '{print $2}' | sort -u)
   ```

   Actual running tags from cluster:
   ```bash
   ACTUAL_IMAGES=$(kubectl get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[0].image}{"\n"}{end}' 2>/dev/null)
   ```

   Build and display a comparison table with columns: **Service | Expected Image | Actual Image | Status (MATCH / MISMATCH)**. Mark any row where the image tags do not match as MISMATCH.

7. **Summarize configmap state.** (Covers DPLY-03.)
   If the `DIFF_OUTPUT` from step 5 contains lines referencing configmap changes (look for `kind: ConfigMap` in the diff output), extract and highlight those sections separately under a "Configmap Changes" heading.

   For targeted inspection of a specific configmap, run:
   ```bash
   kubectl get configmap <name> -n <namespace> -o yaml
   ```
   Always use the namespace defined in the kustomize overlay or helm values — do not default to "default" namespace silently.

8. **Report results.** Display the following sections:

   **Overall Status:** Print `IN SYNC` if `DIFF_EXIT == 0`, or `DRIFTED` if `DIFF_EXIT == 1`.

   **Image Tag Comparison:**
   Show the full comparison table from step 6 (service, expected image, actual image, status).

   **Configmap Changes:**
   If any configmap diffs were found in step 7, show them here. If none, print "No configmap changes detected."

   **Diff Output:**
   - If `--diff` flag was passed (`SHOW_DIFF` is set), show the complete unified diff output from `DIFF_OUTPUT` in a fenced code block.
   - If `--diff` was not passed, show only a summary of changed resource names (extract resource names from the `DIFF_OUTPUT` lines), not the full unified diff.

   **Read-only notice:** This skill performs verification only. No changes have been applied to the cluster. Never run `kubectl apply` — this skill is read-only.
