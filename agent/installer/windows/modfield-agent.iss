; ModField agent installer for Windows 10/11, current user only.
; No administrator: PrivilegesRequired=lowest, everything under
; %LOCALAPPDATA%\Programs\ModField and HKCU. Nothing in Program Files, HKLM
; or Windows services. The uninstaller is registered under HKCU and shows
; in "Installed apps".
;
; Build: iscc /DVersion=0.3.0 /DArch=x64 /DBinary=..\..\dist\modfield-agent_windows_amd64_v1\modfield-agent.exe modfield-agent.iss
; Sign (release workflow): the .exe before packaging and the setup after (Authenticode).

#ifndef Version
  #define Version "0.0.0"
#endif
#ifndef Arch
  #define Arch "x64"
#endif
#ifndef Binary
  #define Binary "modfield-agent.exe"
#endif
; Inno's architecture identifier: x64 has an "...compatible" form (also runs on
; ARM under emulation); arm64 is just "arm64" — there is no "arm64compatible".
#if Arch == "arm64"
  #define ArchId "arm64"
#else
  #define ArchId "x64compatible"
#endif

[Setup]
AppId={{6C1C4B9E-3E43-4D0B-9C62-5C2E3F7A1D10}
AppName=ModField Agent
AppVersion={#Version}
AppPublisher=ModField
DefaultDirName={localappdata}\Programs\ModField
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=
ArchitecturesAllowed={#ArchId}
ArchitecturesInstallIn64BitMode={#ArchId}
OutputBaseFilename=ModField-Agent-{#Version}-{#Arch}-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=ModField Agent
UninstallDisplayIcon={app}\modfield-agent.exe
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "pt"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "de"; MessagesFile: "compiler:Languages\German.isl"

[Files]
Source: "{#Binary}"; DestDir: "{app}"; DestName: "modfield-agent.exe"; Flags: ignoreversion

[Registry]
; Start with Windows for this user only.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "ModField Agent"; ValueData: """{app}\modfield-agent.exe"""; Flags: uninsdeletevalue

[Run]
Filename: "{app}\modfield-agent.exe"; Description: "Iniciar o agente agora"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{cmd}"; Parameters: "/C taskkill /IM modfield-agent.exe /F"; Flags: runhidden; RunOnceId: "StopAgent"

[UninstallDelete]
; Keys and paired browsers live in %LOCALAPPDATA%\ModField; removed with the app.
Type: filesandordirs; Name: "{localappdata}\ModField"
