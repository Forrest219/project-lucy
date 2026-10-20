# Open-mode recovery note

Replace this file before preparing the instance. Record the quiesced PVC backup
path and the current image. Helm rollback does not restore `admins.yaml` or
`.ktx-ui/security.sqlite`. Restoring the backup returns the disk to the old
open-mode state.
