@echo off

cd /d "C:\Users\jaman\Documents\PROYECTOS\PLANTFINC"

git add .

git commit -m "Actualizacion PLANTFINC"

git branch -M main

git push -u origin main --force

pause