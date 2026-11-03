@echo off
setlocal
rem ============================================================
rem  Sube TODO el contenido de esta carpeta a GitHub (sobrescribe)
rem  Repo: https://github.com/jamanteiga/PLANTFINC  (rama main)
rem  Colocar este .bat en la carpeta con index.html, core.js, etc.
rem
rem  Autenticacion sin preguntar:
rem   - Opcion A (recomendada): Git Credential Manager de Git for Windows.
rem     La primera vez abre el navegador para iniciar sesion; despues
rem     recuerda la sesion y no vuelve a pedir nada.
rem   - Opcion B: definir una vez la variable de usuario GITHUB_TOKEN
rem     con un token personal (permiso "Contents: read/write" sobre el
rem     repo). Con ella el .bat nunca pregunta. Desde cmd:
rem        setx GITHUB_TOKEN ghp_xxxxxxxxxxxx
rem     (el token NO se guarda en este fichero ni en .git/config)
rem ============================================================

set "REPO=https://github.com/jamanteiga/PLANTFINC.git"
set "BRANCH=main"

cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: Git no esta instalado. Descargalo de https://git-scm.com/download/win
  pause
  exit /b 1
)

if not exist ".git" (
  git init
)
git checkout -B %BRANCH% >nul 2>nul

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  git remote add origin %REPO%
) else (
  git remote set-url origin %REPO%
)

git config user.name  >nul 2>nul || git config user.name  "jamanteiga"
git config user.email >nul 2>nul || git config user.email "jamanteiga@gmail.com"

git add -A
git commit -m "PLANTFINC %date% %time%" >nul 2>nul
if errorlevel 1 echo (Sin cambios nuevos que confirmar; se fuerza igualmente el envio)

if defined GITHUB_TOKEN (
  for /f %%i in ('powershell -NoProfile -Command "[Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('x-access-token:' + $env:GITHUB_TOKEN))"') do set "B64=%%i"
  git -c http.extraheader="Authorization: Basic %B64%" push --force -u origin %BRANCH%
) else (
  git push --force -u origin %BRANCH%
)

if errorlevel 1 (
  echo.
  echo ERROR al subir. Revisa la conexion, el permiso sobre el repo o el token.
  pause
  exit /b 1
)

echo.
echo Subido y sobrescrito en %REPO% (%BRANCH%).
echo Si usas GitHub Pages: Settings ^> Pages ^> Branch: %BRANCH% / (root)
pause
endlocal