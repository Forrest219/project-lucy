{{/*
Lucy chart helpers.

These helpers are intentionally narrow: chart name, fully-qualified app
labels, secret projection, and a few boolean-to-port guards. Anything more
elaborate should live in the calling template for readability.
*/}}

{{/* Chart name (override via .Values.nameOverride). */}}
{{- define "lucy.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Fully-qualified app name. Truncated to 63 chars per RFC 1123 label rules
so it fits in K8s resources that embed it in labels / owner refs.
*/}}
{{- define "lucy.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/* Chart label / selector standard. */}}
{{- define "lucy.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "lucy.labels" -}}
helm.sh/chart: {{ include "lucy.chart" . }}
{{ include "lucy.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/component: data-agent-runtime
app.kubernetes.io/part-of: lucy
{{- end -}}

{{- define "lucy.selectorLabels" -}}
app.kubernetes.io/name: {{ include "lucy.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Secret name resolution. */}}
{{- define "lucy.secretName" -}}
{{- if .Values.existingSecret -}}
{{- .Values.existingSecret -}}
{{- else -}}
{{- include "lucy.fullname" . -}}-secrets
{{- end -}}
{{- end -}}

{{/* PVC name resolution. */}}
{{- define "lucy.pvcName" -}}
{{- if .Values.persistence.existingClaim -}}
{{- .Values.persistence.existingClaim -}}
{{- else -}}
{{- include "lucy.fullname" . -}}-data
{{- end -}}
{{- end -}}

{{/* ServiceAccount name. */}}
{{- define "lucy.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "lucy.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
Compose-contract env block. These mirror docker-compose.yml so that the
Dockerfile image behaves identically inside the pod.

The caller is expected to apply `| nindent 12` (or similar) so each env
entry lands on its own line at the correct indent.
*/}}
{{- define "lucy.composeEnv" -}}
- name: KTX_PROJECT_ROOT
  value: {{ .Values.env.KTX_PROJECT_ROOT | default "/data/lucy" | quote }}
- name: LUCY_WEBUI_HOST
  value: "0.0.0.0"
- name: LUCY_WEBUI_PORT
  value: {{ .Values.containerPorts.webui | default 5174 | quote }}
- name: LUCY_PROXY_HOST
  value: "0.0.0.0"
- name: LUCY_PROXY_PORT
  value: {{ .Values.containerPorts.mcp | default 7879 | quote }}
- name: LUCY_PROXY_UPSTREAM_HOST
  value: "127.0.0.1"
- name: LUCY_PROXY_UPSTREAM_PORT
  value: "7878"
- name: KTX_TELEMETRY_DISABLED
  value: "1"
- name: POSTHOG_DISABLED
  value: {{ .Values.env.POSTHOG_DISABLED | default "1" | quote }}
- name: LUCY_BUNDLED_KTX_VERSION
  value: {{ .Values.lucy.bundledKtxVersion | default "0.16.0" | quote }}
{{ if .Values.env.LUCY_PUBLIC_MCP_URL -}}
- name: LUCY_PUBLIC_MCP_URL
  value: {{ .Values.env.LUCY_PUBLIC_MCP_URL | quote }}
{{ end -}}
{{ if .Values.env.LUCY_ALLOW_PLACEHOLDER_KTX -}}
- name: LUCY_ALLOW_PLACEHOLDER_KTX
  value: {{ .Values.env.LUCY_ALLOW_PLACEHOLDER_KTX | quote }}
{{ end -}}
{{- end -}}