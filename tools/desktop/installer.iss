[Setup]
AppName=LLaMA Pro
AppVersion=2.0.4
DefaultDirName={localappdata}\LLaMA Pro
DefaultGroupName=LLaMA Pro
OutputDir=dist-installer
OutputBaseFilename=LLaMA-Pro-Setup
SetupIconFile=..\ui\static\favicon.ico
Compression=lzma
SolidCompression=yes
DisableProgramGroupPage=yes
DisableDirPage=no
UsePreviousAppDir=no
UsePreviousTasks=no
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64

[Files]
; Package directory from electron-builder
Source: "dist\win-unpacked\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs

; C++ engine binaries & DLLs
Source: "..\..\build\bin\*"; DestDir: "{app}\bin"; Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: "*.log,*.txt"

; Packaged Python orchestrator
Source: "..\orchestrator\dist\orchestrator.exe"; DestDir: "{app}\bin"; Flags: ignoreversion
Source: "..\orchestrator\providers.json"; DestDir: "{app}\bin"; Flags: ignoreversion
Source: "..\orchestrator\swarm_configs.json"; DestDir: "{app}\bin"; Flags: ignoreversion

; Copy local MCP server directories
Source: "..\mcp\*"; DestDir: "{app}\tools\mcp"; Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: "node_modules\.bin\*"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Icons]
Name: "{group}\LLaMA Pro"; Filename: "{app}\LLaMA Pro.exe"
Name: "{autodesktop}\LLaMA Pro"; Filename: "{app}\LLaMA Pro.exe"; IconFilename: "{app}\LLaMA Pro.exe"; Tasks: desktopicon

[Run]
Filename: "{tmp}\vc_redist.x64.exe"; Parameters: "/install /quiet /norestart"; Check: VCRedistNeedsInstall; StatusMsg: "Installing Visual C++ Redistributable..."; Flags: waituntilterminated skipifdoesntexist
Filename: "{app}\LLaMA Pro.exe"; Description: "Launch LLaMA Pro"; Flags: nowait postinstall skipifsilent

[Code]
function VCRedistNeedsInstall: Boolean;
var
  Version: String;
begin
  if RegQueryStringValue(HKEY_LOCAL_MACHINE, 'SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64', 'Version', Version) then
    Result := False
  else
    Result := True;
end;

var
  DownloadPage: TDownloadWizardPage;

procedure InitializeWizard;
begin
  DownloadPage := CreateDownloadPage(SetupMessage(msgWizardPreparing), SetupMessage(msgPreparingDesc), nil);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  if (CurPageID = wpReady) and VCRedistNeedsInstall then
  begin
    DownloadPage.Clear;
    DownloadPage.Add('https://aka.ms/vs/17/release/vc_redist.x64.exe', 'vc_redist.x64.exe', '');
    DownloadPage.Show;
    try
      try
        DownloadPage.Download;
        Result := True;
      except
        if DownloadPage.AbortedByUser then
          Log('Aborted by user.')
        else
          SuppressibleMsgBox(AddPeriod(GetExceptionMessage), mbCriticalError, MB_OK, IDOK);
        Result := False;
      end;
    finally
      DownloadPage.Hide;
    end;
  end else
    Result := True;
end;
