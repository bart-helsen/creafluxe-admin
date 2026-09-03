@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM ==========================================================================
REM  Creafluxe Admin - structured commit ^& push
REM
REM  Builds a Conventional Commit message, the same style as the Phase 2 script:
REM      type(scope): short summary
REM      <blank line>
REM      longer explanation of what and why
REM
REM  Just double-click, answer the prompts, done. It stages everything,
REM  commits with the message you build, and pushes to origin/main.
REM ==========================================================================

echo ==================================================
echo   Creafluxe Admin  -  commit ^& push
echo ==================================================
echo.

REM --- Make sure we are in a git repository ---------------------------------
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [X] Deze map is geen git-repository.
  goto :end
)

REM --- Show what changed ----------------------------------------------------
echo Huidige wijzigingen:
git status --short
echo.

REM --- 1. Type -------------------------------------------------------------
echo Kies een type:
echo    1^) feat      nieuwe functionaliteit
echo    2^) fix       bugfix
echo    3^) chore     onderhoud / configuratie
echo    4^) refactor  herstructurering, zelfde gedrag
echo    5^) docs      documentatie
echo    6^) style     opmaak / lint, geen logica
echo    7^) test      tests
echo    8^) perf      performance
set /p "TYPECHOICE=Nummer 1-8 (of typ zelf een type, leeg = feat): "

set "TYPE="
if "!TYPECHOICE!"=="" set "TYPE=feat"
if "!TYPECHOICE!"=="1" set "TYPE=feat"
if "!TYPECHOICE!"=="2" set "TYPE=fix"
if "!TYPECHOICE!"=="3" set "TYPE=chore"
if "!TYPECHOICE!"=="4" set "TYPE=refactor"
if "!TYPECHOICE!"=="5" set "TYPE=docs"
if "!TYPECHOICE!"=="6" set "TYPE=style"
if "!TYPECHOICE!"=="7" set "TYPE=test"
if "!TYPECHOICE!"=="8" set "TYPE=perf"
if not defined TYPE set "TYPE=!TYPECHOICE!"

REM --- 2. Scope (optional) --------------------------------------------------
set /p "SCOPE=Scope, bv. machines / catalogue (leeg = geen): "

REM --- 3. Summary (required) ------------------------------------------------
set /p "SUBJECT=Korte samenvatting (verplicht): "
if "!SUBJECT!"=="" (
  echo.
  echo [X] Een samenvatting is verplicht. Gestopt, niets gecommit.
  goto :end
)

REM --- 4. Body (optional) ---------------------------------------------------
set /p "BODY=Uitleg wat en waarom (optioneel): "

REM --- Assemble the subject line --------------------------------------------
if "!SCOPE!"=="" (
  set "HEADER=!TYPE!: !SUBJECT!"
) else (
  set "HEADER=!TYPE!(!SCOPE!): !SUBJECT!"
)

echo.
echo --------------------------------------------------
echo Commitbericht:
echo   !HEADER!
if not "!BODY!"=="" (
  echo.
  echo   !BODY!
)
echo --------------------------------------------------
echo.

REM --- Stage everything -----------------------------------------------------
git add -A

REM --- Nothing to commit? ---------------------------------------------------
git diff --cached --quiet
if not errorlevel 1 (
  echo [i] Er zijn geen wijzigingen om te committen.
  goto :end
)

REM --- Commit (subject + body as separate -m so git adds the blank line) ----
if "!BODY!"=="" (
  git commit -m "!HEADER!"
) else (
  git commit -m "!HEADER!" -m "!BODY!"
)
if errorlevel 1 (
  echo.
  echo [X] Commit mislukt.
  goto :end
)

REM --- Push -----------------------------------------------------------------
echo.
echo Pushen naar origin/main...
git push
if errorlevel 1 (
  echo.
  echo [X] Push mislukt. Controleer je internetverbinding of GitHub-login.
  goto :end
)

echo.
echo [OK] Klaar - je wijzigingen staan op GitHub.

:end
echo.
pause
endlocal
