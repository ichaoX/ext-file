@echo off

setlocal

cd "%~dp0"

reg delete HKCU\Software\Mozilla\NativeMessagingHosts\webext.fsa.app /f

pause
