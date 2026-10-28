; The launcher never goes into a server or game folder: uninstalling or updating it would remove its folder, and the
; launcher refuses a server inside its own folder. With such a folder chosen, Next stays greyed.
!macro customHeader
  !define MUI_DIRECTORYPAGE_TEXT_TOP "Choose a folder of its own for the launcher. Not the folder of your server or of your game: those stay where they are."
!macroend

!ifndef BUILD_UNINSTALLER
Function .onVerifyInstDir
  IfFileExists "$INSTDIR\Start_All_Server.bat" bad
  IfFileExists "$INSTDIR\mysql\bin\mysqld.exe" bad
  IfFileExists "$INSTDIR\Ascension.exe" bad
  IfFileExists "$INSTDIR\Data\*.MPQ" bad
  IfFileExists "$INSTDIR\..\Start_All_Server.bat" bad
  IfFileExists "$INSTDIR\..\Ascension.exe" bad
  Return
  bad:
    Abort
FunctionEnd
!endif
