[Setup]
AppName=LLaMA Pro
AppVersion=2.0.1
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
Filename: "{app}\LLaMA Pro.exe"; Description: "Launch LLaMA Pro"; Flags: nowait postinstall skipifsilent
