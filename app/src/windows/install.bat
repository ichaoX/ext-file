@echo off

setlocal

cd "%~dp0"

set /p choice="Do you want to install to this directory (y/n)? "

if /i "%choice%"=="y" (
    echo Installing...
) else if /i "%choice%"=="n" (
    echo Canceled.
    pause
    goto :eof
) else (
    echo Invalid choice. Please choose y or n.
    pause
    goto :eof
)

set "APP_PATH=%CD%\fsa-host.exe"

if not exist "%APP_PATH%" (
    set "APP_PATH=%CD%\run.bat"
)

set "MANIFEST_PATH=%CD%\manifest.json"

powershell -Command "(Get-Content 'manifest.template.json') -replace '\"__APP_PATH__\"', '\"%APP_PATH:\=\\%\"' | Set-Content 'manifest.json'" ^
 && reg add HKCU\Software\Mozilla\NativeMessagingHosts\webext.fsa.app /ve /t REG_SZ /d "%MANIFEST_PATH%" /f

pause