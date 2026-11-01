@echo off
title Subir PLANTFINC a GitHub

cd /d "C:\Users\jaman\Documents\PROYECTOS\PLANTFINC"

echo.
echo =====================================
echo      SUBIENDO PLANTFINC A GITHUB
echo =====================================
echo.

git init

git remote remove origin 2>nul

git remote add origin https://github.com/jamanteiga/PLANTFINC.git

git add .

git commit -m "Actualizacion PLANTFINC"

git branch -M main

git push -u origin main

echo.
echo =====================================
echo        PROCESO FINALIZADO
echo =====================================
pause