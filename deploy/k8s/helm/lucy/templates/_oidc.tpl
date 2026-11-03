{{/*
OIDC wiring helpers (Lucy v0.25 / L25-06, Spec §10.1).

Kept in its own partial instead of `_helpers.tpl` so the OIDC block stays
self-contained: the OIDC profile is rendered, validated and mounted by
exactly one template set (oidc-configmap.yaml + deployment.yaml).

Three hard rules encoded here:

  1. The client secret VALUE never enters the chart. It is referenced by
     name only — `oidc.existingSecret` (Secret) + `oidc.clientSecretKey`
     (key inside it). The chart never renders a Secret for OIDC.
  2. The pod only ever learns two FILE PATHS:
     LUCY_OIDC_CONFIG_FILE and LUCY_OIDC_CLIENT_SECRET_FILE.
  3. The chart never reaches the network. `discoveryUrl` / JWKS / the
     provider endpoints are plain values; nothing is fetched at install
     time (Spec §8.3, OIDC-22).
*/}}

{{/*
Mounted path of the OIDC provider profile (non-sensitive ConfigMap).
*/}}
{{- define "lucy.oidc.profilePath" -}}
/data/lucy/oidc/profile.yaml
{{- end -}}

{{/*
Mounted path of the OIDC client secret (customer-managed Secret, read-only).
*/}}
{{- define "lucy.oidc.clientSecretPath" -}}
/data/lucy/oidc/client-secret
{{- end -}}

{{/*
Normalized public WebUI origin: https, no path / query / fragment.
Only meaningful after `lucy.oidc.validate` has passed.

`.Values.webui` / `.Values.oidc` are read through `default dict` because a
customer values file may set the block to null (Helm then drops the whole
key); the chart must report a clean validation error, not a template
nil-pointer panic.
*/}}
{{- define "lucy.oidc.publicUrl" -}}
{{- $webui := .Values.webui | default dict -}}
{{- $parsed := urlParse ((index $webui "publicUrl") | default "" | toString | trim) -}}
{{- printf "%s://%s" $parsed.scheme $parsed.host -}}
{{- end -}}

{{/*
Fail-loud validation for the enabled case (Spec §10.1).

Every problem aborts the render instead of producing a Deployment that
cannot start. Called from the OIDC ConfigMap template and from the
Deployment, so either render path validates.
*/}}
{{- define "lucy.oidc.validate" -}}
{{- $oidc := .Values.oidc | default dict -}}
{{- $webui := .Values.webui | default dict -}}

{{/* --- webui.publicUrl: https origin, no path / query / fragment --- */}}
{{- $publicUrl := (index $webui "publicUrl") | default "" | toString | trim -}}
{{- if eq $publicUrl "" -}}
{{- fail "Lucy Helm chart requires webui.publicUrl when oidc.enabled=true: the OIDC redirect_uri origin is built from it and the callback cookie requires HTTPS (e.g. https://lucy.example.com)." -}}
{{- end -}}
{{- if not (regexMatch "^https://[A-Za-z0-9._~%-]+(:[0-9]+)?(/)?$" $publicUrl) -}}
{{- fail (printf "Lucy Helm chart requires webui.publicUrl to be an https origin without path, query or fragment when oidc.enabled=true; got %q" $publicUrl) -}}
{{- end -}}
{{- $public := urlParse $publicUrl -}}
{{- if ne $public.scheme "https" -}}
{{- fail (printf "Lucy Helm chart requires webui.publicUrl to use https when oidc.enabled=true; got %q" $publicUrl) -}}
{{- end -}}
{{- if not $public.host -}}
{{- fail (printf "Lucy Helm chart requires webui.publicUrl to carry a host when oidc.enabled=true; got %q" $publicUrl) -}}
{{- end -}}
{{- if $public.query -}}
{{- fail (printf "Lucy Helm chart requires webui.publicUrl to be an origin without a query string when oidc.enabled=true; got %q" $publicUrl) -}}
{{- end -}}
{{- if $public.fragment -}}
{{- fail (printf "Lucy Helm chart requires webui.publicUrl to be an origin without a fragment when oidc.enabled=true; got %q" $publicUrl) -}}
{{- end -}}
{{- $publicPath := $public.path | default "" | trim -}}
{{- if and (ne $publicPath "") (ne $publicPath "/") -}}
{{- fail (printf "Lucy Helm chart requires webui.publicUrl to be an origin without a path when oidc.enabled=true; got %q" $publicUrl) -}}
{{- end -}}

{{/* --- security.access: HTTPS only (callback origin + Secure cookie) --- */}}
{{- $security := .Values.security | default dict -}}
{{- $access := (index $security "access") | default "https" | toString | trim -}}
{{- if ne $access "https" -}}
{{- fail (printf "Lucy Helm chart requires security.access=https when oidc.enabled=true: the OIDC callback origin and the session cookie both require HTTPS; got %q" $access) -}}
{{- end -}}

{{/* --- client secret reference: name + key only, never a value --- */}}
{{- $existingSecret := $oidc.existingSecret | default "" | toString | trim -}}
{{- if eq $existingSecret "" -}}
{{- fail "Lucy Helm chart requires oidc.existingSecret when oidc.enabled=true: it must name the customer-managed Kubernetes Secret that holds the OIDC client secret. NEVER put the secret value in values.yaml." -}}
{{- end -}}
{{- $clientSecretKey := $oidc.clientSecretKey | default "" | toString | trim -}}
{{- if eq $clientSecretKey "" -}}
{{- fail "Lucy Helm chart requires oidc.clientSecretKey when oidc.enabled=true: it must name the key inside oidc.existingSecret that holds the OIDC client secret." -}}
{{- end -}}

{{/* --- provider profile fields --- */}}
{{- range $field := list "issuer" "authorizationEndpoint" "tokenEndpoint" "jwksUri" "clientId" -}}
{{- $value := index $oidc $field | default "" | toString | trim -}}
{{- if eq $value "" -}}
{{- fail (printf "Lucy Helm chart requires oidc.%s when oidc.enabled=true" $field) -}}
{{- end -}}
{{- end -}}
{{- range $field := list "issuer" "authorizationEndpoint" "tokenEndpoint" "jwksUri" -}}
{{- $value := index $oidc $field | toString | trim -}}
{{- if not (regexMatch "^https?://[^[:space:]]+$" $value) -}}
{{- fail (printf "Lucy Helm chart requires oidc.%s to be an absolute http(s) URL when oidc.enabled=true; got %q" $field $value) -}}
{{- end -}}
{{- end -}}
{{- range $field := list "discoveryUrl" "endSessionEndpoint" -}}
{{- $value := index $oidc $field | default "" | toString | trim -}}
{{- if and (ne $value "") (not (regexMatch "^https?://[^[:space:]]+$" $value)) -}}
{{- fail (printf "Lucy Helm chart requires oidc.%s to be an absolute http(s) URL when it is set; got %q" $field $value) -}}
{{- end -}}
{{- end -}}
{{- $scopes := $oidc.scopes | default "" | toString | trim -}}
{{- if not $scopes -}}
{{- fail "Lucy Helm chart requires oidc.scopes when oidc.enabled=true" -}}
{{- end -}}
{{- if not (has "openid" (splitList " " $scopes)) -}}
{{- fail (printf "Lucy Helm chart requires oidc.scopes to contain the standalone scope \"openid\" when oidc.enabled=true; got %q" $scopes) -}}
{{- end -}}
{{- $tokenAuth := $oidc.tokenEndpointAuth | default "" | toString | trim -}}
{{- if not (or (eq $tokenAuth "client_secret_post") (eq $tokenAuth "client_secret_basic")) -}}
{{- fail (printf "Lucy Helm chart requires oidc.tokenEndpointAuth to be client_secret_post or client_secret_basic when oidc.enabled=true; got %q" $tokenAuth) -}}
{{- end -}}
{{- $logoutStyle := $oidc.logoutStyle | default "" | toString | trim -}}
{{- if and (ne $logoutStyle "") (not (or (eq $logoutStyle "id_token_hint") (eq $logoutStyle "access_token"))) -}}
{{- fail (printf "Lucy Helm chart requires oidc.logoutStyle to be id_token_hint or access_token when it is set; got %q" $logoutStyle) -}}
{{- end -}}
{{- $redirectPath := $oidc.redirectPath | default "" | toString | trim -}}
{{- if or (not (hasPrefix "/" $redirectPath)) (contains "?" $redirectPath) (contains " " $redirectPath) -}}
{{- fail (printf "Lucy Helm chart requires oidc.redirectPath to be an absolute path without query when oidc.enabled=true; got %q" $redirectPath) -}}
{{- end -}}

{{/* --- extraEnvFrom must not break the fixed security contract --- */}}
{{- range (.Values.extraEnvFrom | default list) -}}
{{- $source := "" -}}
{{- $prefix := .prefix | default "" | toString -}}
{{- if .secretRef -}}{{- $source = .secretRef.name | default "" | toString -}}{{- end -}}
{{- if .configMapRef -}}{{- $source = .configMapRef.name | default "" | toString -}}{{- end -}}
{{- if and (ne $source "") (eq $source $existingSecret) -}}
{{- fail (printf "Lucy Helm chart refuses to project the OIDC client secret Secret %q into the pod env via extraEnvFrom: the client secret value may only reach the process as a read-only file (LUCY_OIDC_CLIENT_SECRET_FILE)." $source) -}}
{{- end -}}
{{- if hasPrefix "LUCY_OIDC" $prefix -}}
{{- fail (printf "Lucy Helm chart refuses extraEnvFrom prefix %q: it could shadow the reserved OIDC env contract (LUCY_OIDC_CONFIG_FILE / LUCY_OIDC_CLIENT_SECRET_FILE)." $prefix) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
The OIDC provider profile written to the read-only ConfigMap (Spec §4.2).

Field order follows the Spec. Optional reserved fields (discoveryUrl,
endSessionEndpoint, logoutStyle) are omitted when empty so the profile
never carries a blank value. The client secret is NOT part of the profile.
*/}}
{{- define "lucy.oidc.profile" -}}
{{- $oidc := .Values.oidc | default dict -}}
issuer: {{ $oidc.issuer | toString | trim | quote }}
authorizationEndpoint: {{ $oidc.authorizationEndpoint | toString | trim | quote }}
tokenEndpoint: {{ $oidc.tokenEndpoint | toString | trim | quote }}
jwksUri: {{ $oidc.jwksUri | toString | trim | quote }}
{{- with ($oidc.endSessionEndpoint | default "" | toString | trim) }}
endSessionEndpoint: {{ . | quote }}
{{- end }}
clientId: {{ $oidc.clientId | toString | trim | quote }}
scopes: {{ $oidc.scopes | toString | trim | quote }}
tokenEndpointAuth: {{ $oidc.tokenEndpointAuth | toString | trim | quote }}
{{- with ($oidc.logoutStyle | default "" | toString | trim) }}
logoutStyle: {{ . | quote }}
{{- end }}
redirectPath: {{ $oidc.redirectPath | toString | trim | quote }}
publicWebuiUrl: {{ include "lucy.oidc.publicUrl" . | quote }}
{{- with ($oidc.discoveryUrl | default "" | toString | trim) }}
discoveryUrl: {{ . | quote }}
{{- end }}
{{- end -}}
