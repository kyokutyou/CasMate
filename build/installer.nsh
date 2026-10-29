!macro customUnInstall
  ; The per-user app must ask the protected helper to remove its optional service.
  ; Never silently leave a running privileged component after an uninstall.
  IfFileExists "$INSTDIR\resources\resources\pc-status-worker\CasMate.PcStatus.Worker.exe" 0 casmate_service_done
  nsExec::ExecToStack '"$INSTDIR\resources\resources\pc-status-worker\CasMate.PcStatus.Worker.exe" --direct-firewall-uninstall'
  Pop $0
  Pop $1
  StrCmp $0 "0" casmate_service_done
  MessageBox MB_OK|MB_ICONEXCLAMATION "直接接続サービスを削除できませんでした。Windowsの許可を確認し、もう一度アンインストールしてください。"
  Abort
  casmate_service_done:
!macroend
