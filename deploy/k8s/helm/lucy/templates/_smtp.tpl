{{/*
SMTP wiring helpers (Lucy v0.25 / L25-05, Spec §10.1).

Kept in its own partial, mirroring the OIDC block, so the SMTP wiring stays
self-contained: the profile is rendered, validated and mounted by exactly one
template set (smtp-configmap.yaml + deployment.yaml).

Hard rules encoded here:

  1. The SMTP password VALUE never enters the chart. It is referenced by name
     only — `smtp.existingSecret` (Secret) + `smtp.passwordKey` (key inside
     it). The chart never renders a Secret for SMTP, and `smtp.password` in
     values is a hard render failure.
  2. The pod only ever learns FILE PATHS:
     LUCY_SMTP_PROFILE_FILE, LUCY_SMTP_PASSWORD_FILE and — only when a private
     CA is configured — LUCY_SMTP_CA_FILE.
  3. The chart never reaches the network, and the probes never touch SMTP.
  4. Plaintext SMTP is not an option: `security` is `tls` or `starttls`, and
     anything else fails the render.
*/}}

{{/*
Mounted path of the SMTP profile (non-sensitive ConfigMap).
*/}}
{{- define "lucy.smtp.profilePath" -}}
/data/lucy/smtp/profile.yaml
{{- end -}}

{{/*
Mounted path of the SMTP password (customer-managed Secret, read-only).
*/}}
{{- define "lucy.smtp.passwordPath" -}}
/data/lucy/smtp/password
{{- end -}}

{{/*
Mounted path of the optional private CA (customer-managed Secret, read-only).
*/}}
{{- define "lucy.smtp.caPath" -}}
/data/lucy/smtp/ca.pem
{{- end -}}

{{/*
A shape check for a single mailbox address. The runtime profile parser is the
strict gate (Spec §3.1); the chart only has to catch the obvious mistakes at
render time: a missing `@`, whitespace, control characters or an over-long
address.
*/}}
{{- define "lucy.smtp.validAddress" -}}
{{- $value := . | toString | trim -}}
{{- if and (ne $value "") (le (len $value) 254) (contains "@" $value) (not (contains "@@" $value)) (not (regexMatch "[\\s\\x00-\\x1f\\x7f]" $value)) (not (hasPrefix "@" $value)) (not (hasSuffix "@" $value)) -}}
true
{{- end -}}
{{- end -}}

{{/*
Fail-loud validation for the enabled case (Spec §10.1).

Every problem aborts the render instead of producing a Deployment that cannot
start or that would silently drop the notifications. Called from the SMTP
ConfigMap template and from the Deployment, so either render path validates.
*/}}
{{- define "lucy.smtp.validate" -}}
{{- $smtp := .Values.smtp | default dict -}}

{{/* --- an inline password is forbidden outright --- */}}
{{- if hasKey $smtp "password" -}}
{{- fail "Lucy Helm chart refuses smtp.password in values.yaml: the SMTP password may only reach the process as a read-only file from a customer-managed Kubernetes Secret." -}}
{{- end -}}
{{- if hasKey $smtp "pass" -}}
{{- fail "Lucy Helm chart refuses smtp.pass in values.yaml: the SMTP password may only reach the process as a read-only file from a customer-managed Kubernetes Secret." -}}
{{- end -}}
{{- if hasKey $smtp "secret" -}}
{{- fail "Lucy Helm chart refuses smtp.secret in values.yaml: the SMTP password may only reach the process as a read-only file from a customer-managed Kubernetes Secret." -}}
{{- end -}}

{{/* --- host --- */}}
{{- $host := $smtp.host | default "" | toString | trim -}}
{{- if eq $host "" -}}
{{- fail "Lucy Helm chart requires smtp.host when smtp.enabled=true (the customer provides the SMTP server in their own network)." -}}
{{- end -}}
{{- if gt (len $host) 253 -}}
{{- fail (printf "Lucy Helm chart requires smtp.host to be at most 253 characters; got %d" (len $host)) -}}
{{- end -}}
{{- if regexMatch "[\\s\\x00-\\x1f\\x7f]" $host -}}
{{- fail (printf "Lucy Helm chart requires smtp.host without whitespace or control characters; got %q" $host) -}}
{{- end -}}
{{- if contains "://" $host -}}
{{- fail (printf "Lucy Helm chart requires smtp.host to be a host name or IP address without a scheme; got %q" $host) -}}
{{- end -}}
{{- if contains "/" $host -}}
{{- fail (printf "Lucy Helm chart requires smtp.host without a path; got %q" $host) -}}
{{- end -}}
{{- if contains "@" $host -}}
{{- fail (printf "Lucy Helm chart requires smtp.host without userinfo; got %q" $host) -}}
{{- end -}}
{{- if contains ":" $host -}}
{{- fail (printf "Lucy Helm chart requires smtp.host without a port; the port has its own smtp.port field; got %q" $host) -}}
{{- end -}}

{{/* --- port --- */}}
{{- $port := $smtp.port | default 0 | toString | trim -}}
{{- if not (regexMatch "^[0-9]{1,5}$" $port) -}}
{{- fail (printf "Lucy Helm chart requires smtp.port to be an integer between 1 and 65535; got %q" $port) -}}
{{- end -}}
{{- if or (lt (int $port) 1) (gt (int $port) 65535) -}}
{{- fail (printf "Lucy Helm chart requires smtp.port to be an integer between 1 and 65535; got %q" $port) -}}
{{- end -}}

{{/* --- security: plaintext is not an option --- */}}
{{- $security := $smtp.security | default "" | toString | trim -}}
{{- if not (or (eq $security "tls") (eq $security "starttls")) -}}
{{- fail (printf "Lucy Helm chart requires smtp.security to be tls or starttls when smtp.enabled=true; plaintext SMTP is not supported; got %q" $security) -}}
{{- end -}}

{{/* --- from --- */}}
{{- $from := $smtp.from | default "" | toString | trim -}}
{{- if eq $from "" -}}
{{- fail "Lucy Helm chart requires smtp.from when smtp.enabled=true (a single mailbox address, no display name)." -}}
{{- end -}}
{{- if not (include "lucy.smtp.validAddress" $from) -}}
{{- fail (printf "Lucy Helm chart requires smtp.from to be a single mailbox address without whitespace or control characters; got %q" $from) -}}
{{- end -}}

{{/* --- recipients --- */}}
{{- $recipients := $smtp.recipients | default list -}}
{{- if not (kindIs "slice" $recipients) -}}
{{- fail "Lucy Helm chart requires smtp.recipients to be a list of mailbox addresses." -}}
{{- end -}}
{{- if lt (len $recipients) 1 -}}
{{- fail "Lucy Helm chart requires at least one smtp.recipients entry when smtp.enabled=true." -}}
{{- end -}}
{{- if gt (len $recipients) 20 -}}
{{- fail (printf "Lucy Helm chart requires at most 20 smtp.recipients entries; got %d" (len $recipients)) -}}
{{- end -}}
{{- range $recipient := $recipients -}}
{{- if not (include "lucy.smtp.validAddress" $recipient) -}}
{{- fail (printf "Lucy Helm chart requires every smtp.recipients entry to be a mailbox address without whitespace or control characters; got %q" ($recipient | toString)) -}}
{{- end -}}
{{- end -}}

{{/* --- username implies a password file --- */}}
{{- $username := $smtp.username | default "" | toString | trim -}}
{{- $existingSecret := $smtp.existingSecret | default "" | toString | trim -}}
{{- $passwordKey := $smtp.passwordKey | default "" | toString | trim -}}
{{- if ne $username "" -}}
{{- if eq $existingSecret "" -}}
{{- fail "Lucy Helm chart requires smtp.existingSecret when smtp.enabled=true and smtp.username is set: it must name the customer-managed Kubernetes Secret that holds the SMTP password. NEVER put the password in values.yaml." -}}
{{- end -}}
{{- if eq $passwordKey "" -}}
{{- fail "Lucy Helm chart requires smtp.passwordKey when smtp.enabled=true and smtp.username is set: it must name the key inside smtp.existingSecret that holds the SMTP password." -}}
{{- end -}}
{{- if regexMatch "[\\s\\x00-\\x1f\\x7f]" $username -}}
{{- fail (printf "Lucy Helm chart requires smtp.username without whitespace or control characters; got %q" $username) -}}
{{- end -}}
{{- end -}}

{{/* --- optional private CA --- */}}
{{- $ca := $smtp.ca | default dict -}}
{{- if $ca.enabled -}}
{{- $caSecret := $ca.existingSecret | default "" | toString | trim -}}
{{- $caKey := $ca.key | default "" | toString | trim -}}
{{- if eq $caSecret "" -}}
{{- fail "Lucy Helm chart requires smtp.ca.existingSecret when smtp.enabled=true and smtp.ca.enabled=true: the private CA must come from a customer-managed Kubernetes Secret." -}}
{{- end -}}
{{- if eq $caKey "" -}}
{{- fail "Lucy Helm chart requires smtp.ca.key when smtp.enabled=true and smtp.ca.enabled=true: it must name the key inside smtp.ca.existingSecret that holds the CA bundle." -}}
{{- end -}}
{{- end -}}

{{/* --- extraEnvFrom must not break the fixed SMTP env contract --- */}}
{{- range (.Values.extraEnvFrom | default list) -}}
{{- $source := "" -}}
{{- $prefix := .prefix | default "" | toString -}}
{{- if .secretRef -}}{{- $source = .secretRef.name | default "" | toString -}}{{- end -}}
{{- if .configMapRef -}}{{- $source = .configMapRef.name | default "" | toString -}}{{- end -}}
{{- if and (ne $source "") (ne $existingSecret "") (eq $source $existingSecret) -}}
{{- fail (printf "Lucy Helm chart refuses to project the SMTP password Secret %q into the pod env via extraEnvFrom: the password may only reach the process as a read-only file (LUCY_SMTP_PASSWORD_FILE)." $source) -}}
{{- end -}}
{{- if hasPrefix "LUCY_SMTP" $prefix -}}
{{- fail (printf "Lucy Helm chart refuses extraEnvFrom prefix %q: it could shadow the reserved SMTP env contract (LUCY_SMTP_PROFILE_FILE / LUCY_SMTP_PASSWORD_FILE / LUCY_SMTP_CA_FILE)." $prefix) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
The SMTP profile written to the read-only ConfigMap (Spec §3.1).

The field order follows the runtime profile contract. `username` is omitted
when empty so the profile never carries a blank credential name. The password
is NOT part of the profile — it stays in the customer's own Secret.
*/}}
{{- define "lucy.smtp.profile" -}}
{{- $smtp := .Values.smtp | default dict -}}
enabled: true
host: {{ $smtp.host | toString | trim | quote }}
port: {{ $smtp.port | int }}
security: {{ $smtp.security | toString | trim | quote }}
from: {{ $smtp.from | toString | trim | quote }}
{{- with ($smtp.username | default "" | toString | trim) }}
username: {{ . | quote }}
{{- end }}
recipients:
{{- range $recipient := ($smtp.recipients | default list) }}
  - {{ $recipient | toString | trim | quote }}
{{- end }}
notifications:
  auditHealth: {{ $smtp.auditHealth | default false }}
{{- end -}}
