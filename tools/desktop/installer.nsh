!macro customInstall
  DetailPrint "Checking for Visual C++ 2015-2022 Redistributable (x64)..."
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Version"
  StrCmp $0 "" installVCRedist skipVCRedist

installVCRedist:
  DetailPrint "Visual C++ Redistributable not found. Downloading..."
  nsExec::ExecToLog 'powershell -Command "Invoke-WebRequest -Uri https://aka.ms/vs/17/release/vc_redist.x64.exe -OutFile $TEMP\vc_redist.x64.exe"'
  DetailPrint "Installing Visual C++ Redistributable..."
  ExecWait '"$TEMP\vc_redist.x64.exe" /install /quiet /norestart'
  Delete "$TEMP\vc_redist.x64.exe"
  Goto doneVCRedist

skipVCRedist:
  DetailPrint "Visual C++ Redistributable is already installed."

doneVCRedist:
!macroend
