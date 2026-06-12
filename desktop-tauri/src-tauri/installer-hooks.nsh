; Custom NSIS installer hooks for WorkCraft.
;
; WorkCraft runs as two processes: the Tauri UI (WorkCraft.exe) and a PyInstaller
; sidecar (workcraft-backend.exe). The backend keeps several .pyd files loaded
; (e.g. PIL's _imaging.pyd, mypyc-compiled modules), which locks them on disk.
;
; Tauri's default NSIS template only terminates ${MAINBINARYNAME}.exe before
; writing files, so if the backend is still running the installer fails with
; "Error opening file for writing: ...\backend\_internal\*.pyd".
;
; This hook runs before file extraction and force-kills the backend sidecar
; (and any leftover main binary instances) so the install can overwrite
; locked files cleanly.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Terminating WorkCraft backend process if running..."

  ; Kill the backend sidecar. Try current-user first (matches our default
  ; per-user install), then fall back to the machine-wide variant so this
  ; also works when the installer is running elevated.
  nsis_tauri_utils::FindProcessCurrentUser "workcraft-backend.exe"
  Pop $R0
  ${If} $R0 = 0
    nsis_tauri_utils::KillProcessCurrentUser "workcraft-backend.exe"
    Pop $R0
  ${EndIf}

  nsis_tauri_utils::FindProcess "workcraft-backend.exe"
  Pop $R0
  ${If} $R0 = 0
    nsis_tauri_utils::KillProcess "workcraft-backend.exe"
    Pop $R0
  ${EndIf}

  ; Also make sure the main binary is gone. Tauri's CheckIfAppIsRunning
  ; handles this later too, but doing it here means we don't race the
  ; backend respawning a UI process between the two steps.
  nsis_tauri_utils::FindProcessCurrentUser "WorkCraft.exe"
  Pop $R0
  ${If} $R0 = 0
    nsis_tauri_utils::KillProcessCurrentUser "WorkCraft.exe"
    Pop $R0
  ${EndIf}

  ; Give Windows a moment to release the file handles the killed
  ; processes were holding before we start overwriting files.
  Sleep 1000
!macroend
